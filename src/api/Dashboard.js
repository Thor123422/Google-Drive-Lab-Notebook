/**
 * Dashboard.js — the cross-project view, and search over everything.
 */

function dashboard_() {
  var today = todayStr_();
  var overview = budgetOverview_();
  var stock = inventoryTotals_();

  var projects = all_('projects');
  var openProjects = projects.filter(function (p) {
    return p.status === 'active' || p.status === 'planning' || p.status === 'on_hold';
  });

  var recentEntries = listEntries_({ limit: 8 });

  var openPurchases = listPurchases_({})
    .filter(function (p) { return p.status === 'ordered' || p.status === 'planned'; })
    .sort(function (a, b) {
      var ea = str_(a.expectedDate) || '9999-99-99';
      var eb = str_(b.expectedDate) || '9999-99-99';
      return ea.localeCompare(eb);
    })
    .slice(0, 8);

  var recentFiles = all_('files')
    .sort(function (a, b) { return str_(b.uploadedAt).localeCompare(str_(a.uploadedAt)); })
    .slice(0, 6)
    .map(function (f) { return fileShape_(f, false); });

  var attention = [];

  overview.projects.forEach(function (p) {
    if (p.overBudget) {
      attention.push({
        severity: 'critical', kind: 'budget', projectId: p.id,
        title: p.code + ' is over budget',
        detail: fmtMoney_(p.actual, p.currency) + ' spent of ' + fmtMoney_(p.budget, p.currency)
      });
    } else if (p.forecastOverBudget) {
      attention.push({
        severity: 'warning', kind: 'budget', projectId: p.id,
        title: p.code + ' is forecast to overrun',
        detail: 'Projected ' + fmtMoney_(p.forecast, p.currency) +
          ' against a ' + fmtMoney_(p.budget, p.currency) + ' budget'
      });
    }
  });

  lowStock_().slice(0, 6).forEach(function (item) {
    attention.push({
      severity: item.outOfStock ? 'serious' : 'warning',
      kind: 'stock',
      itemId: item.id,
      title: item.name + (item.outOfStock ? ' is out of stock' : ' is low'),
      detail: item.onHand + ' ' + item.unit + ' on hand, reorder at ' + item.reorderPoint
    });
  });

  listPurchases_({ status: 'ordered' }).forEach(function (p) {
    if (!p.overdue) return;
    attention.push({
      severity: 'warning', kind: 'purchase', purchaseId: p.id,
      title: 'Overdue: ' + (p.description || p.vendor),
      detail: 'Expected ' + p.expectedDate + ' from ' + (p.vendor || 'supplier')
    });
  });

  projects.forEach(function (p) {
    if (p.status !== 'active' || !str_(p.targetDate)) return;
    var days = daysBetween_(today, p.targetDate);
    if (days !== null && days < 0) {
      attention.push({
        severity: 'serious', kind: 'schedule', projectId: p.id,
        title: p.code + ' is past its target date',
        detail: Math.abs(days) + ' day(s) overdue (target ' + p.targetDate + ')'
      });
    } else if (days !== null && days <= 14) {
      attention.push({
        severity: 'warning', kind: 'schedule', projectId: p.id,
        title: p.code + ' is due in ' + days + ' day(s)',
        detail: 'Target ' + p.targetDate
      });
    }
  });

  var rank = { critical: 0, serious: 1, warning: 2, good: 3 };
  attention.sort(function (a, b) { return rank[a.severity] - rank[b.severity]; });

  return {
    counts: {
      projects: projects.length,
      openProjects: openProjects.length,
      entries: all_('entries').length,
      files: all_('files').length,
      items: stock.itemCount,
      boms: all_('boms').length
    },
    budget: overview.totals,
    budgetByProject: overview.projects.slice(0, 8),
    stock: stock,
    recentEntries: recentEntries,
    openPurchases: openPurchases,
    recentFiles: recentFiles,
    attention: attention.slice(0, 12),
    currency: getSetting_('currency', 'USD'),
    today: today
  };
}

