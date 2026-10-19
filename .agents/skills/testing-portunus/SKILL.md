---
name: testing-portunus
description: Run Portunus locally and test the signed-in / unlocked vault UI end-to-end in the VM's Chrome. Covers dev-server secrets, Google login via stored secrets, and resetting the Drive vault to start fresh.
---

# Testing Portunus end-to-end

## Start the dev server

1. `source ~/.nvm/nvm.sh` (Node 24 comes from nvm on the VM and is not on PATH in fresh shells).
2. Run `npm ci` if `node_modules` is missing.
3. Run `npm run dev`, binding these Devin secrets as env vars (by reference, never written to files that get committed):
   - `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_SECRET`
   - `AUTH_URL`: keep it at `http://localhost:3000`. That localhost callback is registered on the Google OAuth client, and localhost counts as a secure context for WebCrypto.
4. Browse to `http://localhost:3000` in the VM's Chrome. Do not use a Devin preview URL; it needs a Devin login, and the user doesn't want Devin credentials on the VM.
5. `npm run dev` appends a `nextjs-agent-rules` block to `AGENTS.md`. Run `git checkout AGENTS.md` before committing.

## Sign in to Google

Click "Sign in with Google" and type the stored secrets into Google's login form:

- Email: `${secret:personal:GOOGLE_ACCOUNT_USERNAME}`
- Password: `${secret:personal:GOOGLE_ACCOUNT_PASSWORD}`

## Reset the vault (start fresh)

The vault lives in the signed-in account's Google Drive as `portunus.vault.json`. The account is a test account, and the user has approved deleting this file for testing.

1. In the same Chrome, open https://drive.google.com, search for `portunus`, and move `portunus.vault.json` to trash (Bin). Don't empty the Bin, so the old vault can still be restored. Only do this in the designated test account.
2. Reload `http://localhost:3000`. With no remote vault, the app shows the create-vault flow instead of "Unlock vault".
3. Create a throwaway vault: choose a test master password, click "Download portunus.key" and note where it was saved, leave "Also install the keyfile in this browser" checked (this makes "Remove key" available), and tick the acknowledgement.

To unlock an existing vault later, you need the master password plus `portunus.key` (or the recovery code). If you no longer have them, reset the vault again as above.

## Devin secrets needed

- `GOOGLE_ACCOUNT_USERNAME`, `GOOGLE_ACCOUNT_PASSWORD` (personal), for Google login
- `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_SECRET`, `AUTH_URL` (personal), for the dev server

## Tips

- Unlocked-header actions (Security, Remove key, Lock, Sign out) are in the hamburger menu (`aria-label="Menu"`) in `src/components/vault-open.tsx`. Save stays visible.
- "Remove key" deletes the keyfile from this browser's localStorage. Afterwards you need the downloaded `portunus.key` to unlock.
- Test "Sign out" last, because it ends the Google session for the app.
- The VM's Chrome strips `target="_blank"` from `<a href>` links, including on a static `data:text/html` page, so new-tab links (e.g. entry titles with a URL) open in the same tab and trigger the unsaved-changes "Leave site" dialog. That isn't an app bug. To confirm, compare the live anchor with a static `target="_blank"` link (`getAttribute('target')` is null on both). Treat plain left-click new-tab behavior as unverified and ask the user to check it in their own browser. Ctrl+click opening a background tab only shows the click doesn't toggle the row.

## Demo mode (no Google account)

For UI checks that don't need real Drive behavior, run `PORTUNUS_DEMO_MODE=1 npm run dev` (or `next start`/Docker) with no secrets. "Sign in with Google" signs in as `demo@portunus.local` without OAuth, and the vault lives in server memory (restart the server for a fresh vault). `node scripts/record-demo.mjs` drives the whole flow headlessly and regenerates the README GIF/screenshots.

- Cheap demo-mode check: unauthenticated `curl localhost:3000/api/vault` → `{"error":"vault_not_found"}` (in Google mode it would be 401).
- Gotcha: locking the vault does NOT clear the keyfile — it stays in React state, so the unlock screen shows "Key … loaded" with no file picker. To exercise the file-picker path, reload the page while locked (also proves the in-memory vault persists across requests).
- Keyfile downloads land in `~/Downloads/portunus.key`. In the GTK file dialog, press Ctrl+L and type the absolute path, then Enter.
- Clipboard verification without devtools: click "copy pass", then paste into the search field — the pasted text should equal the generated password.
- Per-visitor vaults are keyed by the `portunus.demo-visitor` cookie; a request without it hits an "anonymous" bucket and sees no vault — by design, not a bug.
