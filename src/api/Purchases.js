/**
 * Purchases.js — committed and actual spend, and the bridge from an
 * order into stock.
 *
 * A purchase moves planned -> ordered -> received. Receiving it writes
 * the matching stock movement; un-receiving it takes that movement back
 * out, so the ledger always mirrors the order book.
 */

function purchaseShape_(purchase) {
  var project = findById_('projects', purchase.projectId);
  var item = findById_('items', purchase.itemId);
  return {
    id: purchase.id,
    projectId: purchase.projectId,
    projectCode: project ? project.code : '',
    projectName: project ? project.name : '',
    date: purchase.date,
    vendor: purchase.vendor,
    orderNumber: purchase.orderNumber,
    description: purchase.description,
    category: purchase.category,
    status: purchase.status,
    itemId: purchase.itemId,
    itemName: item ? item.name : '',
    itemSku: item ? item.sku : '',
    unit: item ? item.unit : 'ea',
    quantity: num_(purchase.quantity),
    unitCost: num_(purchase.unitCost),
    amount: num_(purchase.amount),
    currency: purchase.currency || getSetting_('currency', 'USD'),
    expectedDate: purchase.expectedDate,
    receivedDate: purchase.receivedDate,
    invoiceFileId: purchase.invoiceFileId,
    invoiceFileName: purchase.invoiceFileId
      ? str_((findById_('files', purchase.invoiceFileId) || {}).name) : '',
    receiveTxnId: purchase.receiveTxnId,
    note: purchase.note,
    overdue: purchase.status === 'ordered' && str_(purchase.expectedDate) &&
      str_(purchase.expectedDate) < todayStr_(),
    createdAt: purchase.createdAt,
    updatedAt: purchase.updatedAt
  };
}

function listPurchases_(options) {
  var opts = options || {};
  var search = str_(opts.search).trim();

  var rows = all_('purchases').filter(function (p) {
    if (opts.projectId && p.projectId !== opts.projectId) return false;
    if (opts.status && p.status !== opts.status) return false;
    if (opts.category && p.category !== opts.category) return false;
    if (opts.itemId && p.itemId !== opts.itemId) return false;
    if (opts.from && str_(p.date) < str_(opts.from)) return false;
    if (opts.to && str_(p.date) > str_(opts.to)) return false;
    if (search && !contains_([p.vendor, p.orderNumber, p.description, p.note].join(' '), search)) {
      return false;
    }
    return true;
  });

  rows.sort(function (a, b) { return str_(b.date).localeCompare(str_(a.date)); });
  return rows.map(purchaseShape_);
}

function getPurchase_(id) {
  var shaped = purchaseShape_(getOr404_('purchases', id, 'Purchase'));
  shaped.backlinks = backlinks_('purchase', id);
  return shaped;
}

/** Amount follows quantity x unit cost unless an explicit total is given. */
function resolveAmount_(data, fallbackQty, fallbackUnit) {
  var qty = data.quantity === undefined ? fallbackQty : num_(data.quantity, 0);
  var unit = data.unitCost === undefined ? fallbackUnit : num_(data.unitCost, 0);
  if (data.amount !== undefined && str_(data.amount) !== '') {
    return { quantity: qty, unitCost: unit, amount: num_(data.amount, 0) };
  }
  return { quantity: qty, unitCost: unit, amount: round2_(qty * unit) };
}

