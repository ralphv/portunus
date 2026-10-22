# Security Policy

Portunus is a zero-knowledge secrets manager, so security reports are the
most important issues we receive. Thank you for helping keep it safe.

## Reporting a vulnerability

**Please do not open a public issue, discussion, or PR for security problems.**

- Preferred: [GitHub private vulnerability reporting](https://github.com/ralphv/portunus/security/advisories/new)
  (Security tab → "Report a vulnerability").

Include the affected version (footer of the UI or image tag),
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

The runtime script self-check (below) does not change this: it is
tamper-evidence for page-level / supply-chain injection, not a defense
against extensions, and a report that an extension can evade it is out of
scope. A way for *page-level* script (e.g. a malicious dependency) to run
despite the CSP is in scope.

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
envelope = JSON {format, version, engine, kdf, wrappedDataKey, nonce, ciphertext, website}
```

`website` is a plaintext pointer back to this repo (so a Drive preview shows
what wrote the file). It is rewritten on every save, deliberately **not**
bound as AAD, and never used for any decision — treat it as untrusted.

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

- Vault plaintext — entries (usernames, passwords, notes, URLs, labels),
  password history, TOTP secrets, and per-vault settings all live inside the
  encrypted document
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
| Have I Been Pwned (`api.pwnedpasswords.com`) | The first 5 hex chars of a password's SHA-1 hash (k-anonymity), requested **directly from the browser** with `credentials: "omit"` and `Add-Padding` | The password, the full hash, or which entry it belongs to |

- The `drive.file` scope limits the app to files it created itself; it cannot
  read the rest of your Drive.
- Breach checks run from the menu's audit and, unless disabled by the user's
  vault setting or `PORTUNUS_HIBP_ON_EDIT=0`, automatically when a password
  is edited. They never go through the Portunus server.
- TOTP QR setup images are decoded locally in the browser (`qr-scanner`);
  nothing is uploaded.
- The browser's `localStorage` may hold the installed keyfile (per-device,
  opt-in) and a cached copy of the ciphertext envelope for offline use.
- **Secrets in the page.** Vault passwords are rendered on demand
  (`src/components/secret-input.tsx`): a hidden field is a fixed-length mask
  with no element holding the value, and a revealed/edited one unmounts again
  on blur, tab hide, or 30s idle. Secret inputs set only the live `.value`
  property via a ref — React's controlled inputs also write the HTML `value`
  attribute, which exposes plaintext to DOM snapshots (outerHTML, session
  replay, "save page") and to CSS attribute-selector exfiltration. This does
  **not** hide secrets from script running in the page: the decrypted vault
  is in main-thread memory while unlocked, and any such script can read it.
  Keeping that script out is the CSP's job.
- **You must trust the code your browser runs.** A malicious or compromised
  server operator could serve modified JavaScript that exfiltrates secrets at
  unlock time; zero-knowledge storage does not protect against that. Self-host
  from a release you have verified (images are signed with cosign), and serve
  over HTTPS.

### Script injection: CSP first, self-check second

1. **Strict Content-Security-Policy (primary, browser-enforced).**
   `src/middleware.ts` sends, on every response:
   `script-src 'self' 'wasm-unsafe-eval' 'nonce-<per-request>' 'sha256-…'`,
   `worker-src 'self' blob:`, `object-src 'none'`, `base-uri 'none'`,
   `frame-ancestors 'none'` (`src/lib/csp.ts`). The hashes cover the inline
   scripts in the build's prerendered HTML — the theme and recorder init
   scripts in `src/app/layout.tsx` and Next.js/React's static-shell
   bootstrap — and the nonce covers scripts Next.js streams during a dynamic
   render. No `'unsafe-inline'` or `'unsafe-eval'` in production.
   `'wasm-unsafe-eval'` is needed for the Argon2id/libsodium WebAssembly;
   `blob:` workers for the local QR decoder. Only the dev server falls back
   to `'unsafe-inline' 'unsafe-eval'`. A plain `next build` is refused
   (`next.config.ts`), and a production server missing the generated hashes
   fails closed (nonce only, prerendered inline scripts blocked) and logs a
   warning.
2. **Build-time allowlist.** `npm run build` runs
   `scripts/script-integrity.mjs`, which builds once, SHA-256-hashes every
   emitted `/_next/static/**/*.js` chunk and every inline script in the
   prerendered HTML into `src/generated/script-integrity.ts`, builds again
   (same build id) so the proxy and `/api/script-integrity` embed it, and
   fails if the client output changed between the passes. The file is
   gitignored: chunk names are content-hashed and change every build.
3. **Runtime self-check (secondary, best-effort tamper-evidence).** An inline
   `<head>` recorder starts one persistent `MutationObserver` before the rest
   of the page parses; `src/components/script-integrity-check.tsx` then
   checks the initial `<script>` snapshot and every script added later
   against the allowlist (same-origin chunk path, inline-script hash, or the
   page's nonce), re-hashes allowlisted chunks to catch modified files, and
   shows a non-blocking "Unexpected script detected; verify your
   deployment/extensions" banner. It never removes nodes or blocks
   execution — the CSP does the blocking.

What the self-check is **not**:

- **Not a defense against browser extensions.** Content scripts run in an
  isolated world and need no `<script>` tag; an extension can also run before
  the check or patch `MutationObserver`, `querySelectorAll`, `fetch`, or
  `crypto.subtle` to blind it. Malicious extensions remain out of scope.
- **Not proof of a trustworthy server.** The allowlist comes from the same
  server as the page: a malicious build or operator can ship a matching
  allowlist. It detects drift from *this build* (injected tags, swapped or
  modified chunk files, a proxy rewriting responses), nothing more.
- Scripts inside shadow roots, `javascript:` URLs, event-handler attributes,
  and code already loaded before the recorder are not covered (the CSP still
  blocks the inline forms).

## What to audit

Start here — these files carry the security-relevant logic.

| File | What it does | Invariants to check |
|---|---|---|
| `src/crypto/engines/argon2id-xchacha20.ts` | v1 engine: Argon2id KEK derivation, data-key wrap/unwrap, vault encrypt/decrypt | Header fields bound as AAD (wrap AAD = kdf header, vault AAD = full header incl. `wrappedDataKey`); fresh random nonces per wrap/save; KDF params from the envelope are bounds-checked before use (DoS caps); length-prefixed `password ‖ keyfile` KDF input; KEK zeroed after use; wrong secrets → `VaultUnlockError`, tampering → `VaultDecryptError` |
| `src/crypto/engines/interface.ts` | `VaultEngineInterface` contract | Deprecated engines stay unlock/decrypt-only |
| `src/crypto/registry.ts`, `src/crypto/envelope.ts` | Engine lookup by envelope id; envelope parse/serialize (adds the plaintext `website` field), `headerOf` | Unknown engines rejected; `headerOf` strips only `nonce`/`ciphertext`; nothing outside the AAD-bound fields (e.g. `website`) influences decryption |
| `src/crypto/aad.ts` | Canonical (sorted-key) JSON encoding for AAD | Encoding is deterministic and independent of key order |
| `src/crypto/base64.ts` | URL-safe base64 without padding | Exact round-trip; no Node-only APIs |
| `src/crypto/keyfile.ts` | Keyfile generation (32 random bytes), parsing, `kid` fingerprint, localStorage install | Key length enforced; `kid` must match key; uses `crypto.getRandomValues` |
| `src/crypto/types.ts` | Envelope/header/secrets types, format + version constants | Format/version checked on parse |
| `src/lib/vault-doc.ts` | Plaintext vault document schema (entries, password history, TOTP secrets, settings) and normalization — client-side only | Only ever serialized into the encrypted payload; malformed fields normalize to safe defaults |
| `src/lib/pwned-passwords.ts` | HIBP range-API client (k-anonymity) | Only the 5-char SHA-1 prefix is sent; suffix matched locally; `credentials: "omit"`; padded responses |
| `src/lib/totp.ts` | RFC 6238 TOTP code generation from `otpauth://` URIs | Runs client-side only; secrets never logged or sent anywhere |
| `src/lib/store/providers/google-drive-store-provider.ts` | Server-side Drive v3 client (find/download/create/update vault file) | Treats contents as an opaque string; only touches the `drive.file`-scoped vault file and app folder |
| `src/app/api/vault/route.ts` | `/api/vault` GET/PUT proxy | **Never parses vault contents**; requires a session; size limit (`MAX_VAULT_BYTES`); optimistic concurrency via `modifiedTime` (409 on conflict) |
| `src/auth.ts` | Auth.js config, Google OAuth, token refresh, server-side access-token lookup | Requested scope is `drive.file` only; `access_token`/`refresh_token` stay in the JWT and never enter the client session object |
| `src/lib/store/factory.ts`, `src/lib/demo-mode.ts` | Picks Drive vs. in-memory store; demo mode | Demo mode only when `PORTUNUS_DEMO_MODE=1` explicitly |
| `src/middleware.ts`, `src/lib/csp.ts` | Strict CSP header + per-request nonce | No `'unsafe-inline'`/`'unsafe-eval'` in production; fresh 128-bit nonce per request; hashes come only from the generated build manifest |
| `scripts/script-integrity.mjs` | Build-time script allowlist (`src/generated/script-integrity.ts`) | Hashes every emitted chunk and prerendered inline script; fails the build if the two passes' client output differs |
| `src/lib/script-integrity.ts`, `src/components/script-integrity-check.tsx`, `src/app/api/script-integrity/route.ts` | Best-effort runtime script self-check (tamper-evidence only) | Warns, never blocks/removes; no false positives on a clean build; documented as not covering extensions |
| `src/components/secret-input.tsx` | On-demand secret rendering (`SecretField`) and attribute-free secret inputs (`PropertyValueInput`) | No secret in an HTML `value` attribute or SSR markup; hidden fields mount no input; re-mask on blur / tab hide / idle |
| `Dockerfile` | Multi-stage Next.js standalone image | Runs as non-root `portunus` user; no secrets baked in; `.env*` / `*.key` excluded via `.dockerignore` |
