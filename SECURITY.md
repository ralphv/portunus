# Security Policy

Portunus is a zero-knowledge secrets manager, so security reports are the
most important issues we receive. Thank you for helping keep it safe.

## Reporting a vulnerability

**Please do not open a public issue, discussion, or PR for security problems.**

- Preferred: [GitHub private vulnerability reporting](https://github.com/ralphv/portunus/security/advisories/new)
  (Security tab → "Report a vulnerability").
- Alternative: email the maintainer at ralphv.online@gmail.com with
  `[portunus security]` in the subject.

Include the affected version (footer of the UI, `package.json`, or image tag),
your deployment type (Docker image / built from source / demo mode), steps to
reproduce, and the impact you expect. **Never include real vault files,
keyfiles (`portunus.key`), recovery codes, or master passwords** — craft a
throwaway vault instead.

### What to expect

- Acknowledgement within **7 days**, and an initial assessment (accepted /
  needs info / out of scope) within **14 days**.
- For accepted reports: a fix on `main` and a patched release + Docker image,
  with a GitHub Security Advisory crediting you (unless you prefer otherwise).
- Please give us a reasonable window (90 days by default) to ship a fix
  before public disclosure.

This is a volunteer-maintained project; there is no bug bounty.

### Scope

In scope: anything that lets the server, Google Drive, a network attacker, or
another user learn vault plaintext, the master password, the keyfile, or the
data key; bypass or weaken the password + keyfile requirement; tamper with a
vault without detection; or hijack a session / OAuth tokens.

Out of scope: attacks requiring a fully compromised client device or browser
(malware, malicious extensions), a malicious build of Portunus, social
engineering, denial of service against your own instance, and **demo mode**
(`PORTUNUS_DEMO_MODE=1`), which is intentionally unauthenticated and must not
hold real secrets.

### Supported versions

Only the latest release (and `main`) receives security fixes.

## Threat model

### Zero-knowledge design

All encryption and decryption happens **in the browser**
(`src/crypto/engines/argon2id-xchacha20.ts`, engine id `argon2id-xchacha20`):

```
KEK      = Argon2id(len(password) ‖ password ‖ keyfile_bytes, salt)   # m=19 MiB, t=2, p=1
dataKey  = random 256-bit key
wrapped  = XChaCha20-Poly1305(KEK,     dataKey,  AAD = {format, version, engine, kdf})
vault    = XChaCha20-Poly1305(dataKey, plaintext, AAD = {format, version, engine, kdf, wrappedDataKey})
envelope = JSON {format, version, engine, kdf, wrappedDataKey, nonce, ciphertext}
```

Unlock requires **both** the master password and the 32-byte keyfile
(`portunus.key`, or its recovery code). Header fields are bound as AEAD
additional data, so tampering with KDF params, the engine id, or the wrapped
key fails decryption. Fresh random nonces are used for every wrap and save.

### What the server sees

- Google OAuth tokens (access + refresh), held in the encrypted Auth.js JWT
  session cookie (`src/auth.ts`); used only server-side to call Drive.
- The **opaque ciphertext envelope** passed through `/api/vault`
  (`src/app/api/vault/route.ts`) — it is size-checked but never parsed.
- Drive file metadata: file id, `modifiedTime`, parent folder ids
  (`src/lib/store/providers/google-drive-store-provider.ts`).
- Your Google account email/name (for the session), request paths and client
  IPs (request log in `src/middleware.ts`).

### What the server never sees

- Vault plaintext (entries, usernames, passwords, notes, URLs)
- The master password
- The keyfile or recovery code
- The KEK or the data key

### Trust boundaries

| Component | Trusted with | Not trusted with |
|---|---|---|
| Browser (client) | Everything — it is the only place plaintext and keys exist | — |
| Portunus server | OAuth tokens, ciphertext in transit, file metadata | Plaintext, password, keyfile, keys |
| Google Drive | Storing the ciphertext envelope (`portunus.vault.json`) | Anything else — it only ever stores ciphertext |
| Google OAuth | Identity + `drive.file` scope grant | — |

- The `drive.file` scope limits the app to files it created itself; it cannot
  read the rest of your Drive.
- The browser's `localStorage` may hold the installed keyfile (per-device,
  opt-in) and a cached copy of the ciphertext envelope for offline use.
- **You must trust the code your browser runs.** A malicious or compromised
  server operator could serve modified JavaScript that exfiltrates secrets at
  unlock time; zero-knowledge storage does not protect against that. Self-host
  from a release you have verified (images are signed with cosign), and serve
  over HTTPS.

## What to audit

Start here — these files carry the security-relevant logic.

| File | What it does | Invariants to check |
|---|---|---|
| `src/crypto/engines/argon2id-xchacha20.ts` | v1 engine: Argon2id KEK derivation, data-key wrap/unwrap, vault encrypt/decrypt | Header fields bound as AAD (wrap AAD = kdf header, vault AAD = full header incl. `wrappedDataKey`); fresh random nonces per wrap/save; KDF params from the envelope are bounds-checked before use (DoS caps); length-prefixed `password ‖ keyfile` KDF input; KEK zeroed after use; wrong secrets → `VaultUnlockError`, tampering → `VaultDecryptError` |
| `src/crypto/engines/interface.ts` | `VaultEngineInterface` contract | Deprecated engines stay unlock/decrypt-only |
| `src/crypto/registry.ts`, `src/crypto/envelope.ts` | Engine lookup by envelope id; envelope parse/serialize, `headerOf` | Unknown engines rejected; `headerOf` strips only `nonce`/`ciphertext` |
| `src/crypto/aad.ts` | Canonical (sorted-key) JSON encoding for AAD | Encoding is deterministic and independent of key order |
| `src/crypto/base64.ts` | URL-safe base64 without padding | Exact round-trip; no Node-only APIs |
| `src/crypto/keyfile.ts` | Keyfile generation (32 random bytes), parsing, `kid` fingerprint, localStorage install | Key length enforced; `kid` must match key; uses `crypto.getRandomValues` |
| `src/crypto/types.ts` | Envelope/header/secrets types, format + version constants | Format/version checked on parse |
| `src/lib/store/providers/google-drive-store-provider.ts` | Server-side Drive v3 client (find/download/create/update vault file) | Treats contents as an opaque string; only touches the `drive.file`-scoped vault file and app folder |
| `src/app/api/vault/route.ts` | `/api/vault` GET/PUT proxy | **Never parses vault contents**; requires a session; size limit (`MAX_VAULT_BYTES`); optimistic concurrency via `modifiedTime` (409 on conflict) |
| `src/auth.ts` | Auth.js config, Google OAuth, token refresh, server-side access-token lookup | Requested scope is `drive.file` only; `access_token`/`refresh_token` stay in the JWT and never enter the client session object |
| `src/lib/store/factory.ts`, `src/lib/demo-mode.ts` | Picks Drive vs. in-memory store; demo mode | Demo mode only when `PORTUNUS_DEMO_MODE=1` explicitly |
| `Dockerfile` | Multi-stage Next.js standalone image | Runs as non-root `portunus` user; no secrets baked in; `.env*` / `*.key` excluded via `.dockerignore` |
