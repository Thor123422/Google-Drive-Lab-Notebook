# Data model

Every table is a sheet in **Lab Notebook Data**. Row 1 holds the column
headers, and the app maps values *by header name* rather than by
position — so you can add your own columns, or reorder the ones that are
there, without breaking anything. Columns the app does not know about
are left alone on read and write.

Editing the sheet by hand is supported and sometimes the fastest way to
fix a batch of rows. Two rules: don't change an `id`, and don't leave an
`id` blank (rows with an empty id are skipped).

---

## Tables

### Projects
The container everything else hangs off.

| Column | Type | Notes |
|---|---|---|
| `id` | string | `prj_…`, generated |
| `code` | string | `PRJ-001`, auto-assigned, must be unique |
| `name` | string | |
| `status` | enum | `planning` `active` `on_hold` `complete` `archived` |
| `priority` | enum | `low` `normal` `high` |
| `description`, `objective` | text | Markdown is rendered in the UI |
| `startDate`, `targetDate`, `closedDate` | date | `closedDate` is set automatically on completion |
| `tags` | string | comma separated |
| `folderId` | string | Drive folder, created on demand |
| `budgetTotal` | number | 0 means "not budgeted" |
| `currency` | string | |

### Entries
Notebook entries, numbered per project.

| Column | Type | Notes |
|---|---|---|
| `id` | string | `ent_…` |
| `projectId` | string | |
| `entryNo` | int | sequential within the project |
| `date` | date | the date of the work, not of typing it up |
| `title`, `type` | string / enum | `experiment` `observation` `build` `test` `analysis` `decision` `meeting` `maintenance` `note` |
| `status` | enum | `draft` `final` |
| `body` | text | Markdown, up to 45 000 characters |
| `author` | string | |
| `signedAt`, `signedBy` | datetime / string | set when signed; presence of `signedAt` is what locks the entry |

Signing freezes an entry. Unlocking requires a reason and writes an
audit row — the point is that a reopened record leaves a trace.

### EntryLinks
What makes the notebook more than a diary: the join between an entry and
the thing it is about.

| Column | Type | Notes |
|---|---|---|
| `entryId` | string | |
| `targetType` | enum | `file` `item` `entry` `bom` `purchase` `url` |
| `targetId` | string | the target's id, or the URL for `url` |
| `label`, `note` | string | |

The reverse lookup is used too: a file's detail panel lists every entry
that references it.

### Files
A record of a Drive file. The bytes live in Drive; this is the index.

| Column | Type | Notes |
|---|---|---|
| `driveId` | string | the Drive file id |
| `name`, `mimeType`, `size` | | copied from Drive at upload |
| `category` | enum | `schematic` `pcb` `gerber` `bom` `firmware` `cad` `datasheet` `photo` `data` `report` `invoice` `other` |
| `revision` | string | free text — `B`, `v2`, a date |
| `supersedesId` | string | points at the file this one replaces |
| `source` | enum | `upload` or `link` |

`source` matters on delete: a file that was *linked* rather than
uploaded is never trashed in Drive, because the app did not put it
there.

### InventoryItems
The parts catalogue. **There is no quantity column** — see below.

| Column | Type | Notes |
|---|---|---|
| `sku` | string | your own code, unique if set |
| `name`, `description`, `category` | | |
| `manufacturer`, `mpn` | string | used to match pasted BOM rows |
| `supplier`, `supplierPn`, `supplierUrl` | | |
| `unit` | string | `ea`, `m`, `kg`, `roll` |
| `unitCost` | number | the catalogue price used for valuation and BOM costing |
| `reorderPoint`, `reorderQty`, `leadTimeDays` | number | drive low-stock warnings and suggested orders |
| `location` | string | `Bin B1` |
| `active` | bool | inactive parts are hidden by default, not deleted |

### InventoryTxns
The stock ledger. Every change to stock is a row here.

| Column | Type | Notes |
|---|---|---|
| `itemId` | string | |
| `date` | date | |
| `type` | enum | `receive` `consume` `adjust` `return` `scrap` |
| `quantity` | number | **signed**; the sign is forced to match the type |
| `unitCost` | number | the cost at the time of the movement |
| `projectId` | string | what the movement is charged to |
| `purchaseId`, `bomId`, `entryId` | string | provenance |

**Quantity on hand is the sum of this column.** It is never stored
anywhere. That is deliberate: a stored total can drift away from its
history, and then you have two numbers and no way to know which is
right.

### Purchases
Money, and the bridge into stock.

