/**
 * Budget.js — planned versus actual, and the forward projection.
 *
 * Three things cost a project money, and they are kept apart because
 * they behave differently:
 *
 *   purchases        one-off, with a status that says whether the money
 *                    has actually left (received) or is only committed
 *                    (ordered) or contemplated (planned)
 *   recurring costs  accrue on a cadence whether or not anyone acts
 *   stock draw       parts taken from shared inventory
 *
 * Stock draw is the awkward one. A part consumed by a project may
 * already have been paid for by that same project's purchase order, in
 * which case counting it again would double-charge. So each item's
 * receipts are attributed by project, and only the share that was NOT
 * bought on this project's own orders is charged as material cost. With
 * no lot tracking this is an average-cost approximation, and it is the
 * honest one.
 */

/* ----------------------- recurring accrual ------------------------ */

/** Dates on which a recurring cost falls, between two bounds. */
function recurringOccurrences_(rec, fromDate, toDate) {
  var out = [];
  var start = toDate_(rec.startDate);
  if (!start) return out;

  var hardEnd = toDate_(rec.endDate);
  var limit = toDate_(toDate);
  if (hardEnd && hardEnd < limit) limit = hardEnd;
  var floor = toDate_(fromDate);
  var amount = num_(rec.amount);
  var cadence = str_(rec.cadence) || 'monthly';

  var cursor = new Date(start.getTime());
  var guard = 0;
  while (cursor <= limit && guard++ < 2000) {
    if (!floor || cursor >= floor) {
      out.push({ date: dateStr_(cursor), amount: amount });
    }
    if (cadence === 'weekly') cursor = addDays_(cursor, 7);
    else if (cadence === 'monthly') cursor = shiftMonths_(cursor, 1);
    else if (cadence === 'quarterly') cursor = shiftMonths_(cursor, 3);
    else if (cadence === 'annual') cursor = shiftMonths_(cursor, 12);
    else break;
  }
  return out;
}

/** Month arithmetic that keeps the day-of-month where it can. */
function shiftMonths_(date, n) {
  var d = toDate_(date);
  var day = d.getDate();
  var shifted = new Date(d.getFullYear(), d.getMonth() + n, 1);
  var lastDay = new Date(shifted.getFullYear(), shifted.getMonth() + 1, 0).getDate();
  shifted.setDate(Math.min(day, lastDay));
  return shifted;
}

/* --------------------- stock-draw attribution --------------------- */

/**
 * For each item, the share of received quantity that was bought on a
 * given project's own purchase orders. Used to avoid double-counting.
 */
function receiptAttribution_() {
  var totals = {};
  all_('txns').forEach(function (t) {
    var qty = num_(t.quantity);
    if (qty <= 0) return;
    var id = str_(t.itemId);
    if (!totals[id]) totals[id] = { total: 0, byProject: {} };
    totals[id].total += qty;

    // Attribute a receipt to the project its purchase was charged to.
    var pid = '';
    if (str_(t.purchaseId)) {
      var po = findById_('purchases', t.purchaseId);
      if (po) pid = str_(po.projectId);
    }
    if (!pid) pid = str_(t.projectId);
    if (pid) totals[id].byProject[pid] = (totals[id].byProject[pid] || 0) + qty;
  });
  return totals;
}

function unbilledFraction_(itemId, projectId, attribution) {
  var row = attribution[str_(itemId)];
  if (!row || row.total <= 0) return 1;
  var mine = row.byProject[str_(projectId)] || 0;
  var fraction = 1 - (mine / row.total);
  return Math.max(0, Math.min(1, fraction));
}

/**
 * Material cost charged to a project: every consumption, valued at its
 * transaction cost, scaled down by whatever share this project already
 * paid for directly.
 */
function stockDrawEvents_(projectId, attribution) {
  var attr = attribution || receiptAttribution_();
  return byField_('txns', 'projectId', projectId)
    .filter(function (t) { return num_(t.quantity) < 0; })
    .map(function (t) {
      var qty = -num_(t.quantity);
      var fraction = unbilledFraction_(t.itemId, projectId, attr);
      var item = findById_('items', t.itemId);
      return {
        date: t.date,
        itemId: t.itemId,
        itemName: item ? item.name : '(deleted item)',
        quantity: qty,
        unitCost: num_(t.unitCost),
        grossValue: round2_(qty * num_(t.unitCost)),
        unbilledFraction: round4_(fraction),
        amount: round2_(qty * num_(t.unitCost) * fraction)
      };
    });
}

/* --------------------------- snapshots ---------------------------- */

