/**
 * Boms.js — bills of materials, costed against the inventory catalogue.
 *
 * A BOM is "per build": each line's qtyPer is the quantity for one unit,
 * and buildQty scales it. That is what makes pricing a run of ten boards
 * a single number rather than an arithmetic exercise.
 */

function bomShape_(bom) {
  var project = findById_('projects', bom.projectId);
  return {
    id: bom.id,
    projectId: bom.projectId,
    projectCode: project ? project.code : '',
    projectName: project ? project.name : '',
    name: bom.name,
    revision: bom.revision,
    description: bom.description,
    buildQty: num_(bom.buildQty, 1),
    status: bom.status,
    notes: bom.notes,
    lineCount: countWhere_('bomLines', function (l) { return l.bomId === bom.id; }),
    createdAt: bom.createdAt,
    updatedAt: bom.updatedAt
  };
}

function listBoms_(options) {
  var opts = options || {};
  var rows = all_('boms').filter(function (b) {
    if (opts.projectId && b.projectId !== opts.projectId) return false;
    if (opts.status && b.status !== opts.status) return false;
    if (opts.search && !contains_([b.name, b.description, b.revision].join(' '), opts.search)) {
      return false;
    }
    return true;
  });
  rows.sort(function (a, b) {
    if (str_(a.name) !== str_(b.name)) return str_(a.name).localeCompare(str_(b.name));
    return str_(b.revision).localeCompare(str_(a.revision));
  });
  return rows.map(function (b) {
    var shaped = bomShape_(b);
    var rollup = bomRollup_(b.id);
    shaped.unitCost = rollup.totals.unitCost;
    shaped.buildCost = rollup.totals.buildCost;
    shaped.shortfallCost = rollup.totals.shortfallCost;
    shaped.buildable = rollup.totals.buildableNow;
    return shaped;
  });
}

/**
 * Cost and stock-check a BOM.
 *
 * Shortfall is worked out line by line against a running pool of stock,
 * so an item appearing on two lines is not counted as covering both.
 */
function bomRollup_(bomId) {
  var bom = getOr404_('boms', bomId, 'BOM');
  var buildQty = Math.max(num_(bom.buildQty, 1), 0);
  var stock = stockIndex_();
  var remaining = {};

  var lines = byField_('bomLines', 'bomId', bom.id).sort(function (a, b) {
    return num_(a.lineNo) - num_(b.lineNo);
  });

  var totals = {
    unitCost: 0, buildCost: 0, shortfallCost: 0, shortfallLines: 0,
    unpricedLines: 0, lineCount: lines.length, buildQty: buildQty,
    currency: getSetting_('currency', 'USD'), buildableNow: null
  };

  var shaped = lines.map(function (line) {
    var item = line.itemId ? findById_('items', line.itemId) : null;
    var qtyPer = num_(line.qtyPer, 0);
    var scrap = num_(line.scrapPct, 0) / 100;
    var perUnit = round4_(qtyPer * (1 + scrap));
    var required = round4_(perUnit * buildQty);

    var override = numOrNull_(line.unitCostOverride);
    var unitCost = override !== null ? override : (item ? num_(item.unitCost) : 0);
    var priced = override !== null || (item && num_(item.unitCost) > 0);

    var onHandTotal = item ? (remaining[item.id] !== undefined ? remaining[item.id] : onHand_(item.id, stock)) : 0;
    var consumed = item ? Math.min(Math.max(onHandTotal, 0), required) : 0;
    if (item) remaining[item.id] = round4_(onHandTotal - consumed);

    var shortfall = item ? round4_(Math.max(required - consumed, 0)) : 0;
    var extCost = round2_(required * unitCost);
    var shortfallCost = round2_(shortfall * unitCost);

    totals.unitCost += perUnit * unitCost;
    totals.buildCost += extCost;
    totals.shortfallCost += shortfallCost;
    if (shortfall > 0) totals.shortfallLines++;
    if (!priced) totals.unpricedLines++;

    // How many complete builds this line alone could supply.
    if (item && perUnit > 0) {
      var canMake = Math.floor(onHand_(item.id, stock) / perUnit);
      totals.buildableNow = totals.buildableNow === null
        ? canMake : Math.min(totals.buildableNow, canMake);
    }

    return {
      id: line.id,
      bomId: line.bomId,
      lineNo: num_(line.lineNo),
      refDes: line.refDes,
      itemId: line.itemId,
      itemName: item ? item.name : '',
      itemSku: item ? item.sku : '',
      mpn: item ? item.mpn : '',
      supplier: item ? item.supplier : '',
      unit: item ? (item.unit || 'ea') : 'ea',
      description: str_(line.description) || (item ? item.name : ''),
      qtyPer: qtyPer,
      scrapPct: num_(line.scrapPct, 0),
      effectiveQtyPer: perUnit,
      required: required,
      onHand: item ? onHand_(item.id, stock) : null,
      shortfall: shortfall,
      unitCost: round4_(unitCost),
      unitCostSource: override !== null ? 'override' : (item ? 'catalog' : 'none'),
      priced: !!priced,
      extCost: extCost,
      shortfallCost: shortfallCost,
      note: line.note
    };
  });

  totals.unitCost = round2_(totals.unitCost);
  totals.buildCost = round2_(totals.buildCost);
  totals.shortfallCost = round2_(totals.shortfallCost);
  if (totals.buildableNow === null) totals.buildableNow = 0;

  return { bom: bomShape_(bom), lines: shaped, totals: totals };
}

