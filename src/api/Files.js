/**
 * Files.js — uploads, Drive links and file records.
 *
 * Uploads use Drive's resumable protocol rather than buffering the whole
 * file in the script: the browser slices the file, each slice is PUT
 * straight through to Drive, and nothing larger than one chunk is ever
 * held in memory. That keeps multi-hundred-megabyte CAD and Gerber
 * archives workable.
 */

function UPLOAD_PROP_PREFIX() { return 'LN_UPLOAD_'; }

/* ---------------------------- shaping ----------------------------- */

function fileShape_(file, withBacklinks) {
  var project = findById_('projects', file.projectId);
  return {
    id: file.id,
    projectId: file.projectId,
    projectCode: project ? project.code : '',
    driveId: file.driveId,
    name: file.name,
    mimeType: file.mimeType,
    size: num_(file.size),
    sizeLabel: humanSize_(file.size),
    category: file.category,
    revision: file.revision,
    supersedesId: file.supersedesId,
    description: file.description,
    tags: parseTags_(file.tags),
    url: file.url,
    previewUrl: isPreviewable_(file.mimeType) ? drivePreviewUrl_(file.driveId) : '',
    source: file.source,
    uploadedAt: file.uploadedAt,
    uploadedBy: file.uploadedBy,
    supersededBy: supersededBy_(file.id),
    backlinks: withBacklinks ? backlinks_('file', file.id) : undefined
  };
}

function isPreviewable_(mimeType) {
  var m = str_(mimeType).toLowerCase();
  return m.indexOf('image/') === 0 || m === 'application/pdf';
}

/** The id of the file that replaced this one, if any. */
function supersededBy_(fileId) {
  var next = firstWhere_('files', function (f) { return f.supersedesId === fileId; });
  return next ? { id: next.id, name: next.name, revision: next.revision } : null;
}

function listFiles_(options) {
  var opts = options || {};
  var projectId = str_(opts.projectId).trim();
  var category = str_(opts.category).trim();
  var search = str_(opts.search).trim();
  var currentOnly = bool_(opts.currentOnly);

  var superseded = {};
  if (currentOnly) {
    all_('files').forEach(function (f) {
      if (f.supersedesId) superseded[f.supersedesId] = true;
    });
  }

  var rows = all_('files').filter(function (f) {
    if (projectId && f.projectId !== projectId) return false;
    if (category && f.category !== category) return false;
    if (currentOnly && superseded[f.id]) return false;
    if (search && !contains_([f.name, f.description, f.tags, f.revision].join(' '), search)) return false;
    return true;
  });

  rows.sort(function (a, b) {
    if (a.category !== b.category) return str_(a.category).localeCompare(str_(b.category));
    return str_(b.uploadedAt).localeCompare(str_(a.uploadedAt));
  });

  return rows.map(function (f) { return fileShape_(f, false); });
}

function getFile_(id) {
  return fileShape_(getOr404_('files', id, 'File'), true);
}

/* -------------------------- upload flow --------------------------- */

function uploadSessionKey_(uploadId) {
  return UPLOAD_PROP_PREFIX() + str_(uploadId);
}

function readUploadSession_(uploadId) {
  var raw = PropertiesService.getUserProperties().getProperty(uploadSessionKey_(uploadId));
  if (!raw) fail_('That upload has expired. Start it again.', 'upload_expired');
  return JSON.parse(raw);
}

function writeUploadSession_(uploadId, session) {
  PropertiesService.getUserProperties()
    .setProperty(uploadSessionKey_(uploadId), JSON.stringify(session));
}

function clearUploadSession_(uploadId) {
  PropertiesService.getUserProperties().deleteProperty(uploadSessionKey_(uploadId));
}

/**
 * Open a resumable Drive upload into the project's folder.
 * Returns the id the browser uses for the rest of the transfer.
 */
function beginUpload_(meta) {
  var data = meta || {};
  var project = getOr404_('projects', require_(data.projectId, 'Project'), 'Project');
  var name = maxLen_(require_(data.name, 'File name'), 250, 'File name');
  var size = requireNum_(data.size, 'File size', { min: 0, integer: true });
  var limits = UPLOAD_LIMITS();

  if (size > limits.maxBytes) {
    fail_(
      'That file is ' + humanSize_(size) + '. The uploader tops out at ' +
      humanSize_(limits.maxBytes) + ' — add it to Drive yourself and use ' +
      '"Link a Drive file" instead.',
      'too_large'
    );
  }

  var folder = ensureProjectFolder_(project);
  var mimeType = str_(data.mimeType).trim() || 'application/octet-stream';

  var response = UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true',
    {
      method: 'post',
      contentType: 'application/json; charset=UTF-8',
      headers: {
        Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': String(size)
      },
      payload: JSON.stringify({ name: name, parents: [folder.getId()], mimeType: mimeType }),
      muteHttpExceptions: true,
      followRedirects: false
    }
  );

  if (response.getResponseCode() !== 200) {
    fail_('Drive refused the upload: ' + response.getContentText().slice(0, 300), 'drive_error');
  }

  var headers = response.getAllHeaders();
  var sessionUri = headers.Location || headers.location;
  if (!sessionUri) fail_('Drive did not return an upload session.', 'drive_error');

  var uploadId = newId_('up');
  writeUploadSession_(uploadId, {
    sessionUri: sessionUri,
    projectId: project.id,
    name: name,
    mimeType: mimeType,
    size: size,
    category: enum_(data.category, 'fileCategory', 'Category', 'other'),
    revision: maxLen_(str_(data.revision), 40, 'Revision'),
    description: maxLen_(str_(data.description), 2000, 'Description'),
    tags: joinTags_(data.tags),
    supersedesId: str_(data.supersedesId),
    entryId: str_(data.entryId),
    offset: 0,
    startedAt: Date.now()
  });

  return { uploadId: uploadId, chunkBytes: limits.chunkBytes, size: size };
}

