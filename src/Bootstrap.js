/**
 * Bootstrap.js — first-run setup and health reporting.
 *
 * Setup is idempotent: running it again repairs a missing sheet, folder
 * or setting without touching existing data.
 */

/**
 * Create (or repair) the spreadsheet, the Drive folders and the default
 * settings. Safe to run repeatedly.
 */
function setupWorkspace_() {
  var props = PropertiesService.getScriptProperties();
  var keys = PROP_KEYS();

  var root = rootFolder_();
  projectsFolder_();
  tempFolder_();

  var ssId = props.getProperty(keys.spreadsheetId);
  var ss = null;
  if (ssId) {
    try {
      ss = SpreadsheetApp.openById(ssId);
      if (DriveApp.getFileById(ssId).isTrashed()) ss = null;
    } catch (err) {
      ss = null;
    }
  }

  if (!ss) {
    // Reuse a data file already sitting in the root folder before making
    // a second one — this is what makes re-running setup safe.
    var existing = root.getFilesByName(DB_FILE_NAME());
    while (existing.hasNext()) {
      var candidate = existing.next();
      if (!candidate.isTrashed()) {
        ss = SpreadsheetApp.openById(candidate.getId());
        break;
      }
    }
  }

  if (!ss) {
    ss = SpreadsheetApp.create(DB_FILE_NAME());
    var file = DriveApp.getFileById(ss.getId());
    root.addFile(file);
    DriveApp.getRootFolder().removeFile(file);
  }

  props.setProperty(keys.spreadsheetId, ss.getId());
  LN_SS_ = ss;
  invalidate_();

  // Create every table, then drop the default "Sheet1" if it is still
  // empty and no longer the only sheet.
  Object.keys(TABLES()).forEach(function (key) { ensureSheet_(key); });
  var blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) {
    ss.deleteSheet(blank);
  }

  seedSettings_();
  formatSheets_();
  props.setProperty(keys.schemaVersion, String(SCHEMA_VERSION()));

  return workspaceStatus_();
}

function seedSettings_() {
  var defaults = DEFAULT_SETTINGS();
  var existing = {};
  all_('settings').forEach(function (row) { existing[row.key] = true; });

  var missing = Object.keys(defaults).filter(function (k) { return !existing[k]; });
  if (!missing.length) return;

  insertMany_('settings', missing.map(function (k) {
    return { key: k, value: defaults[k], updatedAt: new Date() };
  }));
}

/** Column widths and number formats so the sheet is readable by hand. */
function formatSheets_() {
  var ss = db_();
  var money = '$#,##0.00';
  var formats = {
    projects: { budgetTotal: money },
    items: { unitCost: money },
    txns: { unitCost: money },
    purchases: { unitCost: money, amount: money },
    bomLines: { unitCostOverride: money },
    recurring: { amount: money }
  };

  Object.keys(formats).forEach(function (tableKey) {
    var def = TABLES()[tableKey];
    var sheet = ss.getSheetByName(def.sheet);
    if (!sheet) return;
    var lastCol = sheet.getLastColumn();
    if (lastCol < 1) return;
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    Object.keys(formats[tableKey]).forEach(function (colName) {
      var idx = headers.indexOf(colName);
      if (idx === -1) return;
      sheet.getRange(2, idx + 1, Math.max(sheet.getMaxRows() - 1, 1), 1)
        .setNumberFormat(formats[tableKey][colName]);
    });
  });
}

