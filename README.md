# Lab Notebook

A Google Apps Script web app for running a small research or engineering
lab out of your own Google Drive. It is three things that normally live
in three different tools, joined at the project:

- **Lab notebook** — dated, numbered, signable entries that link to the
  files, parts, BOMs and purchases they concern.
- **Inventory** — a parts catalogue with a stock ledger, reorder points
  and per-project consumption.
- **Budget projection** — planned versus actual spend, a month-by-month
  forecast, and BOM-driven cost rollups so you can price a run of ten
  boards before you buy anything.

Everything lives in your Drive: records in a Google Sheet, uploads in a
folder per project. There is no server, no account, and no cost beyond
what Google already gives you.

> This is an organisation and record-keeping tool. It does no design
> work — it keeps track of the design work you do elsewhere.

## Why Apps Script

The data is a spreadsheet you own and can open, sort and export without
this app. The files are ordinary Drive files you can share with someone
who has never heard of the tool. If the app ever stops working, nothing
is trapped inside it. That property is worth more in a lab notebook than
a nicer UI would be.

## Getting started

See **[docs/SETUP.md](docs/SETUP.md)** — about ten minutes, most of it
waiting for Google's permission screens.

The short version:

```bash
npm install
npx clasp login
npx clasp create --type webapp --title "Lab Notebook" --rootDir src
npm run push
npx clasp deploy
```

Then open the web app URL and click **Create my workspace**.

## How it fits together

```
Project ─┬─ Notebook entries ──┬─ link to files, parts, BOMs, purchases
         │                     └─ sign to freeze (unlock is audited)
         ├─ Files ─────────────── uploaded or linked from Drive, with revisions
         ├─ BOMs ──────────────── per-unit lines × build qty, costed from inventory
         ├─ Purchases ─────────── planned → ordered → received (receiving books stock)
         └─ Recurring costs ───── drive the forward projection

Inventory (shared across projects)
         └─ Stock ledger ──────── on-hand is always derived, never stored
```

A few decisions worth knowing about:

- **Stock on hand is never stored.** It is the sum of the movement
  ledger, so the number and its history can never disagree.
- **Receiving a purchase books the stock in**, and un-receiving it takes
  the movement back out.
- **Materials drawn from stock are attributed per item**, so a part
  bought on a project's own purchase order and then consumed by that
  project is not charged to it twice. See
  [docs/DATA-MODEL.md](docs/DATA-MODEL.md#budget-arithmetic).
- **Signed entries are read-only.** They can be unlocked, but the unlock
  demands a reason and is written to the audit log.

## Documentation

| Document | What's in it |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | Install, deploy, update, troubleshoot |
| [docs/USER-GUIDE.md](docs/USER-GUIDE.md) | Day-to-day use, worked example |
| [docs/DATA-MODEL.md](docs/DATA-MODEL.md) | Tables, fields, budget arithmetic |

## Development

```bash
npm test      # run the logic suite against stubbed Apps Script services
npm run check # syntax-check every server file and UI script block
npm run push  # push to Apps Script
npm run watch # push on save
```

`npm test` loads the real server sources into a Node VM with in-memory
Drive, Sheets and Properties stand-ins, then exercises the ledger, the
BOM rollup, the budget projection and the RPC layer. It will not catch
a Drive permissions problem, but it does catch the arithmetic.

## Layout

```
src/
  appsscript.json     manifest (time zone, scopes, web app access)
  Code.js             doGet, the RPC action table, settings
  Config.js           schema, enumerations, limits
  Store.js            sheet-backed record store
  Bootstrap.js        first-run setup, sample data
  lib/                dates, coercion, validation, Drive folders
  api/                one module per domain
  ui/                 HtmlService single-page app
test/                 Node test harness
docs/                 setup, user guide, data model
```

## Limits worth knowing

- Apps Script allows ~6 minutes per request and a daily quota. Normal use
  is nowhere near either; a very large BOM import is the only thing that
  comes close.
- The uploader is capped at 64 MB per file by default
  (`UPLOAD_LIMITS()` in `src/Config.js`). Larger files go into Drive
  directly and get attached with **Link a Drive file**.
- Sheets get slow somewhere past a few tens of thousands of rows. For a
  small lab that is years of records.

## Licence

MIT — see [LICENSE](LICENSE).