function createBom_(payload) {
  var data = payload || {};
  var project = getOr404_('projects', require_(data.projectId, 'Project'), 'Project');
  var now = new Date();

  var bom = insert_('boms', {
    projectId: project.id,
    name: maxLen_(require_(data.name, 'BOM name'), 150, 'BOM name'),
    revision: maxLen_(str_(data.revision).trim() || 'A', 20, 'Revision'),
    description: maxLen_(str_(data.description), 2000, 'Description'),
    buildQty: Math.max(num_(data.buildQty, 1), 0),
    status: enum_(data.status, 'bomStatus', 'Status', 'draft'),
    notes: maxLen_(str_(data.notes), 4000, 'Notes'),
    createdAt: now,
    updatedAt: now
  });

  if (Array.isArray(data.lines) && data.lines.length) {
    data.lines.forEach(function (line) { addBomLine_(bom.id, line); });
  }

  audit_('create', 'bom', bom.id, bom.name + ' rev ' + bom.revision);
  return bomRollup_(bom.id);
}

function updateBom_(id, payload) {
  var existing = getOr404_('boms', id, 'BOM');
  var data = payload || {};
  var patch = { updatedAt: new Date() };

  if (data.name !== undefined) patch.name = maxLen_(require_(data.name, 'BOM name'), 150, 'BOM name');
  if (data.revision !== undefined) patch.revision = maxLen_(str_(data.revision).trim() || 'A', 20, 'Revision');
  if (data.description !== undefined) patch.description = maxLen_(str_(data.description), 2000, 'Description');
  if (data.buildQty !== undefined) patch.buildQty = Math.max(num_(data.buildQty, 1), 0);
  if (data.status !== undefined) patch.status = enum_(data.status, 'bomStatus', 'Status', 'draft');
  if (data.notes !== undefined) patch.notes = maxLen_(str_(data.notes), 4000, 'Notes');

  update_('boms', id, patch);
  audit_('update', 'bom', id, str_(existing.name));
  return bomRollup_(id);
}

function deleteBom_(id) {
  var bom = getOr404_('boms', id, 'BOM');
  removeWhere_('bomLines', function (l) { return l.bomId === bom.id; });
  removeWhere_('entryLinks', function (l) {
    return l.targetType === 'bom' && l.targetId === bom.id;
  });
  remove_('boms', bom.id);
  audit_('delete', 'bom', bom.id, bom.name + ' rev ' + bom.revision);
  return { deleted: true, id: bom.id };
}

/** Copy a BOM to a new revision, lines and all. */
function copyBom_(id, payload) {
  var source = getOr404_('boms', id, 'BOM');
  var data = payload || {};
  var now = new Date();

  var copy = insert_('boms', {
    projectId: str_(data.projectId).trim() || source.projectId,
    name: maxLen_(str_(data.name).trim() || source.name, 150, 'BOM name'),
    revision: maxLen_(str_(data.revision).trim() || bumpRevision_(source.revision), 20, 'Revision'),
    description: source.description,
    buildQty: num_(data.buildQty, num_(source.buildQty, 1)),
    status: 'draft',
    notes: source.notes,
    createdAt: now,
    updatedAt: now
  });

  var lines = byField_('bomLines', 'bomId', source.id).map(function (l) {
    return {
      bomId: copy.id, projectId: copy.projectId, lineNo: num_(l.lineNo),
      refDes: l.refDes, itemId: l.itemId, description: l.description,
      qtyPer: num_(l.qtyPer), unitCostOverride: l.unitCostOverride,
      scrapPct: num_(l.scrapPct), note: l.note
    };
  });
  if (lines.length) insertMany_('bomLines', lines);

  if (str_(data.supersede) === 'true' || bool_(data.supersede)) {
    update_('boms', source.id, { status: 'superseded', updatedAt: now });
  }

  audit_('copy', 'bom', copy.id, 'from ' + source.name + ' rev ' + source.revision);
  return bomRollup_(copy.id);
}

