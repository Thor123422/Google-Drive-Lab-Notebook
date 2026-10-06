/**
 * Store.js — a thin record store on top of a Google Spreadsheet.
 *
 * One sheet per table, row 1 holds the column headers. Values are mapped
 * by header name (not position) so adding your own columns in the sheet
 * never breaks the app. Each execution caches the tables it touches and
 * drops the cache on write.
 */

var LN_SS_ = null;
var LN_TABLE_CACHE_ = {};

/* --------------------------- spreadsheet -------------------------- */

/** The backing spreadsheet, or null when the app has not been set up. */
function openDb_() {
  if (LN_SS_) return LN_SS_;
  var id = PropertiesService.getScriptProperties().getProperty(PROP_KEYS().spreadsheetId);
  if (!id) return null;
  try {
    LN_SS_ = SpreadsheetApp.openById(id);
  } catch (err) {
    fail_(
      'The Lab Notebook spreadsheet could not be opened. It may have been ' +
      'deleted or moved to the trash. Run Setup again from the Settings tab.',
      'db_missing'
    );
  }
  return LN_SS_;
}

/** Like openDb_, but throws the "not set up yet" error instead of null. */
function db_() {
  var ss = openDb_();
  if (!ss) {
    fail_('Lab Notebook has not been set up yet.', 'not_initialised');
  }
  return ss;
}

function isInitialised_() {
  return !!openDb_();
}

/* ----------------------------- sheets ----------------------------- */

function tableDef_(tableKey) {
  var def = TABLES()[tableKey];
  if (!def) fail_('Unknown table "' + tableKey + '".', 'internal');
  return def;
}

/**
 * Return the sheet for a table, creating it (and any missing schema
 * columns) when needed.
 */
function ensureSheet_(tableKey) {
  var def = tableDef_(tableKey);
  var ss = db_();
  var sheet = ss.getSheetByName(def.sheet);
  var wanted = def.columns.map(function (c) { return c.name; });

  if (!sheet) {
    sheet = ss.insertSheet(def.sheet);
    sheet.getRange(1, 1, 1, wanted.length).setValues([wanted]);
    styleHeader_(sheet, wanted.length);
    return sheet;
  }

  var width = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, width).getValues()[0]
    .map(function (h) { return str_(h).trim(); });

  var missing = wanted.filter(function (name) { return headers.indexOf(name) === -1; });
  if (missing.length) {
    var start = headers.filter(function (h) { return h !== ''; }).length + 1;
    sheet.getRange(1, start, 1, missing.length).setValues([missing]);
    styleHeader_(sheet, start + missing.length - 1);
  }
  return sheet;
}

function styleHeader_(sheet, width) {
  var range = sheet.getRange(1, 1, 1, width);
  range.setFontWeight('bold');
  range.setBackground('#f0efec');
  sheet.setFrozenRows(1);
}

/* ------------------------------ read ------------------------------ */

/**
 * Load a whole table as plain objects. Cached for the life of the
 * execution; `_row` carries the sheet row number for in-place updates.
 */
function loadTable_(tableKey) {
  if (LN_TABLE_CACHE_[tableKey]) return LN_TABLE_CACHE_[tableKey];

  var def = tableDef_(tableKey);
  var sheet = ensureSheet_(tableKey);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();

  var state = { def: def, sheet: sheet, headers: [], rows: [], byId: {} };

  if (lastCol < 1) {
    LN_TABLE_CACHE_[tableKey] = state;
    return state;
  }

  var values = sheet.getRange(1, 1, Math.max(lastRow, 1), lastCol).getValues();
  state.headers = values[0].map(function (h) { return str_(h).trim(); });

  var colIndex = {};
  state.headers.forEach(function (name, i) {
    if (name && colIndex[name] === undefined) colIndex[name] = i;
  });
  state.colIndex = colIndex;

  var idCol = def.idColumn;
  for (var r = 1; r < values.length; r++) {
    var raw = values[r];
    var idPos = colIndex[idCol];
    if (idPos === undefined) break;
    var idVal = str_(raw[idPos]).trim();
    if (!idVal) continue; // blank row — ignore

    var record = { _row: r + 1 };
    def.columns.forEach(function (col) {
      var pos = colIndex[col.name];
      record[col.name] = decodeCell_(pos === undefined ? '' : raw[pos], col);
    });
    state.rows.push(record);
    state.byId[idVal] = record;
  }

  LN_TABLE_CACHE_[tableKey] = state;
  return state;
}