/** The compact per-project figures used in lists and cards. */
function budgetSnapshot_(projectId) {
  var project = findById_('projects', projectId);
  if (!project) return null;
  var today = todayStr_();
  var budget = num_(project.budgetTotal);

  var directSpend = 0;
  var committed = 0;
  var planned = 0;

  byField_('purchases', 'projectId', projectId).forEach(function (p) {
    var amount = num_(p.amount);
    if (p.status === 'received') directSpend += amount;
    else if (p.status === 'ordered') committed += amount;
    else if (p.status === 'planned') planned += amount;
  });

  var recurringToDate = 0;
  var recurringFuture = 0;
  var horizon = dateStr_(addMonths_(today_(), num_(getSetting_('forecastMonths', '12'), 12)));
  byField_('recurring', 'projectId', projectId).forEach(function (rec) {
    if (!rec.active) return;
    recurringOccurrences_(rec, rec.startDate, horizon).forEach(function (occ) {
      if (occ.date <= today) recurringToDate += occ.amount;
      else recurringFuture += occ.amount;
    });
  });

  var materials = stockDrawEvents_(projectId).reduce(function (sum, e) {
    return sum + e.amount;
  }, 0);

  var actual = round2_(directSpend + recurringToDate + materials);
  var forecast = round2_(actual + committed + planned + recurringFuture);

  return {
    budget: round2_(budget),
    directSpend: round2_(directSpend),
    recurringToDate: round2_(recurringToDate),
    materials: round2_(materials),
    actual: actual,
    committed: round2_(committed),
    planned: round2_(planned),
    recurringFuture: round2_(recurringFuture),
    forecast: forecast,
    remaining: round2_(budget - actual),
    available: round2_(budget - forecast),
    percentUsed: budget > 0 ? round2_((actual / budget) * 100) : null,
    percentForecast: budget > 0 ? round2_((forecast / budget) * 100) : null,
    overBudget: budget > 0 && actual > budget,
    forecastOverBudget: budget > 0 && forecast > budget,
    currency: project.currency || getSetting_('currency', 'USD')
  };
}

/* ------------------------ monthly projection ---------------------- */

/**
 * Month-by-month actual and projected cumulative spend, plus the month
 * the project is forecast to run out of money.
 */
function budgetDetail_(projectId, options) {
  var project = getOr404_('projects', projectId, 'Project');
  var opts = options || {};
  var months = Math.max(num_(opts.months, num_(getSetting_('forecastMonths', '12'), 12)), 1);
  var snapshot = budgetSnapshot_(project.id);
  var today = todayStr_();
  var thisMonth = monthKey_(today_());
  var horizonDate = addMonths_(today_(), months);
  var horizon = dateStr_(horizonDate);

  // Buckets, keyed yyyy-MM.
  var buckets = {};
  function bucket(key) {
    if (!buckets[key]) {
      buckets[key] = { month: key, actual: 0, committed: 0, planned: 0, recurring: 0, materials: 0 };
    }
    return buckets[key];
  }

  var earliest = project.startDate || today;

  byField_('purchases', 'projectId', project.id).forEach(function (p) {
    if (p.status === 'cancelled') return;
    var amount = num_(p.amount);
    if (amount === 0) return;

    if (p.status === 'received') {
      var when = str_(p.receivedDate) || str_(p.date);
      if (when && when < earliest) earliest = when;
      bucket(monthKey_(when)).actual += amount;
    } else {
      // Money not yet spent lands on the date it is expected to be.
      var due = str_(p.expectedDate) || str_(p.date) || today;
      if (due < today) due = today;
      var key = monthKey_(due);
      if (p.status === 'ordered') bucket(key).committed += amount;
      else bucket(key).planned += amount;
    }
  });

  byField_('recurring', 'projectId', project.id).forEach(function (rec) {
    if (!rec.active) return;
    recurringOccurrences_(rec, rec.startDate, horizon).forEach(function (occ) {
      if (occ.date < earliest) earliest = occ.date;
      var row = bucket(monthKey_(occ.date));
      if (occ.date <= today) row.actual += occ.amount;
      else row.recurring += occ.amount;
    });
  });

  stockDrawEvents_(project.id).forEach(function (event) {
    if (event.amount === 0) return;
    if (event.date && event.date < earliest) earliest = event.date;
    var row = bucket(monthKey_(event.date));
    row.actual += event.amount;
    row.materials += event.amount;
  });

  // Walk a continuous month axis so gaps do not collapse the chart.
  var cursor = monthStart_(earliest);
  var end = monthStart_(horizonDate);
  var series = [];
  var cumulativeActual = 0;
  var cumulativeProjected = 0;
  var exhaustedMonth = '';
  var guard = 0;

  while (cursor <= end && guard++ < 400) {
    var key = monthKey_(cursor);
    var row = buckets[key] || { month: key, actual: 0, committed: 0, planned: 0, recurring: 0, materials: 0 };
    var isPast = key <= thisMonth;

    cumulativeActual += row.actual;
    cumulativeProjected += row.actual + row.committed + row.planned + row.recurring;

    if (!exhaustedMonth && snapshot.budget > 0 && cumulativeProjected > snapshot.budget) {
      exhaustedMonth = key;
    }

    series.push({
      month: key,
      label: Utilities.formatDate(cursor, tz_(), 'MMM yy'),
      actual: round2_(row.actual),
      committed: round2_(row.committed),
      planned: round2_(row.planned),
      recurring: round2_(row.recurring),
      materials: round2_(row.materials),
      cumulativeActual: isPast ? round2_(cumulativeActual) : null,
      cumulativeProjected: round2_(cumulativeProjected),
      isPast: isPast,
      isCurrent: key === thisMonth
    });
    cursor = addMonths_(cursor, 1);
  }

  // Burn rate over the trailing three complete months.
  var past = series.filter(function (s) { return s.isPast && !s.isCurrent; });
  var trailing = past.slice(-3);
  var burnRate = trailing.length
    ? round2_(trailing.reduce(function (sum, s) { return sum + s.actual; }, 0) / trailing.length)
    : 0;
  var runwayMonths = burnRate > 0 ? round2_(snapshot.remaining / burnRate) : null;

  return {
    project: {
      id: project.id, code: project.code, name: project.name,
      status: project.status, currency: snapshot.currency,
      startDate: project.startDate, targetDate: project.targetDate
    },
    snapshot: snapshot,
    series: series,
    burnRate: burnRate,
    runwayMonths: runwayMonths,
    exhaustedMonth: exhaustedMonth,
    exhaustedLabel: exhaustedMonth
      ? Utilities.formatDate(toDate_(exhaustedMonth + '-01'), tz_(), 'MMMM yyyy') : '',
    byCategory: budgetByCategory_(project.id),
    recurring: recurringForProject_(project.id),
    materials: stockDrawEvents_(project.id).sort(function (a, b) {
      return str_(b.date).localeCompare(str_(a.date));
    }),
    bomCommitments: bomCommitments_(project.id),
    horizonMonths: months
  };
}

