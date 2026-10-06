/* Exercise the real server code against the stubs. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { install } = require('./stubs');

const SRC = path.join(__dirname, '..', 'src');
const ORDER = [
  'Config.js', 'lib/Util.js', 'lib/Validate.js', 'lib/DriveLib.js',
  'Store.js', 'Bootstrap.js',
  'api/Projects.js', 'api/Entries.js', 'api/Files.js', 'api/Inventory.js',
  'api/Purchases.js', 'api/Boms.js', 'api/Budget.js', 'api/Dashboard.js',
  'api/Reports.js', 'Code.js'
];

const sandbox = {};
install(sandbox);
const ctx = vm.createContext(sandbox);
for (const f of ORDER) {
  const code = fs.readFileSync(path.join(SRC, f), 'utf8');
  try { new vm.Script(code, { filename: f }).runInContext(ctx); }
  catch (e) { console.error('LOAD FAIL', f, e.message); process.exit(1); }
}

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       expected ${JSON.stringify(expected)}\n       actual   ${JSON.stringify(actual)}`); }
}
function near(label, actual, expected, tol = 0.011) {
  const ok = Math.abs(Number(actual) - Number(expected)) <= tol;
  if (ok) { pass++; console.log(`  ok   ${label}  (${actual})`); }
  else { fail++; console.log(`  FAIL ${label}\n       expected ~${expected}\n       actual   ${actual}`); }
}
function section(s) { console.log('\n' + s); }

const run = (expr) => vm.runInContext(expr, ctx);
const call = (fn, ...args) => {
  ctx.__args = args;
  return vm.runInContext(`${fn}.apply(null, __args)`, ctx);
};

section('Setup');
const status = call('setupWorkspace_');
check('workspace initialised', status.initialised, true);
check('all tables created', run('Object.keys(TABLES()).every(function(k){ return !!db_().getSheetByName(TABLES()[k].sheet); })'), true);
check('settings seeded', run("getSetting_('currency','?')"), 'USD');

section('Store round-trip');
const project = call('createProject_', {
  name: 'Bench PSU', budgetTotal: 1000, startDate: '2026-01-15',
  tags: ['power', 'rev-b'], status: 'active'
});
check('auto code', project.code, 'PRJ-001');
check('budget stored as number', project.budgetTotal, 1000);
check('tags parsed back to array', project.tags, ['power', 'rev-b']);
check('date round-trips unchanged', project.startDate, '2026-01-15');
check('second project increments code', call('createProject_', { name: 'Second' }).code, 'PRJ-002');

section('Inventory ledger');
const item = call('createItem_', {
  name: 'Widget', sku: 'W-1', unitCost: 5, openingQty: 10, reorderPoint: 4, unit: 'ea'
});
check('opening balance became a receipt', item.onHand, 10);
check('one movement recorded', item.txnCount, 1);
check('stock value', item.value, 50);
check('not low at 10 vs reorder 4', item.lowStock, false);

let threw = '';
try { call('recordTxn_', { itemId: item.id, type: 'consume', quantity: 999 }); }
catch (e) { threw = e.code; }
check('overdraw refused', threw, 'insufficient_stock');

const consumed = call('recordTxn_', { itemId: item.id, type: 'consume', quantity: 3, projectId: project.id });
check('consume applied negative sign', consumed.item.onHand, 7);

call('setStockLevel_', item.id, 9, 'count');
check('stock count writes the delta', call('getItem_', item.id).onHand, 9);

section('Purchases -> stock');
const po = call('createPurchase_', {
  projectId: project.id, description: 'Widgets', itemId: item.id,
  quantity: 10, unitCost: 5, status: 'ordered', date: '2026-02-01'
});
check('amount derived from qty x cost', po.amount, 50);
check('ordered does not move stock', call('getItem_', item.id).onHand, 9);

call('receivePurchase_', po.id, { date: '2026-02-10' });
check('receiving books stock in', call('getItem_', item.id).onHand, 19);
call('unreceivePurchase_', po.id);
check('un-receiving reverses it', call('getItem_', item.id).onHand, 9);
call('receivePurchase_', po.id, { date: '2026-02-10' });

section('BOM rollup');
const bom = call('createBom_', {
  projectId: project.id, name: 'Board', revision: 'A', buildQty: 5,
  lines: [
    { itemId: item.id, qtyPer: 2, refDes: 'U1,U2' },
    { description: 'Misc hardware', qtyPer: 1, unitCostOverride: 3 }
  ]
});
check('two lines', bom.totals.lineCount, 2);
near('unit cost = 2x5 + 1x3', bom.totals.unitCost, 13);
near('build of 5', bom.totals.buildCost, 65);
check('required for line 1', bom.lines[0].required, 10);
check('on hand 19 covers 10', bom.lines[0].shortfall, 0);
check('buildable now = floor(19/2)', bom.totals.buildableNow, 9);

const scrapBom = call('createBom_', {
  projectId: project.id, name: 'Scrappy', buildQty: 10,
  lines: [{ itemId: item.id, qtyPer: 1, scrapPct: 10 }]
});
check('scrap inflates required', scrapBom.lines[0].required, 11);
check('shortfall against 19 on hand', scrapBom.lines[0].shortfall, 0);

section('Build consumes stock');
const built = call('buildBom_', bom.bom.id, { quantity: 5, date: '2026-03-01' });
check('one inventory line consumed', built.consumed.length, 1);
check('stock drawn down by 10', call('getItem_', item.id).onHand, 9);
near('build cost reported', built.cost, 65);

let buildThrew = '';
try { call('buildBom_', bom.bom.id, { quantity: 50 }); }
catch (e) { buildThrew = e.code; }
check('build refused when short', buildThrew, 'insufficient_stock');

section('Budget');
call('createRecurring_', {
  projectId: project.id, name: 'Software', amount: 10, cadence: 'monthly',
  startDate: '2026-01-01', endDate: '2026-03-31'
});
const snap = call('budgetSnapshot_', project.id);
check('direct spend = received purchase', snap.directSpend, 50);
near('recurring Jan+Feb+Mar accrued', snap.recurringToDate, 30);

// Attribution: 20 units received in total (10 opening, 10 on this project's PO),
// so half of what the project consumes was already paid for by its own order.
const materials = call('stockDrawEvents_', project.id);
const grossDrawn = materials.reduce((s, m) => s + m.grossValue, 0);
const chargedDrawn = materials.reduce((s, m) => s + m.amount, 0);
near('gross stock drawn (3 + 10 units at 5)', grossDrawn, 65);
check('charged is less than gross (no double-charging)', chargedDrawn < grossDrawn, true);
near('actual = 50 purchase + 30 recurring + materials', snap.actual, 50 + 30 + chargedDrawn);

const detail = call('budgetDetail_', project.id, { months: 6 });
check('series is continuous', detail.series.length > 1, true);
const monotonic = detail.series.every((p, i, a) =>
  i === 0 || p.cumulativeProjected >= a[i - 1].cumulativeProjected - 0.001);
check('cumulative projection never decreases', monotonic, true);
const lastActual = detail.series.filter(p => p.cumulativeActual !== null).pop();
near('final cumulative actual matches the snapshot', lastActual.cumulativeActual, snap.actual);
check('category breakdown present', detail.byCategory.length > 0, true);
near('categories sum to actual+committed+planned',
  detail.byCategory.reduce((s, c) => s + c.total, 0),
  snap.actual + snap.committed + snap.planned);

section('Notebook and links');
const entry = call('createEntry_', {
  projectId: project.id, title: 'First power-up', type: 'test',
  body: '## Setup\n\nRan it.', tags: ['rev-b']
});
check('entry numbered per project', entry.entryNo, 1);
call('addEntryLink_', entry.id, { targetType: 'bom', targetId: bom.bom.id, label: 'Board rev A' });
check('link resolves', call('getEntry_', entry.id).links[0].title, 'Board rev A');
check('duplicate link is a no-op',
  (call('addEntryLink_', entry.id, { targetType: 'bom', targetId: bom.bom.id }),
   call('getEntry_', entry.id).links.length), 1);
check('backlink found', call('backlinks_', 'bom', bom.bom.id).length, 1);

call('signEntry_', entry.id);
check('signed entry is locked', call('getEntry_', entry.id).locked, true);
let lockThrew = '';
try { call('updateEntry_', entry.id, { title: 'Changed' }); } catch (e) { lockThrew = e.code; }
check('signed entry rejects edits', lockThrew, 'locked');
let reasonThrew = '';
try { call('unsignEntry_', entry.id, ''); } catch (e) { reasonThrew = e.code; }
check('unlock demands a reason', reasonThrew, 'required');
call('unsignEntry_', entry.id, 'typo in the measured value');
check('unlocked', call('getEntry_', entry.id).locked, false);

section('BOM import');
const imported = call('importBomLines_', scrapBom.bom.id,
  'refdes,sku,description,qty\nC1,W-1,Widget again,2\nR1,UNKNOWN-9,Mystery part,4', {});
check('two rows imported', imported.imported, 2);
check('unmatched part reported', imported.unmatched, ['UNKNOWN-9']);
const matchedLine = imported.rollup.lines.find(l => l.refDes === 'C1');
check('known SKU matched to the catalogue', matchedLine.itemId, item.id);

section('Shortfall -> planned purchases');
call('updateBom_', scrapBom.bom.id, { buildQty: 100 });
const shortfall = call('purchaseShortfall_', scrapBom.bom.id, {});
check('planned purchases created', shortfall.created > 0, true);
check('created as planned, not ordered', shortfall.purchases[0].status, 'planned');

section('Search, dashboard, CSV');
check('search finds the project', call('globalSearch_', 'Bench', {}).total > 0, true);
const dash = call('dashboard_');
check('dashboard counts projects', dash.counts.projects, 2);
check('dashboard has budget totals', typeof dash.budget.forecast, 'number');
const csv = call('exportCsv_', 'purchases', {});
check('csv has a header plus rows', csv.csv.split('\n').length > 1, true);
check('csv row count matches', csv.rowCount, run("all_('purchases').length"));

section('Cascade delete');
const victim = call('createProject_', { name: 'Doomed' });
call('createEntry_', { projectId: victim.id, title: 'note' });
const before = run("all_('entries').length");
call('deleteProject_', victim.id, {});
check('entries removed with the project', run("all_('entries').length"), before - 1);
check('stock history survives', call('getItem_', item.id).txnCount > 0, true);

section('RPC envelope');
const good = call('rpc', 'projects.list', {});
check('ok envelope', good.ok, true);
const bad = call('rpc', 'projects.get', { id: 'nope' });
check('error envelope', bad.ok, false);
check('error code surfaced', bad.error.code, 'not_found');
const unknown = call('rpc', 'does.not.exist', {});
check('unknown action handled', unknown.error.code, 'unknown_action');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
