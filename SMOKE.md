# Smoke tests

End-to-end browser tests (Playwright) that run the app in
[demo mode](README.md#demo-mode): stubbed sign-in and an in-memory vault, so
no Google account or secrets are needed.

The tests sign in, create a vault, add an entry, save, reload, unlock with
password + keyfile, and check the entry is still there. A run fails on any
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
| 5 | reload + unlock with keyfile | Reload the page. Enter the password and pick the downloaded keyfile in the file picker (it wasn't installed, so the picker path is exercised), then Unlock. | "Unlock vault" appears after the reload, then "Key … loaded", then the vault opens. |
| 6 | entry persisted | — | "Smoke entry" is listed: it survived the save → reload → decrypt round trip. |

Checked across every step:

- No uncaught page errors.
- No `console.error` output. The browser's generic "Failed to load resource"
  message is skipped, because HTTP errors are checked below with their URL.
- No CSP violations (`securitypolicyviolation`). This catches a production
  build whose inline-script hashes don't match.
- No HTTP response ≥ 400, except `GET /api/vault` → 404 on first sign-in,
  which is how the app detects that there's no vault yet.

Not covered:

- Real Google OAuth, Drive storage and vault signatures. Demo mode stubs
  sign-in, keeps the vault in memory and turns signing off
  (`isSigningEnabled()` in `src/lib/signing.ts`). These need a manual check
  against a real deployment.
- Two-factor vault delivery. It does work in demo mode, but no test turns it
  on yet. That would be a good next test.
- Everything else in the UI: search, labels, icons, TOTP codes, copy,
  auto-lock, Remove key, sign-out.

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
| `DOCKER=<binary>` | `full-smoke` and `deploy:local`: Docker binary, e.g. `docker.exe` in WSL without Docker Desktop integration. |

```bash
HEADED=1 npm run full-smoke                # watch it
KEEP_OPEN=1 SLOWMO=800 npm run full-smoke  # watch slowly, then explore
```

## Layout

```
scripts/
├── deploy-local.mjs      # npm run deploy:local / deploy:local:stop (also used by full-smoke)
└── smoke/
    ├── tests.mjs         # the tests, shared by both harnesses
    ├── run-tests.mjs     # runner: browser, error collection, failure artifacts, options
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

Selectors: entry-editor labels aren't `for`-associated, so use the `field()`
helper in `tests.mjs`. `scripts/record-demo.mjs` drives the same UI, so a UI
change that breaks a selector usually needs fixing in both.

## Troubleshooting

- **"Expected a demo-mode server … ECONNREFUSED"**: nothing is listening at
  `BASE_URL`. Start `npm run deploy:local` or the dev server first, or use
  `full-smoke`.
- **Expected 404**: `GET /api/vault` returns 404 on first sign-in (no vault
  yet, so the create-vault flow opens). The runner allows exactly that one.
- **No window with `HEADED=1`**: check `echo $DISPLAY` prints something
  (`:0` under WSLg); if it's empty, `export DISPLAY=:0`.
- **Container won't start**: `deploy-local.mjs` prints the container logs
  when the server isn't ready within 90 s; otherwise run
  `docker logs portunus-local`.
