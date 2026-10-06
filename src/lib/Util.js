/**
 * Util.js — ids, dates, coercion and small string helpers.
 */

/** Script timezone, used for every date <-> string conversion. */
function tz_() {
  return Session.getScriptTimeZone() || 'Etc/GMT';
}

/**
 * Short, sortable, collision-resistant id: a base-36 timestamp plus
 * randomness, prefixed so ids are self-describing in the sheet.
 */
function newId_(prefix) {
  var ts = Date.now().toString(36);
  var rand = Math.floor(Math.random() * 1679616).toString(36);
  while (rand.length < 4) rand = '0' + rand;
  return (prefix || 'id') + '_' + ts + rand;
}

function uuid_() {
  return Utilities.getUuid();
}

/* ------------------------------ dates ----------------------------- */

/** Parse anything date-ish into a Date, or null. */
function toDate_(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    var fromNum = new Date(value);
    return isNaN(fromNum.getTime()) ? null : fromNum;
  }
  var s = String(value).trim();
  if (!s) return null;
  // Plain yyyy-mm-dd is parsed as UTC by Date(); build it in local time
  // instead so the calendar day never shifts backwards.
  var ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (ymd) {
    return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
  }
  var parsed = new Date(s);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/** Date -> 'yyyy-MM-dd' in script time, or '' . */
function dateStr_(value) {
  var d = toDate_(value);
  return d ? Utilities.formatDate(d, tz_(), 'yyyy-MM-dd') : '';
}

/** Date -> ISO-ish local datetime string, or ''. */
function dateTimeStr_(value) {
  var d = toDate_(value);
  return d ? Utilities.formatDate(d, tz_(), "yyyy-MM-dd'T'HH:mm:ss") : '';
}

function today_() {
  var now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function todayStr_() {
  return dateStr_(today_());
}

/** First day of the month containing `d`. */
function monthStart_(d) {
  var dt = toDate_(d) || today_();
  return new Date(dt.getFullYear(), dt.getMonth(), 1);
}

/** 'yyyy-MM' bucket key. */
function monthKey_(d) {
  var dt = toDate_(d);
  return dt ? Utilities.formatDate(dt, tz_(), 'yyyy-MM') : '';
}

function addMonths_(d, n) {
  var dt = toDate_(d) || today_();
  var out = new Date(dt.getFullYear(), dt.getMonth() + n, 1);
  return out;
}

function addDays_(d, n) {
  var dt = toDate_(d) || today_();
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + n);
}

/** Whole days between two dates (b - a). */
function daysBetween_(a, b) {
  var da = toDate_(a);
  var db = toDate_(b);
  if (!da || !db) return null;
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

/* --------------------------- coercion ----------------------------- */

function num_(value, fallback) {
  if (value === null || value === undefined || value === '') {
    return fallback === undefined ? 0 : fallback;
  }
  if (typeof value === 'number') return isFinite(value) ? value : (fallback || 0);
  var cleaned = String(value).replace(/[$,\s]/g, '');
  var n = parseFloat(cleaned);
  return isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
}

/** Null-preserving number: '' stays null instead of collapsing to 0. */
function numOrNull_(value) {
  if (value === null || value === undefined || value === '') return null;
  var n = num_(value, NaN);
  return isFinite(n) ? n : null;
}

function str_(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return dateTimeStr_(value);
  return String(value);
}

function bool_(value) {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined || value === '') return false;
  var s = String(value).trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === 'y' || s === '1';
}

function round2_(n) {
  return Math.round((num_(n) + Number.EPSILON) * 100) / 100;
}

function round4_(n) {
  return Math.round((num_(n) + Number.EPSILON) * 10000) / 10000;
}

/* ---------------------------- strings ----------------------------- */

function slug_(value, maxLen) {
  var s = str_(value).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  var limit = maxLen || 48;
  return s.length > limit ? s.slice(0, limit).replace(/-+$/, '') : s;
}

/** Tag strings are stored comma-separated; normalise both directions. */
function parseTags_(value) {
  return str_(value)
    .split(',')
    .map(function (t) { return t.trim(); })
    .filter(function (t) { return t.length > 0; });
}

function joinTags_(tags) {
  if (!tags) return '';
  var list = Array.isArray(tags) ? tags : parseTags_(tags);
  var seen = {};
  var out = [];
  list.forEach(function (t) {
    var clean = String(t).trim();
    var key = clean.toLowerCase();
    if (clean && !seen[key]) { seen[key] = true; out.push(clean); }
  });
  return out.join(', ');
}

/** Case-insensitive "does haystack contain needle". */
function contains_(haystack, needle) {
  if (!needle) return true;
  return str_(haystack).toLowerCase().indexOf(String(needle).toLowerCase()) !== -1;
}

function humanSize_(bytes) {
  var b = num_(bytes);
  if (b <= 0) return '—';
  var units = ['B', 'KB', 'MB', 'GB', 'TB'];
  var i = 0;
  while (b >= 1024 && i < units.length - 1) { b = b / 1024; i++; }
  return (i === 0 ? b : b.toFixed(b < 10 ? 1 : 0)) + ' ' + units[i];
}

/** Current user's email, or '' when the scope is unavailable. */
function currentUser_() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch (err) {
    return '';
  }
}
