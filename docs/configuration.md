---
title: Configuration
nav_order: 6
---

# Configuration
{: .no_toc }

Portunus is configured entirely through environment variables. There's no
config file and no database.

1. TOC
{:toc}

## Required

**The server refuses to start if any required variable is missing** (unless
demo mode is on).

| Variable | Description |
|---|---|
| `AUTH_GOOGLE_ID` | Google OAuth client ID — see [Google OAuth setup](google-oauth.md) |
| `AUTH_GOOGLE_SECRET` | Google OAuth client secret |
| `AUTH_SECRET` | Session encryption secret — `openssl rand -hex 32` |
| `AUTH_URL` | Public origin, e.g. `https://vault.example.com`. It drives OAuth callback URLs and cookie flags, so it must match the address in your browser exactly. See [Running it over HTTPS](https.md). |

## Optional

| Variable | Default | Description |
|---|---|---|
| `PORTUNUS_HIBP_ON_EDIT` | on | `0` disables the silent Have I Been Pwned re-check on password edits entirely — the Settings toggle for it is hidden |
| `DISABLE_OFFLINE_MODE` | off | `1` disables the offline mode feature entirely |
| `PORTUNUS_DEMO_MODE` | off | `1` enables demo mode with in-memory storage and stubbed sign-in. **Never use it for real secrets.** |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | Send OpenTelemetry traces to this OTLP collector |
| `OTEL_TRACES_EXPORTER` | unset | `console` prints each finished trace span to stdout |

With neither OpenTelemetry variable set, tracing stays off.

### Have I Been Pwned on edit

`PORTUNUS_HIBP_ON_EDIT=0` stops the app from contacting
`api.pwnedpasswords.com` automatically whenever a password is edited. The check
is already k-anonymous — only the first 5 hex chars of the SHA-1 hash leave the
client — but you may want it off when:

- Your policy forbids any third-party requests during secret handling
  (corporate/compliance environments, or you simply don't want an external
  service to see request timing/metadata from your users).
- The instance is meant for fully offline or air-gapped use.
- You prefer explicit consent — checks then only run from the menu's "Have I
  Been Pwned" audit, which stays available either way.

With `PORTUNUS_HIBP_ON_EDIT` on (the default), each user can still turn the
on-edit check off for their own vault via the menu's **Settings** — the
preference is stored inside the encrypted vault document and syncs to their
other devices on save. Setting the variable to `0` hides that toggle and
disables the check no matter the saved preference.

## Set by the Docker image

You normally don't touch these. They're listed so you know what the container
does.

| Variable | Value in the image | Meaning |
|---|---|---|
| `PORT` | `3000` | Port the server listens on inside the container |
| `HOSTNAME` | `0.0.0.0` | Address the server binds to |
| `NODE_ENV` | `production` | |

To expose Portunus on a different host port, change the port mapping (for
example `"8080:3000"`) rather than `PORT`, and keep `AUTH_URL` in step with the
address you actually use.

## Example `.env`

```bash
AUTH_GOOGLE_ID=1234567890-abc.apps.googleusercontent.com
AUTH_GOOGLE_SECRET=your-google-client-secret
AUTH_SECRET=0f3c…64-hex-characters…
AUTH_URL=https://vault.example.com

# Optional
# PORTUNUS_HIBP_ON_EDIT=0
# DISABLE_OFFLINE_MODE=1
```

Keep this file out of git. If you keep your compose file in a repository,
commit a placeholder version and load the real values with `env_file: .env`.