function fmtMoney_(amount, currency) {
  var symbol = str_(getSetting_('currencySymbol', '$'));
  var n = num_(amount);
  var text = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (n < 0 ? '-' : '') + symbol + text;
}

/** One search box across projects, entries, files, items and purchases. */
function globalSearch_(query, options) {
  var q = str_(query).trim();
  if (q.length < 2) return { query: q, groups: [], total: 0 };
  var limit = num_((options || {}).limit, 8);
  var groups = [];

  function group(label, kind, rows) {
    if (rows.length) groups.push({ label: label, kind: kind, rows: rows.slice(0, limit) });
  }

  group('Projects', 'project', all_('projects')
    .filter(function (p) {
      return contains_([p.code, p.name, p.description, p.objective, p.tags].join(' '), q);
    })
    .map(function (p) {
      return { id: p.id, title: (p.code ? p.code + ' — ' : '') + p.name, subtitle: p.status };
    }));

  group('Notebook entries', 'entry', all_('entries')
    .filter(function (e) { return contains_([e.title, e.body, e.tags].join(' '), q); })
    .sort(function (a, b) { return str_(b.date).localeCompare(str_(a.date)); })
    .map(function (e) {
      var project = findById_('projects', e.projectId);
      return {
        id: e.id, projectId: e.projectId,
        title: '#' + e.entryNo + ' ' + e.title,
        subtitle: [project ? project.code : '', e.date, e.type].filter(String).join(' · ')
      };
    }));

  group('Files', 'file', all_('files')
    .filter(function (f) { return contains_([f.name, f.description, f.tags, f.revision].join(' '), q); })
    .map(function (f) {
      var project = findById_('projects', f.projectId);
      return {
        id: f.id, projectId: f.projectId, url: f.url, title: f.name,
        subtitle: [project ? project.code : '', f.category, humanSize_(f.size)]
          .filter(String).join(' · ')
      };
    }));

  var stock = stockIndex_();
  group('Inventory', 'item', all_('items')
    .filter(function (i) {
      return contains_([i.sku, i.name, i.mpn, i.manufacturer, i.supplier, i.location, i.tags].join(' '), q);
    })
    .map(function (i) {
      return {
        id: i.id, title: i.name,
        subtitle: [i.sku, (stock[i.id] ? stock[i.id].onHand : 0) + ' ' + (i.unit || 'ea') + ' on hand']
          .filter(String).join(' · ')
      };
    }));

  group('Purchases', 'purchase', all_('purchases')
    .filter(function (p) {
      return contains_([p.vendor, p.orderNumber, p.description, p.note].join(' '), q);
    })
    .sort(function (a, b) { return str_(b.date).localeCompare(str_(a.date)); })
    .map(function (p) {
      return {
        id: p.id, projectId: p.projectId,
        title: p.description || p.vendor,
        subtitle: [p.date, p.status, fmtMoney_(p.amount, p.currency)].filter(String).join(' · ')
      };
    }));

  group('Bills of materials', 'bom', all_('boms')
    .filter(function (b) { return contains_([b.name, b.description, b.revision].join(' '), q); })
    .map(function (b) {
      var project = findById_('projects', b.projectId);
      return {
        id: b.id, projectId: b.projectId,
        title: b.name + ' rev ' + b.revision,
        subtitle: [project ? project.code : '', b.status].filter(String).join(' · ')
      };
    }));

  var total = groups.reduce(function (sum, g) { return sum + g.rows.length; }, 0);
  return { query: q, groups: groups, total: total };
}

/** Recent audit-log rows for the Settings screen. */
function recentActivity_(limit) {
  var n = num_(limit, 50);
  return all_('audit')
    .sort(function (a, b) { return str_(b.at).localeCompare(str_(a.at)); })
    .slice(0, n)
    .map(function (row) {
      return {
        id: row.id, at: row.at, actor: row.actor, action: row.action,
        entity: row.entity, entityId: row.entityId, summary: row.summary
      };
    });
}
