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

## Commands

```bash
npm run dev      # dev server
npm run build    # production build
npm run lint     # eslint
npm test         # vitest run (unit tests, node env)
npm run test:watch # vitest watch mode
```

Node v24 is used for local dev (`~/.local/bin` on PATH in WSL).
Docker builds run via `docker.exe` (Docker Desktop, WSL integration off).

## Environment

- `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` — Google OAuth client (each
  self-hoster creates their own Cloud project + OAuth consent screen).
- `AUTH_SECRET` — Auth.js session encryption secret (`npx auth secret`).
- `AUTH_URL` — app origin (e.g. `http://localhost:3000`).
- Drive scope: `https://www.googleapis.com/auth/drive.file` — app only sees
  files it created (`portunus.vault.json`).

## Pending design notes

- Auto-lock: idle timer with a **visible countdown** in the UI; reloads/locks
  the vault when it expires (skipped while unsaved changes exist).
- Keyfile can be installed into localStorage (per-device) or loaded
  per-session via file picker.
- Theme: Portunus — Roman god of keys, doors, harbors. Deep navy + bronze;
  gate/keyhole unlock animation (Framer Motion) planned for Phase 6.