function createPurchase_(payload) {
  var data = payload || {};
  var now = new Date();
  var project = str_(data.projectId).trim();
  if (project) getOr404_('projects', project, 'Project');

  var item = null;
  if (str_(data.itemId).trim()) item = getOr404_('items', data.itemId, 'Item');

  var money = resolveAmount_(data, 1, item ? num_(item.unitCost) : 0);

  var purchase = insert_('purchases', {
    projectId: project,
    date: optDate_(data.date, 'Order date') || todayStr_(),
    vendor: maxLen_(str_(data.vendor), 150, 'Vendor'),
    orderNumber: maxLen_(str_(data.orderNumber), 100, 'Order number'),
    description: maxLen_(require_(data.description || (item && item.name), 'Description'), 300, 'Description'),
    category: enum_(data.category, 'purchaseCategory', 'Category', 'components'),
    status: enum_(data.status, 'purchaseStatus', 'Status', 'planned'),
    itemId: item ? item.id : '',
    quantity: money.quantity,
    unitCost: money.unitCost,
    amount: money.amount,
    currency: str_(data.currency).trim() || getSetting_('currency', 'USD'),
    expectedDate: optDate_(data.expectedDate, 'Expected date'),
    receivedDate: '',
    invoiceFileId: str_(data.invoiceFileId),
    receiveTxnId: '',
    note: maxLen_(str_(data.note), 2000, 'Note'),
    createdAt: now,
    updatedAt: now
  });

  // Creating one already marked received should still move the stock.
  if (purchase.status === 'received') {
    return receivePurchase_(purchase.id, { date: optDate_(data.receivedDate, 'Received date') });
  }

  audit_('create', 'purchase', purchase.id,
    str_(purchase.vendor) + ' ' + str_(purchase.description) + ' ' + purchase.amount);
  return purchaseShape_(findById_('purchases', purchase.id));
}

function updatePurchase_(id, payload) {
  var existing = getOr404_('purchases', id, 'Purchase');
  var data = payload || {};
  var patch = { updatedAt: new Date() };

  if (data.projectId !== undefined) {
    var pid = str_(data.projectId).trim();
    if (pid) getOr404_('projects', pid, 'Project');
    patch.projectId = pid;
  }
  if (data.itemId !== undefined) {
    var iid = str_(data.itemId).trim();
    if (iid) getOr404_('items', iid, 'Item');
    patch.itemId = iid;
  }
  if (data.date !== undefined) patch.date = optDate_(data.date, 'Order date') || existing.date;
  if (data.vendor !== undefined) patch.vendor = maxLen_(str_(data.vendor), 150, 'Vendor');
  if (data.orderNumber !== undefined) patch.orderNumber = maxLen_(str_(data.orderNumber), 100, 'Order number');
  if (data.description !== undefined) patch.description = maxLen_(require_(data.description, 'Description'), 300, 'Description');
  if (data.category !== undefined) patch.category = enum_(data.category, 'purchaseCategory', 'Category', 'components');
  if (data.expectedDate !== undefined) patch.expectedDate = optDate_(data.expectedDate, 'Expected date');
  if (data.invoiceFileId !== undefined) patch.invoiceFileId = str_(data.invoiceFileId);
  if (data.note !== undefined) patch.note = maxLen_(str_(data.note), 2000, 'Note');
  if (data.currency !== undefined) patch.currency = str_(data.currency).trim() || 'USD';

  if (data.quantity !== undefined || data.unitCost !== undefined || data.amount !== undefined) {
    var money = resolveAmount_(data, num_(existing.quantity), num_(existing.unitCost));
    patch.quantity = money.quantity;
    patch.unitCost = money.unitCost;
    patch.amount = money.amount;
  }

  // Status changes route through receive/unreceive so stock stays in step.
  if (data.status !== undefined) {
    var wanted = enum_(data.status, 'purchaseStatus', 'Status', 'planned');
    if (wanted !== existing.status) {
      if (wanted === 'received') {
        update_('purchases', id, patch);
        return receivePurchase_(id, { date: optDate_(data.receivedDate, 'Received date') });
      }
      if (existing.status === 'received') {
        unreceivePurchase_(id);
      }
      patch.status = wanted;
      if (wanted === 'cancelled') patch.expectedDate = '';
    }
  }

  var saved = update_('purchases', id, patch);
  audit_('update', 'purchase', id, str_(saved.vendor) + ' ' + str_(saved.description));
  return purchaseShape_(saved);
}

/**
 * Mark a purchase received. When it names an inventory item, the stock
 * receipt is written at the purchase's unit cost and linked back.
 */
