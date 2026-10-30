# Install

Portunus ships as a single Docker image,
[`ghcr.io/ralphv/portunus`](https://github.com/ralphv/portunus/pkgs/container/portunus).
It's a Next.js standalone build that runs as non-root and has no database.

You need:

- Docker (or any OCI container runtime)
- A Google OAuth client. See [Google OAuth setup](./google-oauth); it takes
  about five minutes, once.
- HTTPS in front of the container for anything other than `localhost`. See
  [Running over HTTPS](./https).

Want to look around first? The [local demo](./demo) needs none of this.

## Docker Compose

Fill in the environment values (see [Configuration](./configuration)):

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

```bash
docker compose up -d
```

Then open `http://localhost:3000`.

::: warning Keep secrets out of git
If you keep this compose file in a git repo, don't commit the real secret
values. Track a placeholder version, or use `env_file: .env` (gitignored)
instead.
:::

## Image tags

| Tag | What it is |
|---|---|
| `latest`, `vX.Y.Z`, `vX.Y` | Releases |
| `main` | The current `main` branch |
| `nightly` | Scheduled daily build |
| `sha-<short>` | A specific commit |

Release images are signed with [cosign](https://github.com/sigstore/cosign).
Self-host from a release you have verified. The
[security model](./security#you-must-trust-the-code-your-browser-runs) explains
why that matters.

## Building the image yourself

```bash
git clone https://github.com/ralphv/portunus.git
cd portunus
docker build -t portunus:latest .
# or: npm run docker:build
```

To run on a remote server, export the image and load it there:

```bash
docker save portunus:latest | gzip > portunus.tar.gz   # or: npm run docker:save
# copy to the server, then:
gunzip -c portunus.tar.gz | docker load
docker compose up -d
```

## After it's running

1. Put it behind HTTPS and set `AUTH_URL` to the public origin. See
   [Running over HTTPS](./https).
2. Sign in with Google and create a vault. **Save the recovery code and the
   `portunus.key` keyfile.** The keyfile is per-device. If you lose every copy
   *and* the recovery code, the vault can't be recovered. There is no password
   reset.

## Building from source (development)

```bash
npm install
npm run dev          # dev server on http://localhost:3000 (needs .env.local)
```

See [CONTRIBUTING.md](https://github.com/ralphv/portunus/blob/main/CONTRIBUTING.md)
for the full development setup.
