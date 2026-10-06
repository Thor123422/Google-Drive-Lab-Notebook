# User guide

A walk through the app in the order you would actually use it, followed
by the parts that are not obvious.

---

## The shape of it

Everything hangs off a **project**. Notebook entries, files, bills of
materials and spend all belong to one. **Inventory** is the exception —
parts are shared, and projects draw from the same shelf.

Navigation, left to right:

| | |
|---|---|
| **Dashboard** | What needs attention today |
| **Projects** | The list, and each project's own workspace |
| **Notebook** | Every entry, across projects |
| **Files** | Everything uploaded or linked |
| **Inventory** | Parts and stock |
| **Purchases** | Orders, and the money that has actually gone |
| **Budget** | Every project's position |
| **Settings** | Preferences, exports, audit log |

`Ctrl`/`Cmd` + `K` jumps to search, which covers projects, entries,
files, parts, purchases and BOMs at once.

---

## A worked example

Suppose you are building a bench power supply.

### Start the project

**Projects → New project.** Name it, set a budget, give it a target
date. The code (`PRJ-001`) is assigned for you and becomes the prefix of
the Drive folder, so your Drive stays navigable without the app.

### Put the design files in

Open the project, go to **Files**, and drag in the schematic PDF, the
board file and the Gerber zip. Set a **category** for each
(`schematic`, `pcb`, `gerber`) and a **revision** (`B`).

Categories are not decoration — they group the file list and label the
reference chips in notebook entries, so "the rev B schematic" is
identifiable at a glance six months later.

Files above about 64 MB won't go through the browser uploader. Put them
in Drive yourself and use **Link a Drive file**; the app records them
without moving them.

### Set up the parts

**Inventory → New part**, one per thing you stock: the MCU, the
inductors, the bare boards. Give each a SKU, a unit cost, a location and
a **reorder point**. Set an **opening stock** figure — it is recorded as
a receipt, so the ledger is complete from day one rather than starting
with an unexplained balance.

### Cost the build

Back in the project, **BOMs → New BOM**. Name it, set **build quantity**
to how many units this run makes.

Add lines, or paste a BOM exported from your EDA tool — **Paste BOM**
takes CSV or tab-separated rows with a header, and matches parts to the
catalogue by SKU or MPN. Unmatched part numbers come in as free-text
lines so nothing is silently dropped.

Each line is **per unit**. A board with two inductors has `qtyPer: 2`,
and the build quantity does the multiplication. Add a **scrap
allowance** where you expect losses.

You now have: cost per unit, cost for the run, how many you could build
from stock right now, and what you are short of.

### Order what you are short of

**Order shortfall** on the BOM creates one *planned* purchase per short
line, using each part's supplier, cost and lead time. Nothing is
ordered — they land as planned for you to review.

When you actually place an order, set it to **ordered**. When the parts
turn up, **Receive** it: the stock is booked in at the purchase's unit
cost, and the spend becomes actual.

### Build it

**Build** on the BOM draws every line's parts out of stock and charges
them to the project. It refuses to start unless every line is covered,
so you never end up with a half-consumed ledger — there is an override
for when you know parts are on the bench but not yet booked in.

### Write it up

**New entry.** Date it, pick a type (`test`), write it in Markdown.

Then the part that makes this a lab notebook rather than a diary:
**Add reference**. Link the schematic, the board files, the BOM you
built, the purchase the parts came from. Later, opening that file shows
every entry that touched it.

When the entry is finished, **Sign & lock** it. It becomes read-only and
records who signed it and when. You can unlock it, but you must say why,
and the unlock is written to the audit log.

### Watch the money

**Budget**, inside the project. Spent, committed, forecast; a
month-by-month curve against the budget line; the month you are forecast
to run out; burn rate and runway.

---

## Things that are not obvious

### Signing

A draft is a working document. A signed entry is a record. The
distinction only means something if signing actually prevents editing,
which is why it does. Unlocking is deliberately slightly annoying.

### Revisions

Set a file's **supersedes** field to the file it replaces. The old one
gets a "superseded" badge and drops out of the default list, but stays
linked to the entries that referenced it — so an old entry still points
at the revision that was current when it was written, which is the
correct behaviour for a lab record.

### Stock can't be wrong

There is no quantity field to edit. Stock is the sum of its movements.
To correct a count, use **Stock count**: enter what is on the shelf and
the difference is written as an adjustment. The discrepancy becomes part
of the history instead of quietly overwriting it.

### Materials are not double-charged

If you buy parts on a project's purchase order and then consume them on
that project, you are charged once, not twice. The app works out what
share of each part's stock the project already paid for and only charges
the rest. The working is shown per movement in
**Budget → Materials drawn from stock**.

Full explanation in
[DATA-MODEL.md](DATA-MODEL.md#budget-arithmetic).

### Recurring costs drive the forecast

A monthly software seat or bench rental is not a purchase — it just
happens. Add it under **Budget → Recurring costs** and it accrues
automatically, past and future.

### BOM cost is not spend

What a run *would* cost is shown separately from what you have spent. It
only enters the budget when parts are actually bought or drawn.

---

## Sharing

You are the only person who uses the app. Two ways to show someone else
your work:

**Share the Drive folder** — *project → Share*. A link, or a named
person, view or edit. They see the files; they do not need the app or an
account on anything.

**Export a report** — *project → Export report*. Writes a Google Doc
into the project folder: objective, budget summary and category
breakdown, costed BOMs, a file index with links, and the full notebook
with each entry's references. It is a point-in-time snapshot, which is
usually what you want to hand someone. From there it exports to PDF or
Word like any Doc.

For raw data, **Settings → Your data** exports any table as CSV, and the
spreadsheet itself is always right there in Drive.

---

## Keeping it fast

Every screen reads the sheet it needs, so speed tracks row count.

- Set finished projects to **archived**; they drop out of the default
  lists.
- Mark parts you no longer stock as **inactive** rather than deleting
  them — deleting takes their movement history with them.
- Narrow with the filters rather than scrolling.

A few thousand rows per table is comfortable. For a small lab that is
years of work.

---

## When something looks wrong

**Settings → Repair workspace** re-creates any missing sheet, column or
folder without touching your data. Run it after an update, or whenever a
screen errors unexpectedly.

**Settings → Recent activity** is the audit log: every create, update,
delete, signing, unlock, stock movement and share, with who and when.

The spreadsheet is always openable directly — **Settings → Workspace →
Open the spreadsheet**. Fixing a batch of rows by hand is a supported
workflow. Don't change an `id`, and don't leave one blank.

Other failure modes are in [SETUP.md](SETUP.md#troubleshooting).
