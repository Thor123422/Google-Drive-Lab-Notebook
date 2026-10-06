# Setup

About ten minutes, most of it spent on Google's permission screens.

You need a Google account and [Node.js](https://nodejs.org) 18 or newer.
You do not need a Google Cloud project, a billing account or a domain.

---

## 1. Install the tooling

```bash
git clone https://github.com/Thor123422/Google-Drive-Lab-Notebook.git
cd Google-Drive-Lab-Notebook
npm install
```

This installs [clasp](https://github.com/google/clasp), Google's
command-line tool for Apps Script.

## 2. Sign in

```bash
npx clasp login
```

A browser window opens. Approve the access clasp asks for — this is
clasp talking to the Apps Script API on your behalf, not the notebook
app itself.

If this is your first Apps Script project, you may also need to turn on
the Apps Script API once, at
<https://script.google.com/home/usersettings>.

## 3. Create the script project

```bash
npx clasp create --type webapp --title "Lab Notebook" --rootDir src
```

This writes `.clasp.json` with your new script's id. That file is
gitignored because the id is personal to you — `.clasp.json.example`
shows the shape if you ever need to recreate it by hand.

## 4. Push the code

```bash
npm run push
```

clasp uploads everything under `src/`. Confirm when it asks about the
manifest — `appsscript.json` is meant to be pushed, and it carries the
permission scopes and web app settings.

## 5. Set your time zone

Dates are formatted in the script's time zone, so this one matters.

```bash
npm run open
```

In the Apps Script editor: **Project Settings** (the gear) → **Time
zone**. Set it to yours.

Or edit `src/appsscript.json` before pushing — it ships with
`America/New_York`:

```json
{ "timeZone": "Europe/London" }
```

## 6. Deploy as a web app

```bash
npx clasp deploy --description "v1"
```

Then get the URL:

```bash
npx clasp deployments
```

Or do it in the editor: **Deploy → New deployment → Web app**, with
**Execute as: Me** and **Who has access: Only myself**.

## 7. First run

Open the web app URL.

Google will warn you that the app is unverified. This is expected: you
wrote it, it is not published, and Google has no way to know that.
Click **Advanced → Go to Lab Notebook (unsafe)** and approve.

The permissions it asks for, and why:

| Permission | Why |
|---|---|
| See, edit, create and delete your Google Drive files | Create the data spreadsheet, the project folders, and the files you upload |
| See, edit, create and delete your spreadsheets | Read and write the records |
| See your primary email address | Stamp entries and the audit log with who did what |

Then click **Create my workspace**. It makes:

```
My Drive/
  Lab Notebook/
    Lab Notebook Data        ← the spreadsheet holding every record
    Projects/                ← one folder per project, created on demand
    _incoming/               ← scratch space for uploads
```

That is it. There is a **Load a worked example** button on the empty
dashboard if you want something to poke at before entering real work.

---

## Updating

```bash
git pull
npm run push
npx clasp deploy --deploymentId <your-deployment-id>
```

Reusing the deployment id keeps the same URL. `npx clasp deployments`
lists them. Deploying without an id mints a new URL and leaves the old
one serving the old code.

Setup is idempotent, so **Settings → Repair workspace** after an update
is safe: it adds any new sheet or column without touching your data.

## Working on the code

```bash
npm run watch   # push on every save
npm run logs    # tail the execution log
npm test        # logic suite, no deployment needed
npm run check   # syntax-check everything
```

`npm test` runs the real server code against in-memory stand-ins for
Drive and Sheets, so you can iterate on the budget arithmetic or the
stock ledger without a round trip to Google.

---

## Troubleshooting

**"Script function not found: doGet"**
The deployment predates the code. Push, then deploy again.

**"You do not have permission to call DriveApp"**
The scopes changed since you first authorised. Open the web app URL
again and re-approve.

**"Lab Notebook has not been set up yet"**
The spreadsheet was renamed, moved to the trash or deleted. Open
**Settings → Repair workspace**. If the spreadsheet is really gone,
recover it from the Drive trash first — the app can rebuild empty
sheets but not your records.

**Uploads fail partway through**
Each chunk is its own request, so a flaky connection shows up as a
failed slice. Retry the file. If it fails consistently over about
50 MB, put the file in Drive yourself and use **Link a Drive file**.

**The app is slow to load**
Every screen reads the whole sheet it needs. Past a few thousand rows
per table this gets noticeable. Archiving finished projects helps; so
does raising the limits on list views.

**Dates are a day out**
The script time zone does not match yours. Step 5.

**"The notebook is busy with another change"**
Two writes collided and one waited more than 20 seconds. Retry. If it
persists, an earlier execution is probably stuck — check
`npm run logs`.

## Removing it

Delete the `Lab Notebook` folder from your Drive and the script project
from <https://script.google.com>. Nothing lives anywhere else. Export
anything you want to keep first: **Settings → Your data → CSV**, or just
download the spreadsheet.
