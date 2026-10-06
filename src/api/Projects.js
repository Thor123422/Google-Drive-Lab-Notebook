/**
 * Projects.js — the top-level container everything else hangs from.
 */

/** Next free project code, PRJ-001 style. */
function nextProjectCode_() {
  var max = 0;
  all_('projects').forEach(function (p) {
    var m = /^PRJ-(\d+)$/i.exec(str_(p.code).trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  var n = max + 1;
  return 'PRJ-' + (n < 1000 ? ('00' + n).slice(-3) : String(n));
}

/** Shape a stored project row for the client, with light rollups. */
function projectSummary_(project) {
  var id = project.id;
  var entries = byField_('entries', 'projectId', id);
  var lastEntry = entries.reduce(function (acc, e) {
    return (!acc || str_(e.date) > str_(acc.date)) ? e : acc;
  }, null);

  return {
    id: id,
    code: project.code,
    name: project.name,
    status: project.status,
    priority: project.priority,
    description: project.description,
    objective: project.objective,
    startDate: project.startDate,
    targetDate: project.targetDate,
    closedDate: project.closedDate,
    tags: parseTags_(project.tags),
    folderId: project.folderId,
    budgetTotal: num_(project.budgetTotal),
    currency: project.currency || getSetting_('currency', 'USD'),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    counts: {
      entries: entries.length,
      files: countWhere_('files', function (f) { return f.projectId === id; }),
      boms: countWhere_('boms', function (b) { return b.projectId === id; }),
      purchases: countWhere_('purchases', function (p) { return p.projectId === id; })
    },
    lastEntryDate: lastEntry ? lastEntry.date : '',
    budget: budgetSnapshot_(id)
  };
}

function listProjects_(options) {
  var opts = options || {};
  var search = str_(opts.search).trim();
  var status = str_(opts.status).trim();
  var includeArchived = bool_(opts.includeArchived);

  var rows = all_('projects').filter(function (p) {
    if (status && p.status !== status) return false;
    if (!status && !includeArchived && p.status === 'archived') return false;
    if (search) {
      var hay = [p.code, p.name, p.description, p.objective, p.tags].join(' ');
      if (!contains_(hay, search)) return false;
    }
    return true;
  });

  var order = { active: 0, planning: 1, on_hold: 2, complete: 3, archived: 4 };
  rows.sort(function (a, b) {
    var da = order[a.status] === undefined ? 9 : order[a.status];
    var db = order[b.status] === undefined ? 9 : order[b.status];
    if (da !== db) return da - db;
    return str_(a.code).localeCompare(str_(b.code));
  });

  return rows.map(projectSummary_);
}

function getProject_(id) {
  return projectSummary_(getOr404_('projects', id, 'Project'));
}

function createProject_(payload) {
  var data = payload || {};
  var now = new Date();
  var name = require_(data.name, 'Project name');
  var code = str_(data.code).trim() || nextProjectCode_();

  if (firstWhere_('projects', function (p) {
    return str_(p.code).toLowerCase() === code.toLowerCase();
  })) {
    fail_('Project code "' + code + '" is already in use.', 'duplicate', { field: 'code' });
  }

  var project = insert_('projects', {
    code: code,
    name: maxLen_(name, 200, 'Project name'),
    status: enum_(data.status, 'projectStatus', 'Status', 'planning'),
    priority: enum_(data.priority, 'projectPriority', 'Priority', 'normal'),
    description: maxLen_(str_(data.description), 20000, 'Description'),
    objective: maxLen_(str_(data.objective), 5000, 'Objective'),
    startDate: optDate_(data.startDate, 'Start date') || todayStr_(),
    targetDate: optDate_(data.targetDate, 'Target date'),
    closedDate: '',
    tags: joinTags_(data.tags),
    folderId: '',
    budgetTotal: num_(data.budgetTotal, 0),
    currency: str_(data.currency).trim() || getSetting_('currency', 'USD'),
    createdAt: now,
    updatedAt: now
  });

  // Create the Drive folder straight away so uploads and links have a home.
  try {
    ensureProjectFolder_(project);
  } catch (err) {
    console.warn('project folder creation deferred: ' + err);
  }

  audit_('create', 'project', project.id, code + ' ' + name);
  return projectSummary_(findById_('projects', project.id));
}

function updateProject_(id, payload) {
  var existing = getOr404_('projects', id, 'Project');
  var data = payload || {};
  var patch = { updatedAt: new Date() };

  if (data.name !== undefined) patch.name = maxLen_(require_(data.name, 'Project name'), 200, 'Project name');
  if (data.code !== undefined) {
    var code = require_(data.code, 'Project code');
    var clash = firstWhere_('projects', function (p) {
      return p.id !== existing.id && str_(p.code).toLowerCase() === code.toLowerCase();
    });
    if (clash) fail_('Project code "' + code + '" is already in use.', 'duplicate', { field: 'code' });
    patch.code = code;
  }
  if (data.status !== undefined) {
    patch.status = enum_(data.status, 'projectStatus', 'Status', 'planning');
    var closing = patch.status === 'complete' || patch.status === 'archived';
    if (closing && !str_(existing.closedDate)) patch.closedDate = todayStr_();
    if (!closing) patch.closedDate = '';
  }
  if (data.priority !== undefined) patch.priority = enum_(data.priority, 'projectPriority', 'Priority', 'normal');
  if (data.description !== undefined) patch.description = maxLen_(str_(data.description), 20000, 'Description');
  if (data.objective !== undefined) patch.objective = maxLen_(str_(data.objective), 5000, 'Objective');
  if (data.startDate !== undefined) patch.startDate = optDate_(data.startDate, 'Start date');
  if (data.targetDate !== undefined) patch.targetDate = optDate_(data.targetDate, 'Target date');
  if (data.tags !== undefined) patch.tags = joinTags_(data.tags);
  if (data.budgetTotal !== undefined) patch.budgetTotal = num_(data.budgetTotal, 0);
  if (data.currency !== undefined) patch.currency = str_(data.currency).trim() || 'USD';

  var saved = update_('projects', id, patch);

  if (patch.name || patch.code) renameProjectFolder_(saved);
  audit_('update', 'project', id, str_(saved.code) + ' ' + str_(saved.name));
  return projectSummary_(saved);
}

/**
 * Delete a project and everything filed under it. Drive files are left
 * in place unless `deleteDriveFiles` is set — losing a schematic to a
 * stray click is not recoverable from inside the app.
 */
function deleteProject_(id, options) {
  var project = getOr404_('projects', id, 'Project');
  var opts = options || {};
  var pid = project.id;

  if (opts.confirmName !== undefined &&
      str_(opts.confirmName).trim() !== str_(project.name).trim()) {
    fail_('Type the project name exactly to confirm deletion.', 'confirm_failed');
  }

  var files = byField_('files', 'projectId', pid);
  if (bool_(opts.deleteDriveFiles)) {
    files.forEach(function (f) {
      if (str_(f.source) !== 'upload') return; // never trash a linked original
      try { DriveApp.getFileById(f.driveId).setTrashed(true); } catch (err) { /* already gone */ }
    });
  }

  removeWhere_('entryLinks', function (r) { return r.projectId === pid; });
  removeWhere_('entries', function (r) { return r.projectId === pid; });
  removeWhere_('files', function (r) { return r.projectId === pid; });
  removeWhere_('bomLines', function (r) { return r.projectId === pid; });
  removeWhere_('boms', function (r) { return r.projectId === pid; });
  removeWhere_('purchases', function (r) { return r.projectId === pid; });
  removeWhere_('recurring', function (r) { return r.projectId === pid; });

  // Stock movements are the inventory's audit trail: keep the history,
  // just detach it from the project that no longer exists.
  byField_('txns', 'projectId', pid).forEach(function (t) {
    update_('txns', t.id, { projectId: '', note: str_(t.note) });
  });

  remove_('projects', pid);
  audit_('delete', 'project', pid, str_(project.code) + ' ' + str_(project.name));
  return { deleted: true, id: pid, files: files.length };
}

/** Options for the project pickers scattered through the UI. */
function projectOptions_() {
  return all_('projects')
    .filter(function (p) { return p.status !== 'archived'; })
    .sort(function (a, b) { return str_(a.code).localeCompare(str_(b.code)); })
    .map(function (p) {
      return { id: p.id, code: p.code, name: p.name, currency: p.currency };
    });
}
