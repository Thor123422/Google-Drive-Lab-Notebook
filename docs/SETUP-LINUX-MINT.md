# Setting up on a Linux Mint desktop

Start-to-finish instructions for a fresh Linux Mint machine (21.x or
22.x — both are covered). Assumes nothing is installed yet.

Budget about 20 minutes, most of it waiting on downloads and Google's
permission screens.

> **The code is on a branch, not on `main`.** Step 3 checks it out. If
> you clone and see only a README, that is why.

---

## 1. Open a terminal

`Ctrl` + `Alt` + `T`, or **Menu → Terminal**.

Install the two things Mint does not ship:

```bash
sudo apt update
sudo apt install -y git curl
```

Enter your password when asked. (It will not echo as you type — that is
normal.)

## 2. Install Node.js

**Do not use `sudo apt install nodejs`.** Mint's repositories carry a
Node that is too old for the tooling — Mint 21 ships Node 12, which
fails with confusing errors. Use one of these instead.

### Option A — nvm (recommended)

No `sudo`, nothing installed system-wide, and easy to change versions
later.

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
```

Then **close the terminal and open a new one** so your shell picks up
nvm, and install Node:

```bash
nvm install --lts
nvm use --lts
```

If `v0.40.3` 404s, that release has moved on — get the current install
line from <https://github.com/nvm-sh/nvm#installing-and-updating>.

### Option B — NodeSource

One command, but it installs Node system-wide and needs `sudo`.

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

### Either way, check it

```bash
node --version    # want v18 or higher; v22 is ideal
npm --version
```

If `node --version` prints nothing or `v12.x`, Node did not install
properly — go back and try the other option.

## 3. Get the code

```bash
mkdir -p ~/Projects
cd ~/Projects
git clone https://github.com/Thor123422/Google-Drive-Lab-Notebook.git
cd Google-Drive-Lab-Notebook
git checkout claude/wonderful-pascal-sm4kyc
```

That last line matters — the app lives on that branch. Confirm you have
it:

```bash
ls src/        # should list Code.js, Config.js, Store.js, api/, ui/ …
```

If `src/` is missing, the checkout did not take. Run
`git branch -a` to see what is available.

## 4. Install dependencies

```bash
npm install
```

This installs [clasp](https://github.com/google/clasp) **into the
project**, not globally — so no `sudo npm install -g`, and no permission
errors. Every command below uses `npx`, which runs the local copy.

## 5. Check it works before touching Google

```bash
npm test
npm run check
```

You should see `65 passed, 0 failed` and `All files parse.` This runs
the real server code against in-memory stand-ins for Drive and Sheets,
so it proves the install is sound without needing a Google account yet.

If this fails, stop here — the problem is local (almost always the Node
version) and deploying will not fix it.

## 6. Set your time zone

Dates are formatted in the script's time zone, so do this *before* you
push. Open `src/appsscript.json` in a text editor (**Menu → Text
Editor**, or `xed src/appsscript.json`) and change the first line:

```json
{
  "timeZone": "America/New_York",
```

Use your own [IANA
zone](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) —
`America/Chicago`, `Europe/London`, and so on. If you are unsure what
yours is:

```bash
timedatectl | grep "Time zone"
```

## 7. Sign in to Google

```bash
npx clasp login
```

Firefox opens. Sign in and approve. This is clasp getting permission to
manage Apps Script projects for you — it is not the notebook app asking
for anything yet.

**If no browser opens** (or you are over SSH):

```bash
npx clasp login --no-localhost
```

That prints a URL to open manually and asks you to paste back a code.

**If it hangs after you approve**, the callback on `localhost:8888` is
being blocked. Mint's firewall is off by default, but if you turned on
**gufw**, either allow port 8888 or use `--no-localhost`.

**If you get "User has not enabled the Apps Script API"**, turn it on
once at <https://script.google.com/home/usersettings>, then retry.

## 8. Create the Apps Script project

```bash
npx clasp create --type webapp --title "Lab Notebook" --rootDir src
```

This writes `.clasp.json` holding your new script's id. That file is
gitignored on purpose — the id is yours, not something to share.

If it refuses because `.clasp.json` already exists, you already have a
project; skip to the next step.

## 9. Push and deploy

```bash
npm run push
```

Say yes if it asks about the manifest — `appsscript.json` is meant to go
up; it carries the permission scopes and the web app settings.

```bash
npx clasp deploy --description "v1"
npx clasp deployments
```

The second command prints your web app URL. It looks like:

```
https://script.google.com/macros/s/AKfycb…/exec
```

Copy it. Bookmark it — that URL *is* the app.

## 10. First run

Open the URL in your browser.

Google will warn you the app is unverified. Expected: you wrote it, it
is not published, and Google has no way to know it is yours. Click
**Advanced → Go to Lab Notebook (unsafe)**, then approve.

It asks for Drive and Sheets access so it can create the data
spreadsheet and your project folders, and your email address so entries
and the audit log can record who did what. Details are in
[SETUP.md](SETUP.md#7-first-run).

Then click **Create my workspace**. It builds:

```
My Drive/
  Lab Notebook/
    Lab Notebook Data        ← every record lives here
    Projects/                ← one folder per project
    _incoming/               ← upload scratch space
```

There is a **Load a worked example** button on the empty dashboard if
you want something to click around before entering real work.

---

## Pushing your own changes back

To commit from the desktop you will need to authenticate to GitHub.
Password authentication over HTTPS was removed years ago, so pick one:

### A personal access token (simplest)

Create one at **GitHub → Settings → Developer settings → Personal access
tokens → Tokens (classic)** with the `repo` scope. Then:

```bash
git config --global credential.helper store
```

The first `git push` asks for your username and password — paste the
token as the password. It is saved after that.

> `credential.helper store` writes the token in plain text to
> `~/.git-credentials`. On a personal desktop that is usually fine. For
> something better, install `libsecret`:
> ```bash
> sudo apt install -y libsecret-1-0 libsecret-1-dev
> sudo make --directory=/usr/share/doc/git/contrib/credential/libsecret
> git config --global credential.helper \
>   /usr/share/doc/git/contrib/credential/libsecret/git-credential-libsecret
> ```

### An SSH key (better if you use several machines)

```bash
ssh-keygen -t ed25519 -C "your@email"       # press Enter at each prompt
cat ~/.ssh/id_ed25519.pub
```

Paste the output into **GitHub → Settings → SSH and GPG keys → New SSH
key**, then switch the remote over:

```bash
git remote set-url origin git@github.com:Thor123422/Google-Drive-Lab-Notebook.git
ssh -T git@github.com     # say yes to the fingerprint prompt
```

### Then, as normal

```bash
git add -A
git commit -m "What you changed"
git push
```

Set your identity first if git complains:

```bash
git config --global user.name "Your Name"
git config --global user.email "your@email"
```

---

## Day-to-day on the desktop

```bash
cd ~/Projects/Google-Drive-Lab-Notebook

npm run watch     # push to Apps Script on every file save
npm test          # logic suite — no deploy needed
npm run check     # syntax-check everything
npm run logs      # tail the Apps Script execution log
npm run open      # open the script editor in a browser
```

The loop that works best: edit, `npm test`, then `npm run push`. You
only need `npx clasp deploy` when you want the live URL to pick up the
changes — `push` updates the code, `deploy` updates what the URL serves.

To keep the same URL when redeploying, reuse the deployment id:

```bash
npx clasp deployments                                  # find the id
npx clasp deploy --deploymentId AKfycb… --description "v2"
```

Deploying without an id mints a *new* URL and leaves the old one serving
the old code — a common source of "my change did not show up".

---

## Merging to `main`

The work is on `claude/wonderful-pascal-sm4kyc` because that is where it
was asked to go. When you are happy with it, either open a pull request
on GitHub, or merge locally:

```bash
git checkout main
git merge claude/wonderful-pascal-sm4kyc
git push origin main
```

---

## If something goes wrong

| Symptom | Cause and fix |
|---|---|
| `npm install` errors about engines or syntax | Node too old. `node --version` — needs 18+. Step 2. |
| `clasp: command not found` | You dropped the `npx`. Use `npx clasp …`, or the `npm run …` scripts. |
| `npm run push` → "User has not enabled the Apps Script API" | Turn it on at <https://script.google.com/home/usersettings>. |
| `EACCES` / permission denied during install | You used `sudo npm install -g`. Don't — step 4 installs locally. If you already did, `sudo rm -rf ~/.npm` and re-run `npm install`. |
| Web app shows an old version | You pushed but did not deploy, or deployed to a new URL. See above. |
| "Script function not found: doGet" | The deployment predates the code. `npm run push`, then deploy again. |
| Dates are a day out | Script time zone does not match yours. Step 6, then push again. |
| `src/` is empty after cloning | You are on `main`. `git checkout claude/wonderful-pascal-sm4kyc`. |

More in [SETUP.md → Troubleshooting](SETUP.md#troubleshooting).

Once it is running, [USER-GUIDE.md](USER-GUIDE.md) walks through actually
using it.
