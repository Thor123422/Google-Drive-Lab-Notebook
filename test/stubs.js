/* Minimal in-memory stand-ins for the Apps Script services the server uses. */

const MONTHS = ['January','February','March','April','May','June','July',
  'August','September','October','November','December'];

function pad(n, w) { return String(n).padStart(w, '0'); }

function formatDate(date, tz, fmt) {
  const d = new Date(date);
  const map = [
    ["yyyy", () => String(d.getFullYear())],
    ["MMMM", () => MONTHS[d.getMonth()]],
    ["MMM",  () => MONTHS[d.getMonth()].slice(0, 3)],
    ["MM",   () => pad(d.getMonth() + 1, 2)],
    ["dd",   () => pad(d.getDate(), 2)],
    ["HH",   () => pad(d.getHours(), 2)],
    ["mm",   () => pad(d.getMinutes(), 2)],
    ["ss",   () => pad(d.getSeconds(), 2)],
    ["yy",   () => pad(d.getFullYear() % 100, 2)]
  ];
  let out = '';
  let i = 0;
  while (i < fmt.length) {
    if (fmt[i] === "'") { // quoted literal
      const end = fmt.indexOf("'", i + 1);
      out += fmt.slice(i + 1, end === -1 ? fmt.length : end);
      i = (end === -1 ? fmt.length : end + 1);
      continue;
    }
    const hit = map.find(([tok]) => fmt.startsWith(tok, i));
    if (hit) { out += hit[1](); i += hit[0].length; }
    else { out += fmt[i]; i++; }
  }
  return out;
}

class FakeSheet {
  constructor(name) { this.name = name; this.rows = []; this.frozen = 0; }
  getName() { return this.name; }
  _ensure(r, c) {
    while (this.rows.length < r) this.rows.push([]);
    for (const row of this.rows) while (row.length < c) row.push('');
  }
  getLastRow() {
    let last = 0;
    this.rows.forEach((row, i) => {
      if (row.some(v => v !== '' && v !== null && v !== undefined)) last = i + 1;
    });
    return last;
  }
  getLastColumn() {
    let last = 0;
    for (const row of this.rows) {
      for (let c = row.length - 1; c >= 0; c--) {
        if (row[c] !== '' && row[c] !== null && row[c] !== undefined) { last = Math.max(last, c + 1); break; }
      }
    }
    return last;
  }
  getMaxRows() { return Math.max(this.rows.length, 1000); }
  deleteRow(r) { this.rows.splice(r - 1, 1); }
  setFrozenRows(n) { this.frozen = n; }
  getRange(row, col, numRows = 1, numCols = 1) {
    const sheet = this;
    sheet._ensure(row + numRows - 1, col + numCols - 1);
    return {
      getValues() {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const line = [];
          for (let c = 0; c < numCols; c++) {
            const v = sheet.rows[row - 1 + r][col - 1 + c];
            line.push(v === undefined ? '' : v);
          }
          out.push(line);
        }
        return out;
      },
      setValues(values) {
        sheet._ensure(row + values.length - 1, col + values[0].length - 1);
        values.forEach((line, r) => line.forEach((v, c) => {
          sheet.rows[row - 1 + r][col - 1 + c] = v;
        }));
        return this;
      },
      setFontWeight() { return this; },
      setBackground() { return this; },
      setNumberFormat() { return this; }
    };
  }
}

