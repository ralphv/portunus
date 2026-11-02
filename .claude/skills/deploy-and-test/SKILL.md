---
name: deploy-and-test
description: Deploy Portunus locally (production Docker image, demo mode) and verify a change end-to-end — scripted smoke test plus interactive UI checks through the Playwright MCP. Use after UI or server changes, or when asked to deploy, smoke-test, or check something in the browser.
---

# Deploy and test Portunus locally

Everything here runs in **demo mode** (`PORTUNUS_DEMO_MODE=1`): stubbed
"Sign in with Google" (`demo@portunus.local`), in-memory vault, no secrets.
It covers the whole UI and client-side crypto, not real Google OAuth / Drive /
vault signatures (that flow lives in `.agents/skills/testing-portunus/` and
needs a human-provided Google login — don't attempt it).

## Pick a target

| Target | Start | URL | Use for |
|---|---|---|---|
| Dev server | `PORTUNUS_DEMO_MODE=1 npm run dev` (run in background) | `http://localhost:3000` | quick UI iteration, hot reload |
| Local Docker | `npm run deploy:local` | `http://localhost:3001` | the real production build: 2× `next build`, strict-CSP hashes, standalone server |

Before calling a change done, prefer the Docker target — CSP or build-only
breakage never shows up under `next dev`.

`npm run deploy:local` builds `portunus:local`, replaces the
`portunus-local` container, and waits until `/api/vault` answers
`{"error":"vault_not_found"}`. On a startup failure it prints the container
logs; otherwise use `docker logs portunus-local`. Stop it with
`npm run deploy:local:stop`. `DOCKER=docker.exe` if `docker` is unavailable.

## Smoke test

```bash
npm run full-smoke                              # build + throwaway container (:3002) + smoke, always cleaned up
npm run smoke                                   # against :3001 (Docker, after deploy:local)
BASE_URL=http://localhost:3000 npm run smoke    # against the dev server
```

`full-smoke` is the one-shot pre-commit check for a change. Run headless
yourself: only the user can see a `HEADED=1` window, and `KEEP_OPEN=1`
waits for Enter on a terminal (it's ignored without one). To show the user
the UI live, tell them to run `HEADED=1` / `KEEP_OPEN=1 npm run full-smoke`.
All options, setup and how to add tests: `SMOKE.md` (update it when you
change `scripts/smoke/`).

Layout: the tests are in `scripts/smoke/tests/` (one module per README
feature group, ordered `{ name, run }` steps sharing `ctx.state`, run in the
order `scripts/smoke/tests.mjs` lists); shared UI moves are in
`scripts/smoke/helpers.mjs`; `scripts/smoke/run-tests.mjs` owns the browser,
error collection and failure artifacts; `smoke.mjs` / `full-smoke.mjs` are
harnesses that only provide the server. Add new checks to the module for the
feature (README features each need one — see `SMOKE.md`).

One run creates a vault and works through every README feature demo mode can
reach (~70 steps, 1½–2 min; the "Test cases" table in `SMOKE.md` lists them).
Have I Been Pwned is stubbed, so runs need no internet. Fails on any page
error, console error or CSP violation, and prints a screenshot + HTML path —
Read the screenshot to see what went wrong. Each run uses a fresh browser context, so it gets a fresh
vault; no server restart needed.

If the smoke test fails on a selector after an intentional UI change, update
`scripts/smoke/tests/` (and likely `scripts/record-demo.mjs`, which uses the
same selectors).

## Interactive checks (Playwright MCP)

The `playwright` MCP server (`.mcp.json`, headless, isolated profile) is for
checking the specific feature you changed: `browser_navigate` to the target
URL, `browser_snapshot` for the accessibility tree (use it to find refs
before clicking), `browser_click` / `browser_type` / `browser_fill_form`,
`browser_take_screenshot` to look at the result. If it reports a missing
browser, run `npx -y @playwright/mcp@<version in .mcp.json> install-browser
chrome-for-testing` once (it bundles a newer Playwright than the project's,
so it uses its own browser build).

Fast path into an unlocked vault: click "Sign in with Google" → type the
same password into both password fields → Continue → tick "I have saved the
keyfile…" (leave "Also install the keyfile in this browser" checked so you
never need the file) → Create vault.

## Demo-mode gotchas

- The vault is per visitor cookie (`portunus.demo-visitor`). A request
  without it hits an "anonymous" bucket with no vault — by design.
  Restarting the server/container wipes all demo vaults.
- `GET /api/vault` → 404 on first sign-in is expected (no vault yet → the
  create-vault flow); the browser logs it as a "Failed to load resource"
  console error. The smoke test allowlists exactly that one.
- Locking does NOT clear the keyfile (it stays in React state); reload while
  locked to get the file picker back.
- Unlocked-header actions (Security, Remove key, Lock, Sign out) are in the
  hamburger menu (`aria-label="Menu"`); Save stays visible. Save asks for the
  master password again ("Save to Drive").
- Entry-editor labels aren't `for`-associated — select inputs by label text
  (see the `field()` helper in `scripts/smoke/helpers.mjs`).
- Clipboard check without devtools: "copy pass", then paste into the search
  field.
- `npm run dev` re-adds a `next dev` block to `AGENTS.md`; that's expected —
  don't strip it.