/** Spend split by purchase category, with the non-purchase lines added. */
function budgetByCategory_(projectId) {
  var rows = {};
  function row(key, label) {
    if (!rows[key]) rows[key] = { category: key, label: label || key, actual: 0, committed: 0, planned: 0 };
    return rows[key];
  }

  byField_('purchases', 'projectId', projectId).forEach(function (p) {
    if (p.status === 'cancelled') return;
    var r = row(str_(p.category) || 'other');
    var amount = num_(p.amount);
    if (p.status === 'received') r.actual += amount;
    else if (p.status === 'ordered') r.committed += amount;
    else r.planned += amount;
  });

  var today = todayStr_();
  var horizon = dateStr_(addMonths_(today_(), num_(getSetting_('forecastMonths', '12'), 12)));
  byField_('recurring', 'projectId', projectId).forEach(function (rec) {
    if (!rec.active) return;
    var r = row(str_(rec.category) || 'services');
    recurringOccurrences_(rec, rec.startDate, horizon).forEach(function (occ) {
      if (occ.date <= today) r.actual += occ.amount;
      else r.planned += occ.amount;
    });
  });

  var materials = stockDrawEvents_(projectId).reduce(function (sum, e) { return sum + e.amount; }, 0);
  if (materials > 0) row('stock', 'Stock drawn').actual += materials;

  return Object.keys(rows).map(function (key) {
    var r = rows[key];
    return {
      category: r.category,
      label: r.label === r.category ? labelFor_(r.category) : r.label,
      actual: round2_(r.actual),
      committed: round2_(r.committed),
      planned: round2_(r.planned),
      total: round2_(r.actual + r.committed + r.planned)
    };
  }).sort(function (a, b) { return b.total - a.total; });
}

