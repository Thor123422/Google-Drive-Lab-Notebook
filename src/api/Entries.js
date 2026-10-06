/**
 * Entries.js — notebook entries and the links that tie them to files,
 * stock items, BOMs, purchases and other entries.
 *
 * Signing an entry freezes it. That is the point of a lab notebook: a
 * signed record can still be unlocked, but only deliberately and the
 * unlock is written to the audit log.
 */

/** Resolve one link into something the UI can render without extra calls. */
function resolveLink_(link) {
  var out = {
    id: link.id,
    entryId: link.entryId,
    projectId: link.projectId,
    targetType: link.targetType,
    targetId: link.targetId,
    label: link.label,
    note: link.note,
    createdAt: link.createdAt,
    title: str_(link.label),
    subtitle: '',
    url: '',
    missing: false
  };

  switch (link.targetType) {
    case 'file': {
      var file = findById_('files', link.targetId);
      if (!file) { out.missing = true; out.subtitle = 'File record deleted'; break; }
      out.title = out.title || file.name;
      out.subtitle = [file.category, file.revision ? 'rev ' + file.revision : '', humanSize_(file.size)]
        .filter(String).join(' · ');
      out.url = file.url;
      out.mimeType = file.mimeType;
      out.driveId = file.driveId;
      break;
    }
    case 'item': {
      var item = findById_('items', link.targetId);
      if (!item) { out.missing = true; out.subtitle = 'Item deleted'; break; }
      out.title = out.title || item.name;
      out.subtitle = [item.sku, item.mpn].filter(String).join(' · ');
      break;
    }
    case 'entry': {
      var entry = findById_('entries', link.targetId);
      if (!entry) { out.missing = true; out.subtitle = 'Entry deleted'; break; }
      out.title = out.title || entry.title;
      out.subtitle = '#' + entry.entryNo + ' · ' + entry.date;
      break;
    }
    case 'bom': {
      var bom = findById_('boms', link.targetId);
      if (!bom) { out.missing = true; out.subtitle = 'BOM deleted'; break; }
      out.title = out.title || bom.name;
      out.subtitle = 'rev ' + bom.revision + ' · ' + bom.status;
      break;
    }
    case 'purchase': {
      var po = findById_('purchases', link.targetId);
      if (!po) { out.missing = true; out.subtitle = 'Purchase deleted'; break; }
      out.title = out.title || (po.vendor + ' ' + po.orderNumber).trim();
      out.subtitle = po.date + ' · ' + po.status;
      break;
    }
    case 'url':
      out.url = str_(link.targetId);
      out.title = out.title || out.url;
      out.subtitle = 'External link';
      break;
    default:
      out.subtitle = 'Unknown link type';
      out.missing = true;
  }

  if (!out.title) out.title = '(untitled)';
  return out;
}

function entryLinks_(entryId) {
  return byField_('entryLinks', 'entryId', entryId).map(resolveLink_);
}

function entryShape_(entry, withLinks) {
  var project = findById_('projects', entry.projectId);
  return {
    id: entry.id,
    projectId: entry.projectId,
    projectCode: project ? project.code : '',
    projectName: project ? project.name : '',
    entryNo: num_(entry.entryNo),
    date: entry.date,
    title: entry.title,
    type: entry.type,
    status: entry.status,
    body: entry.body,
    tags: parseTags_(entry.tags),
    author: entry.author,
    signedAt: entry.signedAt,
    signedBy: entry.signedBy,
    locked: !!str_(entry.signedAt),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    linkCount: countWhere_('entryLinks', function (l) { return l.entryId === entry.id; }),
    links: withLinks ? entryLinks_(entry.id) : undefined
  };
}

function listEntries_(options) {
  var opts = options || {};
  var projectId = str_(opts.projectId).trim();
  var search = str_(opts.search).trim();
  var type = str_(opts.type).trim();
  var limit = num_(opts.limit, 0);

  var rows = all_('entries').filter(function (e) {
    if (projectId && e.projectId !== projectId) return false;
    if (type && e.type !== type) return false;
    if (opts.from && str_(e.date) < str_(opts.from)) return false;
    if (opts.to && str_(e.date) > str_(opts.to)) return false;
    if (search) {
      var hay = [e.title, e.body, e.tags, e.type].join(' ');
      if (!contains_(hay, search)) return false;
    }
    return true;
  });

  rows.sort(function (a, b) {
    if (str_(a.date) !== str_(b.date)) return str_(b.date).localeCompare(str_(a.date));
    return num_(b.entryNo) - num_(a.entryNo);
  });

  if (limit > 0) rows = rows.slice(0, limit);
  return rows.map(function (e) { return entryShape_(e, false); });
}