function decodeCell_(value, col) {
  switch (col.type) {
    case 'number': {
      var n = numOrNull_(value);
      if (n === null) return col.def === undefined ? null : col.def;
      return n;
    }
    case 'int': {
      var i = numOrNull_(value);
      if (i === null) return col.def === undefined ? null : col.def;
      return Math.round(i);
    }
    case 'bool':
      if (value === '' || value === null || value === undefined) {
        return col.def === undefined ? false : col.def;
      }
      return bool_(value);
    case 'date':
      return dateStr_(value);
    case 'datetime':
      return dateTimeStr_(value);
    case 'json':
      if (!value) return null;
      try { return JSON.parse(str_(value)); } catch (err) { return null; }
    default:
      return str_(value);
  }
}

function encodeCell_(value, col) {
  switch (col.type) {
    case 'number':
    case 'int': {
      var n = numOrNull_(value);
      if (n === null) return '';
      return col.type === 'int' ? Math.round(n) : n;
    }
    case 'bool':
      return bool_(value);
    case 'date': {
      var d = toDate_(value);
      return d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()) : '';
    }
    case 'datetime': {
      var dt = toDate_(value);
      return dt || '';
    }
    case 'json':
      return value === null || value === undefined ? '' : JSON.stringify(value);
    default:
      return str_(value);
  }
}

/* ---------------------------- queries ----------------------------- */

function all_(tableKey) {
  return loadTable_(tableKey).rows;
}

function findById_(tableKey, id) {
  var key = str_(id).trim();
  if (!key) return null;
  return loadTable_(tableKey).byId[key] || null;
}

function getOr404_(tableKey, id, label) {
  return requireRecord_(findById_(tableKey, id), label || tableDef_(tableKey).label, id);
}

function where_(tableKey, predicate) {
  return all_(tableKey).filter(predicate);
}

function byField_(tableKey, field, value) {
  var want = str_(value);
  return where_(tableKey, function (r) { return str_(r[field]) === want; });
}

function firstWhere_(tableKey, predicate) {
  var hits = where_(tableKey, predicate);
  return hits.length ? hits[0] : null;
}

function countWhere_(tableKey, predicate) {
  return where_(tableKey, predicate).length;
}

/* ----------------------------- writes ----------------------------- */

function invalidate_(tableKey) {
  if (tableKey) delete LN_TABLE_CACHE_[tableKey];
  else LN_TABLE_CACHE_ = {};
}

/**
 * Insert a record. `record.id` is generated from the table's prefix when
 * absent. Returns the stored record (re-read through the decoders so the
 * caller sees exactly what a later read would give).
 */
function insert_(tableKey, record) {
  var def = tableDef_(tableKey);
  var state = loadTable_(tableKey);
  var row = Object.assign({}, record);

  if (def.idColumn === 'id' && !str_(row.id).trim()) {
    row.id = newId_(idPrefix_(tableKey));
  }
  var id = str_(row[def.idColumn]).trim();
  if (!id) fail_('A ' + def.label + ' record needs a ' + def.idColumn + '.', 'required');
  if (state.byId[id]) {
    fail_('A ' + def.label + ' record with that key already exists.', 'duplicate', { id: id });
  }

  applyDefaults_(def, row);

  var width = state.headers.length || def.columns.length;
  var values = new Array(width).fill('');
  def.columns.forEach(function (col) {
    var pos = state.colIndex ? state.colIndex[col.name] : undefined;
    if (pos === undefined) return;
    values[pos] = encodeCell_(row[col.name], col);
  });

  var targetRow = state.sheet.getLastRow() + 1;
  state.sheet.getRange(targetRow, 1, 1, width).setValues([values]);

  invalidate_(tableKey);
  return findById_(tableKey, id);
}

/**
 * Patch an existing record. Only keys present in `patch` are written;
 * everything else keeps its stored value.
 */
function update_(tableKey, id, patch) {
  var def = tableDef_(tableKey);
  var state = loadTable_(tableKey);
  var existing = state.byId[str_(id).trim()];
  requireRecord_(existing, def.label, id);

  var merged = {};
  def.columns.forEach(function (col) {
    merged[col.name] = Object.prototype.hasOwnProperty.call(patch, col.name)
      ? patch[col.name]
      : existing[col.name];
  });
  merged[def.idColumn] = existing[def.idColumn]; // ids are immutable

  var width = state.headers.length || def.columns.length;
  var values = state.sheet.getRange(existing._row, 1, 1, width).getValues()[0];
  def.columns.forEach(function (col) {
    var pos = state.colIndex ? state.colIndex[col.name] : undefined;
    if (pos === undefined) return;
    values[pos] = encodeCell_(merged[col.name], col);
  });
  state.sheet.getRange(existing._row, 1, 1, width).setValues([values]);

  invalidate_(tableKey);
  return findById_(tableKey, id);
}

