/**
 * Inventory.js — parts catalogue and stock ledger.
 *
 * Quantity on hand is never stored. It is the sum of the movements in
 * InventoryTxns, so the stock figure and its history can never disagree.
 */

/** itemId -> { onHand, received, consumed, lastDate } for every item. */
function stockIndex_() {
  var index = {};
  all_('txns').forEach(function (t) {
    var id = str_(t.itemId);
    if (!id) return;
    if (!index[id]) {
      index[id] = { onHand: 0, received: 0, consumed: 0, lastDate: '', txnCount: 0 };
    }
    var row = index[id];
    var qty = num_(t.quantity);
    row.onHand += qty;
    row.txnCount++;
    if (qty > 0) row.received += qty;
    else row.consumed += -qty;
    if (str_(t.date) > row.lastDate) row.lastDate = str_(t.date);
  });
  Object.keys(index).forEach(function (id) {
    index[id].onHand = round4_(index[id].onHand);
    index[id].received = round4_(index[id].received);
    index[id].consumed = round4_(index[id].consumed);
  });
  return index;
}

function onHand_(itemId, index) {
  var idx = index || stockIndex_();
  return idx[str_(itemId)] ? idx[str_(itemId)].onHand : 0;
}

function itemShape_(item, index) {
  var stock = index[item.id] || { onHand: 0, received: 0, consumed: 0, lastDate: '', txnCount: 0 };
  var reorderPoint = num_(item.reorderPoint);
  return {
    id: item.id,
    sku: item.sku,
    name: item.name,
    description: item.description,
    category: item.category,
    manufacturer: item.manufacturer,
    mpn: item.mpn,
    supplier: item.supplier,
    supplierPn: item.supplierPn,
    supplierUrl: item.supplierUrl,
    unit: item.unit || 'ea',
    unitCost: num_(item.unitCost),
    currency: item.currency || getSetting_('currency', 'USD'),
    reorderPoint: reorderPoint,
    reorderQty: num_(item.reorderQty),
    leadTimeDays: num_(item.leadTimeDays),
    location: item.location,
    datasheetFileId: item.datasheetFileId,
    tags: parseTags_(item.tags),
    active: !!item.active,
    notes: item.notes,
    onHand: stock.onHand,
    received: stock.received,
    consumed: stock.consumed,
    lastMovement: stock.lastDate,
    txnCount: stock.txnCount,
    value: round2_(stock.onHand * num_(item.unitCost)),
    lowStock: reorderPoint > 0 && stock.onHand <= reorderPoint,
    outOfStock: stock.onHand <= 0,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}

function listItems_(options) {
  var opts = options || {};
  var search = str_(opts.search).trim();
  var category = str_(opts.category).trim();
  var index = stockIndex_();

  var rows = all_('items').filter(function (i) {
    if (!bool_(opts.includeInactive) && !i.active) return false;
    if (category && str_(i.category) !== category) return false;
    if (search) {
      var hay = [i.sku, i.name, i.description, i.mpn, i.manufacturer,
        i.supplier, i.supplierPn, i.location, i.tags].join(' ');
      if (!contains_(hay, search)) return false;
    }
    return true;
  }).map(function (i) { return itemShape_(i, index); });

  if (bool_(opts.lowStockOnly)) {
    rows = rows.filter(function (i) { return i.lowStock || i.outOfStock; });
  }

  var sort = str_(opts.sort) || 'name';
  rows.sort(function (a, b) {
    if (sort === 'onHand') return a.onHand - b.onHand;
    if (sort === 'value') return b.value - a.value;
    if (sort === 'sku') return str_(a.sku).localeCompare(str_(b.sku));
    return str_(a.name).localeCompare(str_(b.name));
  });
  return rows;
}

function getItem_(id) {
  var item = getOr404_('items', id, 'Item');
  var index = stockIndex_();
  var shaped = itemShape_(item, index);

  shaped.transactions = byField_('txns', 'itemId', item.id)
    .sort(function (a, b) {
      if (str_(a.date) !== str_(b.date)) return str_(b.date).localeCompare(str_(a.date));
      return str_(b.createdAt).localeCompare(str_(a.createdAt));
    })
    .map(function (t) {
      var project = findById_('projects', t.projectId);
      return {
        id: t.id, date: t.date, type: t.type, quantity: num_(t.quantity),
        unitCost: num_(t.unitCost), note: t.note,
        projectId: t.projectId, projectCode: project ? project.code : '',
        purchaseId: t.purchaseId, entryId: t.entryId, createdBy: t.createdBy
      };
    });

  // Where this part is used, by project.
  var byProject = {};
  byField_('txns', 'itemId', item.id).forEach(function (t) {
    var qty = num_(t.quantity);
    if (qty >= 0 || !str_(t.projectId)) return;
    byProject[t.projectId] = (byProject[t.projectId] || 0) + -qty;
  });
  shaped.usage = Object.keys(byProject).map(function (pid) {
    var p = findById_('projects', pid);
    return {
      projectId: pid, code: p ? p.code : '(deleted)', name: p ? p.name : '',
      quantity: round4_(byProject[pid])
    };
  }).sort(function (a, b) { return b.quantity - a.quantity; });

  // Which BOMs call for it, and the open purchases that will replenish it.
  shaped.usedInBoms = byField_('bomLines', 'itemId', item.id).map(function (line) {
    var bom = findById_('boms', line.bomId);
    if (!bom) return null;
    var project = findById_('projects', bom.projectId);
    return {
      bomId: bom.id, name: bom.name, revision: bom.revision,
      qtyPer: num_(line.qtyPer), buildQty: num_(bom.buildQty),
      projectId: bom.projectId, projectCode: project ? project.code : ''
    };
  }).filter(Boolean);

  shaped.onOrder = round4_(byField_('purchases', 'itemId', item.id)
    .filter(function (p) { return p.status === 'ordered' || p.status === 'planned'; })
    .reduce(function (sum, p) { return sum + num_(p.quantity); }, 0));

  shaped.backlinks = backlinks_('item', item.id);
  return shaped;
}

function createItem_(payload) {
  var data = payload || {};
  var now = new Date();
  var name = maxLen_(require_(data.name, 'Item name'), 200, 'Item name');
  var sku = str_(data.sku).trim();

  if (sku && firstWhere_('items', function (i) {
    return str_(i.sku).toLowerCase() === sku.toLowerCase();
  })) {
    fail_('SKU "' + sku + '" is already in use.', 'duplicate', { field: 'sku' });
  }

  var item = insert_('items', {
    sku: sku,
    name: name,
    description: maxLen_(str_(data.description), 2000, 'Description'),
    category: maxLen_(str_(data.category), 80, 'Category'),
    manufacturer: str_(data.manufacturer),
    mpn: str_(data.mpn),
    supplier: str_(data.supplier),
    supplierPn: str_(data.supplierPn),
    supplierUrl: str_(data.supplierUrl),
    unit: str_(data.unit).trim() || 'ea',
    unitCost: num_(data.unitCost, 0),
    currency: str_(data.currency).trim() || getSetting_('currency', 'USD'),
    reorderPoint: num_(data.reorderPoint, 0),
    reorderQty: num_(data.reorderQty, 0),
    leadTimeDays: num_(data.leadTimeDays, 0),
    location: str_(data.location),
    datasheetFileId: str_(data.datasheetFileId),
    tags: joinTags_(data.tags),
    active: data.active === undefined ? true : bool_(data.active),
    notes: maxLen_(str_(data.notes), 4000, 'Notes'),
    createdAt: now,
    updatedAt: now
  });

  // An opening balance is recorded as a receipt, not as a stored number.
  var opening = num_(data.openingQty, 0);
  if (opening !== 0) {
    recordTxn_({
      itemId: item.id, type: opening > 0 ? 'receive' : 'adjust',
      quantity: opening, unitCost: item.unitCost,
      date: todayStr_(), note: 'Opening balance'
    });
  }

  audit_('create', 'item', item.id, (sku ? sku + ' ' : '') + name);
  return getItem_(item.id);
}

function updateItem_(id, payload) {
  var existing = getOr404_('items', id, 'Item');
  var data = payload || {};
  var patch = { updatedAt: new Date() };

  if (data.sku !== undefined) {
    var sku = str_(data.sku).trim();
    if (sku) {
      var clash = firstWhere_('items', function (i) {
        return i.id !== existing.id && str_(i.sku).toLowerCase() === sku.toLowerCase();
      });
      if (clash) fail_('SKU "' + sku + '" is already in use.', 'duplicate', { field: 'sku' });
    }
    patch.sku = sku;
  }

  var simple = ['name', 'description', 'category', 'manufacturer', 'mpn', 'supplier',
    'supplierPn', 'supplierUrl', 'location', 'datasheetFileId', 'notes'];
  simple.forEach(function (field) {
    if (data[field] !== undefined) patch[field] = str_(data[field]);
  });
  if (data.name !== undefined) patch.name = maxLen_(require_(data.name, 'Item name'), 200, 'Item name');
  if (data.unit !== undefined) patch.unit = str_(data.unit).trim() || 'ea';
  ['unitCost', 'reorderPoint', 'reorderQty', 'leadTimeDays'].forEach(function (field) {
    if (data[field] !== undefined) patch[field] = num_(data[field], 0);
  });
  if (data.currency !== undefined) patch.currency = str_(data.currency).trim() || 'USD';
  if (data.tags !== undefined) patch.tags = joinTags_(data.tags);
  if (data.active !== undefined) patch.active = bool_(data.active);

  var saved = update_('items', id, patch);
  audit_('update', 'item', id, str_(saved.sku || saved.name));
  return getItem_(saved.id);
}

function deleteItem_(id, options) {
  var item = getOr404_('items', id, 'Item');
  var opts = options || {};
  var txnCount = countWhere_('txns', function (t) { return t.itemId === item.id; });
  var bomCount = countWhere_('bomLines', function (l) { return l.itemId === item.id; });

  if ((txnCount || bomCount) && !bool_(opts.force)) {
    fail_(
      'This item has ' + txnCount + ' stock movement(s) and appears on ' +
      bomCount + ' BOM line(s). Mark it inactive instead, or confirm to ' +
      'delete it and its history.',
      'in_use',
      { txnCount: txnCount, bomCount: bomCount }
    );
  }

  removeWhere_('txns', function (t) { return t.itemId === item.id; });
  byField_('bomLines', 'itemId', item.id).forEach(function (line) {
    update_('bomLines', line.id, {
      itemId: '',
      description: str_(line.description) || str_(item.name),
      unitCostOverride: line.unitCostOverride === null || line.unitCostOverride === ''
        ? num_(item.unitCost) : line.unitCostOverride
    });
  });
  removeWhere_('entryLinks', function (l) {
    return l.targetType === 'item' && l.targetId === item.id;
  });
  remove_('items', item.id);
  audit_('delete', 'item', item.id, str_(item.sku || item.name));
  return { deleted: true, id: item.id };
}

/* ---------------------------- movements --------------------------- */

/**
 * Record a stock movement. The sign of `quantity` is forced to match the
 * movement type so a "consume" can never silently add stock.
 */
function recordTxn_(payload) {
  var data = payload || {};
  var item = getOr404_('items', require_(data.itemId, 'Item'), 'Item');
  var type = enum_(data.type, 'txnType', 'Movement type');
  var qty = requireNum_(data.quantity, 'Quantity');
  if (qty === 0) fail_('Quantity cannot be zero.', 'range', { field: 'quantity' });

  var sign = TXN_SIGN()[type];
  if (sign === 1) qty = Math.abs(qty);
  else if (sign === -1) qty = -Math.abs(qty);

  if (str_(data.projectId)) getOr404_('projects', data.projectId, 'Project');

  var allowNegative = bool_(data.allowNegative) || str_(getSetting_('allowNegativeStock', 'false')) === 'true';
  if (qty < 0 && !allowNegative) {
    var current = onHand_(item.id);
    if (current + qty < 0) {
      fail_(
        'Only ' + current + ' ' + (item.unit || 'ea') + ' of ' + item.name +
        ' on hand; that movement would leave ' + round4_(current + qty) + '.',
        'insufficient_stock',
        { onHand: current, requested: -qty }
      );
    }
  }

  var txn = insert_('txns', {
    itemId: item.id,
    date: optDate_(data.date, 'Movement date') || todayStr_(),
    type: type,
    quantity: round4_(qty),
    unitCost: data.unitCost === undefined || data.unitCost === ''
      ? num_(item.unitCost) : num_(data.unitCost, 0),
    projectId: str_(data.projectId),
    entryId: str_(data.entryId),
    purchaseId: str_(data.purchaseId),
    bomId: str_(data.bomId),
    location: str_(data.location) || str_(item.location),
    note: maxLen_(str_(data.note), 1000, 'Note'),
    createdAt: new Date(),
    createdBy: currentUser_()
  });

  audit_('stock', 'item', item.id, type + ' ' + round4_(qty) + ' ' + (item.unit || 'ea') +
    ' of ' + str_(item.name));
  return { txn: txn, item: getItem_(item.id) };
}

function deleteTxn_(id) {
  var txn = getOr404_('txns', id, 'Stock movement');
  if (str_(txn.purchaseId)) {
    fail_(
      'This movement came from a received purchase. Change the purchase ' +
      'back to "ordered" to reverse it.',
      'linked'
    );
  }
  remove_('txns', txn.id);
  audit_('delete', 'txn', txn.id, 'reversed ' + txn.type + ' of ' + txn.quantity);
  return { deleted: true, id: txn.id };
}

/** Set stock to an absolute figure by writing the difference. */
function setStockLevel_(itemId, newQty, note) {
  var item = getOr404_('items', itemId, 'Item');
  var target = requireNum_(newQty, 'New quantity', { min: 0 });
  var current = onHand_(item.id);
  var delta = round4_(target - current);
  if (delta === 0) return getItem_(item.id);

  recordTxn_({
    itemId: item.id, type: 'adjust', quantity: delta, date: todayStr_(),
    allowNegative: true,
    note: str_(note) || ('Stock count: ' + current + ' → ' + target)
  });
  return getItem_(item.id);
}

function listTransactions_(options) {
  var opts = options || {};
  var limit = num_(opts.limit, 200);

  var rows = all_('txns').filter(function (t) {
    if (opts.itemId && t.itemId !== opts.itemId) return false;
    if (opts.projectId && t.projectId !== opts.projectId) return false;
    if (opts.type && t.type !== opts.type) return false;
    if (opts.from && str_(t.date) < str_(opts.from)) return false;
    if (opts.to && str_(t.date) > str_(opts.to)) return false;
    return true;
  }).sort(function (a, b) {
    if (str_(a.date) !== str_(b.date)) return str_(b.date).localeCompare(str_(a.date));
    return str_(b.createdAt).localeCompare(str_(a.createdAt));
  });

  if (limit > 0) rows = rows.slice(0, limit);

  return rows.map(function (t) {
    var item = findById_('items', t.itemId);
    var project = findById_('projects', t.projectId);
    return {
      id: t.id, date: t.date, type: t.type, quantity: num_(t.quantity),
      unitCost: num_(t.unitCost), value: round2_(num_(t.quantity) * num_(t.unitCost)),
      itemId: t.itemId, itemName: item ? item.name : '(deleted item)',
      itemSku: item ? item.sku : '', unit: item ? item.unit : 'ea',
      projectId: t.projectId, projectCode: project ? project.code : '',
      purchaseId: t.purchaseId, note: t.note, createdBy: t.createdBy
    };
  });
}

/** Items at or below their reorder point, worst first. */
function lowStock_() {
  var index = stockIndex_();
  return all_('items')
    .filter(function (i) { return i.active; })
    .map(function (i) { return itemShape_(i, index); })
    .filter(function (i) { return i.lowStock || i.outOfStock; })
    .map(function (i) {
      i.shortBy = round4_(Math.max(i.reorderPoint - i.onHand, 0));
      i.suggestedOrder = round4_(Math.max(i.reorderQty, i.shortBy));
      i.suggestedCost = round2_(i.suggestedOrder * i.unitCost);
      return i;
    })
    .sort(function (a, b) {
      var ra = a.reorderPoint > 0 ? a.onHand / a.reorderPoint : a.onHand;
      var rb = b.reorderPoint > 0 ? b.onHand / b.reorderPoint : b.onHand;
      return ra - rb;
    });
}

/** Totals for the inventory header strip. */
function inventoryTotals_() {
  var index = stockIndex_();
  var items = all_('items').filter(function (i) { return i.active; });
  var value = 0;
  var low = 0;
  var out = 0;
  items.forEach(function (i) {
    var shaped = itemShape_(i, index);
    value += shaped.value;
    if (shaped.outOfStock) out++;
    else if (shaped.lowStock) low++;
  });
  return {
    itemCount: items.length,
    totalValue: round2_(value),
    lowStockCount: low,
    outOfStockCount: out,
    currency: getSetting_('currency', 'USD')
  };
}