/** 'A' -> 'B', 'B2' -> 'B3', '1' -> '2'. */
function bumpRevision_(revision) {
  var rev = str_(revision).trim();
  if (!rev) return 'A';
  var trailing = /^(.*?)(\d+)$/.exec(rev);
  if (trailing) return trailing[1] + (parseInt(trailing[2], 10) + 1);
  var last = rev.slice(-1);
  if (/[A-Ya-y]/.test(last)) {
    return rev.slice(0, -1) + String.fromCharCode(last.charCodeAt(0) + 1);
  }
  return rev + '1';
}

/* ------------------------------ lines ----------------------------- */

function addBomLine_(bomId, payload) {
  var bom = getOr404_('boms', bomId, 'BOM');
  var data = payload || {};
  var itemId = str_(data.itemId).trim();
  var item = itemId ? getOr404_('items', itemId, 'Item') : null;

  if (!item && !str_(data.description).trim()) {
    fail_('A BOM line needs either an inventory item or a description.', 'required');
  }

  var line = insert_('bomLines', {
    bomId: bom.id,
    projectId: bom.projectId,
    lineNo: num_(data.lineNo, 0) || nextSeq_('bomLines', 'lineNo', 'bomId', bom.id),
    refDes: maxLen_(str_(data.refDes), 200, 'Reference designators'),
    itemId: item ? item.id : '',
    description: maxLen_(str_(data.description) || (item ? item.name : ''), 300, 'Description'),
    qtyPer: Math.max(num_(data.qtyPer, 1), 0),
    unitCostOverride: numOrNull_(data.unitCostOverride),
    scrapPct: Math.max(num_(data.scrapPct, 0), 0),
    note: maxLen_(str_(data.note), 500, 'Note')
  });

  update_('boms', bom.id, { updatedAt: new Date() });
  return line;
}

function updateBomLine_(lineId, payload) {
  var existing = getOr404_('bomLines', lineId, 'BOM line');
  var data = payload || {};
  var patch = {};

  if (data.itemId !== undefined) {
    var iid = str_(data.itemId).trim();
    if (iid) getOr404_('items', iid, 'Item');
    patch.itemId = iid;
  }
  if (data.lineNo !== undefined) patch.lineNo = num_(data.lineNo, 0);
  if (data.refDes !== undefined) patch.refDes = maxLen_(str_(data.refDes), 200, 'Reference designators');
  if (data.description !== undefined) patch.description = maxLen_(str_(data.description), 300, 'Description');
  if (data.qtyPer !== undefined) patch.qtyPer = Math.max(num_(data.qtyPer, 1), 0);
  if (data.unitCostOverride !== undefined) patch.unitCostOverride = numOrNull_(data.unitCostOverride);
  if (data.scrapPct !== undefined) patch.scrapPct = Math.max(num_(data.scrapPct, 0), 0);
  if (data.note !== undefined) patch.note = maxLen_(str_(data.note), 500, 'Note');

  var saved = update_('bomLines', lineId, patch);
  update_('boms', existing.bomId, { updatedAt: new Date() });
  return saved;
}

function deleteBomLine_(lineId) {
  var line = getOr404_('bomLines', lineId, 'BOM line');
  remove_('bomLines', line.id);
  update_('boms', line.bomId, { updatedAt: new Date() });
  return { deleted: true, id: line.id };
}

/**
 * Paste a BOM in as text. Accepts CSV or tab-separated rows with a
 * header naming any of: refdes, sku/part, description, qty, cost, scrap.
 */
