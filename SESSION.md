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
- [x] **Phase 3 — DONE**: Drive layer + client vault store.
  - `src/lib/drive.ts` — Drive API client (find by name, `alt=media` download,
    multipart create, media PATCH update, `getFileMeta`). NOTE: Drive v3 has
    NO `etag` field — requesting it in `fields` → 400 "Invalid field
    selection" (caused the first live 502). Concurrency is
    modifiedTime read-compare-write (small race window; single-user vault).
  - `src/app/api/vault/route.ts` — `GET` (404 `vault_not_found` when absent),
    `PUT` ({fileId?, contents, baseModifiedTime?}; server compares
    baseModifiedTime vs `getFileMeta` → 409 `conflict`, 404 `file_gone`,
    401 auth/`drive_auth`, 502 other upstream — logs status+body to console).
    Server never parses vault contents.
  - `src/auth.ts` `getAccessToken(req)` — server-only token via `getToken`
    (next-auth/jwt, salt = `authjs.session-token` / `__Secure-` by AUTH_URL
    scheme); self-refreshes since jwt-callback refresh doesn't apply mid-request.
  - `src/lib/vault-session.ts` — `VaultSession`: `unlock`/`create`/`update`/
    `save`/`verifySecrets`/`lock`, `dirty` tracking, `needsEngineUpgrade`
    (re-wraps with fresh data key under default engine on save).
  - Engine change: `unlock()` accepts a `VaultHeader` — powers password
    re-verification via `headerOf(env)` before saves.
  - Tests: 60 total — `drive.test.ts` (fetch-stubbed Drive calls),
    `vault-session.test.ts` (in-memory /api/vault; create→unlock→save→conflict).
- [x] **Phase 4 — DONE**: vault UI state machine (`src/components/`).
  - `vault-app.tsx` — loading → `create` (no remote vault) | `unlock` |
    `open`. Holds keyfile (installed flag distinguishes localStorage vs
    file-picker source).
  - `vault-create.tsx` — password+confirm → generate keyfile → recovery code
    (Crockford Base32) + mandatory download + ack checkbox → `VaultSession.create`.
  - `vault-unlock.tsx` — password + keyfile (installed or file picker);
    optional install-to-browser after picker unlock.
  - `vault-open.tsx` — header (Synced/Unsaved badge, `locks in m:ss`
    countdown, Save, Lock), save modal re-prompts password
    (`session.verifyPassword`), auto-lock after 5 min idle — paused while
    dirty. 409 conflict → "lock and unlock to reload" message.
  - `vault-editor.tsx` — entries: search, expand-to-edit (name, username,
    password w/ generate+show, url, notes), copy-to-clipboard, delete confirm.
  - `src/lib/vault-doc.ts` — `portunus-vault-data` v1 payload schema;
    `src/lib/password-gen.ts` — unbiased generator (rejection sampling).
  - `VaultSession` now holds the keyfile for `verifyPassword`; `lock()`
    zeroes dataKey/plaintext/keyfile. NOTE: callers' buffers are copied on
    entry (lock() must not wipe caller-owned arrays).
  - NOT YET browser-verified: libsodium wasm under Turbopack at runtime is
    the big open question — if unlock hangs/errors client-side, try
    `libsodium-wrappers-sumo` or a turbopack wasm rule.
- [x] **Phase 5 — DONE**: provisioning/recovery.
  - `VaultSession.changePassword(newPw)` — fresh data key + new Argon2id wrap
    (new password ‖ same keyfile), re-encrypt, upload. Old data key zeroed.
  - `VaultSession.exportKeyfile()` — `keyfileFromKey` rebuilds Keyfile+kid
    from held bytes.
  - `vault-security.tsx` — "Security" button in open header → modal with
    password change (current+new+confirm) and keyfile export (password →
    download .key + recovery code display/copy).
  - Unlock screen: "Remove key from this browser" (installed keys) and
    "Restore from recovery code instead" (rebuilds keyfile from the code).
  - Email field added to entries; search covers notes too.
- [~] **Phase 6 — PARTIAL**: `PortunusEmblem` SVG on landing — breathing
  keyhole glow + slow harbor-beacon sweep (pure CSS, reduced-motion aware).
  Still open: gate/keyhole unlock animation, harbor ambience, mobile pass.
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