/** Everything the Settings screen needs to describe the workspace. */
function workspaceStatus_() {
  var props = PropertiesService.getScriptProperties();
  var keys = PROP_KEYS();
  var ssId = props.getProperty(keys.spreadsheetId);
  var status = {
    initialised: false,
    spreadsheetId: ssId || '',
    spreadsheetUrl: '',
    rootFolderId: props.getProperty(keys.rootFolderId) || '',
    rootFolderUrl: '',
    schemaVersion: num_(props.getProperty(keys.schemaVersion), 0),
    expectedSchemaVersion: SCHEMA_VERSION(),
    user: currentUser_(),
    timeZone: tz_(),
    counts: {}
  };

  if (!ssId) return status;

  try {
    var ss = SpreadsheetApp.openById(ssId);
    status.initialised = true;
    status.spreadsheetUrl = ss.getUrl();
  } catch (err) {
    return status;
  }

  try {
    status.rootFolderUrl = driveUrl_(rootFolder_());
    status.rootFolderId = rootFolder_().getId();
  } catch (err) {
    status.rootFolderUrl = '';
  }

  ['projects', 'entries', 'files', 'items', 'txns', 'purchases', 'boms'].forEach(function (k) {
    try { status.counts[k] = all_(k).length; } catch (e) { status.counts[k] = 0; }
  });

  return status;
}

/**
 * Populate the workspace with one worked example — a small electronics
 * project with a notebook entry, stock, a purchase and a costed BOM — so
 * every screen has something to show on day one.
 */
