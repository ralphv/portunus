# portunus

Self-hosted, zero-knowledge secrets manager backed by Google Drive.
Next.js (App Router, TypeScript, Tailwind) — one Docker image, no database.

Secrets are encrypted **client-side** with Argon2id + XChaCha20-Poly1305 and
stored as a single file (`portunus.vault.json`) in your Google Drive. The
server never sees plaintext or your master password. `portunus.html` in this
repo is the legacy single-file version, kept for reference.

## Setup

1. **Create a Google OAuth client** (each self-hoster needs their own):
   - Google Cloud Console → create a project → enable the **Google Drive API**
   - APIs & Services → OAuth consent screen → configure (External is fine for
     personal use; add yourself as a test user)
   - Credentials → Create OAuth client ID → **Web application**
   - Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
     (or `https://your-domain/api/auth/callback/google`)
   - The app requests only the `drive.file` scope — it can see just the files
     it created.

2. **Configure environment** — copy `.env.example` to `.env.local`:

   ```
   AUTH_GOOGLE_ID=...        # OAuth client id
   AUTH_GOOGLE_SECRET=...    # OAuth client secret
   AUTH_SECRET=...           # openssl rand -hex 32
   AUTH_URL=http://localhost:3000
   ```

3. **Run**

   ```bash
   # local dev
   npm install
   npm run dev

   # or Docker
   docker compose up --build
   ```

## Roadmap

- [x] Phase 1 — scaffold, Google sign-in (Drive scope), Docker
- [ ] Phase 2 — client-side crypto core (pluggable engines, keyfile)
- [ ] Phase 3 — Drive vault read/write via API routes
- [ ] Phase 4 — vault UI (entries, search, save flow, auto-lock countdown)
- [ ] Phase 5 — keyfile provisioning & recovery
- [ ] Phase 6 — Portunus theme + animations
- [ ] Phase 7 — hardening & tests
