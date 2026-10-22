# Portunus

Self-hosted, Google Drive–backed password/secrets manager. Next.js (App Router,
TypeScript, Tailwind), deployable as a single Docker image. `portunus.html` is
the legacy single-file version, kept for reference only.

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

- TypeScript strict mode.
- **Interfaces end with the `Interface` suffix** — e.g. `VaultEngineInterface`,
  `KeyfileStoreInterface`. Always.
- Client components only where interactivity is needed; crypto modules must be
  importable client-side (no Node-only APIs in `src/crypto/`).
- Files used only by tests must say so in their filename: `*.test.ts` for test
  files, `*.test-helper.ts` for shared test helpers (e.g.
  `store-contract.test-helper.ts`, `fake-drive.test-helper.ts`).
- Keep `README.md`'s Features list in sync: every user-facing feature added
  or changed must be reflected there in the same PR.

## Commands

```bash
npm run dev      # dev server
npm run build    # production build (2× next build via scripts/script-integrity.mjs)
npm run lint     # eslint
npm test         # vitest run (unit tests, node env)
npm run test:watch # vitest watch mode
```

`npm run build` generates `src/generated/script-integrity.ts` (strict-CSP
inline-script hashes + the runtime script self-check's allowlist); it's
gitignored and must never be committed. Use `npm run build`, not plain
`next build` — without the generated file the CSP falls back to
`'unsafe-inline'`. `npm run dev` writes an empty stub via `predev`.

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
- Drive scope: `https://www.googleapis.com/auth/drive.file` — app only sees
  files it created (`portunus.vault.json`).

## Interface / provider pattern

When adding an interface with swappable implementations:

- Put it in a folder under `src/lib/` named after the component, e.g.
  `src/lib/store/` for `Store`.
- One file for the interface; its name ends with `Interface`
  (`store-interface.ts` → `StoreInterface`).
- Each implementation is a class ending in `Provider` under a `providers/`
  subfolder (`providers/memory-store-provider.ts` → `MemoryStoreProvider`),
  one file each.
- Exactly one `factory.ts` per folder chooses the implementation. The
  factory function's name ends with `Factory` and decides each provider's
  lifetime itself: stateless providers get a fresh instance per call,
  stateful ones a cached instance per caller key
  (`src/lib/store/factory.ts` → `createStoreFactory()`).
- `src/factory.ts` re-exports every factory function — always import from
  `@/factory`, never from the per-folder file.

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
