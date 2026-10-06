/**
 * Config.js — schema, enumerations and app-wide constants.
 *
 * Everything here is exposed through functions rather than top-level
 * constants: Apps Script does not guarantee the evaluation order of files,
 * so cross-file references are only safe inside function bodies.
 */

/** Bump when the sheet layout changes in a way that needs a migration. */
function SCHEMA_VERSION() {
  return 1;
}

function APP_NAME() {
  return 'Lab Notebook';
}

/** Property keys used in the script's PropertiesService store. */
function PROP_KEYS() {
  return {
    spreadsheetId: 'LN_SPREADSHEET_ID',
    rootFolderId: 'LN_ROOT_FOLDER_ID',
    schemaVersion: 'LN_SCHEMA_VERSION'
  };
}

/* ------------------------------------------------------------------ *
 * Enumerations
 * ------------------------------------------------------------------ */

function ENUMS() {
  return {
    projectStatus: ['planning', 'active', 'on_hold', 'complete', 'archived'],
    projectPriority: ['low', 'normal', 'high'],
    entryType: [
      'experiment', 'observation', 'build', 'test', 'analysis',
      'decision', 'meeting', 'maintenance', 'note'
    ],
    entryStatus: ['draft', 'final'],
    linkTarget: ['file', 'item', 'entry', 'bom', 'purchase', 'url'],
    fileCategory: [
      'schematic', 'pcb', 'gerber', 'bom', 'firmware', 'cad', 'datasheet',
      'photo', 'data', 'report', 'invoice', 'other'
    ],
    txnType: ['receive', 'consume', 'adjust', 'return', 'scrap'],
    purchaseStatus: ['planned', 'ordered', 'received', 'cancelled'],
    purchaseCategory: [
      'components', 'materials', 'equipment', 'tooling', 'services',
      'software', 'fabrication', 'shipping', 'tax', 'fees', 'other'
    ],
    bomStatus: ['draft', 'released', 'superseded'],
    cadence: ['weekly', 'monthly', 'quarterly', 'annual']
  };
}

/**
 * Transaction types that must carry a positive quantity, and those that
 * must carry a negative one. `adjust` may be either.
 */
function TXN_SIGN() {
  return { receive: 1, return: 1, consume: -1, scrap: -1, adjust: 0 };
}

function CADENCE_MONTHS() {
  return { weekly: 0.25, monthly: 1, quarterly: 3, annual: 12 };
}

/* ------------------------------------------------------------------ *
 * Table definitions
 * ------------------------------------------------------------------ */

var LN_SCHEMA_CACHE_ = null;

/**
 * The full set of sheet-backed tables.
 *
 * Each table has a `sheet` name, an `id` column and an ordered `columns`
 * list. Column types drive coercion on read and write:
 *   string | text | number | int | bool | date | datetime | json
 *
 * `indexes` lists columns the store should build lookup maps for.
 */
