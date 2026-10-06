/**
 * Code.js — web app entry point and the single RPC door into the server.
 *
 * The client never calls domain functions directly. It calls rpc(action,
 * payload); everything comes back as { ok, data } or { ok, error } so
 * the UI has one error path instead of a dozen.
 */

function doGet(e) {
  var template = HtmlService.createTemplateFromFile('ui/index');
  template.bootstrapJson = JSON.stringify(initialPayload_());
  return template.evaluate()
    .setTitle(APP_NAME())
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Used by the HTML templates to inline partials. */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** Everything the UI needs for its first paint, inlined into the page. */
function initialPayload_() {
  try {
    var status = workspaceStatus_();
    if (!status.initialised) {
      return { ready: false, status: status, enums: ENUMS() };
    }
    return {
      ready: true,
      status: status,
      enums: ENUMS(),
      settings: getSettings_(),
      dashboard: dashboard_(),
      projects: projectOptions_()
    };
  } catch (err) {
    return {
      ready: false,
      error: { message: String(err && err.message ? err.message : err), code: 'boot_failed' },
      enums: ENUMS()
    };
  }
}

/* ------------------------------ RPC ------------------------------- */

/**
 * Action table. `mutates: true` makes the call take the script lock.
 * Each handler receives the whole payload object.
 */
function rpcRoutes_() {
  return {
    /* app ------------------------------------------------------- */
    'app.status':       { fn: function () { return workspaceStatus_(); } },
    'app.setup':        { fn: function () { return setupWorkspace_(); }, mutates: true },
    'app.seed':         { fn: function () { return { projectId: seedExample_() }; }, mutates: true },
    'app.settings':     { fn: function () { return getSettings_(); } },
    'app.saveSettings': { fn: function (p) { return saveSettings_(p.settings); }, mutates: true },
    'app.dashboard':    { fn: function () { return dashboard_(); } },
    'app.search':       { fn: function (p) { return globalSearch_(p.query, p); } },
    'app.activity':     { fn: function (p) { return recentActivity_(p.limit); } },
    'app.sweep':        { fn: function () { return { removed: sweepTempFolder_() }; }, mutates: true },

    /* projects -------------------------------------------------- */
    'projects.list':    { fn: function (p) { return listProjects_(p); } },
    'projects.options': { fn: function () { return projectOptions_(); } },
    'projects.get':     { fn: function (p) { return getProject_(p.id); } },
    'projects.create':  { fn: function (p) { return createProject_(p); }, mutates: true },
    'projects.update':  { fn: function (p) { return updateProject_(p.id, p); }, mutates: true },
    'projects.delete':  { fn: function (p) { return deleteProject_(p.id, p); }, mutates: true },

    /* notebook -------------------------------------------------- */
    'entries.list':        { fn: function (p) { return listEntries_(p); } },
    'entries.get':         { fn: function (p) { return getEntry_(p.id); } },
    'entries.create':      { fn: function (p) { return createEntry_(p); }, mutates: true },
    'entries.update':      { fn: function (p) { return updateEntry_(p.id, p); }, mutates: true },
    'entries.sign':        { fn: function (p) { return signEntry_(p.id); }, mutates: true },
    'entries.unsign':      { fn: function (p) { return unsignEntry_(p.id, p.reason); }, mutates: true },
    'entries.delete':      { fn: function (p) { return deleteEntry_(p.id); }, mutates: true },
    'entries.linkTargets': { fn: function (p) { return linkTargets_(p.projectId); } },
    'entries.addLink':     { fn: function (p) { return addEntryLink_(p.entryId, p); }, mutates: true },
    'entries.removeLink':  { fn: function (p) { return removeEntryLink_(p.id); }, mutates: true },

    /* files ----------------------------------------------------- */
    'files.list':        { fn: function (p) { return listFiles_(p); } },
    'files.get':         { fn: function (p) { return getFile_(p.id); } },
    'files.beginUpload': { fn: function (p) { return beginUpload_(p); } },
    'files.uploadChunk': { fn: function (p) { return uploadChunk_(p.uploadId, p.offset, p.data); } },
    'files.abortUpload': { fn: function (p) { return abortUpload_(p.uploadId); } },
    'files.link':        { fn: function (p) { return linkDriveFile_(p); }, mutates: true },
    'files.update':      { fn: function (p) { return updateFile_(p.id, p); }, mutates: true },
    'files.delete':      { fn: function (p) { return deleteFile_(p.id, p); }, mutates: true },
    'files.share':       { fn: function (p) { return shareProjectFolder_(p.projectId, p.access); } },
    'files.shareWith':   { fn: function (p) { return shareProjectWith_(p.projectId, p.email, p.role); } },

    /* inventory ------------------------------------------------- */
    'items.list':      { fn: function (p) { return listItems_(p); } },
    'items.get':       { fn: function (p) { return getItem_(p.id); } },
    'items.create':    { fn: function (p) { return createItem_(p); }, mutates: true },
    'items.update':    { fn: function (p) { return updateItem_(p.id, p); }, mutates: true },
    'items.delete':    { fn: function (p) { return deleteItem_(p.id, p); }, mutates: true },
    'items.setStock':  { fn: function (p) { return setStockLevel_(p.id, p.quantity, p.note); }, mutates: true },
    'items.txn':       { fn: function (p) { return recordTxn_(p); }, mutates: true },
    'items.deleteTxn': { fn: function (p) { return deleteTxn_(p.id); }, mutates: true },
    'items.txns':      { fn: function (p) { return listTransactions_(p); } },
    'items.lowStock':  { fn: function () { return lowStock_(); } },
    'items.totals':    { fn: function () { return inventoryTotals_(); } },

    /* purchases ------------------------------------------------- */
    'purchases.list':       { fn: function (p) { return listPurchases_(p); } },
    'purchases.get':        { fn: function (p) { return getPurchase_(p.id); } },
    'purchases.create':     { fn: function (p) { return createPurchase_(p); }, mutates: true },
    'purchases.update':     { fn: function (p) { return updatePurchase_(p.id, p); }, mutates: true },
    'purchases.receive':    { fn: function (p) { return receivePurchase_(p.id, p); }, mutates: true },
    'purchases.unreceive':  { fn: function (p) { return unreceivePurchase_(p.id); }, mutates: true },
    'purchases.delete':     { fn: function (p) { return deletePurchase_(p.id); }, mutates: true },
    'purchases.shortfall':  { fn: function (p) { return purchaseShortfall_(p.bomId, p); }, mutates: true },

    /* BOMs ------------------------------------------------------ */
    'boms.list':       { fn: function (p) { return listBoms_(p); } },
    'boms.get':        { fn: function (p) { return bomRollup_(p.id); } },
    'boms.create':     { fn: function (p) { return createBom_(p); }, mutates: true },
    'boms.update':     { fn: function (p) { return updateBom_(p.id, p); }, mutates: true },
    'boms.delete':     { fn: function (p) { return deleteBom_(p.id); }, mutates: true },
    'boms.copy':       { fn: function (p) { return copyBom_(p.id, p); }, mutates: true },
    'boms.addLine':    { fn: function (p) { return addBomLine_(p.bomId, p); }, mutates: true },
    'boms.updateLine': { fn: function (p) { return updateBomLine_(p.id, p); }, mutates: true },
    'boms.deleteLine': { fn: function (p) { return deleteBomLine_(p.id); }, mutates: true },
    'boms.import':     { fn: function (p) { return importBomLines_(p.bomId, p.text, p); }, mutates: true },
    'boms.build':      { fn: function (p) { return buildBom_(p.bomId, p); }, mutates: true },

    /* budget ---------------------------------------------------- */
    'budget.detail':          { fn: function (p) { return budgetDetail_(p.projectId, p); } },
    'budget.overview':        { fn: function () { return budgetOverview_(); } },
    'budget.createRecurring': { fn: function (p) { return createRecurring_(p); }, mutates: true },
    'budget.updateRecurring': { fn: function (p) { return updateRecurring_(p.id, p); }, mutates: true },
    'budget.deleteRecurring': { fn: function (p) { return deleteRecurring_(p.id); }, mutates: true },

    /* reports --------------------------------------------------- */
    'reports.project': { fn: function (p) { return exportProjectReport_(p.projectId, p); }, mutates: true },
    'reports.csv':     { fn: function (p) { return exportCsv_(p.table, p); } }
  };
}

/**
 * The one function the browser calls. Never throws: failures come back
 * as { ok:false, error }.
 */
function rpc(action, payload) {
  var name = String(action || '');
  var data = payload || {};

  try {
    var route = rpcRoutes_()[name];
    if (!route) {
      return errorEnvelope_(new AppError('Unknown action "' + name + '".', 'unknown_action'));
    }
    // Everything except setup needs a workspace to talk to.
    if (name !== 'app.setup' && name !== 'app.status' && !isInitialised_()) {
      return errorEnvelope_(new AppError(
        'Lab Notebook has not been set up yet.', 'not_initialised'));
    }

    var result = route.mutates
      ? withLock_(function () { return route.fn(data); })
      : route.fn(data);

    return { ok: true, data: result === undefined ? null : result };
  } catch (err) {
    console.error(name + ' failed: ' + (err && err.stack ? err.stack : err));
    return errorEnvelope_(err);
  }
}

function errorEnvelope_(err) {
  if (err && err.isAppError) {
    return {
      ok: false,
      error: { message: err.message, code: err.code, details: err.details || null }
    };
  }
  var message = err && err.message ? err.message : String(err);
  return { ok: false, error: { message: message, code: 'server_error', details: null } };
}

/* ---------------------------- settings ---------------------------- */

function saveSettings_(settings) {
  var allowed = Object.keys(DEFAULT_SETTINGS()).concat(['allowNegativeStock']);
  var incoming = settings || {};
  Object.keys(incoming).forEach(function (key) {
    if (allowed.indexOf(key) === -1) return;
    setSetting_(key, incoming[key]);
  });
  audit_('update', 'settings', '', Object.keys(incoming).join(', '));
  return getSettings_();
}

/* ------------------------- spreadsheet menu ----------------------- */

/** Adds a menu when the backing spreadsheet is opened directly. */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu(APP_NAME())
      .addItem('Open the app', 'showAppLink_')
      .addItem('Repair / re-run setup', 'setupWorkspace_')
      .addToUi();
  } catch (err) {
    // Not running in a spreadsheet context; nothing to add a menu to.
  }
}

function showAppLink_() {
  var url = ScriptApp.getService().getUrl();
  var html = HtmlService.createHtmlOutput(
    '<p style="font:14px system-ui">Open the Lab Notebook web app:</p>' +
    '<p><a target="_blank" href="' + url + '">' + url + '</a></p>'
  ).setWidth(420).setHeight(140);
  SpreadsheetApp.getUi().showModalDialog(html, APP_NAME());
}
