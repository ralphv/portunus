# Portunus

**Self-hosted, stateless, zero-knowledge secrets manager backed by your own Google Drive.**

Named after Portunus, the Roman god of keys, doors, and harbors.

Your secrets are encrypted **in your browser** — before anything touches the
network — and stored as a single file (`portunus.vault.json`) in your Google
Drive. The server brokers OAuth and proxies Drive calls; it never sees
plaintext, your master password, or your keyfile. No database, one stateless Docker
image.

![Portunus demo — sign in, create a vault, unlock with keyfile, add and copy entries](docs/screenshots/demo.gif)

## Try the demo (Docker)

Runs the full UI with a stubbed sign-in and an in-memory vault — no Google
OAuth, no Drive account, nothing else to configure:

```bash
docker run --rm -p 3000:3000 -e PORTUNUS_DEMO_MODE=1 ghcr.io/ralphv/portunus:latest
```

Then open `http://localhost:3000` and click "Sign in with Google". Each
browser gets its own isolated in-memory vault (a visitor cookie), lost when
the container restarts. **Demo
mode is for trying the UI; use it nowhere near real secrets.**

## Features

- **Zero-knowledge server** — Argon2id + XChaCha20-Poly1305, all client-side
- **Password *and* keyfile required** — `KEK = Argon2id(password ‖ keyfile)`.
  A leaked password alone can't brute-force the vault; neither can the
  keyfile alone.
- **Per-device keyfile** — install in the browser or load per-session;
  Crockford-Base32 recovery code at creation
- **Google Drive storage** — the vault lives in a `Portunus Application`
  folder in your Drive; the app only ever sees files it created
  (`drive.file` scope)
- **Password manager UX** — multi-term search, labels with one-click
  filters, quick-copy, entry editor (username / email / password / URL /
  notes; an email-address username fills an empty email field when you
  leave it), password generator, and a "duplicate?" warning when a new
  entry has the same name and username/email as an existing one
- **Entry metadata & password history** — per-entry created/updated
  timestamps, update count, and the last 5 previous passwords
- **Have I Been Pwned checks** — opt-in k-anonymity audit from the menu,
  plus an automatic check when you edit a password (toggleable in
  Settings); only the first 5 characters of the SHA-1 hash leave the
  browser, breached entries get a `pwned` label and highlight
- **Password strength meter** — zxcvbn scoring with crack-time estimate
  under every password field
- **Synced settings** — per-vault preferences stored inside the encrypted
  document, so they follow you across devices: the on-edit breach check
  and whether the browser/OS may offer to fill or save passwords
  (suppressed everywhere by default, including the unlock screen)
- **Offline mode** — the vault opens read-only from a cached ciphertext
  and recovers automatically when connectivity returns
- **Themes** — original navy plus light and dark variants, remembered
  per browser
- **Auto-lock** — visible countdown, pauses while you have unsaved changes;
  activity (mouse, keys, scroll) resets it
- **Save protection** — re-enter your master password to save; conflict
  detection on concurrent writes
- **Single Docker image** — Next.js standalone build, non-root, ~stateless

## Screenshots

| Vault creation — recovery code + keyfile download | Unlock — keyfile + password |
|---|---|
| ![Create vault](docs/screenshots/create-vault.png) | ![Unlock](docs/screenshots/unlock.png) |

| Unlocked vault — entry list & search | Expanded entry — edit fields |
|---|---|
| ![Entries](docs/screenshots/entries.png) | ![Entry editor](docs/screenshots/entry-edit.png) |

## Quick start (Docker Compose)

