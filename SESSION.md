# Portunus — Session Handoff

> Read this together with `AGENTS.md` (project rules/conventions). This file
> captures where the project stands and what to build next.

## What this project is

A self-hosted, zero-knowledge password/secrets manager that replaces the legacy
`portunus.html` single-file app (kept in repo root for reference only).

- Next.js 16 (App Router, TypeScript, Tailwind v4), one Docker image, **no database**.
- Secrets are encrypted **client-side** and stored as `portunus.vault.json` in the
  user's Google Drive. The server only brokers OAuth + proxies Drive API calls —
  it must never see plaintext or the master password.
- Sign-in is Google SSO with the `drive.file` scope (app sees only files it created).

## Decisions already made (do not re-litigate)

- **Crypto model: symmetric envelope encryption.** A random 256-bit data key
  encrypts the vault. The data key is wrapped by `KEK = Argon2id(password ||
  keyfile_bytes)` — BOTH are required. This preserves the old app's property:
  password alone on a foreign machine cannot brute-force the vault.
- **Keyfile, not localStorage-resident key.** Vault creation generates a random
  256-bit key downloaded as `portunus.key` (JSON w/ format marker). Two modes:
  install into localStorage (per device) or load per-session via file picker.
  Provisioning a new device = copy the file. Revocation = rotate data key +
  reissue keyfile. A printable recovery encoding of the key is shown at creation.
- **Drive access via Next.js API routes** (server proxies with the OAuth token;
  refresh handled server-side). Chosen over direct browser→googleapis calls.
- **Crypto libs**: `hash-wasm` (Argon2id, OWASP params m=19 MiB, t=2, p=1) +
  `libsodium-wrappers` (XChaCha20-Poly1305 AEAD). NOT OpenPGP/RSA — asymmetric
  was incidental complexity in the old file.
- **No importer** for the old `portunus.html` vault — fresh start.
- **Auto-lock**: idle timer with a **visible countdown** in the UI (user request).
- **Interfaces end with `Interface` suffix** (e.g. `VaultEngineInterface`) —
  recorded in AGENTS.md.

## Vault envelope format (designed, not yet implemented)

```json
{
  "format": "portunus-vault", "version": 1,
  "engine": "argon2id-xchacha20",
  "kdf": { "algo": "argon2id", "salt": "…", "time": 2, "mem": 19456, "lanes": 1 },
  "wrappedDataKey": "…",
  "nonce": "…", "ciphertext": "…"
}
```

Engine-upgrade rules agreed in discussion:
- Unlock dispatches on `envelope.engine` → registry lookup → `unlock()` → data key.
- Save always uses the **latest/default** engine → silent upgrade on next save.
- KDF params stored per-file → params can be bumped without a new engine id.
- Engines are `deprecated` (unlock-only), **never deleted** — deleting bricks old vaults.
- Header fields must be bound as AEAD **AAD** (prevents engine/KDF downgrade attacks).
- On engine change, generate a **fresh data key** (free rotation).
- `format`/`version` (envelope schema) and `engine` (crypto) are independent axes.

## Phase status

- [x] **Phase 1 — DONE**: scaffold, Auth.js Google provider (drive.file scope,
  offline access, JWT sessions, server-side token refresh in `jwt` callback),
  landing page with sign-in/out, Dockerfile + compose + .env.example.
  Verified end-to-end: user signed in successfully through real Google OAuth.