function importBomLines_(bomId, text, options) {
  var bom = getOr404_('boms', bomId, 'BOM');
  var opts = options || {};
  var raw = require_(text, 'Pasted BOM text');
  var rows = raw.split(/\r?\n/).filter(function (l) { return l.trim().length; });
  if (rows.length < 2) fail_('Paste a header row plus at least one line.', 'invalid');

  var delimiter = rows[0].indexOf('\t') !== -1 ? '\t' : ',';
  var headers = splitDelimited_(rows[0], delimiter).map(function (h) {
    return h.trim().toLowerCase().replace(/[^a-z]/g, '');
  });

  function col(names) {
    for (var i = 0; i < names.length; i++) {
      var idx = headers.indexOf(names[i]);
      if (idx !== -1) return idx;
    }
    return -1;
  }

  var map = {
    refDes: col(['refdes', 'reference', 'references', 'designator', 'designators']),
    sku: col(['sku', 'partnumber', 'part', 'mpn', 'manufacturerpartnumber']),
    description: col(['description', 'desc', 'comment', 'value', 'name']),
    qty: col(['qty', 'quantity', 'qtyper', 'quantityper']),
    cost: col(['cost', 'unitcost', 'price', 'unitprice']),
    scrap: col(['scrap', 'scrappct', 'scraprate'])
  };

  if (map.description === -1 && map.sku === -1) {
    fail_('Could not find a description or part-number column in the header row.', 'invalid');
  }

  var itemsBySku = {};
  all_('items').forEach(function (i) {
    if (i.sku) itemsBySku[str_(i.sku).toLowerCase()] = i;
    if (i.mpn) itemsBySku[str_(i.mpn).toLowerCase()] = i;
  });

  var startNo = nextSeq_('bomLines', 'lineNo', 'bomId', bom.id);
  var created = [];
  var unmatched = [];

  rows.slice(1).forEach(function (rowText, i) {
    var cells = splitDelimited_(rowText, delimiter);
    function cell(idx) { return idx === -1 ? '' : str_(cells[idx]).trim(); }

    var skuText = cell(map.sku);
    var item = skuText ? itemsBySku[skuText.toLowerCase()] : null;
    if (skuText && !item) unmatched.push(skuText);

    var description = cell(map.description) || skuText;
    if (!description && !item) return;

    created.push({
      bomId: bom.id,
      projectId: bom.projectId,
      lineNo: startNo + i,
      refDes: cell(map.refDes),
      itemId: item ? item.id : '',
      description: description,
      qtyPer: Math.max(num_(cell(map.qty), 1), 0) || 1,
      unitCostOverride: item ? null : numOrNull_(cell(map.cost)),
      scrapPct: Math.max(num_(cell(map.scrap), 0), 0),
      note: (!item && skuText) ? 'Unmatched part number: ' + skuText : ''
    });
  });

  if (!created.length) fail_('No usable rows found in that paste.', 'invalid');
  if (bool_(opts.replace)) {
    removeWhere_('bomLines', function (l) { return l.bomId === bom.id; });
    created.forEach(function (line, i) { line.lineNo = i + 1; });
  }

  insertMany_('bomLines', created);
  update_('boms', bom.id, { updatedAt: new Date() });
  audit_('import', 'bom', bom.id, 'imported ' + created.length + ' line(s)');

  return {
    imported: created.length,
    unmatched: unmatched,
    rollup: bomRollup_(bom.id)
  };
}

/** CSV-aware split that respects double-quoted fields. */
function splitDelimited_(line, delimiter) {
  if (delimiter === '\t') return str_(line).split('\t');
  var out = [];
  var current = '';
  var inQuotes = false;
  var s = str_(line);
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    if (ch === '"') {
      if (inQuotes && s.charAt(i + 1) === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === delimiter && !inQuotes) {
      out.push(current); current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

/**
 * Consume the stock a build needs and record it against the project.
 * Refuses to start unless every line is covered, so a build never
 * leaves the ledger half-consumed.
 */
function buildBom_(bomId, payload) {
  var bom = getOr404_('boms', bomId, 'BOM');
  var data = payload || {};
  var qty = requireNum_(data.quantity === undefined ? bom.buildQty : data.quantity,
    'Build quantity', { min: 0.0001 });

  var scale = qty / Math.max(num_(bom.buildQty, 1), 0.0001);
  var rollup = bomRollup_(bom.id);
  var date = optDate_(data.date, 'Build date') || todayStr_();

  var shortages = rollup.lines.filter(function (line) {
    if (!line.itemId) return false;
    return round4_(line.required * scale) > num_(line.onHand);
  });

  if (shortages.length && !bool_(data.allowNegative)) {
    fail_(
      'Not enough stock for ' + shortages.length + ' line(s): ' +
      shortages.slice(0, 5).map(function (l) {
        return l.itemName + ' (need ' + round4_(l.required * scale) + ', have ' + l.onHand + ')';
      }).join('; ') + '.',
      'insufficient_stock',
      { shortages: shortages.map(function (l) { return l.itemId; }) }
    );
  }

  var consumed = [];
  rollup.lines.forEach(function (line) {
    if (!line.itemId) return;
    var need = round4_(line.required * scale);
    if (need <= 0) return;
    var result = recordTxn_({
      itemId: line.itemId,
      type: 'consume',
      quantity: need,
      unitCost: line.unitCost,
      date: date,
      projectId: bom.projectId,
      entryId: str_(data.entryId),
      bomId: bom.id,
      allowNegative: true,
      note: 'Build: ' + bom.name + ' rev ' + bom.revision + ' x' + qty
    });
    consumed.push({ itemId: line.itemId, name: line.itemName, quantity: need, txnId: result.txn.id });
  });

  audit_('build', 'bom', bom.id,
    'Built ' + qty + ' x ' + bom.name + ' rev ' + bom.revision +
    ' (' + consumed.length + ' line(s) consumed)');

  return {
    built: qty,
    consumed: consumed,
    cost: round2_(rollup.totals.unitCost * qty),
    rollup: bomRollup_(bom.id)
  };
}