function receivePurchase_(id, options) {
  var purchase = getOr404_('purchases', id, 'Purchase');
  var opts = options || {};
  if (purchase.status === 'received') return purchaseShape_(purchase);
  if (purchase.status === 'cancelled') {
    fail_('This purchase is cancelled. Reopen it before receiving.', 'invalid_state');
  }

  var receivedDate = optDate_(opts.date, 'Received date') || todayStr_();
  var txnId = '';

  if (str_(purchase.itemId) && num_(purchase.quantity) > 0) {
    var result = recordTxn_({
      itemId: purchase.itemId,
      type: 'receive',
      quantity: num_(opts.quantity, num_(purchase.quantity)),
      unitCost: num_(purchase.unitCost),
      date: receivedDate,
      projectId: purchase.projectId,
      purchaseId: purchase.id,
      note: 'Received ' + [str_(purchase.vendor), str_(purchase.orderNumber)]
        .filter(String).join(' ')
    });
    txnId = result.txn.id;
  }

  var saved = update_('purchases', id, {
    status: 'received',
    receivedDate: receivedDate,
    receiveTxnId: txnId,
    updatedAt: new Date()
  });

  audit_('receive', 'purchase', id,
    str_(saved.description) + ' — ' + saved.amount + ' ' + saved.currency);
  return purchaseShape_(saved);
}

/** Undo a receipt: drop the stock movement and go back to "ordered". */
function unreceivePurchase_(id) {
  var purchase = getOr404_('purchases', id, 'Purchase');
  if (purchase.status !== 'received') return purchaseShape_(purchase);

  if (str_(purchase.receiveTxnId) && findById_('txns', purchase.receiveTxnId)) {
    remove_('txns', purchase.receiveTxnId);
  }
  var saved = update_('purchases', id, {
    status: 'ordered', receivedDate: '', receiveTxnId: '', updatedAt: new Date()
  });
  audit_('unreceive', 'purchase', id, str_(saved.description));
  return purchaseShape_(saved);
}

function deletePurchase_(id) {
  var purchase = getOr404_('purchases', id, 'Purchase');
  if (str_(purchase.receiveTxnId) && findById_('txns', purchase.receiveTxnId)) {
    remove_('txns', purchase.receiveTxnId);
  }
  removeWhere_('entryLinks', function (l) {
    return l.targetType === 'purchase' && l.targetId === purchase.id;
  });
  remove_('purchases', purchase.id);
  audit_('delete', 'purchase', purchase.id, str_(purchase.description));
  return { deleted: true, id: purchase.id };
}

/**
 * Turn a BOM shortfall into draft purchases, one per supplier line.
 * Everything lands as "planned" so nothing is ordered by accident.
 */
function purchaseShortfall_(bomId, options) {
  var bom = getOr404_('boms', bomId, 'BOM');
  var opts = options || {};
  var rollup = bomRollup_(bom.id);
  var created = [];

  rollup.lines.forEach(function (line) {
    if (!line.itemId || line.shortfall <= 0) return;
    var item = findById_('items', line.itemId);
    if (!item) return;
    var qty = Math.max(line.shortfall, num_(item.reorderQty, 0));
    created.push(createPurchase_({
      projectId: bom.projectId,
      date: todayStr_(),
      vendor: str_(item.supplier),
      description: str_(item.name) + ' for ' + bom.name + ' rev ' + bom.revision,
      category: 'components',
      status: 'planned',
      itemId: item.id,
      quantity: qty,
      unitCost: num_(item.unitCost),
      expectedDate: num_(item.leadTimeDays) > 0
        ? dateStr_(addDays_(today_(), num_(item.leadTimeDays))) : '',
      note: str_(opts.note) || 'Auto-generated from BOM shortfall'
    }));
  });

  audit_('create', 'purchase', bom.id,
    'Generated ' + created.length + ' planned purchase(s) from ' + bom.name);
  return { created: created.length, purchases: created };
}
