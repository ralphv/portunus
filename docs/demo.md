---
title: Live demo
nav_order: 2
---

# Live demo

**[demo.portunus-vault.app](https://demo.portunus-vault.app/)** — nothing to
install. Click "Sign in with Google" (it's stubbed; no Google account is used),
create a vault, and look around. Your browser gets its own in-memory vault that
is wiped whenever the demo server restarts.

{: .warning }
**Never put real secrets in it** — it's someone else's server running demo
mode.

## Run the demo on your own machine

The same demo mode, locally — stubbed sign-in and an in-memory vault, no Google
OAuth, no Drive account, nothing else to configure:

```bash
docker run --rm -p 3000:3000 -e PORTUNUS_DEMO_MODE=1 ghcr.io/ralphv/portunus:latest
```

Then open `http://localhost:3000` and click "Sign in with Google". Each browser
gets its own isolated in-memory vault (a visitor cookie), lost when the
container restarts. **Demo mode is for trying the UI; use it nowhere near real
secrets.**

When you're ready for a real vault, go to [Install](install.md).
