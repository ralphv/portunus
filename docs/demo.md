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