function getEntry_(id) {
  return entryShape_(getOr404_('entries', id, 'Entry'), true);
}

function createEntry_(payload) {
  var data = payload || {};
  var project = getOr404_('projects', require_(data.projectId, 'Project'), 'Project');
  var now = new Date();

  var entry = insert_('entries', {
    projectId: project.id,
    entryNo: nextSeq_('entries', 'entryNo', 'projectId', project.id),
    date: optDate_(data.date, 'Entry date') || todayStr_(),
    title: maxLen_(require_(data.title, 'Entry title'), 300, 'Entry title'),
    type: enum_(data.type, 'entryType', 'Entry type', 'note'),
    status: 'draft',
    body: maxLen_(str_(data.body), 45000, 'Entry body'),
    tags: joinTags_(data.tags),
    author: str_(data.author).trim() || currentUser_(),
    signedAt: '',
    signedBy: '',
    createdAt: now,
    updatedAt: now
  });

  (data.links || []).forEach(function (link) {
    addEntryLink_(entry.id, link);
  });

  audit_('create', 'entry', entry.id, project.code + ' #' + entry.entryNo + ' ' + entry.title);
  return entryShape_(findById_('entries', entry.id), true);
}

function updateEntry_(id, payload) {
  var existing = getOr404_('entries', id, 'Entry');
  var data = payload || {};

  if (str_(existing.signedAt) && !bool_(data.force)) {
    fail_(
      'Entry #' + existing.entryNo + ' is signed. Unlock it first, or add a ' +
      'follow-up entry instead.',
      'locked'
    );
  }

  var patch = { updatedAt: new Date() };
  if (data.title !== undefined) patch.title = maxLen_(require_(data.title, 'Entry title'), 300, 'Entry title');
  if (data.date !== undefined) patch.date = optDate_(data.date, 'Entry date') || existing.date;
  if (data.type !== undefined) patch.type = enum_(data.type, 'entryType', 'Entry type', 'note');
  if (data.body !== undefined) patch.body = maxLen_(str_(data.body), 45000, 'Entry body');
  if (data.tags !== undefined) patch.tags = joinTags_(data.tags);
  if (data.author !== undefined) patch.author = str_(data.author);

  var saved = update_('entries', id, patch);
  audit_('update', 'entry', id, '#' + saved.entryNo + ' ' + saved.title);
  return entryShape_(saved, true);
}

/** Freeze an entry: status final, signature and timestamp recorded. */
function signEntry_(id) {
  var entry = getOr404_('entries', id, 'Entry');
  if (str_(entry.signedAt)) return entryShape_(entry, true);

  var saved = update_('entries', id, {
    status: 'final',
    signedAt: new Date(),
    signedBy: currentUser_() || str_(entry.author) || 'unknown',
    updatedAt: new Date()
  });
  audit_('sign', 'entry', id, '#' + saved.entryNo + ' ' + saved.title);
  return entryShape_(saved, true);
}

/** Reopen a signed entry. The reason is required and is logged. */
function unsignEntry_(id, reason) {
  var entry = getOr404_('entries', id, 'Entry');
  if (!str_(entry.signedAt)) return entryShape_(entry, true);

  var why = require_(reason, 'Reason for unlocking');
  var saved = update_('entries', id, {
    status: 'draft', signedAt: '', signedBy: '', updatedAt: new Date()
  });
  audit_('unsign', 'entry', id,
    '#' + saved.entryNo + ' unlocked (was signed by ' + str_(entry.signedBy) +
    ' on ' + str_(entry.signedAt) + '): ' + why);
  return entryShape_(saved, true);
}

function deleteEntry_(id) {
  var entry = getOr404_('entries', id, 'Entry');
  if (str_(entry.signedAt)) {
    fail_('Signed entries cannot be deleted. Unlock it first if you really mean to.', 'locked');
  }
  removeWhere_('entryLinks', function (l) { return l.entryId === entry.id; });
  remove_('entries', entry.id);
  audit_('delete', 'entry', entry.id, '#' + entry.entryNo + ' ' + entry.title);
  return { deleted: true, id: entry.id };
}