/**
 * Push one slice. `offset` is the byte position the slice starts at, so
 * a retried chunk is idempotent. Returns progress, or the finished file
 * record once Drive acknowledges the last byte.
 */
function uploadChunk_(uploadId, offset, base64Data) {
  var session = readUploadSession_(uploadId);
  var start = requireNum_(offset, 'Chunk offset', { min: 0, integer: true });
  var bytes = Utilities.base64Decode(require_(base64Data, 'Chunk data'));
  var length = bytes.length;

  if (!length) fail_('Empty chunk.', 'invalid');
  var end = start + length - 1;
  if (end >= session.size) {
    // The browser may round the final slice; trust the declared size.
    end = session.size - 1;
  }

  var response = UrlFetchApp.fetch(session.sessionUri, {
    method: 'put',
    headers: {
      'Content-Range': 'bytes ' + start + '-' + end + '/' + session.size
    },
    contentType: session.mimeType,
    payload: bytes,
    muteHttpExceptions: true,
    followRedirects: false
  });

  var code = response.getResponseCode();

  if (code === 308) {
    var range = response.getAllHeaders().Range || response.getAllHeaders().range || '';
    var m = /bytes=0-(\d+)/.exec(str_(range));
    session.offset = m ? Number(m[1]) + 1 : end + 1;
    writeUploadSession_(uploadId, session);
    return { done: false, uploadedBytes: session.offset, size: session.size };
  }

  if (code === 200 || code === 201) {
    var body = {};
    try { body = JSON.parse(response.getContentText()); } catch (err) { body = {}; }
    var driveId = str_(body.id);
    if (!driveId) fail_('Drive finished the upload but returned no file id.', 'drive_error');
    clearUploadSession_(uploadId);
    var record = registerUploadedFile_(session, driveId);
    return { done: true, uploadedBytes: session.size, size: session.size, file: record };
  }

  fail_(
    'Upload failed (HTTP ' + code + '): ' + response.getContentText().slice(0, 300),
    'drive_error'
  );
}

/** Write the Files row once Drive has the bytes. */
function registerUploadedFile_(session, driveId) {
  var url = 'https://drive.google.com/file/d/' + driveId + '/view';
  var actualSize = session.size;
  try {
    var driveFile = DriveApp.getFileById(driveId);
    actualSize = driveFile.getSize();
    url = driveFile.getUrl();
  } catch (err) {
    // Metadata read is a nicety; the record is valid without it.
  }

  var record = insert_('files', {
    projectId: session.projectId,
    driveId: driveId,
    name: session.name,
    mimeType: session.mimeType,
    size: actualSize,
    category: session.category,
    revision: session.revision,
    supersedesId: session.supersedesId,
    description: session.description,
    tags: session.tags,
    url: url,
    source: 'upload',
    uploadedAt: new Date(),
    uploadedBy: currentUser_()
  });

  if (session.entryId && findById_('entries', session.entryId)) {
    addEntryLink_(session.entryId, {
      targetType: 'file', targetId: record.id, label: record.name
    });
  }

  audit_('upload', 'file', record.id, record.name + ' (' + humanSize_(actualSize) + ')');
  return fileShape_(record, false);
}

