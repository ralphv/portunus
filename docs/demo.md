# Live demo

**[demo.portunus-vault.app](https://demo.portunus-vault.app/)**: nothing to install.

1. Open the demo and click **Sign in with Google**. Sign-in is stubbed, so no
   Google account is used.
2. Create a vault. You'll get a recovery code and a keyfile download, the same
   as a real install.
3. Unlock with the keyfile and password, then add entries, labels, and 2FA
   codes, and try search and copy.

Your browser gets its own in-memory vault, which is wiped whenever the demo
server restarts.

::: danger Never put real secrets in the demo
The demo is someone else's server running demo mode. Demo mode is
intentionally unauthenticated and is
[out of scope](https://github.com/ralphv/portunus/blob/main/SECURITY.md#scope)
for security reports.
:::

## Run the demo locally

You can run the same demo mode on your own machine. It uses stubbed sign-in
and an in-memory vault, with no Google OAuth, no Drive account, and nothing
else to configure:

```bash
docker run --rm -p 3000:3000 -e PORTUNUS_DEMO_MODE=1 ghcr.io/ralphv/portunus:latest
```

Then open `http://localhost:3000` and click **Sign in with Google**. Each
browser gets its own isolated in-memory vault (tracked by a visitor cookie),
which is lost when the container restarts.

Demo mode is for trying the UI. Keep real secrets well away from it. When
you're ready for a real vault, go to [Install](./install).

## Screenshots

| Vault creation: recovery code + keyfile download | Unlock: keyfile + password |
|---|---|
| ![Create vault](./screenshots/create-vault.png) | ![Unlock](./screenshots/unlock.png) |

| Unlocked vault: entry list and search | Expanded entry: edit fields |
|---|---|
| ![Entries](./screenshots/entries.png) | ![Entry editor](./screenshots/entry-edit.png) |