/* ------------------------------ links ----------------------------- */

function addEntryLink_(entryId, payload) {
  var entry = getOr404_('entries', entryId, 'Entry');
  var data = payload || {};
  var targetType = enum_(data.targetType, 'linkTarget', 'Link type');
  var targetId = require_(data.targetId, 'Link target');

  if (targetType === 'url') {
    if (!/^https?:\/\//i.test(targetId)) {
      fail_('External links must start with http:// or https://.', 'invalid', { field: 'targetId' });
    }
  } else {
    var tables = { file: 'files', item: 'items', entry: 'entries', bom: 'boms', purchase: 'purchases' };
    getOr404_(tables[targetType], targetId, 'Linked ' + targetType);
    if (targetType === 'entry' && targetId === entry.id) {
      fail_('An entry cannot link to itself.', 'invalid');
    }
  }

  var dupe = firstWhere_('entryLinks', function (l) {
    return l.entryId === entry.id && l.targetType === targetType && l.targetId === targetId;
  });
  if (dupe) return resolveLink_(dupe);

  var link = insert_('entryLinks', {
    entryId: entry.id,
    projectId: entry.projectId,
    targetType: targetType,
    targetId: targetId,
    label: maxLen_(str_(data.label), 300, 'Link label'),
    note: maxLen_(str_(data.note), 1000, 'Link note'),
    createdAt: new Date()
  });
  return resolveLink_(link);
}

function removeEntryLink_(linkId) {
  var link = getOr404_('entryLinks', linkId, 'Link');
  remove_('entryLinks', link.id);
  return { deleted: true, id: link.id };
}

/**
 * Everything in a project that an entry can point at, grouped for the
 * link picker.
 */
function linkTargets_(projectId) {
  var pid = str_(projectId).trim();
  var groups = [];

  var files = byField_('files', 'projectId', pid).map(function (f) {
    return {
      targetType: 'file', targetId: f.id, title: f.name,
      subtitle: [f.category, f.revision ? 'rev ' + f.revision : '', humanSize_(f.size)]
        .filter(String).join(' · ')
    };
  });
  if (files.length) groups.push({ label: 'Files', options: files });

  var boms = byField_('boms', 'projectId', pid).map(function (b) {
    return {
      targetType: 'bom', targetId: b.id, title: b.name,
      subtitle: 'rev ' + b.revision + ' · ' + b.status
    };
  });
  if (boms.length) groups.push({ label: 'Bills of materials', options: boms });

  var purchases = byField_('purchases', 'projectId', pid).map(function (p) {
    return {
      targetType: 'purchase', targetId: p.id,
      title: (str_(p.vendor) + ' ' + str_(p.orderNumber)).trim() || str_(p.description),
      subtitle: p.date + ' · ' + p.status
    };
  });
  if (purchases.length) groups.push({ label: 'Purchases', options: purchases });

  var entries = byField_('entries', 'projectId', pid)
    .sort(function (a, b) { return num_(b.entryNo) - num_(a.entryNo); })
    .map(function (e) {
      return {
        targetType: 'entry', targetId: e.id, title: '#' + e.entryNo + ' ' + e.title,
        subtitle: e.date + ' · ' + e.type
      };
    });
  if (entries.length) groups.push({ label: 'Other entries', options: entries });

  var items = all_('items')
    .filter(function (i) { return i.active; })
    .sort(function (a, b) { return str_(a.name).localeCompare(str_(b.name)); })
    .map(function (i) {
      return {
        targetType: 'item', targetId: i.id, title: i.name,
        subtitle: [i.sku, i.mpn].filter(String).join(' · ')
      };
    });
  if (items.length) groups.push({ label: 'Inventory', options: items });

  return groups;
}

/** Every entry that references a given target — the reverse lookup. */
function backlinks_(targetType, targetId) {
  return where_('entryLinks', function (l) {
    return l.targetType === targetType && l.targetId === str_(targetId);
  }).map(function (l) {
    var entry = findById_('entries', l.entryId);
    if (!entry) return null;
    return {
      linkId: l.id,
      entryId: entry.id,
      entryNo: num_(entry.entryNo),
      title: entry.title,
      date: entry.date,
      type: entry.type,
      projectId: entry.projectId,
      note: l.note
    };
  }).filter(Boolean).sort(function (a, b) {
    return str_(b.date).localeCompare(str_(a.date));
  });
}