function TABLES() {
  if (LN_SCHEMA_CACHE_) return LN_SCHEMA_CACHE_;

  var t = {};

  t.projects = {
    sheet: 'Projects',
    label: 'Projects',
    columns: [
      { name: 'id', type: 'string' },
      { name: 'code', type: 'string' },
      { name: 'name', type: 'string' },
      { name: 'status', type: 'string', def: 'planning' },
      { name: 'priority', type: 'string', def: 'normal' },
      { name: 'description', type: 'text' },
      { name: 'objective', type: 'text' },
      { name: 'startDate', type: 'date' },
      { name: 'targetDate', type: 'date' },
      { name: 'closedDate', type: 'date' },
      { name: 'tags', type: 'string' },
      { name: 'folderId', type: 'string' },
      { name: 'budgetTotal', type: 'number', def: 0 },
      { name: 'currency', type: 'string', def: 'USD' },
      { name: 'createdAt', type: 'datetime' },
      { name: 'updatedAt', type: 'datetime' }
    ],
    indexes: ['code']
  };

  t.entries = {
    sheet: 'Entries',
    label: 'Notebook entries',
    columns: [
      { name: 'id', type: 'string' },
      { name: 'projectId', type: 'string' },
      { name: 'entryNo', type: 'int', def: 0 },
      { name: 'date', type: 'date' },
      { name: 'title', type: 'string' },
      { name: 'type', type: 'string', def: 'note' },
      { name: 'status', type: 'string', def: 'draft' },
      { name: 'body', type: 'text' },
      { name: 'tags', type: 'string' },
      { name: 'author', type: 'string' },
      { name: 'signedAt', type: 'datetime' },
      { name: 'signedBy', type: 'string' },
      { name: 'createdAt', type: 'datetime' },
      { name: 'updatedAt', type: 'datetime' }
    ],
    indexes: ['projectId']
  };

  t.entryLinks = {
    sheet: 'EntryLinks',
    label: 'Entry links',
    columns: [
      { name: 'id', type: 'string' },
      { name: 'entryId', type: 'string' },
      { name: 'projectId', type: 'string' },
      { name: 'targetType', type: 'string' },
      { name: 'targetId', type: 'string' },
      { name: 'label', type: 'string' },
      { name: 'note', type: 'text' },
      { name: 'createdAt', type: 'datetime' }
    ],
    indexes: ['entryId', 'targetId']
  };

  t.files = {
    sheet: 'Files',
    label: 'Files',
    columns: [
      { name: 'id', type: 'string' },
      { name: 'projectId', type: 'string' },
      { name: 'driveId', type: 'string' },
      { name: 'name', type: 'string' },
      { name: 'mimeType', type: 'string' },
      { name: 'size', type: 'int', def: 0 },
      { name: 'category', type: 'string', def: 'other' },
      { name: 'revision', type: 'string' },
      { name: 'supersedesId', type: 'string' },
      { name: 'description', type: 'text' },
      { name: 'tags', type: 'string' },
      { name: 'url', type: 'string' },
      { name: 'source', type: 'string', def: 'upload' },
      { name: 'uploadedAt', type: 'datetime' },
      { name: 'uploadedBy', type: 'string' }
    ],
    indexes: ['projectId', 'driveId']
  };

  t.items = {
    sheet: 'InventoryItems',
    label: 'Inventory items',
    columns: [
      { name: 'id', type: 'string' },
      { name: 'sku', type: 'string' },
      { name: 'name', type: 'string' },
      { name: 'description', type: 'text' },
      { name: 'category', type: 'string' },
      { name: 'manufacturer', type: 'string' },
      { name: 'mpn', type: 'string' },
      { name: 'supplier', type: 'string' },
      { name: 'supplierPn', type: 'string' },
      { name: 'supplierUrl', type: 'string' },
      { name: 'unit', type: 'string', def: 'ea' },
      { name: 'unitCost', type: 'number', def: 0 },
      { name: 'currency', type: 'string', def: 'USD' },
      { name: 'reorderPoint', type: 'number', def: 0 },
      { name: 'reorderQty', type: 'number', def: 0 },
      { name: 'leadTimeDays', type: 'int', def: 0 },
      { name: 'location', type: 'string' },
      { name: 'datasheetFileId', type: 'string' },
      { name: 'tags', type: 'string' },
      { name: 'active', type: 'bool', def: true },
      { name: 'notes', type: 'text' },
      { name: 'createdAt', type: 'datetime' },
      { name: 'updatedAt', type: 'datetime' }
    ],
    indexes: ['sku']
  };

  t.txns = {
    sheet: 'InventoryTxns',
    label: 'Stock movements',
    columns: [
      { name: 'id', type: 'string' },
      { name: 'itemId', type: 'string' },
      { name: 'date', type: 'date' },
      { name: 'type', type: 'string' },
      { name: 'quantity', type: 'number', def: 0 },
      { name: 'unitCost', type: 'number', def: 0 },
      { name: 'projectId', type: 'string' },
      { name: 'entryId', type: 'string' },
      { name: 'purchaseId', type: 'string' },
      { name: 'bomId', type: 'string' },
      { name: 'location', type: 'string' },
      { name: 'note', type: 'text' },
      { name: 'createdAt', type: 'datetime' },
      { name: 'createdBy', type: 'string' }
    ],
    indexes: ['itemId', 'projectId', 'purchaseId']
  };

  t.purchases = {
    sheet: 'Purchases',
    label: 'Purchases',
    columns: [
      { name: 'id', type: 'string' },
      { name: 'projectId', type: 'string' },
      { name: 'date', type: 'date' },
      { name: 'vendor', type: 'string' },
      { name: 'orderNumber', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'category', type: 'string', def: 'components' },
      { name: 'status', type: 'string', def: 'planned' },
      { name: 'itemId', type: 'string' },
      { name: 'quantity', type: 'number', def: 0 },
      { name: 'unitCost', type: 'number', def: 0 },
      { name: 'amount', type: 'number', def: 0 },
      { name: 'currency', type: 'string', def: 'USD' },
      { name: 'expectedDate', type: 'date' },
      { name: 'receivedDate', type: 'date' },
      { name: 'invoiceFileId', type: 'string' },
      { name: 'receiveTxnId', type: 'string' },
      { name: 'note', type: 'text' },
      { name: 'createdAt', type: 'datetime' },
      { name: 'updatedAt', type: 'datetime' }
    ],
    indexes: ['projectId', 'itemId']
  };

  t.boms = {
    sheet: 'BOMs',
    label: 'Bills of materials',
    columns: [
      { name: 'id', type: 'string' },
      { name: 'projectId', type: 'string' },
      { name: 'name', type: 'string' },
      { name: 'revision', type: 'string', def: 'A' },
      { name: 'description', type: 'text' },
      { name: 'buildQty', type: 'number', def: 1 },
      { name: 'status', type: 'string', def: 'draft' },
      { name: 'notes', type: 'text' },
      { name: 'createdAt', type: 'datetime' },
      { name: 'updatedAt', type: 'datetime' }
    ],
    indexes: ['projectId']
  };

  t.bomLines = {
    sheet: 'BOMLines',
    label: 'BOM lines',
    columns: [
      { name: 'id', type: 'string' },
      { name: 'bomId', type: 'string' },
      { name: 'projectId', type: 'string' },
      { name: 'lineNo', type: 'int', def: 0 },
      { name: 'refDes', type: 'string' },
      { name: 'itemId', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'qtyPer', type: 'number', def: 1 },
      { name: 'unitCostOverride', type: 'number' },
      { name: 'scrapPct', type: 'number', def: 0 },
      { name: 'note', type: 'text' }
    ],
    indexes: ['bomId', 'itemId']
  };

  t.recurring = {
    sheet: 'RecurringCosts',
    label: 'Recurring costs',
    columns: [
      { name: 'id', type: 'string' },
      { name: 'projectId', type: 'string' },
      { name: 'name', type: 'string' },
      { name: 'amount', type: 'number', def: 0 },
      { name: 'currency', type: 'string', def: 'USD' },
      { name: 'cadence', type: 'string', def: 'monthly' },
      { name: 'category', type: 'string', def: 'services' },
      { name: 'startDate', type: 'date' },
      { name: 'endDate', type: 'date' },
      { name: 'active', type: 'bool', def: true },
      { name: 'note', type: 'text' },
      { name: 'createdAt', type: 'datetime' }
    ],
    indexes: ['projectId']
  };

  t.audit = {
    sheet: 'AuditLog',
    label: 'Audit log',
    columns: [
      { name: 'id', type: 'string' },
      { name: 'at', type: 'datetime' },
      { name: 'actor', type: 'string' },
      { name: 'action', type: 'string' },
      { name: 'entity', type: 'string' },
      { name: 'entityId', type: 'string' },
      { name: 'summary', type: 'text' }
    ],
    indexes: []
  };

  t.settings = {
    sheet: 'Settings',
    label: 'Settings',
    idColumn: 'key',
    columns: [
      { name: 'key', type: 'string' },
      { name: 'value', type: 'string' },
      { name: 'updatedAt', type: 'datetime' }
    ],
    indexes: []
  };

  // Normalise: give every table an explicit id column and a name.
  Object.keys(t).forEach(function (key) {
    t[key].key = key;
    if (!t[key].idColumn) t[key].idColumn = 'id';
  });

  LN_SCHEMA_CACHE_ = t;
  return t;
}

/** Default values written into the Settings sheet on first run. */
function DEFAULT_SETTINGS() {
  return {
    currency: 'USD',
    currencySymbol: '$',
    locale: 'en-US',
    lowStockOnly: 'false',
    forecastMonths: '12',
    theme: 'system',
    ownerName: '',
    schemaVersion: String(SCHEMA_VERSION())
  };
}

/** Upload limits. Apps Script payloads are capped well below Drive's. */
function UPLOAD_LIMITS() {
  return {
    // Bytes of raw file data per chunk sent from the browser.
    chunkBytes: 2 * 1024 * 1024,
    // Largest file the chunked uploader will accept.
    maxBytes: 64 * 1024 * 1024,
    // Temp chunks older than this are swept on the next upload.
    staleChunkMs: 6 * 60 * 60 * 1000
  };
}