function seedExample_() {
  if (all_('projects').length) {
    fail_('Sample data can only be added to an empty notebook.', 'not_empty');
  }
  var now = new Date();
  var start = dateStr_(addDays_(today_(), -45));

  var project = insert_('projects', {
    code: 'PRJ-001',
    name: 'Bench PSU controller',
    status: 'active',
    priority: 'high',
    description: 'Digitally controlled bench power supply: STM32 front end, ' +
      'buck pre-regulator, linear post-regulator.',
    objective: 'Working rev-B prototype with <2 mV ripple at 3 A.',
    startDate: start,
    targetDate: dateStr_(addDays_(today_(), 60)),
    tags: 'electronics, power, rev-b',
    budgetTotal: 2500,
    currency: 'USD',
    createdAt: now,
    updatedAt: now
  });

  var items = insertMany_('items', [
    {
      sku: 'MCU-STM32G474', name: 'STM32G474RET6', category: 'Semiconductors',
      manufacturer: 'STMicroelectronics', mpn: 'STM32G474RET6',
      supplier: 'Digi-Key', unit: 'ea', unitCost: 8.42, reorderPoint: 5,
      reorderQty: 10, leadTimeDays: 14, location: 'Bin A3', active: true,
      createdAt: now, updatedAt: now
    },
    {
      sku: 'IND-10UH-5A', name: '10 µH 5 A shielded inductor', category: 'Passives',
      manufacturer: 'Coilcraft', mpn: 'XAL6060-103ME', supplier: 'Mouser',
      unit: 'ea', unitCost: 1.86, reorderPoint: 20, reorderQty: 50,
      leadTimeDays: 7, location: 'Bin B1', active: true,
      createdAt: now, updatedAt: now
    },
    {
      sku: 'PCB-PSU-REVB', name: 'PSU controller PCB rev B', category: 'Fabrication',
      supplier: 'JLCPCB', unit: 'ea', unitCost: 11.20, reorderPoint: 2,
      reorderQty: 5, leadTimeDays: 10, location: 'Shelf 2', active: true,
      createdAt: now, updatedAt: now
    }
  ]);

  insertMany_('txns', [
    {
      itemId: items[0].id, date: dateStr_(addDays_(today_(), -30)), type: 'receive',
      quantity: 10, unitCost: 8.42, note: 'Opening stock', createdAt: now,
      createdBy: currentUser_()
    },
    {
      itemId: items[1].id, date: dateStr_(addDays_(today_(), -30)), type: 'receive',
      quantity: 50, unitCost: 1.86, note: 'Opening stock', createdAt: now,
      createdBy: currentUser_()
    },
    {
      itemId: items[2].id, date: dateStr_(addDays_(today_(), -12)), type: 'receive',
      quantity: 5, unitCost: 11.20, note: 'Rev B panel', createdAt: now,
      createdBy: currentUser_()
    },
    {
      itemId: items[2].id, date: dateStr_(addDays_(today_(), -5)), type: 'consume',
      quantity: -2, unitCost: 11.20, projectId: project.id,
      note: 'Built two prototypes', createdAt: now, createdBy: currentUser_()
    }
  ]);

  insertMany_('purchases', [
    {
      projectId: project.id, date: dateStr_(addDays_(today_(), -12)), vendor: 'JLCPCB',
      orderNumber: 'W2026-4471', description: 'PCB rev B, 5 off',
      category: 'fabrication', status: 'received', itemId: items[2].id,
      quantity: 5, unitCost: 11.20, amount: 56.00, currency: 'USD',
      receivedDate: dateStr_(addDays_(today_(), -12)), createdAt: now, updatedAt: now
    },
    {
      projectId: project.id, date: dateStr_(addDays_(today_(), -3)), vendor: 'Digi-Key',
      orderNumber: '88-412-556', description: 'Analog front-end parts',
      category: 'components', status: 'ordered', quantity: 1, unitCost: 214.80,
      amount: 214.80, currency: 'USD', expectedDate: dateStr_(addDays_(today_(), 6)),
      createdAt: now, updatedAt: now
    },
    {
      projectId: project.id, date: todayStr_(), vendor: 'Keysight',
      orderNumber: '', description: 'Loaner differential probe (planned)',
      category: 'equipment', status: 'planned', quantity: 1, unitCost: 450,
      amount: 450, currency: 'USD', expectedDate: dateStr_(addDays_(today_(), 30)),
      createdAt: now, updatedAt: now
    }
  ]);

  insert_('recurring', {
    projectId: project.id, name: 'EDA suite seat', amount: 29, currency: 'USD',
    cadence: 'monthly', category: 'software', startDate: start, active: true,
    createdAt: now
  });

  var bom = insert_('boms', {
    projectId: project.id, name: 'Controller board', revision: 'B',
    description: 'Rev B assembly, per board.', buildQty: 10, status: 'released',
    createdAt: now, updatedAt: now
  });

  insertMany_('bomLines', [
    {
      bomId: bom.id, projectId: project.id, lineNo: 1, refDes: 'U1',
      itemId: items[0].id, description: 'Main MCU', qtyPer: 1, scrapPct: 2
    },
    {
      bomId: bom.id, projectId: project.id, lineNo: 2, refDes: 'L1, L2',
      itemId: items[1].id, description: 'Buck inductors', qtyPer: 2, scrapPct: 5
    },
    {
      bomId: bom.id, projectId: project.id, lineNo: 3, refDes: 'PCB',
      itemId: items[2].id, description: 'Bare board', qtyPer: 1, scrapPct: 0
    },
    {
      bomId: bom.id, projectId: project.id, lineNo: 4, refDes: 'MISC',
      itemId: '', description: 'Connectors, hardware, passives (lumped)',
      qtyPer: 1, unitCostOverride: 6.40, scrapPct: 0
    }
  ]);

  var entry = insert_('entries', {
    projectId: project.id, entryNo: 1, date: dateStr_(addDays_(today_(), -5)),
    title: 'Rev B first power-up', type: 'test', status: 'final',
    body: [
      '## Setup',
      '',
      'Two rev-B boards assembled from the panel received on the 24th. Bench',
      'supply limited to 12 V / 0.5 A for first power-up.',
      '',
      '## Observations',
      '',
      '- 3V3 rail came up at 3.298 V, within tolerance.',
      '- Buck switching node shows ~180 mV overshoot at the leading edge.',
      '- MCU enumerated over USB on the first try.',
      '',
      '## Next',
      '',
      'Add a 2.2 Ω / 470 pF snubber across the low-side FET and re-measure.'
    ].join('\n'),
    tags: 'power-up, rev-b',
    author: currentUser_(), signedAt: now, signedBy: currentUser_(),
    createdAt: now, updatedAt: now
  });

  insert_('entryLinks', {
    entryId: entry.id, projectId: project.id, targetType: 'bom',
    targetId: bom.id, label: 'Controller board rev B',
    note: 'Assembly built for this test', createdAt: now
  });

  audit_('seed', 'workspace', '', 'Added sample project data');
  return project.id;
}
