# Portunus

Self-hosted, Google Drive–backed password/secrets manager. Next.js (App Router,
TypeScript, Tailwind), deployable as a single Docker image. `portunus.html` is
the legacy single-file version, kept for reference only.

> **Read [`AGENTS-TSNODE.md`](AGENTS-TSNODE.md) too, if it exists.** It
> holds conventions for any TypeScript Node project (naming, test files,
> constants, Zod schema validation of external input, the
> interface/provider/factory component pattern) that apply here in full.
> Where the two files conflict, this file wins.

@AGENTS-TSNODE.md

## Architecture rules

- **Zero-knowledge server**: all encryption/decryption happens client-side.
  The server only brokers Google OAuth tokens and proxies Drive API calls —
  it must never receive plaintext vault data or the master password.
- **No database**: sessions use the Auth.js JWT strategy (encrypted cookie).
  State lives in the Drive vault file, the user's keyfile/localStorage, and
  the session cookie.
- **Keyfile model**: the vault data key is wrapped by
  `Argon2id(password || keyfile_bytes)`. Both are required to unlock —
  password alone on a foreign machine cannot brute-force the vault.
- **Crypto engine is pluggable**: engines live in `src/crypto/engines/`,
  implement `VaultEngineInterface`, and register by id. The vault envelope
  JSON stores the engine id + params so engines can be swapped later.
- Engine v1: Argon2id KDF (OWASP params: m=19 MiB, t=2, p=1) + XChaCha20-Poly1305.
  Libraries: `hash-wasm` / `libsodium-wrappers`.

## Code conventions

Project-specific additions to `AGENTS-TSNODE.md`:

- Client components only where interactivity is needed; crypto modules must be
  importable client-side (no Node-only APIs in `src/crypto/`).
- Schema validation (Zod) of external input applies to **server-side code
  only** for now (API route bodies, Google Drive and OAuth responses, the
  signed vault wrapper). Browser and Worker inputs (keyfile, envelope, vault
  document, `/api/vault` responses, localStorage, Worker messages) keep their
  existing checks. Schemas live in `src/lib/schemas/*.schema.ts`; the
  validator is `createSchemaValidatorFactory()` from `@/factory`
  (`src/lib/schema-validator/`). Inside `src/lib/store/providers/`, create it
  per instance, not at module load: `@/factory` also re-exports the store
  factory, so a module-level call there would run mid import cycle.
- Exception to "import factories from `@/factory`": **client components**
  import a browser-side factory from its own folder (e.g.
  `@/lib/biometric/factory`). `@/factory` also re-exports the server-side
  store and schema-validator factories, and importing it from the browser
  bundles Zod, whose `Function("")` probe the production CSP blocks.

## Commands

```bash
npm run dev      # dev server
npm run build    # production build (2× next build via scripts/script-integrity.mjs)
npm run lint     # eslint
npm test         # vitest run (unit tests, node env)
npm run test:watch # vitest watch mode
npm run deploy:local      # prod Docker image, demo mode, on http://localhost:3001
npm run deploy:local:stop # remove that container
npm run smoke      # Playwright e2e smoke vs a demo-mode server (BASE_URL, default :3001)
npm run full-smoke # build + throwaway container (:3002) + smoke, container always removed
npm run full-smoke-with-screenshots # same, plus a screenshot per step in ./smoke-artifacts/steps/
```

Smoke tests live in `scripts/smoke/tests/` (one module per README feature group,
run in the order `scripts/smoke/tests.mjs` lists); `scripts/smoke/smoke.mjs` and
`scripts/smoke/full-smoke.mjs` are harnesses that only provide the server.
Every user-facing feature in README.md's Features list must have a smoke step
(added or updated in the same PR as the feature), unless demo mode can't reach
it — then list it under "Not covered" in `SMOKE.md`.
**Rule: every user-facing behavior change — a new feature or a tweak to an
existing one (e.g. hiding a button in some case) — adds or updates a smoke
assertion for it in the same PR**, so the CI `smoke` job
(`.github/workflows/node.js.yml`, `npm run full-smoke`) checks it. Cover
both sides of a condition (shown/hidden, on/off), and update the step's row
in `SMOKE.md`.
Everything about smoke testing (setup, options such as `HEADED`/`KEEP_OPEN`,
adding tests) is in `SMOKE.md` — keep it in sync with `scripts/smoke/`.

Local deploy + smoke/UI testing workflow (incl. the Playwright MCP in
`.mcp.json`): `.claude/skills/deploy-and-test/SKILL.md`.

`npm run build` generates `src/generated/script-integrity.ts` (strict-CSP
inline-script hashes + the runtime script self-check's allowlist); it's
gitignored and must never be committed. Use `npm run build`; plain
`next build` is refused by `next.config.ts` (without the generated hashes the
production CSP fails closed and blocks prerendered inline scripts).
`npm run dev` writes an empty stub via `predev`.

A Devin blueprint lives in `.devin/blueprint.yaml` (Node 24 install,
`npm install`, test/lint/build/dev commands, required secret names). Keep it in
sync when these commands, the Node version, or the env vars below change.

Node v24 is used for local dev (`~/.local/bin` on PATH in WSL).
Docker builds run via `docker` (requires Docker Desktop WSL integration
enabled for this distro; `docker.exe` works without it).

## Environment

- `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` — Google OAuth client (each
  self-hoster creates their own Cloud project + OAuth consent screen).
- `AUTH_SECRET` — Auth.js session encryption secret (`npx auth secret`).
- `AUTH_URL` — app origin (e.g. `http://localhost:3000`).
- `PORTUNUS_DEMO_MODE=1` (any env, including the Docker image) —
  stubbed sign-in + in-memory `MemoryStore`; no `AUTH_*` vars needed. Used by
  `scripts/record-demo.mjs` to regenerate the README GIF/screenshots.
- `PORTUNUS_SIGNING_PRIVATE_KEY` — Ed25519 key (base64 DER PKCS#8) the
  server uses to sign/verify the Drive vault file (`src/lib/signing.ts`);
  required at boot unless `PORTUNUS_SIGNATURES_DISABLED=1` or demo mode.
  `PORTUNUS_ALLOW_MISSING_SIGNATURE=1` admits legacy unsigned vaults during
  migration. Tests generate keys via `src/lib/signing.test-helper.ts`.
- `PORTUNUS_BIOMETRIC_UNLOCK=1` — optional biometric (WebAuthn passkey +
  PRF) unlock; off by default. `PORTUNUS_BIOMETRIC_SAVE_CONFIRM=0` keeps
  saves on the master password (default: biometrics may confirm a save).
  Read server-side in `src/lib/biometric/biometric-env.ts`.
- Drive scope: `https://www.googleapis.com/auth/drive.file` — app only sees
  files it created (`portunus.vault.json`).

## Pending design notes

- Auto-lock: idle timer with a **visible countdown** in the UI; reloads/locks
  the vault when it expires (skipped while unsaved changes exist).
- Keyfile can be installed into localStorage (per-device) or loaded
  per-session via file picker.
- Theme: Portunus — Roman god of keys, doors, harbors. Deep navy + bronze;
  gate/keyhole unlock animation (Framer Motion) planned for Phase 6.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
