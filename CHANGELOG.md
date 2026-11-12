# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Press `.` to search** — while no entry is open, pressing `.` anywhere
  outside a text field or dialog focuses the entry search box; the box says
  "Search entries (press . to focus)…" until it has focus.
- **No duplicate email quick-copy** — a collapsed entry whose email is the
  same as its username shows only the `user` copy button, not `email` too.

### Fixed

- **Show/hide eye on every password field** — the save confirmation, the
  create-vault form, and the Security dialog (change master password, keyfile
  export, two-factor set-up and disable) now have the same reveal button as
  the unlock form.
- **Stale app code after an upgrade** — the offline service worker served
  cached scripts across deploys, so the page could run against an older vault
  Worker (e.g. "Disabling two-factor failed" from
  `Unknown vault method "saveTotp"`). Each build now adds its build id to
  static asset URLs (`?dpl=`, Next's `deploymentId`), including the vault
  Worker and its chunks, and the service worker keeps one cache per build:
  a new build carries over its own cached files and a fresh page, then drops
  the old cache, so the app still loads offline right after an upgrade.

### Added

- **Service name autocomplete** — typing a new entry's name suggests the
  matching service from the bundled brand icons as ghost text ("Net" →
  "Netflix"); Tab (or clicking it) takes it. Touch screens, which have no
  Tab key, get the browser's own suggestion list of service names
  instead. Taking a suggestion, or leaving
  the field with a known service's name, also fills the URL (e.g.
  `https://netflix.com`) when it's empty.
- **On-screen keyboard on the unlock form** — a keyboard icon next to the
  master password's eye opens a grid of keys (letters/digits, Shift, a
  symbols page, Space, Backspace, Done; letters also follow the physical
  Shift and Caps Lock, and keys edit at the caret) shuffled with
  `crypto.getRandomValues` each time it opens or on "Shuffle". Keys type
  into the existing field (no second copy of the password, no `value`
  attribute), never take focus, and the phone's own keyboard stays hidden
  while it's open (`inputmode="none"`). Whether it's open is remembered per
  device (`localStorage["portunus.onscreen-keyboard"]`). It stops
  keystroke loggers, not screen recorders or malware reading the page.

- **Schema validation of server-side input** — the server checks everything
  it receives from outside against a Zod schema (`src/lib/schemas/`) through
  one validator (`src/lib/schema-validator/`): the `PUT /api/vault` and
  `POST /api/vault/unlock` bodies, Google Drive responses, Google's OAuth
  token response, and the signed vault wrapper read back from Drive. The
  request bodies are strict: unknown fields are now refused with
  `400 bad_request` instead of ignored. Google's responses and the stored
  wrapper allow unknown fields. A Drive response of the wrong shape becomes a
  `502 drive_error`, and a token response without a valid `expires_in` is a
  failed refresh (previously it gave an expiry of `NaN`). Validation errors
  name paths and issue codes only, never payload values.

- **Show/hide master password** — an eye button inside the unlock form's
  password field reveals or masks what was typed. It stays out of the Tab
  order, and the value still never lands in the HTML `value` attribute.

- **Entry list sorting** — a selector next to the search box orders the list
  by vault order (default), name A–Z / Z–A, oldest / newest first, or
  oldest / newest password. Purely a display
  preference: the vault document's entry order is untouched, and the choice
  is remembered per device in localStorage. Entries keep their position
  while being edited and move only once saved.

- **Two-factor vault delivery** — optional: Security → "Enable two-factor
  authentication" (password re-entry, QR code + manual key, confirm a code)
  makes the server require an authenticator code before serving the vault;
  the unlock screen asks for it. The TOTP secret is stored in the signed
  Drive wrapper (`{ payload, totp, signature }`, signature covering both),
  server-visible and outside the encrypted document. Gates `/api/vault`
  only — direct Drive access still yields offline-decryptable ciphertext.
  "Disable 2FA" removes it.

- **Tamper-detected vault file** — the server signs the stored envelope with
  Ed25519 (`PORTUNUS_SIGNING_PRIVATE_KEY`) on every save and refuses to serve
  a Drive file whose signature is missing or invalid; the app shows "vault
  signature invalid — the file may have been tampered with" and won't unlock.
  `PORTUNUS_ALLOW_MISSING_SIGNATURE=1` admits legacy unsigned vaults while
  they migrate on their next save; `PORTUNUS_SIGNATURES_DISABLED=1` turns
  the feature off. **Upgrading:** the server now refuses to start without
  `PORTUNUS_SIGNING_PRIVATE_KEY` unless signatures are disabled — see the
  README's "Vault signatures" for key generation and the rollout steps.

- **Vault isolated in a Web Worker** — the data key, keyfile bytes and the
  decrypted vault (passwords, history, TOTP seeds) live in a dedicated
  Worker; the UI holds a redacted copy and requests a secret only to reveal,
  edit or copy it. Strength scoring, breach checks and TOTP codes run in the
  Worker, and locking terminates it. Encryption (XChaCha20-Poly1305) and the
  vault format are unchanged.
- **Secrets rendered on demand** — entry and previous passwords show as a
  fixed-length mask until revealed/edited and re-mask on blur, tab hide, or
  30s idle; secret inputs never write the plaintext into the HTML `value`
  attribute.
- **Zero-knowledge vault** — all encryption happens in the browser with
  Argon2id (OWASP params: 19 MiB, t=2, p=1) + XChaCha20-Poly1305; the server
  only ever handles ciphertext. Header fields are bound as AEAD additional
  data, and the pluggable engine envelope allows future engine upgrades.