The fastest way to run Portunus is Docker Compose. Fill in the environment
values below (see [Configuration](#configuration)), then:

```yaml
# docker-compose.yml
services:
  portunus:
    image: ghcr.io/ralphv/portunus:latest
    ports:
      - "3000:3000"
    environment:
      AUTH_GOOGLE_ID: "your-google-client-id"
      AUTH_GOOGLE_SECRET: "your-google-client-secret"
      AUTH_SECRET: "generate-with-openssl-rand-hex-32"
      AUTH_URL: "http://localhost:3000"     # public origin when deployed
    restart: unless-stopped
```

> **Note:** if you keep this compose file inside a git repo, don't commit the
> real secret values — keep a placeholder version tracked, or use
> `env_file: .env` (gitignored) instead.

```bash
docker compose up -d
```

Then open `http://localhost:3000`.

### Building the image yourself

```bash
docker build -t portunus:latest .
# or: npm run docker:build
```

To run on a remote server, export and load:

```bash
docker save portunus:latest | gzip > portunus.tar.gz   # or: npm run docker:save
# copy to the server, then:
gunzip -c portunus.tar.gz | docker load
docker compose up -d                                  # compose file above, minus `build:`
```

## Configuration

Copy `.env.example` to `.env` (or `.env.local` for dev) and fill in:

| Variable | Required | Description |
|---|---|---|
| `AUTH_GOOGLE_ID` | yes | Google OAuth client ID |
| `AUTH_GOOGLE_SECRET` | yes | Google OAuth client secret |
| `AUTH_SECRET` | yes | Session encryption secret — `openssl rand -hex 32` |
| `AUTH_URL` | yes | Public origin, e.g. `https://vault.example.com` |
| `PORTUNUS_HIBP_ON_EDIT` | no | `0` disables the silent Have I Been Pwned re-check on password edits entirely — the Settings toggle for it is hidden (default: on) |

**The server refuses to start if any required variable is missing.**

`PORTUNUS_HIBP_ON_EDIT=0` stops the app from contacting
`api.pwnedpasswords.com` automatically whenever a password is edited. The
check is already k-anonymous — only the first 5 hex chars of the SHA-1
hash leave the client — but you may want it off when:

- Your policy forbids any third-party requests during secret handling
  (corporate/compliance environments, or you simply don't want an
  external service to see request timing/metadata from your users).
- The instance is meant for fully offline or air-gapped use.
- You prefer explicit consent — checks then only run from the menu's
  "Have I Been Pwned" audit, which stays available either way.

With `PORTUNUS_HIBP_ON_EDIT` on (default), each user can still turn the
on-edit check off for their own vault via the menu's **Settings** — the
preference is stored inside the encrypted vault document and syncs to
their other devices on save. Setting the variable to `0` hides that
toggle and disables the check no matter the saved preference.

### Google OAuth setup (required once, per self-hoster)

1. Google Cloud Console → create a project → enable the **Google Drive API**
2. APIs & Services → OAuth consent screen → configure (External is fine for
   personal use; add yourself as a test user)
3. Credentials → Create OAuth client ID → **Web application**
4. Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
   — plus `https://your-domain/api/auth/callback/google` when deployed
5. Copy the client ID/secret into your env file

The app requests only the `drive.file` scope — it can see just the files it
created, never the rest of your Drive.

## Deploying

- **`AUTH_URL` must match the public origin** — it drives OAuth callback
  URLs and cookie flags.
- **Serve it over HTTPS** (reverse proxy: Caddy, nginx, Traefik). The unlock
  flow uses WebCrypto, which browsers only allow in secure contexts — plain
  `http://` on a LAN will not work. The container itself speaks HTTP on
  port 3000; terminate TLS at the proxy.

## Security model

```
vault plaintext ──▶ XChaCha20-Poly1305 (random data key)
                        │
data key ──▶ wrapped by KEK = Argon2id(password ‖ keyfile_bytes)
                        │
envelope (ciphertext + wrapped key + kdf params) ──▶ Google Drive
```

- Argon2id parameters follow OWASP guidance (19 MiB, t=2, p=1)
- Header fields are bound as AEAD additional data — tampering with KDF
  params or the engine id fails decryption
- Per-save random nonces; envelope encryption allows engine rotation
- Unlock requires **both** the master password and the keyfile

> **Keep your `portunus.key` file and recovery code safe.** The keyfile is
> per-device — losing all copies *and* the recovery code means the vault is
> unrecoverable. There is no password reset; that's the point.

## Development

```bash
npm install
npm run dev          # dev server (needs .env.local)

npm test             # vitest — crypto, vault stores, vault session
npm run lint         # eslint
npm run build        # production build (standalone output)
```

### Demo mode

`PORTUNUS_DEMO_MODE=1 npm run dev` runs the full UI without Google OAuth or a
Drive account:

- "Sign in with Google" issues a stubbed session (`demo@portunus.local`) via
  a local credentials provider — no `AUTH_*` variables are required, and the
  startup env check is skipped.
- `/api/vault` uses `MemoryStoreProvider` (in-memory, per server process) instead of
  `GoogleDriveStoreProvider`; restart the server to start from an empty vault.
- Also honored in production builds — it's how the try-it-out Docker run works.

Vault storage is pluggable behind `StoreInterface` in `src/lib/store/`;
`factory.ts` picks the implementation, and `store-contract.test-helper.ts` is a
shared test suite every store runs.

### Recording the demo GIF and screenshots

```bash
npx playwright install chromium        # once
PORTUNUS_DEMO_MODE=1 npm run dev       # fresh server = empty vault
node scripts/record-demo.mjs           # BASE_URL defaults to http://localhost:3000
```

The script drives landing → sign-in → create vault → recovery code/keyfile →
unlock → add/search/copy entries in headless Chromium, writes the PNGs in
`docs/screenshots/`, and converts the video to `docs/screenshots/demo.gif`
with `ffmpeg` (must be on `PATH`).

Devin environment setup is committed in `.devin/blueprint.yaml`; update it
alongside any changes to these commands.

Stack: Next.js 16 (App Router), TypeScript strict, Tailwind v4, Auth.js v5,
`hash-wasm` (Argon2id), `libsodium-wrappers` (XChaCha20-Poly1305).

## Contributing

Issues and PRs welcome. Please don't post vault contents, keyfiles, or
recovery codes in issues — and never commit `*.key` or `.env*` files (both
are gitignored).

## License

[AGPL-3.0](LICENSE) — self-host it, fork it, but if you offer a modified
version as a hosted service you must share the source.
