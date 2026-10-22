# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
  browser password fill/save) stored inside the encrypted document.
- **Offline mode** — read-only unlock from a cached ciphertext copy.
- **Auto-lock** — idle timer with a visible countdown, paused while there are
  unsaved changes.
- **Save protection** — re-enter the master password to save.
- **Demo mode** (`PORTUNUS_DEMO_MODE=1`) — stubbed sign-in and an in-memory
  vault for trying the UI without Google OAuth.
- **Docker image** — Next.js standalone build running as non-root, published
  to `ghcr.io/ralphv/portunus` (multi-arch `linux/amd64` + `linux/arm64`,
  cosign-signed), optionally mirrored to Docker Hub.
- Project docs: `SECURITY.md` (disclosure policy + threat model),
  `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue templates.

[Unreleased]: https://github.com/ralphv/portunus/compare/v0.8.8...HEAD
