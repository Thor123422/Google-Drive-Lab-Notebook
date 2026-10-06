/**
 * Validate.js — argument checking and the error shape the UI understands.
 *
 * Server functions throw AppError; Code.js catches it and returns a
 * structured { ok:false, error } envelope so the client can show a useful
 * message instead of a stack trace.
 */

/** @constructor */
function AppError(message, code, details) {
  this.name = 'AppError';
  this.message = message || 'Something went wrong.';
  this.code = code || 'invalid';
  this.details = details || null;
  this.isAppError = true;
}
AppError.prototype = Object.create(Error.prototype);
AppError.prototype.constructor = AppError;

function fail_(message, code, details) {
  throw new AppError(message, code, details);
}

function require_(value, label) {
  var s = str_(value).trim();
  if (!s) fail_(label + ' is required.', 'required', { field: label });
  return s;
}

function requireNum_(value, label, opts) {
  var options = opts || {};
  var n = numOrNull_(value);
  if (n === null) fail_(label + ' is required.', 'required', { field: label });
  if (options.min !== undefined && n < options.min) {
    fail_(label + ' must be at least ' + options.min + '.', 'range', { field: label });
  }
  if (options.max !== undefined && n > options.max) {
    fail_(label + ' must be at most ' + options.max + '.', 'range', { field: label });
  }
  if (options.integer && Math.round(n) !== n) {
    fail_(label + ' must be a whole number.', 'range', { field: label });
  }
  return n;
}

/**
 * Validate against an ENUMS() list. Empty input falls back to `def` when
 * one is given, otherwise it is an error.
 */
function enum_(value, enumName, label, def) {
  var allowed = ENUMS()[enumName];
  if (!allowed) fail_('Unknown enumeration "' + enumName + '".', 'internal');
  var s = str_(value).trim().toLowerCase();
  if (!s) {
    if (def !== undefined) return def;
    fail_(label + ' is required.', 'required', { field: label });
  }
  if (allowed.indexOf(s) === -1) {
    fail_(
      label + ' must be one of: ' + allowed.join(', ') + '.',
      'enum',
      { field: label, allowed: allowed, got: s }
    );
  }
  return s;
}

function requireDate_(value, label) {
  var d = toDate_(value);
  if (!d) fail_(label + ' must be a valid date.', 'invalid_date', { field: label });
  return dateStr_(d);
}

/** Optional date: '' passes through untouched. */
function optDate_(value, label) {
  if (value === null || value === undefined || str_(value).trim() === '') return '';
  return requireDate_(value, label);
}

/** Throws unless `record` exists; used after a store lookup. */
function requireRecord_(record, label, id) {
  if (!record) {
    fail_(label + ' not found.', 'not_found', { id: str_(id) });
  }
  return record;
}

/** Trim to a maximum length, erroring rather than silently truncating. */
function maxLen_(value, limit, label) {
  var s = str_(value);
  if (s.length > limit) {
    fail_(label + ' is too long (' + s.length + ' of ' + limit + ' characters).',
      'too_long', { field: label, limit: limit });
  }
  return s;
}