| Column | Type | Notes |
|---|---|---|
| `status` | enum | `planned` → `ordered` → `received`, or `cancelled` |
| `category` | enum | `components` `materials` `equipment` `tooling` `services` `software` `fabrication` `shipping` `tax` `fees` `other` |
| `itemId` | string | optional; naming a part makes receiving book stock in |
| `quantity`, `unitCost`, `amount` | number | `amount` defaults to quantity × unit cost |
| `expectedDate`, `receivedDate` | date | |
| `receiveTxnId` | string | the stock movement receiving created, so it can be reversed |

Only `received` counts as money spent. `ordered` is committed,
`planned` is contemplated, and both show in the forecast rather than
the actual.

### BOMs and BOMLines
A BOM describes **one unit**; `buildQty` scales it.

| BOMLines column | Type | Notes |
|---|---|---|
| `lineNo`, `refDes` | | `C1, C2, C7` |
| `itemId` | string | blank for a free-text line |
| `description` | string | used when there is no catalogue part |
| `qtyPer` | number | per single unit |
| `unitCostOverride` | number | blank means use the catalogue price |
| `scrapPct` | number | extra quantity to allow for losses |

So required quantity is `qtyPer × (1 + scrapPct/100) × buildQty`, and
extended cost is that times the unit cost.

Shortfall is worked out line by line against a *running pool* of stock,
so an item appearing on two lines is not counted as covering both.

### RecurringCosts
Costs that land on a cadence: `weekly` `monthly` `quarterly` `annual`.
Occurrences are generated from `startDate` forward, stopping at
`endDate` or the forecast horizon.

### AuditLog
Append-only: who did what, when. Written for creates, updates, deletes,
signings, unlockings, stock movements, shares and exports.

### Settings
Key/value. Currency, forecast horizon, theme, and whether stock may go
negative.

---

## Budget arithmetic

This is the part most worth understanding, because the naive version is
wrong in a way that is easy to miss.

### The three sources of cost

```
actual   = received purchases
         + recurring costs already fallen due
         + materials drawn from stock          ← the subtle one

forecast = actual
         + ordered purchases      (committed)
         + planned purchases
         + recurring costs still to come, out to the horizon
```

### Why materials need care

Say you buy ten widgets on the project's own purchase order for $50, and
then consume them building a prototype.

- The purchase is `received`, so $50 is already counted as spent.
- The consumption draws $50 of stock.

Add both and the project is charged $100 for $50 of widgets.

But the opposite case is just as real: you draw ten widgets from general
shelf stock, bought years ago on no project at all. If consumption is
not counted, that project's cost is understated by $50.

### The attribution rule

For each item, the app works out what share of all receipts was bought
on a given project's own purchase orders:

```
mine_p    = quantity received on purchases charged to project p
total     = quantity received, all sources
unbilled  = 1 − (mine_p / total)
```

When project *p* consumes *q* units, it is charged
`q × unitCost × unbilled`.

In the first example, all receipts are the project's own, so `unbilled`
is 0 and nothing extra is charged — the $50 purchase stands alone. In
the second, none of the receipts are the project's, so `unbilled` is 1
and the full $50 of material is charged.

Mixed cases land in between, proportionally. Without lot tracking this
is an average-cost approximation, and it is the honest one: it never
double-charges and never silently drops a cost. The per-item working is
shown in **Budget → Materials drawn from stock**, including the
percentage applied, so the figure is never a black box.

### The projection

Costs are bucketed by month:

- Received purchases land on their `receivedDate`.
- Ordered and planned purchases land on their `expectedDate`, never
  earlier than today — money you have not spent cannot be in the past.
- Recurring costs land on each generated occurrence.
- Stock draws land on the movement date.

Cumulative actual runs to the current month and stops. Cumulative
projected continues to the horizon. Where projected first crosses the
budget line is the **forecast exhaustion month**.

Burn rate is the mean actual spend over the last three complete months,
and runway is `remaining ÷ burn rate`.

### BOM costs are not budget costs

A BOM's build cost is what a run *would* cost. It stays out of the
budget until parts are actually bought or drawn from stock. It is shown
separately under **Build costs from BOMs** so it informs planning
without inflating the forecast.

---

## Identifiers

Ids are `prefix_<base36 timestamp><random>` — `prj_`, `ent_`, `itm_`,
`txn_`, `pur_`, `bom_`, `bml_`, `fil_`, `lnk_`, `rec_`, `log_`. They
sort roughly by creation time and say what they are when you see one in
a cell.

## Concurrency

Sheets have no transactions. Every mutating RPC takes a script lock for
up to 20 seconds, which serialises writes. Reads are not locked, so a
read concurrent with a write can see a half-applied multi-row change.
For a single user this is theoretical; it is why the audit log exists.
