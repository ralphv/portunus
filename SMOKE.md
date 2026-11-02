# Smoke tests

End-to-end browser tests (Playwright) that run the app in
[demo mode](README.md#demo-mode): stubbed sign-in and an in-memory vault, so
no Google account or secrets are needed.

The tests sign in, create a vault, add an entry, save, reload, unlock with
password + keyfile, and check the entry is still there. They also check the
offline cache, that a second vault can't be created over the first, and
two-factor unlock. A run fails on any
page error, console error, CSP violation or unexpected HTTP error. When a run
fails, a screenshot and the page HTML are saved and their paths printed.

## Test cases

Defined in `scripts/smoke/tests.mjs` and run in this order on one page. Each
step depends on the ones before it, and the first failure stops the run.
Keep this table in sync when you change the tests.

| # | Step | Actions | Passes when |
|---|---|---|---|
| 0 | precheck | Unauthenticated `GET /api/vault` (run by the runner, before the browser starts). | The response is `{"error":"vault_not_found"}`, i.e. a demo-mode server is listening. Google mode would answer 401. |
| 1 | sign in | Open `BASE_URL`, click "Sign in with Google" (the demo provider, no Google round trip). | The "Create your vault" heading appears, so the new visitor has no vault yet. |
| 2 | create vault | Enter the master password twice, then Continue. Download `portunus.key` into the run's temp dir. Uncheck "Also install the keyfile in this browser", tick "I have saved the keyfile", then Create vault. | The vault opens: the "Search entries…" box appears. |
| 3 | add entry | Click "+ Add", fill Name ("Smoke entry") and Username, click Generate for a password, then Done. | Every action succeeds without a browser error. |
| 4 | save | Click Save, re-enter the master password in "Confirm master password to save", then "Save to Drive". | The Save button turns disabled, meaning there are no unsaved changes left and the server accepted the encrypted vault. |
| 5 | offline cache after save | With `DISABLE_OFFLINE_MODE` set, also plant a stale cache entry for step 8 to wipe. | Cache on: `localStorage["portunus.vault.cache"]` holds the vault and not the entry's name (ciphertext only). Cache off: it's empty. |
| 6 | reload + unlock with keyfile | Reload the page. Enter the password and pick the downloaded keyfile in the file picker (it wasn't installed, so the picker path is exercised), then Unlock. | "Unlock vault" appears after the reload, then "Key … loaded", then the vault opens. |
| 7 | entry persisted | — | "Smoke entry" is listed: it survived the save → reload → decrypt round trip. |
| 8 | offline cache after unlock | — | Same check as step 5. Cache off: the stale entry is gone too. |
| 9 | second create is refused | `PUT /api/vault` without a `fileId` (a create) from the page. | `409 {"error":"vault_exists"}`: no second vault file that would shadow the first. |
| 10 | refused create keeps the vault and keyfile | Answer `GET /api/vault` with 404 (`page.route`) so the app offers "Create your vault", reload, and create a vault with "Also install the keyfile in this browser" ticked. Then drop the route, reload and unlock. | "A vault already exists in your Drive" is shown, the browser's installed keyfile is unchanged, and the original vault still unlocks with "Smoke entry" listed. |
| 11 | enable two-factor | Menu → Security. Enter the master password, then "Set up two-factor". Read the manual key, compute the current code the way an authenticator app would, then Enable. Close the dialog with ✕. | The QR code appears, then "Two-factor authentication enabled.", and the ✕ can be reached and clicked. |
| 12 | unlock asks for a two-factor code | Menu → Lock, then reload. Enter the password and pick the keyfile. | The unlock form shows the "Two-factor code" field, because the server refused the vault fetch with 401 `totp_required`. |
| 13 | wrong two-factor code is rejected | Enter a correctly formatted but wrong code (the one from an hour ago), then Unlock. | "That code didn't match…" is shown (401 from `POST /api/vault/unlock`) and the vault stays locked. |
| 14 | unlock with two-factor code | Enter the current code, then Unlock. | The vault opens and "Smoke entry" is listed. |
| 15 | disable two-factor | Menu → Security. Enter the master password, then "Disable 2FA". | "Two-factor authentication disabled." is shown. |
| 16 | unlock without a code after disabling | Lock, reload, enter the password and the keyfile. | No "Two-factor code" field appears, and the vault opens with "Smoke entry" listed. |

The server accepts each time-step's code only once (replay protection), so
steps 11 and 14 each wait for a fresh 30-second window, if needed, before
entering a code. That adds up to about a minute to a run.

Checked across every step:

- No uncaught page errors.
- No `console.error` output. The browser's generic "Failed to load resource"
  message is skipped, because HTTP errors are checked below with their URL.
- No CSP violations (`securitypolicyviolation`). This catches a production
  build whose inline-script hashes don't match.
- No HTTP response ≥ 400, except the ones a step declares in its
  `allowHttp` list: `GET /api/vault` → 404 on first sign-in (no vault yet),
  `PUT /api/vault` → 409 for the refused creates (steps 9–10),
  `GET /api/vault` → 404 while step 10 forces the create screen,
  `GET /api/vault` → 401 while two-factor is on (step 12), and
  `POST /api/vault/unlock` → 401 for the wrong code (step 13).

Not covered:

- Real Google OAuth, Drive storage and vault signatures. Demo mode stubs
  sign-in, keeps the vault in memory and turns signing off
  (`isSigningEnabled()` in `src/lib/signing.ts`). These need a manual check
  against a real deployment.
- Two-factor when saving after the grant has expired (the save dialog's code
  field), and the lockout after 5 wrong codes.
- Everything else in the UI: search, labels, icons, TOTP codes on entries,
  copy, auto-lock, Remove key, sign-out.

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
    ├── tests.mjs         # the tests, shared by both harnesses
    ├── run-tests.mjs     # runner: browser, error collection, failure artifacts, options
    ├── totp.mjs          # authenticator-style TOTP codes for the two-factor tests
    ├── smoke.mjs         # harness: test a server that's already running
    └── full-smoke.mjs    # harness: build + throwaway container + test + cleanup
```

The harnesses only provide a server; everything that touches the browser is
in `run-tests.mjs`, and the checks themselves are in `tests.mjs`.

## Adding a test

`tests.mjs` exports an ordered list of `{ name, run(ctx) }` steps. They run
one after another on the same page and build on each other, and the first
failure stops the run. `ctx` has:

- `page`: the Playwright page,
- `baseUrl`: the server under test,
- `workDir`: a temp directory for downloads, deleted after a passing run,
- `state`: a scratch object for handing data to later steps (e.g. the
  keyfile path).

Append a step, or insert it where the state it needs exists (e.g. after
"create vault" for anything that needs an unlocked vault). The runner prints
each step's name and fails the step if the browser reported an error during
it.

If a step expects an HTTP error (e.g. a deliberately wrong code), list it
on the step as `allowHttp: [{ status, method, path }]`. It's allowed during
that step only.

Helpers in `tests.mjs`:

- `field()`: entry-editor labels aren't `for`-associated, so select inputs
  by label text with this.
- `openSecurity()` / `closeSecurity()`, `lockAndReload()`, `fillUnlock()`,
  `unlockButton()`, `vaultOpen()`: the common moves.
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