- [x] **Phase 2 — DONE**: crypto core in `src/crypto/` (client-safe, no Node APIs):
  - `engines/interface.ts` — `VaultEngineInterface` (`initNew`, `unlock`,
    `encrypt`, `decrypt`); `registry.ts` — `getEngine(id)` for unlock dispatch,
    `defaultEngine()` (latest non-deprecated) for saves.
  - Engine v1 `argon2id-xchacha20`: KEK = Argon2id(len‖password‖keyfile),
    m=19 MiB/t=2/p=1 (per-file params, sanity-capped on read), XChaCha20-Poly1305.
    `wrappedDataKey` = b64(wrapNonce‖ct); wrap AAD = {format,version,engine,kdf};
    vault-ciphertext AAD = full header (incl. wrappedDataKey).
  - `keyfile.ts`: generate/serialize/parse (`portunus.key` JSON w/ `kid`
    = 8-byte SHA-256 fingerprint), install/load/uninstall via localStorage,
    `downloadKeyfile`. `recovery.ts`: Crockford Base32 groups-of-4
    encode/decode of the 32-byte keyfile key (padding-checked).
  - `envelope.ts` (`parseEnvelope`/`serializeEnvelope`/`headerOf`),
    `errors.ts` (VaultUnlockError etc.), `aad.ts`, `base64.ts` (urlsafe-nopad).
  - Verified via throwaway esbuild-bundle + node smoke test (16 checks:
    round-trips, wrong password/keyfile, tampered kdf/ciphertext/wrap).
    NOTE: libsodium-wrappers bundling under Turbopack is unverified — it only
    enters a bundle once Phase 3/4 UI imports it.
- [ ] **Phase 3**: Drive layer — `GET /api/vault` (find `portunus.vault.json` by
  name, download), `PUT /api/vault` (create/update, multipart upload); token
  refresh already in place. Client-side vault store: load→decrypt→edit→save,
  dirty tracking.
- [ ] **Phase 4**: vault UI state machine — install keyfile → create vault
  (master password + keyfile download + recovery display) → unlock → list/edit
  entries (search, copy, password generator, notes) → save (re-prompt password,
  encrypt, upload). Auto-lock countdown + unsaved-changes guard.
- [ ] **Phase 5**: provisioning/recovery — re-export keyfile behind password
  re-entry, printable recovery key, "uninstall key" button.
- [ ] **Phase 6**: Portunus theme — deep navy + bronze (palette already in
  globals.css), gate/keyhole unlock animation via Framer Motion, harbor ambience.
- [ ] **Phase 7**: hardening — security headers/CSP. (Engine round-trip tests
  already done in Phase 2: `vitest` + `src/crypto/*.test.ts`, 44 tests —
  run `npm test`. vitest 4.1.11 pinned: 5.x requires @types/node>=22 and
  latest was published same-day.)

## Environment / ops notes

- Runs in **WSL2** (Ubuntu), repo on `/mnt/d/Coding/portunus`. Node v24 lives at
  `~/.local/bin` (not on default PATH — prefix commands with
  `export PATH="$HOME/.local/bin:$PATH"`). Docker via `docker.exe` (Desktop).
- Dev server: `npm run dev`. `watchOptions.pollIntervalMs: 1000` is set in
  `next.config.ts` because native file events don't cross the /mnt boundary —
  without it, edits are silently not picked up. First compile after restart is
  slow (~10s+).
- **Accessing from Windows browser**: `localhost:3000` forwarding is flaky —
  use `http://<WSL-IP>:3000` (get IP via `hostname -I`; was 172.18.113.116) or
  the Devin browser-preview URL.
- `.env.local` (gitignored) contains real `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`,
  generated `AUTH_SECRET`, `AUTH_URL=http://localhost:3000`. `.env.example`
  documents them for other self-hosters.
- Google OAuth gotchas hit already: consent screen was in Testing → added the
  account as test user. Recommend publishing the consent screen to Production
  to avoid the 7-day refresh-token expiry (drive.file doesn't need verification).
- next-auth is `5.0.0-beta.32` (v5 beta — correct choice for App Router).
  JWT type augmentation targets `@auth/core/jwt` (see `src/types/next-auth.d.ts`).
- `cacheComponents` is enabled: server components that read session need
  `await connection()` + a `<Suspense>` boundary (see `src/app/page.tsx`).
  `export const dynamic` is NOT allowed under cacheComponents.
- Session uses JWT strategy — no DB. OAuth tokens live in the JWT cookie;
  `session.error` surfaces refresh failures to the UI.
- `npm audit` shows 5 dev-only vulns (braces/micromatch via eslint chain) —
  accepted, not runtime-relevant.
- User clicked through the full sign-in flow on 2026-10-15: confirmed working.
- User commits code themselves when they want to — don't auto-commit.