class FakeSpreadsheet {
  constructor(id, name) { this.id = id; this.name = name; this.sheets = []; }
  getId() { return this.id; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
  getSheets() { return this.sheets; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new FakeSheet(n); this.sheets.push(s); return s; }
  deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
}

function install(global) {
  const spreadsheets = {};
  const props = { script: {}, user: {} };
  let seq = 0;

  global.console = console;

  global.Session = {
    getScriptTimeZone: () => 'America/New_York',
    getActiveUser: () => ({ getEmail: () => 'tester@example.com' })
  };

  global.Utilities = {
    formatDate,
    getUuid: () => 'uuid-' + (++seq),
    base64Decode: (s) => Array.from(Buffer.from(s, 'base64')),
    newBlob: (b) => ({ getBytes: () => b })
  };

  function store(bag) {
    return {
      getProperty: (k) => (k in bag ? bag[k] : null),
      setProperty: (k, v) => { bag[k] = String(v); },
      deleteProperty: (k) => { delete bag[k]; }
    };
  }
  global.PropertiesService = {
    getScriptProperties: () => store(props.script),
    getUserProperties: () => store(props.user)
  };

  global.LockService = {
    getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} })
  };

  global.SpreadsheetApp = {
    create: (name) => {
      const id = 'ss-' + (++seq);
      const ss = new FakeSpreadsheet(id, name);
      ss.insertSheet('Sheet1');
      spreadsheets[id] = ss;
      return ss;
    },
    openById: (id) => {
      if (!spreadsheets[id]) throw new Error('No spreadsheet ' + id);
      return spreadsheets[id];
    },
    getUi: () => { throw new Error('no ui'); }
  };

  const folders = {};
  function makeFolder(name, id) {
    const self = {
      _id: id, _name: name, _files: [], _children: {},
      getId: () => self._id,
      getName: () => self._name,
      setName: (n) => { self._name = n; },
      isTrashed: () => false,
      getUrl: () => 'https://drive.google.com/drive/folders/' + self._id,
      getFoldersByName: (n) => {
        const hit = self._children[n];
        let used = false;
        return { hasNext: () => !!hit && !used, next: () => { used = true; return hit; } };
      },
      getFilesByName: () => ({ hasNext: () => false, next: () => null }),
      getFiles: () => ({ hasNext: () => false, next: () => null }),
      createFolder: (n) => {
        const child = makeFolder(n, 'fld-' + (++seq));
        self._children[n] = child;
        folders[child._id] = child;
        return child;
      },
      addFile: () => {}, removeFile: () => {},
      setSharing: () => {}, addEditor: () => {}, addViewer: () => {}
    };
    folders[id] = self;
    return self;
  }
  const root = makeFolder('My Drive', 'root');

  const files = {};
  function makeFile(id, name) {
    const f = {
      _trashed: false, _name: name,
      getId: () => id,
      getName: () => f._name,
      setName: (n) => { f._name = n; },
      getUrl: () => 'https://drive.google.com/file/d/' + id + '/view',
      getSize: () => 1024,
      getMimeType: () => 'application/octet-stream',
      isTrashed: () => f._trashed,
      setTrashed: (v) => { f._trashed = !!v; }
    };
    files[id] = f;
    return f;
  }

  global.DriveApp = {
    getRootFolder: () => root,
    getFolderById: (id) => { if (!folders[id]) throw new Error('no folder'); return folders[id]; },
    getFileById: (id) => files[id] || makeFile(id, 'file-' + id),
    Access: { PRIVATE: 'private', ANYONE_WITH_LINK: 'link' },
    Permission: { NONE: 'none', VIEW: 'view', EDIT: 'edit' }
  };

  global.UrlFetchApp = { fetch: () => { throw new Error('network disabled in tests'); } };
  global.ScriptApp = {
    getOAuthToken: () => 'token',
    getService: () => ({ getUrl: () => 'https://script.google.com/app' })
  };
  global.HtmlService = {
    createTemplateFromFile: () => ({ evaluate: () => ({}) }),
    createHtmlOutputFromFile: () => ({ getContent: () => '' }),
    createHtmlOutput: () => ({ setWidth: () => ({ setHeight: () => ({}) }) }),
    XFrameOptionsMode: { ALLOWALL: 'allowall' }
  };
  global.DocumentApp = {
    create: () => { throw new Error('docs disabled in tests'); },
    ParagraphHeading: {}, GlyphType: {}
  };
}

module.exports = { install };
