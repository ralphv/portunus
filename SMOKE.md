# Smoke tests

End-to-end browser tests (Playwright) that run the app in
[demo mode](README.md#demo-mode): stubbed sign-in and an in-memory vault, so
no Google account or secrets are needed.

The tests cover every feature in the README's Features list that a demo-mode
browser can reach (see [Not covered](#not-covered) for the rest). One run
creates a vault and works through the features in order on the same page.
A run fails on any page error, console error, CSP violation or unexpected
HTTP error. When a run fails, a screenshot and the page HTML are saved and
their paths printed.

The runs are hermetic. Have I Been Pwned lookups go to a stub of the range
API (`scripts/smoke/network.mjs`), never to the real service. The stub
reports the password `password` as seen 1,234 times and everything else as
not found.

## Test cases

Defined in `scripts/smoke/tests/*.mjs` (one module per feature group) and run
in the order `scripts/smoke/tests.mjs` lists them. Each step depends on the
ones before it, and the first failure stops the run. Keep this table in sync
when you change the tests.

| # | Step | README feature | Actions → passes when |
|---|---|---|---|
| 0 | precheck | — | The runner's unauthenticated `GET /api/vault` answers `{"error":"vault_not_found"}`, i.e. a demo-mode server is listening (Google mode would answer 401). |
| **core** | | | |
| 1 | sign in | — | Install the Pwned Passwords stub and the request log, open `BASE_URL`, click "Sign in with Google" → "Create your vault" appears. |
| 2 | create vault | Per-device keyfile | Password twice, Continue, note the recovery code, download `portunus.key`, leave "Also install…" unticked, Create vault → the vault opens. |
| 3 | add entry | — | "+ Add", Name "Smoke entry", Username, Generate, Done → no browser error. |
| 4 | save | Save protection | Save, master password, "Save to Drive" → Save turns disabled (nothing left unsaved). |
| 5 | offline cache after save | Offline mode | Cache on: `localStorage["portunus.vault.cache"]` holds the vault without the entry's name (ciphertext). Cache off: empty, and a stale entry is planted for step 8. |
| 6 | reload + unlock with keyfile | Password *and* keyfile | Reload, password, pick the keyfile file → "Key … loaded", the vault opens, and the keyfile is installed (the unlock checkbox defaults on). |
| 7 | entry persisted | Google Drive storage (demo store) | "Smoke entry" survived save → reload → decrypt. |
| 8 | offline cache after unlock | Offline mode | Same as step 5; cache off: the stale entry is gone. |
| 9 | second create is refused | — | `PUT /api/vault` without `fileId` → `409 {"error":"vault_exists"}`. |
| 10 | refused create keeps the vault and keyfile | — | Force the create screen (`GET /api/vault` → 404 via `page.route`), create with install ticked → "A vault already exists…", the installed keyfile is unchanged, and the real vault still unlocks. |
| **keyfile** | | | |
| 11 | wrong password is refused | Password *and* keyfile | Lock, reload (the installed key loads by itself, "Signed in as demo@portunus.local"), wrong password → "Wrong password or keyfile." |
| 12 | master password stays out of the DOM | Secrets rendered on demand | The filled password input has no `value` attribute and the password isn't in the page HTML. |
| 13 | wrong keyfile is refused | Password *and* keyfile | Pick the keyfile of the refused second vault, right password → "Wrong password or keyfile." |
| 14 | remove key from the unlock screen | Per-device keyfile | Reload, "Remove key from this browser" → "Choose portunus.key…" and `localStorage["portunus.keyfile"]` is empty. |
| 15 | unlock with recovery code | Per-device keyfile | "Restore from recovery code instead", the code from step 2 → "Key <kid> loaded", unlock, the keyfile is installed again. |
| 16 | installed keyfile unlocks without the file | Per-device keyfile | Lock, reload, password only → the vault opens. |
| 17 | remove key from the menu | Per-device keyfile | Menu → Remove key → storage empty; after lock + reload the file picker is back; unlock with the file. |
| **entries** | | | |
| 18 | entry editor fields | Password manager UX | Add "GitHub" with username `octocat@example.com`; leaving the field fills an empty Email; URL, notes and a "dev" label. |
| 19 | password generator and strength meter | Password manager UX, strength meter | Generate → the field is masked, the meter shows "Strong"/"Excellent" (≥ 4/5) and "… to crack". |
| 20 | site icon from the URL | Site icons | The GitHub row shows the GitHub logo; the picker says "Auto (GitHub)". |
| 21 | SSO provider chip | Password manager UX | Add "Notion" with SSO provider "Google" and a "work" label → "sso · Google" chip. |
| 22 | stray spaces highlighted and trimmed | Password manager UX | Name "  Spacey  " → "2 leading spaces · 2 trailing spaces", "trim" → "Spacey". |
| 23 | monogram and icon override | Site icons | An unmatched name gets a letter monogram and "Auto"; pick GitLab in the searchable picker → the row shows the GitLab logo. |
| 24 | duplicate warning | Password manager UX | A new "GitHub" with the same username → "duplicate?" chip and "You already have GitHub…"; Delete removes it. |
| 25 | save new entries | — | Save. |
| 26 | multi-term search | Password manager UX | "git octo" → only GitHub ("1 entry"); "google" finds Notion by SSO provider; "octo notion" → "No entries match your search." |
| 27 | label filters | Password manager UX | Filter chip "work" → Notion; + "dev" → nothing (labels combine with AND); Clear; a row's own label chip filters too. |
| 28 | sort order, remembered per device | Password manager UX | Name A–Z, oldest first and Name Z–A reorder the list; the choice is in `localStorage["portunus.entry-sort"]` and survives a reload; back to Vault Order. |
| 29 | quick copy | Password manager UX | The collapsed row's user / email / pass buttons put the right values on the clipboard (the password matches what "show" reveals). |
| **secrets** | | | |
| 30 | passwords masked until revealed | Secrets rendered on demand | Open GitHub: a fixed `••••••••` mask, no password `<input>`, password not in the HTML; "show" → `type="text"`, no `value` attribute, still not in the HTML. |
| 31 | re-masks when focus leaves the field | Secrets rendered on demand | Click Name → masked again. |
| 32 | re-masks after 30 s idle | Secrets rendered on demand | Show, wait 31 s → masked. |
| 33 | vault worker ends on lock | Vault isolated in a Web Worker | A dedicated Worker runs while unlocked; Lock terminates it. |
| **history** | | | |
| 34 | password changes are recorded on save | Entry metadata & password history | Add "History entry", then change its password 6 times, saving each ("Password changed — history updates when you save."). |
| 35 | item history | Entry metadata & password history | Item History: a created time, "(… ago)", "Password updates" = 6, "Previous Passwords (5)" holding the 5 newest old passwords, newest first. |
| **hibp** | | | |
| 36 | breach check on password edit | Have I Been Pwned checks | Add "Weak entry" with password `password` → "Very weak", "Seen 1,234 times in breaches…", a `pwned` label and chip. |
| 37 | only a 5-character hash prefix is sent | Have I Been Pwned checks | Every request so far is `/range/<5 hex>`, carries `Add-Padding: true`, and has no cookie or referrer. |
| 38 | on-edit check can be turned off | Have I Been Pwned checks, Synced settings | Settings → untick "Have I Been Pwned on edit", give Notion the same password → no request, no chip. |
| 39 | breach audit from the menu | Have I Been Pwned checks | Menu → Have I Been Pwned → "4 / 4 checked", "1 of 4 passwords found in breaches" (the shared password is checked once); Notion is now marked, GitHub isn't. |
| 40 | breach results and setting saved | — | Turn the setting back on, Save. |
| **entry-totp** | | | |
| 41 | two-factor code from a pasted secret | Two-factor codes (TOTP) | GitHub: paste a base32 secret, Set → the code an authenticator computes, a 1–30 s countdown; "Copy two-factor code" and the collapsed row's "2FA: …" button copy it. |
| 42 | two-factor code from an otpauth:// URI | Two-factor codes (TOTP) | Notion: paste an `otpauth://totp/…` URI → the right code, in the editor and the collapsed row. |
| 43 | two-factor code from a QR image | Two-factor codes (TOTP) | Spacey: upload a QR image (`qrcode-generator`) of an `otpauth://` URI with "Scan QR image" → the right code. |
| 44 | invalid two-factor secret is refused | Two-factor codes (TOTP) | "not a secret!" → "Not a valid TOTP secret or otpauth:// URI."; an empty Set adds nothing. |
| 45 | countdown turns red before the code expires | Two-factor codes (TOTP) | GitHub's collapsed code turns red with ≤ 5 s left (waits up to 35 s). |
| 46 | two-factor secrets saved | — | Save. |
| **settings** | | | |
| 47 | focus mode is on by default | Synced settings | Settings shows Focus mode on; editing GitHub lists only GitHub; Done brings all 6 back. |
| 48 | focus mode off keeps the whole list | Synced settings | Untick it → editing lists all 6. |
| 49 | password autofill suppressed by default | Synced settings | The save dialog's password input has `autocomplete="new-password"` and `data-1p-ignore`; save. |
| 50 | settings survive a reload | Synced settings | Lock, reload, unlock → Focus mode is still off (it's in the vault); turn it back on, save. |
| 51 | password fill & save setting | Synced settings | Turn "Browser password fill & save" on → save dialog `autocomplete="current-password"`; after a reload the unlock screen follows it too; off again → back to `new-password`. |
| 52 | save needs the master password | Save protection | Edit, Save with a wrong password → "Wrong password."; the right one saves. |
| 53 | concurrent write is detected | Save protection | A second browser context (same account) saves first → this tab's save gets "The vault changed elsewhere…" (409); after lock/unlock it shows the other tab's edit. |
| **offline** | | | |
| 54 | offline unlock | Offline mode | Lock, go offline (`context.setOffline`), unlock. Cache on: "Offline — read only", no "+ Add" / Save, fields disabled. Cache off: "Unlock failed. Check your connection…", then unlock online. |
| 55 | offline recovers when the network returns | Offline mode | Cache on: back online → "Synced" and "+ Add" return by themselves. |
| 56 | offline stays read-only when the vault changed meanwhile | Offline mode | Cache on: offline unlock, a second context saves a change, back online → "The vault changed on Drive while you were offline…" and still read-only; lock/unlock loads the change. |
| **security-dialog** | | | |
| 57 | export keyfile and recovery code | Per-device keyfile | Security → wrong password → "Wrong password."; right one → "Key <kid>", the recovery code from step 2, and a download holding the same key. |
| 58 | change master password | — | Change it → "Password changed — vault re-encrypted."; the old password is refused, the new one unlocks; change it back. |
| **two-factor** | | | |
| 59 | enable two-factor | Two-factor vault delivery | Security → password → "Set up two-factor"; read the manual key, enter the current code, Enable → "Two-factor authentication enabled.", ✕ closes. |
| 60 | unlock asks for a two-factor code | Two-factor vault delivery | Lock, reload, password + keyfile → the "Two-factor code" field (401 `totp_required`). |
| 61 | wrong two-factor code is rejected | Two-factor vault delivery | The code from an hour ago → "That code didn't match…" (401 from `POST /api/vault/unlock`). |
| 62 | unlock with two-factor code | Two-factor vault delivery | The current code → the vault opens. |
| 63 | disable two-factor | Two-factor vault delivery | Security → password → "Disable 2FA" → "Two-factor authentication disabled." |
| 64 | unlock without a code after disabling | Two-factor vault delivery | Lock, reload, unlock → no code field. |
| **page-security** | | | |
| 65 | strict content security policy | Strict Content-Security-Policy | The page's CSP header: `script-src` has `'self'`, a nonce and build hashes and no `'unsafe-inline'`/`'unsafe-eval'`; `object-src`, `base-uri` and `frame-ancestors` are `'none'`. |
| 66 | injected script is blocked and flagged | Strict CSP, Script tamper-evidence | The self-check status is `ok`; append an inline `<script>` → CSP blocks it (it never runs), "Unexpected script detected…" appears and the status turns `unexpected`; Dismiss hides it. |
| 67 | zero-knowledge: nothing readable reaches the server | Zero-knowledge server | Across every request of the run (page and Worker, ≥ 10 vault uploads), no URL or body contains the master passwords, entry names, usernames, notes, entry passwords or TOTP seeds; an upload is an encrypted envelope (`ciphertext`, `nonce`). |
| **session** | | | |
| 68 | account shown in the menu | — | The menu shows `demo@portunus.local`. |
| 69 | themes, remembered per browser | Themes | Light and Dark set `<html data-theme>`, stored in `localStorage["portunus-theme"]` and kept after a reload; back to Original. |
| 70 | auto-lock countdown, paused while unsaved | Auto-lock | With Playwright's fake clock: "locks in 4:5x"; 4 min later ~1:00; moving the mouse resets it; an unsaved edit shows "auto-lock paused" and 6 min later the vault is still open. |
| 71 | auto-lock locks when idle | Auto-lock | Save, 5:01 idle → "Unlock vault". |
| 72 | sign out | — | "Sign out" on the unlock screen → "Sign in with Google". |

The vault's own two-factor secret (step 59) is the one secret the server
receives on purpose, since the server checks the codes. Step 67 therefore
doesn't check it.

The server accepts each time-step's code only once (replay protection), so
steps 59 and 62 each wait for a fresh 30-second window, if needed, before
entering a code. With the 30 s idle step and the red-countdown wait, a run
takes about 1½–2 minutes.

Checked across every step:

- No uncaught page errors.
- No `console.error` output. The browser's generic "Failed to load resource"
  message is skipped, because HTTP errors are checked below with their URL.
  A step can allow specific messages in its `allowConsole` list. Only step 66
  does, for the CSP violation it causes on purpose.
- No CSP violations (`securitypolicyviolation`). This catches a production
  build whose inline-script hashes don't match.
- No HTTP response ≥ 400, except the ones a step declares in its
  `allowHttp` list: `GET /api/vault` → 404 on first sign-in (no vault yet),
  `PUT /api/vault` → 409 for the refused creates (steps 9–10) and the
  concurrent write (step 53), `GET /api/vault` → 404 while step 10 forces the
  create screen, `GET /api/vault` → 401 while two-factor is on (step 60), and
  `POST /api/vault/unlock` → 401 for the wrong code (step 61).
- No request leaves the server under test. Every browser context (including
  the second tabs of steps 53 and 56) aborts and reports any request to
  another origin, except the stubbed Pwned Passwords API. A new outside call
  fails the run rather than quietly needing the internet. Installing
  dependencies and building the image still need the network; the run
  itself doesn't.

### Not covered

- **Google Drive storage** (the `Portunus Application` folder, `drive.file`
  scope), **real Google OAuth** and **tamper-detected vault files**. Demo
  mode stubs sign-in, keeps the vault in memory and turns signing off
  (`isSigningEnabled()` in `src/lib/signing.ts`). These need a manual check
  against a real deployment. Signatures are unit-tested in
  `src/lib/signing.test.ts`.
- **Single Docker image**: covered by `npm run full-smoke` itself, which
  builds the image and runs these tests against it, but not by `npm run smoke`.
- Two-factor when saving after the grant has expired (the save dialog's code
  field), and the lockout after 5 wrong codes.
- Re-masking when the tab is hidden: headless Chromium doesn't change
  `document.visibilityState`.

## Setup (once)

```bash
npx playwright install --with-deps chromium
```

`--with-deps` installs Chromium's system libraries and needs sudo. Docker is
needed for `full-smoke` and `deploy:local`.

If Playwright refuses with "does not support chromium on <distro>" (a distro
newer than the installed Playwright release, e.g. Ubuntu 26.04), install the
build for the previous Ubuntu LTS and the libraries by hand:

```bash
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 npx playwright install chromium
sudo apt-get install -y libnss3 libnspr4 libasound2t64
```

## Running

| Command | What it does |
|---|---|
| `npm run full-smoke` | Builds the production image, runs it in a throwaway container (`portunus-smoke`, port 3002), runs the tests, and always removes the container. Use this before opening a PR. |
| `npm run full-smoke-with-screenshots` | Same as `full-smoke`, plus a screenshot after every step in `./smoke-artifacts/steps/` (see `SMOKE_SCREENSHOTS` below). |
| `npm run smoke` | Runs the tests against a server that is already running (default `http://localhost:3001`). |
| `npm run deploy:local` | Builds the production image and runs it in demo mode as `portunus-local` on `http://localhost:3001`, ready for `npm run smoke` or manual testing. |
| `npm run deploy:local:stop` | Removes the `portunus-local` container. |

`full-smoke` and `deploy:local` test the real production build: the
standalone server and the strict-CSP script hashes, which `next dev` doesn't
exercise. For quick iteration against the dev server:

```bash
PORTUNUS_DEMO_MODE=1 npm run dev
BASE_URL=http://localhost:3000 npm run smoke
```

Each run uses a fresh browser context and therefore a fresh demo vault, so
the server never needs a restart between runs.

### In CI

The `smoke` job in `.github/workflows/node.js.yml` runs `npm run full-smoke`
on every push to main and every PR, on `ubuntu-24.04` (Playwright 1.56 can't
install its system libraries on 26.04, today's `ubuntu-latest`), twice in parallel: once with the offline
cache on, once with `DISABLE_OFFLINE_MODE=1`. It needs no secrets (demo
mode). When a run fails, the job prints the container's server log and
uploads the failure screenshot and HTML as the `smoke-failure-cache-on` /
`smoke-failure-cache-off` artifact (via `SMOKE_ARTIFACTS_DIR`).

Each job also writes a results table to the run's summary page: every step
with ✅/❌ and its duration.

**Screenshots of every step:** put `[smoke-screenshots]` anywhere in the
commit message (for a PR, the message of its newest commit). The job then
sets `SMOKE_SCREENSHOTS=1` and uploads the whole run, pass or fail, as the
`smoke-screenshots-cache-on` / `-cache-off` artifact. The summary table then
names each step's screenshot. A commit without the tag runs as usual.
GitHub can't show images inside a step's log, so the screenshots are in
the artifact (a zip on the run's page), not inline.

```bash
git commit -m "Tweak the unlock form [smoke-screenshots]"
git commit --allow-empty -m "Smoke screenshots [smoke-screenshots]"  # just to get them
```

## Options

Environment variables. They work with both `smoke` and `full-smoke` unless
noted.

| Variable | Effect |
|---|---|
| `HEADED=1` | Show the browser window while the tests run. Each action is slowed to 300 ms so you can follow it. On WSL the window opens on the Windows desktop (WSLg). With `full-smoke` it appears only after the Docker build finishes. |
| `SLOWMO=<ms>` | Delay per browser action, e.g. `SLOWMO=1000`. Defaults to 300 when headed, 0 otherwise. |
| `KEEP_OPEN=1` | Implies `HEADED=1`. After the run, pass or fail, the browser stays open on the vault the test created until you press Enter in the terminal, so you can click around. With `full-smoke` the container is removed only after that. Ignored when stdin isn't a terminal. |
| `BASE_URL=<url>` | `smoke` only: the server to test (default `http://localhost:3001`). |
| `SMOKE_PORT=<port>` | `full-smoke` only: host port for the throwaway container (default 3002). |
| `DISABLE_OFFLINE_MODE=1` | Run the offline-cache steps expecting the cache off. `full-smoke` and `deploy:local` pass it on to the container; with `smoke`, start the server with the same value, since the tests can't read the server's env. Without it they expect the cache on. |
| `SMOKE_SCREENSHOTS=1` | Save a full-page screenshot after every step, pass or fail, as `steps/NN-step-name.png` (numbered like the table above; a failing step is `NN-…-failed.png`) under `SMOKE_ARTIFACTS_DIR`, default `./smoke-artifacts`. Kept after a passing run. `npm run full-smoke-with-screenshots` sets it for you. In CI, turned on per commit (see [In CI](#in-ci)). |
| `SMOKE_ARTIFACTS_DIR=<dir>` | Save the failure screenshot and HTML there instead of the run's temp dir (created if missing). CI uses `smoke-artifacts`, which is gitignored. |
| `DOCKER=<binary>` | `full-smoke` and `deploy:local`: Docker binary, e.g. `docker.exe` in WSL without Docker Desktop integration. |

```bash
HEADED=1 npm run full-smoke                # watch it
DISABLE_OFFLINE_MODE=1 npm run full-smoke  # the offline cache switched off
KEEP_OPEN=1 SLOWMO=800 npm run full-smoke  # watch slowly, then explore
```

## Layout

```
scripts/
├── deploy-local.mjs      # npm run deploy:local / deploy:local:stop (also used by full-smoke)
└── smoke/
    ├── tests.mjs         # the run order: concatenates the modules below
    ├── tests/            # the tests, one module per README feature group
    │   ├── core.mjs            # sign in, create, save, unlock, offline cache, exclusive create
    │   ├── keyfile.mjs         # password + keyfile, recovery code, install / remove key
    │   ├── entries.mjs         # editor fields, icons, SSO, spaces, duplicates, search, labels, sort, copy
    │   ├── secrets.mjs         # masking, re-masking, the vault Worker
    │   ├── history.mjs         # password history and entry metadata
    │   ├── hibp.mjs            # Have I Been Pwned (stubbed)
    │   ├── entry-totp.mjs      # per-entry TOTP codes
    │   ├── settings.mjs        # synced settings, save protection
    │   ├── offline.mjs         # offline mode
    │   ├── security-dialog.mjs # keyfile export, master-password change
    │   ├── two-factor.mjs      # two-factor vault delivery
    │   ├── page-security.mjs   # CSP, script tamper-evidence, zero-knowledge
    │   └── session.mjs         # themes, auto-lock, sign out (fakes the clock: keep last)
    ├── helpers.mjs       # shared constants and UI moves
    ├── network.mjs       # Pwned Passwords stub + request log
    ├── run-tests.mjs     # runner: browser, error collection, failure artifacts, options
    ├── totp.mjs          # authenticator-style TOTP codes for the two-factor tests
    ├── smoke.mjs         # harness: test a server that's already running
    └── full-smoke.mjs    # harness: build + throwaway container + test + cleanup
```

The harnesses only provide a server; everything that touches the browser is
in `run-tests.mjs`, and the checks themselves are in `tests/`.

## Adding a test

Each module in `tests/` exports an ordered list of `{ name, run(ctx) }`
steps, and `tests.mjs` concatenates them. They run one after another on the
same page and build on each other, and the first failure stops the run.
`ctx` has:

- `page`: the Playwright page,
- `baseUrl`: the server under test,
- `workDir`: a temp directory for downloads, deleted after a passing run,
- `state`: a scratch object for handing data to later steps (e.g. the
  keyfile path, the recovery code, or `state.secrets`, the plaintext the
  zero-knowledge step checks no request contains),
- `offlineCache`: false when the server runs with `DISABLE_OFFLINE_MODE`.

Add a step to the module for its feature (or a new module, listed in
`tests.mjs`), where the state it needs exists. A new user-facing feature in
the README needs a step here too. The runner prints each step's name and
fails the step if the browser reported an error during it. Leave the page
unlocked with no entry open and nothing unsaved, as the next step expects.

If a step expects an HTTP error (e.g. a deliberately wrong code), list it
on the step as `allowHttp: [{ status, method, path }]`; an expected console
error goes in `allowConsole: [/regexp/]`. They're allowed during that step
only.

Helpers in `helpers.mjs`:

- `field()` / `notesField()`: entry-editor labels aren't `for`-associated,
  so select inputs by label text with these.
- `addEntry()`, `openEntry()`, `closeEntry()`, `entryRow()`, `entryNames()`,
  `setEntryPassword()`, `revealPassword()`: entries.
- `save()`, `lock()`, `lockAndReload()`, `fillUnlock()`, `unlock()`,
  `menu()`, `openSecurity()` / `closeSecurity()`: the common moves.
- `openSecondTab()`: a second browser context on the same account and vault
  (for conflicts and changes made elsewhere).
- `freshTotpCode(secret, state)` (from `totp.mjs`): the current two-factor
  code. It waits for a new time-step when needed, so the server's replay
  protection doesn't reject it.

`scripts/record-demo.mjs` drives the same UI, so a UI change that breaks a
selector usually needs fixing in both.

## Troubleshooting

- **"Expected a demo-mode server … ECONNREFUSED"**: nothing is listening at
  `BASE_URL`. Start `npm run deploy:local` or the dev server first, or use
  `full-smoke`.
- **Expected 404/401s**: `GET /api/vault` returns 404 on first sign-in (no
  vault yet) and 401 while two-factor is on. The steps that trigger them
  allow them via `allowHttp`. Anywhere else they fail the run.
- **"That code didn't match" where a valid code was expected**: the clocks
  of the test machine and the server (the Docker VM) disagree by more than
  30 s. Check `date` against `docker exec portunus-local date`.
- **No window with `HEADED=1`**: check `echo $DISPLAY` prints something
  (`:0` under WSLg); if it's empty, `export DISPLAY=:0`.
- **Container won't start**: `deploy-local.mjs` prints the container logs
  when the server isn't ready within 90 s; otherwise run
  `docker logs portunus-local`.
