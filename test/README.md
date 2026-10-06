# Tests

`npm test` loads the real server sources into a Node VM with in-memory
stand-ins for the Apps Script services (`stubs.js`), then exercises the
domain logic end to end: setup, the sheet store, the inventory ledger,
purchase receiving, BOM rollup and builds, the budget projection, entry
signing and linking, CSV export, cascade deletes and the RPC envelope.

It is not a substitute for deploying — nothing here touches Drive, the
Docs report builder or the resumable uploader, all of which need the
real services. It does cover the arithmetic and the state machines,
which is where quiet mistakes live.

```
npm test          # logic suite
npm run check     # syntax-check every server file and UI script block
```