/** Delete one record by id. Returns true when a row was removed. */
function remove_(tableKey, id) {
  var state = loadTable_(tableKey);
  var existing = state.byId[str_(id).trim()];
  if (!existing) return false;
  state.sheet.deleteRow(existing._row);
  invalidate_(tableKey);
  return true;
}

/**
 * Delete every record matching a predicate, bottom-up so earlier row
 * numbers stay valid while deleting.
 */
function removeWhere_(tableKey, predicate) {
  var state = loadTable_(tableKey);
  var doomed = state.rows.filter(predicate).sort(function (a, b) { return b._row - a._row; });
  doomed.forEach(function (r) { state.sheet.deleteRow(r._row); });
  if (doomed.length) invalidate_(tableKey);
  return doomed.length;
}

/** Insert many records in one setValues call. */
function insertMany_(tableKey, records) {
  if (!records || !records.length) return [];
  var def = tableDef_(tableKey);
  var state = loadTable_(tableKey);
  var width = state.headers.length || def.columns.length;
  var ids = [];

  var matrix = records.map(function (record) {
    var row = Object.assign({}, record);
    if (def.idColumn === 'id' && !str_(row.id).trim()) {
      row.id = newId_(idPrefix_(tableKey));
    }
    applyDefaults_(def, row);
    ids.push(str_(row[def.idColumn]));

    var values = new Array(width).fill('');
    def.columns.forEach(function (col) {
      var pos = state.colIndex ? state.colIndex[col.name] : undefined;
      if (pos === undefined) return;
      values[pos] = encodeCell_(row[col.name], col);
    });
    return values;
  });

  state.sheet.getRange(state.sheet.getLastRow() + 1, 1, matrix.length, width).setValues(matrix);
  invalidate_(tableKey);
  return ids.map(function (id) { return findById_(tableKey, id); });
}

function applyDefaults_(def, row) {
  def.columns.forEach(function (col) {
    var v = row[col.name];
    var blank = v === undefined || v === null || v === '';
    if (blank && col.def !== undefined) row[col.name] = col.def;
    else if (v === undefined) row[col.name] = '';
  });
}

function idPrefix_(tableKey) {
  var prefixes = {
    projects: 'prj', entries: 'ent', entryLinks: 'lnk', files: 'fil',
    items: 'itm', txns: 'txn', purchases: 'pur', boms: 'bom',
    bomLines: 'bml', recurring: 'rec', audit: 'log'
  };
  return prefixes[tableKey] || 'rec';
}

/** Next value for a per-project counter such as the entry number. */
function nextSeq_(tableKey, field, scopeField, scopeValue) {
  var max = 0;
  all_(tableKey).forEach(function (r) {
    if (scopeField && str_(r[scopeField]) !== str_(scopeValue)) return;
    var n = num_(r[field], 0);
    if (n > max) max = n;
  });
  return max + 1;
}

/* ---------------------------- settings ---------------------------- */

function getSettings_() {
  var out = DEFAULT_SETTINGS();
  all_('settings').forEach(function (row) {
    if (row.key) out[row.key] = row.value;
  });
  return out;
}

function getSetting_(key, fallback) {
  var settings = getSettings_();
  var v = settings[key];
  return (v === undefined || v === '') ? fallback : v;
}

function setSetting_(key, value) {
  var existing = findById_('settings', key);
  var payload = { key: key, value: str_(value), updatedAt: new Date() };
  if (existing) return update_('settings', key, payload);
  return insert_('settings', payload);
}

/* ----------------------------- audit ------------------------------ */

function audit_(action, entity, entityId, summary) {
  try {
    insert_('audit', {
      at: new Date(),
      actor: currentUser_(),
      action: action,
      entity: entity,
      entityId: str_(entityId),
      summary: maxLen_(str_(summary).slice(0, 500), 500, 'summary')
    });
  } catch (err) {
    // The audit trail must never break the operation it is recording.
    console.warn('audit failed: ' + err);
  }
}

/* ------------------------------ lock ------------------------------ */

/**
 * Serialise mutating work. Sheets have no transactions, so a single
 * script lock keeps concurrent requests from interleaving reads and
 * writes on the same rows.
 */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    fail_('The notebook is busy with another change. Try again in a moment.', 'busy');
  }
  try {
    invalidate_();
    return fn();
  } finally {
    lock.releaseLock();
  }
}
