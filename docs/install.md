---
title: Install
nav_order: 3
---

# Install
{: .no_toc }

Portunus is one stateless Docker image. Your vault lives in your Google Drive,
so the container has no volume to back up.

1. TOC
{:toc}

## What you need

- **Docker** with Compose, on any `linux/amd64` or `linux/arm64` machine.
- **A Google account** for the vault, and a Google Cloud project for the OAuth
  client (free). [Google OAuth setup](google-oauth.md) walks through it.
- **An HTTPS address**, unless you'll only ever use Portunus on the same
  machine at `http://localhost`. Browsers and Google both refuse plain `http://`
  everywhere else. [Running it over HTTPS](https.md) covers the options.

Just want to look? The [live demo](demo.md) needs none of this.

## 1. Create the Google OAuth client

Follow [Google OAuth setup](google-oauth.md) and keep the **client ID** and
**client secret** it gives you.

## 2. Generate a session secret

```bash
openssl rand -hex 32
```

This becomes `AUTH_SECRET`. It encrypts the session cookie; treat it like a
password.

## 3. Write the environment file

Create a `.env` file next to your compose file:

```bash
AUTH_GOOGLE_ID=your-google-client-id
AUTH_GOOGLE_SECRET=your-google-client-secret
AUTH_SECRET=the-value-from-step-2
AUTH_URL=https://vault.example.com   # or http://localhost:3000 for local-only use
```

`AUTH_URL` must be exactly the address you type into the browser — scheme,
host and port. **The server refuses to start if any of these four is missing.**
Every other setting is optional; see [Configuration](configuration.md).

{: .note }
Keep `.env` out of git. The repository's `.gitignore` already ignores
`.env*` files.

## 4. Start the container

```yaml
# docker-compose.yml
services:
  portunus:
    image: ghcr.io/ralphv/portunus:latest
    ports:
      - "3000:3000"
    env_file: .env
    restart: unless-stopped
```

```bash
docker compose up -d
```

The container speaks plain HTTP on port 3000. For anything other than
`localhost`, put a reverse proxy or tunnel in front of it — see
[Running it over HTTPS](https.md).

Prefer a fixed version to `latest`? Each release is also published as
`ghcr.io/ralphv/portunus:vX.Y.Z` and `:vX.Y` — see
[releases](https://github.com/ralphv/portunus/releases).

## 5. Create your vault

Open your `AUTH_URL`, click **Sign in with Google**, and approve access.
Portunus asks only for the `drive.file` scope, so it can see the files it
creates and nothing else in your Drive.

Then create a vault. You'll choose a master password, and Portunus gives you:

- a **keyfile** (`portunus.key`) to download, and
- a **recovery code** for that keyfile.

![Vault creation — recovery code and keyfile download](screenshots/create-vault.png)

Unlocking needs **both** the master password and the keyfile.

{: .warning }
**Keep your `portunus.key` file and recovery code safe.** The keyfile is
per-device — losing all copies *and* the recovery code means the vault is
unrecoverable. There is no password reset; that's the point.

The vault is saved to your Drive as `portunus.vault.json`, inside a folder
called `Portunus Application`.

## Using it on another device

Sign in with the same Google account and unlock with your master password plus
the keyfile. On each device you can install the keyfile in the browser, or load
it from a file each session. If you don't have the file to hand, the recovery
code stands in for it.

## Updating

There's no data in the container, so updating is just pulling a new image:

```bash
docker compose pull
docker compose up -d
```

Only the latest release receives security fixes. Release notes are in
[CHANGELOG.md](https://github.com/ralphv/portunus/blob/main/CHANGELOG.md).

## Building the image yourself

```bash
git clone https://github.com/ralphv/portunus.git
cd portunus
docker build -t portunus:latest .
```

Then use `image: portunus:latest` in the compose file above.