function abortUpload_(uploadId) {
  var session = null;
  try { session = readUploadSession_(uploadId); } catch (err) { return { aborted: true }; }
  try {
    UrlFetchApp.fetch(session.sessionUri, {
      method: 'delete',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
  } catch (err) {
    // Drive expires abandoned sessions on its own.
  }
  clearUploadSession_(uploadId);
  return { aborted: true };
}

/* ------------------------ linking existing ------------------------ */

/**
 * Register a file that is already in Drive. `mode` 'reference' records
 * it where it sits; 'move' also files it under the project folder.
 */
function linkDriveFile_(payload) {
  var data = payload || {};
  var project = getOr404_('projects', require_(data.projectId, 'Project'), 'Project');
  var driveId = parseDriveId_(require_(data.driveIdOrUrl, 'Drive link'));
  if (!driveId) fail_('That does not look like a Drive file link or id.', 'invalid');

  var driveFile;
  try {
    driveFile = DriveApp.getFileById(driveId);
  } catch (err) {
    fail_(
      'Could not open that Drive file. Check the link, and that the file ' +
      'is in this Google account.',
      'not_found'
    );
  }

  var existing = firstWhere_('files', function (f) {
    return f.driveId === driveId && f.projectId === project.id;
  });
  if (existing) return fileShape_(existing, false);

  if (str_(data.mode) === 'move') {
    try {
      ensureProjectFolder_(project).addFile(driveFile);
    } catch (err) {
      console.warn('could not add file to project folder: ' + err);
    }
  }

  var record = insert_('files', {
    projectId: project.id,
    driveId: driveId,
    name: str_(data.name).trim() || driveFile.getName(),
    mimeType: driveFile.getMimeType(),
    size: driveFile.getSize(),
    category: enum_(data.category, 'fileCategory', 'Category', 'other'),
    revision: maxLen_(str_(data.revision), 40, 'Revision'),
    supersedesId: str_(data.supersedesId),
    description: maxLen_(str_(data.description), 2000, 'Description'),
    tags: joinTags_(data.tags),
    url: driveFile.getUrl(),
    source: 'link',
    uploadedAt: new Date(),
    uploadedBy: currentUser_()
  });

  if (data.entryId && findById_('entries', data.entryId)) {
    addEntryLink_(data.entryId, {
      targetType: 'file', targetId: record.id, label: record.name
    });
  }

  audit_('link', 'file', record.id, record.name);
  return fileShape_(record, false);
}

function updateFile_(id, payload) {
  var existing = getOr404_('files', id, 'File');
  var data = payload || {};
  var patch = {};

  if (data.name !== undefined) {
    patch.name = maxLen_(require_(data.name, 'File name'), 250, 'File name');
    if (str_(existing.source) === 'upload') {
      try { DriveApp.getFileById(existing.driveId).setName(patch.name); } catch (err) { /* ignore */ }
    }
  }
  if (data.category !== undefined) patch.category = enum_(data.category, 'fileCategory', 'Category', 'other');
  if (data.revision !== undefined) patch.revision = maxLen_(str_(data.revision), 40, 'Revision');
  if (data.description !== undefined) patch.description = maxLen_(str_(data.description), 2000, 'Description');
  if (data.tags !== undefined) patch.tags = joinTags_(data.tags);
  if (data.supersedesId !== undefined) {
    var target = str_(data.supersedesId).trim();
    if (target) {
      if (target === existing.id) fail_('A file cannot supersede itself.', 'invalid');
      getOr404_('files', target, 'Superseded file');
    }
    patch.supersedesId = target;
  }

  var saved = update_('files', id, patch);
  audit_('update', 'file', id, saved.name);
  return fileShape_(saved, true);
}

/**
 * Remove the record. The Drive file itself is only trashed when asked,
 * and never for a file that was linked rather than uploaded.
 */
function deleteFile_(id, options) {
  var file = getOr404_('files', id, 'File');
  var opts = options || {};
  var trashed = false;

  if (bool_(opts.trashDriveFile) && str_(file.source) === 'upload') {
    try {
      DriveApp.getFileById(file.driveId).setTrashed(true);
      trashed = true;
    } catch (err) {
      console.warn('could not trash Drive file: ' + err);
    }
  }

  removeWhere_('entryLinks', function (l) {
    return l.targetType === 'file' && l.targetId === file.id;
  });
  remove_('files', file.id);
  audit_('delete', 'file', file.id, file.name + (trashed ? ' (Drive file trashed)' : ''));
  return { deleted: true, id: file.id, driveTrashed: trashed };
}

/** Share a project's folder and return the link. */
function shareProjectFolder_(projectId, access) {
  var project = getOr404_('projects', projectId, 'Project');
  var folder = ensureProjectFolder_(project);
  var mode = str_(access).trim() || 'view';

  if (mode === 'private') {
    folder.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  } else {
    folder.setSharing(
      DriveApp.Access.ANYONE_WITH_LINK,
      mode === 'edit' ? DriveApp.Permission.EDIT : DriveApp.Permission.VIEW
    );
  }

  audit_('share', 'project', project.id, 'folder sharing set to ' + mode);
  return { url: driveUrl_(folder), access: mode };
}

/** Grant a named person access to the project folder. */
function shareProjectWith_(projectId, email, role) {
  var project = getOr404_('projects', projectId, 'Project');
  var address = require_(email, 'Email address');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
    fail_('That does not look like an email address.', 'invalid', { field: 'email' });
  }
  var folder = ensureProjectFolder_(project);
  if (str_(role) === 'edit') folder.addEditor(address);
  else folder.addViewer(address);

  audit_('share', 'project', project.id, 'shared with ' + address + ' as ' + (role || 'viewer'));
  return { url: driveUrl_(folder), email: address, role: str_(role) || 'view' };
}