- **Password + keyfile unlock** — `KEK = Argon2id(password ‖ keyfile)`; both
  are required. Per-device keyfile install (or per-session file picker) and a
  Crockford-Base32 recovery code at vault creation.
- **Google Drive storage** — the vault is a single `portunus.vault.json` in a
  `Portunus Application` folder, accessed with the `drive.file` scope only;
  optimistic concurrency detects conflicting writes.
- **Password manager UX** — multi-term search, labels with one-click
  filters, quick-copy, entry editor (username / email / password / URL /
  notes; an email-address username fills an empty email field), password
  generator, a "duplicate?" warning for new entries matching an existing
  name + username/email, and original/light/dark themes.
- **Entry metadata & password history** — created/updated timestamps,
  update count, and the last 5 previous passwords per entry.
- **Have I Been Pwned checks** — k-anonymity breach audit from the menu plus
  an optional check on password edits (`PORTUNUS_HIBP_ON_EDIT=0` disables
  it instance-wide); breached entries are labeled `pwned`.
- **Password strength meter** — zxcvbn score and crack-time estimate.
- **Two-factor codes (TOTP)** — per-entry secrets from a pasted secret,
  `otpauth://` URI, or a locally decoded QR image; live codes with countdown.
- **Synced settings** — per-vault preferences (on-edit breach check,
  browser password fill/save, Focus mode) stored inside the encrypted
  document.
- **Focus mode setting** — Settings toggle (`focusEdit`, on by default) to
  hide the rest of the entry list while one entry is open for edit/add.
- **Offline mode** — read-only unlock from a cached ciphertext copy.
- **Auto-lock** — idle timer with a visible countdown, paused while there are
  unsaved changes.
- **Save protection** — re-enter the master password to save.
- **Demo mode** (`PORTUNUS_DEMO_MODE=1`) — stubbed sign-in and an in-memory
  vault for trying the UI without Google OAuth.
- **Docker image** — Next.js standalone build running as non-root, published
  to `ghcr.io/ralphv/portunus` (multi-arch `linux/amd64` + `linux/arm64`,
  cosign-signed), optionally mirrored to Docker Hub.
- **Strict Content-Security-Policy** — nonce + build-time inline-script
  hashes (`script-src 'self'`, no `'unsafe-inline'`), `object-src 'none'`,
  `base-uri 'none'`, `frame-ancestors 'none'`.
- **Best-effort script tamper-evidence** — `npm run build` generates a
  SHA-256 allowlist of the emitted scripts; a `MutationObserver`-backed
  runtime check shows a non-blocking banner for unexpected or modified
  scripts. Detects page-level / supply-chain injection only, not browser
  extensions.
- Project docs: `SECURITY.md` (disclosure policy + threat model),
  `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue templates.
- **Docs site** — VitePress site in `docs/` (install, Google OAuth setup,
  HTTPS via reverse proxy / Cloudflare Tunnel / Tailscale, configuration,
  security model, FAQ, running demo mode locally), built on PRs and deployed to GitHub Pages
  from `main` by `.github/workflows/docs.yml`.

### Security

- **Generic unlock error on two-factor vaults** — a wrong two-factor code
  and a wrong password (or keyfile) now show the same message, "Wrong
  password, keyfile or two-factor code", so the unlock form no longer tells
  which one was wrong. Every attempt re-checks a fresh code.

### Fixed

- **Two-factor field kept after a wrong password** — the "Two-factor code"
  field no longer disappears when the password is wrong; the spent code is
  cleared for a new one.
- **`DISABLE_OFFLINE_MODE` now works** — the flag was read in browser code,
  where non-`NEXT_PUBLIC_` env vars are always undefined, so the encrypted
  vault was cached in localStorage regardless. The server now reads it and
  passes it to the app; when set, nothing is cached, an existing cached copy
  is wiped, and offline unlock is off.
- **A second vault can no longer shadow the first** — creating a vault when
  one already exists is refused (`409 vault_exists`). Previously a create
  without a 2FA code made a new, newer vault file that the app then opened
  instead of the real one. The create screen also no longer replaces this
  device's installed keyfile until the new vault actually exists.
- **Google token refresh runs once per token lifetime** — after the access
  token expired, every API request refreshed it (up to twice); refreshes are
  now cached until near expiry and shared by concurrent requests. A failed
  refresh is reported as such instead of passing the expired token to Drive.
- **Saving a vault written by an older crypto engine** — the save now
  re-wraps it under the current engine using the password the save dialog
  verifies, instead of failing; a wrong password is rejected before
  anything is written.

- **Smoother unlock with large vaults** — the background password-strength
  pass no longer ties up the vault Worker: it yields between passwords (and
  scores the open entry first), so copy, reveal, 2FA codes and save respond
  right away instead of waiting seconds behind the whole vault. Live 2FA
  codes share one per-second timer, and the auto-lock countdown no longer
  re-renders the entry list every second.
- **Mobile entry toolbar** — on small screens the search box gets its own
  row and the sort selector shares the next one with "+ Add", instead of the
  full-width selector squeezing the search box.
- **Pasting 2FA codes** — the enable-2FA confirm, unlock and save
  two-factor fields now keep only digits, so pasted codes like "123 456",
  " 123456 " or "123-456" work instead of being truncated and rejected.
- **Two-factor asked on every unlock** — unlocking a 2FA vault now always
  needs a fresh code. Before, a lock right after a 2FA unlock could leave the
  grant cookie behind, so later unlocks (and reloads within 12 h) skipped
  the code. The code now buys a single-use delivery grant; saves use a
  separate session grant.

[Unreleased]: https://github.com/ralphv/portunus/compare/v0.8.8...HEAD
