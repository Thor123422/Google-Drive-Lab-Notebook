/**
 * DriveLib.js — Drive folder plumbing.
 *
 * Layout created under the user's My Drive:
 *
 *   Lab Notebook/
 *     Lab Notebook Data            (the backing spreadsheet)
 *     Projects/
 *       PRJ-001 Widget revision B/ (one folder per project)
 *     _incoming/                   (temporary upload chunks)
 */

function ROOT_FOLDER_NAME() { return 'Lab Notebook'; }
function PROJECTS_FOLDER_NAME() { return 'Projects'; }
function TEMP_FOLDER_NAME() { return '_incoming'; }
function DB_FILE_NAME() { return 'Lab Notebook Data'; }

/** Find a direct child folder by name, or create it. */
function childFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent.createFolder(name);
}

/** The app's root folder, created on first use. */
function rootFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(PROP_KEYS().rootFolderId);
  if (id) {
    try {
      var folder = DriveApp.getFolderById(id);
      if (!folder.isTrashed()) return folder;
    } catch (err) {
      // fall through and re-create
    }
  }
  var created = childFolder_(DriveApp.getRootFolder(), ROOT_FOLDER_NAME());
  props.setProperty(PROP_KEYS().rootFolderId, created.getId());
  return created;
}

function projectsFolder_() {
  return childFolder_(rootFolder_(), PROJECTS_FOLDER_NAME());
}

function tempFolder_() {
  return childFolder_(rootFolder_(), TEMP_FOLDER_NAME());
}

/** Folder name for a project: code first so folders sort usefully. */
function projectFolderName_(project) {
  var code = str_(project.code).trim();
  var name = str_(project.name).trim() || 'Untitled project';
  return (code ? code + ' ' : '') + name;
}

/**
 * The Drive folder for a project, created and recorded on the project
 * row the first time it is needed.
 */
function ensureProjectFolder_(project) {
  var id = str_(project.folderId).trim();
  if (id) {
    try {
      var existing = DriveApp.getFolderById(id);
      if (!existing.isTrashed()) return existing;
    } catch (err) {
      // recorded folder is gone — make a new one below
    }
  }
  var folder = childFolder_(projectsFolder_(), projectFolderName_(project));
  update_('projects', project.id, { folderId: folder.getId(), updatedAt: new Date() });
  project.folderId = folder.getId();
  return folder;
}

/** Keep the Drive folder name in step with a renamed project. */
function renameProjectFolder_(project) {
  if (!str_(project.folderId)) return;
  try {
    var folder = DriveApp.getFolderById(project.folderId);
    var wanted = projectFolderName_(project);
    if (folder.getName() !== wanted) folder.setName(wanted);
  } catch (err) {
    console.warn('could not rename project folder: ' + err);
  }
}

/** A view URL that works for both files and folders. */
function driveUrl_(fileOrFolder) {
  try {
    return fileOrFolder.getUrl();
  } catch (err) {
    return '';
  }
}

/** Thumbnail/preview link for images and PDFs; '' when unavailable. */
function drivePreviewUrl_(driveId) {
  var id = str_(driveId).trim();
  return id ? 'https://drive.google.com/thumbnail?id=' + id + '&sz=w400' : '';
}

/**
 * Accept a Drive URL, an "open?id=" link or a bare id and return the id.
 */
function parseDriveId_(input) {
  var s = str_(input).trim();
  if (!s) return '';
  var patterns = [
    /\/d\/([a-zA-Z0-9_-]{10,})/,
    /[?&]id=([a-zA-Z0-9_-]{10,})/,
    /\/folders\/([a-zA-Z0-9_-]{10,})/
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = patterns[i].exec(s);
    if (m) return m[1];
  }
  return /^[a-zA-Z0-9_-]{10,}$/.test(s) ? s : '';
}

/** Delete temp upload chunks left behind by abandoned uploads. */
function sweepTempFolder_() {
  var cutoff = Date.now() - UPLOAD_LIMITS().staleChunkMs;
  var files = tempFolder_().getFiles();
  var removed = 0;
  while (files.hasNext()) {
    var f = files.next();
    try {
      if (f.getDateCreated().getTime() < cutoff) { f.setTrashed(true); removed++; }
    } catch (err) {
      // ignore individual failures; the sweep is best effort
    }
  }
  return removed;
}
