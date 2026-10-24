# Running over HTTPS

Portunus must be served over HTTPS for anything other than `localhost`. The
unlock flow uses WebCrypto, which browsers only allow in
[secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts).
Plain `http://` on a LAN will not work.

The container itself speaks HTTP on port 3000, so terminate TLS in front of it.
Whichever option you pick, two settings have to agree with the public URL:

- **`AUTH_URL`** must be the public origin, for example
  `https://vault.example.com`. It drives OAuth callback URLs and cookie flags.
- **The Google redirect URI** must be `<AUTH_URL>/api/auth/callback/google`.
  See [Google OAuth setup](./google-oauth).

When a proxy or tunnel sits on the same host, publish the container port on
loopback only (`"127.0.0.1:3000:3000"`), so nothing reaches it over plain HTTP
from outside.

## Option 1: Reverse proxy

Use this on a server with a public DNS name. The examples assume Portunus
listens on `127.0.0.1:3000`.

### Caddy

Caddy obtains and renews certificates automatically.

```txt
# Caddyfile
vault.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

### nginx

```nginx
server {
    listen 443 ssl;
    server_name vault.example.com;

    ssl_certificate     /etc/letsencrypt/live/vault.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/vault.example.com/privkey.pem;

    # The vault is saved as one request. The app accepts up to 10 MiB;
    # nginx's default limit is 1 MiB.
    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    }
}

server {
    listen 80;
    server_name vault.example.com;
    return 301 https://$host$request_uri;
}
```

### Traefik

Traefik (Docker labels) works the same way: route ``Host(`vault.example.com`)``
to the container's port 3000 over the `websecure` entrypoint with a certificate
resolver, and pass the standard `X-Forwarded-*` headers (Traefik does this by
default).

## Option 2: Cloudflare Tunnel

Use this when you don't want to open inbound ports. `cloudflared` makes an
outbound connection to Cloudflare, which serves your hostname over HTTPS.

1. In the Cloudflare dashboard, go to **Zero Trust → Networks → Tunnels**,
   create a tunnel, and copy its token.
2. Add a public hostname, for example `vault.example.com`, with the service
   `http://portunus:3000`.
3. Run `cloudflared` next to Portunus:

```yaml
# docker-compose.yml
services:
  portunus:
    image: ghcr.io/ralphv/portunus:latest
    env_file: .env          # AUTH_URL=https://vault.example.com
    restart: unless-stopped
    # no `ports:` needed; cloudflared reaches it over the compose network

  cloudflared:
    image: cloudflare/cloudflared:latest
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN}
    restart: unless-stopped
```

Things to know:

- Cloudflare terminates TLS. It sits in the path of the page and the
  JavaScript your browser runs, the same position as any reverse proxy. Read
  [You must trust the code your browser runs](./security#you-must-trust-the-code-your-browser-runs)
  before choosing this option.
- Turn off Cloudflare features that rewrite HTML or JavaScript for this
  hostname, such as Rocket Loader. Portunus's strict Content-Security-Policy
  blocks injected scripts, and its script self-check flags them.

## Option 3: Tailscale

Use this to keep Portunus private to your own devices. `tailscale serve` gives
the machine an HTTPS URL on your tailnet, such as
`https://vault-host.your-tailnet.ts.net`, with a valid certificate.

1. In the Tailscale admin console, enable **MagicDNS** and
   **HTTPS certificates** for your tailnet.
2. On the host running Portunus (port 3000 published on loopback):

```bash
sudo tailscale serve --bg 3000
tailscale serve status      # shows the https://….ts.net URL
```

3. Set `AUTH_URL=https://vault-host.your-tailnet.ts.net` and add
   `https://vault-host.your-tailnet.ts.net/api/auth/callback/google` as a
   redirect URI on your Google OAuth client.

Only devices on your tailnet can reach the instance. Google sign-in still
works, because the OAuth redirect happens in your browser and Google never
needs to reach your server. Portunus does need outbound internet access to
Google's APIs.