function labelFor_(key) {
  var s = str_(key).replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function recurringForProject_(projectId) {
  var monthsPer = CADENCE_MONTHS();
  return byField_('recurring', 'projectId', projectId).map(function (rec) {
    var every = monthsPer[str_(rec.cadence)] || 1;
    return {
      id: rec.id, name: rec.name, amount: num_(rec.amount), cadence: rec.cadence,
      category: rec.category, startDate: rec.startDate, endDate: rec.endDate,
      active: !!rec.active, note: rec.note,
      monthlyEquivalent: round2_(num_(rec.amount) / every)
    };
  });
}

/** What the project's released BOMs would cost to build, as-is. */
function bomCommitments_(projectId) {
  return byField_('boms', 'projectId', projectId).map(function (bom) {
    var rollup = bomRollup_(bom.id);
    return {
      bomId: bom.id,
      name: bom.name,
      revision: bom.revision,
      status: bom.status,
      buildQty: rollup.totals.buildQty,
      unitCost: rollup.totals.unitCost,
      buildCost: rollup.totals.buildCost,
      shortfallCost: rollup.totals.shortfallCost,
      unpricedLines: rollup.totals.unpricedLines
    };
  }).sort(function (a, b) { return b.buildCost - a.buildCost; });
}

/* ------------------------- recurring CRUD ------------------------- */

function createRecurring_(payload) {
  var data = payload || {};
  var project = getOr404_('projects', require_(data.projectId, 'Project'), 'Project');
  var rec = insert_('recurring', {
    projectId: project.id,
    name: maxLen_(require_(data.name, 'Name'), 150, 'Name'),
    amount: requireNum_(data.amount, 'Amount', { min: 0 }),
    currency: str_(data.currency).trim() || project.currency || getSetting_('currency', 'USD'),
    cadence: enum_(data.cadence, 'cadence', 'Cadence', 'monthly'),
    category: enum_(data.category, 'purchaseCategory', 'Category', 'services'),
    startDate: optDate_(data.startDate, 'Start date') || todayStr_(),
    endDate: optDate_(data.endDate, 'End date'),
    active: data.active === undefined ? true : bool_(data.active),
    note: maxLen_(str_(data.note), 1000, 'Note'),
    createdAt: new Date()
  });
  audit_('create', 'recurring', rec.id, rec.name + ' ' + rec.amount + '/' + rec.cadence);
  return rec;
}

function updateRecurring_(id, payload) {
  getOr404_('recurring', id, 'Recurring cost');
  var data = payload || {};
  var patch = {};
  if (data.name !== undefined) patch.name = maxLen_(require_(data.name, 'Name'), 150, 'Name');
  if (data.amount !== undefined) patch.amount = requireNum_(data.amount, 'Amount', { min: 0 });
  if (data.cadence !== undefined) patch.cadence = enum_(data.cadence, 'cadence', 'Cadence', 'monthly');
  if (data.category !== undefined) patch.category = enum_(data.category, 'purchaseCategory', 'Category', 'services');
  if (data.startDate !== undefined) patch.startDate = optDate_(data.startDate, 'Start date');
  if (data.endDate !== undefined) patch.endDate = optDate_(data.endDate, 'End date');
  if (data.active !== undefined) patch.active = bool_(data.active);
  if (data.note !== undefined) patch.note = maxLen_(str_(data.note), 1000, 'Note');
  var saved = update_('recurring', id, patch);
  audit_('update', 'recurring', id, str_(saved.name));
  return saved;
}

function deleteRecurring_(id) {
  var rec = getOr404_('recurring', id, 'Recurring cost');
  remove_('recurring', rec.id);
  audit_('delete', 'recurring', rec.id, str_(rec.name));
  return { deleted: true, id: rec.id };
}

/* -------------------------- portfolio ----------------------------- */

/** Budget health for every open project, worst first. */
function budgetOverview_() {
  var rows = all_('projects')
    .filter(function (p) { return p.status !== 'archived'; })
    .map(function (p) {
      var snap = budgetSnapshot_(p.id);
      return {
        id: p.id, code: p.code, name: p.name, status: p.status,
        budget: snap.budget, actual: snap.actual, committed: snap.committed,
        planned: snap.planned, forecast: snap.forecast,
        remaining: snap.remaining, available: snap.available,
        percentUsed: snap.percentUsed, percentForecast: snap.percentForecast,
        overBudget: snap.overBudget, forecastOverBudget: snap.forecastOverBudget,
        currency: snap.currency
      };
    });

  rows.sort(function (a, b) {
    var pa = a.percentForecast === null ? -1 : a.percentForecast;
    var pb = b.percentForecast === null ? -1 : b.percentForecast;
    return pb - pa;
  });

  var totals = rows.reduce(function (acc, r) {
    acc.budget += r.budget;
    acc.actual += r.actual;
    acc.committed += r.committed;
    acc.planned += r.planned;
    acc.forecast += r.forecast;
    return acc;
  }, { budget: 0, actual: 0, committed: 0, planned: 0, forecast: 0 });

  Object.keys(totals).forEach(function (k) { totals[k] = round2_(totals[k]); });
  totals.remaining = round2_(totals.budget - totals.actual);
  totals.available = round2_(totals.budget - totals.forecast);
  totals.currency = getSetting_('currency', 'USD');

  return { projects: rows, totals: totals };
}
