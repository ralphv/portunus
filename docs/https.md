---
title: Running it over HTTPS
nav_order: 5
---

# Running it over HTTPS
{: .no_toc }

If you'll only ever use Portunus at `http://localhost:3000` on the machine it
runs on, you can skip this page. For anything else — another computer, your
phone, a home server — Portunus needs an HTTPS address with a real hostname.

1. TOC
{:toc}

## Why plain HTTP on your network won't work

Three separate things require it:

1. **The browser.** Unlocking uses WebCrypto, which browsers only allow in
   [secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts):
   HTTPS pages and `localhost`. On `http://192.168.1.20:3000` the unlock flow
   can't run.
2. **Google.** Its [redirect URI rules](https://developers.google.com/identity/protocols/oauth2/web-server#uri-validation)
   reject plain `http://` (except `localhost`), raw IP addresses, and
   hostnames that don't end in a public domain suffix — so `umbrel.local`,
   `nas.lan` and `vault.home` are all refused. See
   [Google OAuth setup](google-oauth.md#redirect-uris-google-will-refuse).
3. **The session cookie.** When `AUTH_URL` starts with `https://`, the session
   cookie is marked `Secure`, so the browser only ever sends it over HTTPS.

The container itself speaks plain HTTP on port 3000. You terminate TLS in front
of it, with one of the options below.

## Pick an option

| Option | You need | Reachable from | Open ports |
|---|---|---|---|
| [Reverse proxy](#option-1-reverse-proxy-on-your-own-domain) (Caddy, nginx, Traefik) | A domain name | Anywhere, or your LAN only | 443 (and 80 for automatic certificates) |
| [Cloudflare Tunnel](#option-2-cloudflare-tunnel) | A domain on Cloudflare | Anywhere | None |
| [Tailscale Serve](#option-3-tailscale-serve) | A Tailscale account | Your tailnet only | None |

Whichever you choose, the last two steps are the same:

- set `AUTH_URL` to the HTTPS address, exactly as you'll type it (for example
  `AUTH_URL=https://vault.example.com`), and
- add `<that address>/api/auth/callback/google` as an authorized redirect URI
  in your Google OAuth client.

Google never connects to your server during sign-in — your browser carries the
redirect. So the hostname only has to be valid and reachable *from your
browser*; it doesn't have to be on the public internet. Your server does need
outbound internet access to reach Google's token and Drive APIs.

## Option 1: Reverse proxy on your own domain

Point a DNS name (say `vault.example.com`) at the machine, then let a proxy
handle certificates.

### Caddy

Caddy gets and renews a Let's Encrypt certificate on its own. With the default
HTTP challenge, ports 80 and 443 must be reachable from the internet; for a
LAN-only setup use Caddy's DNS challenge instead.

```yaml
# docker-compose.yml
services:
  portunus:
    image: ghcr.io/ralphv/portunus:latest
    env_file: .env            # AUTH_URL=https://vault.example.com
    restart: unless-stopped

  caddy:
    image: caddy:2
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
    restart: unless-stopped

volumes:
  caddy_data:
```

```text
# Caddyfile
vault.example.com {
	reverse_proxy portunus:3000
}
```

Caddy forwards the `Host` and `X-Forwarded-Proto` headers by default.

### nginx

```nginx
server {
    listen 443 ssl;
    server_name vault.example.com;

    ssl_certificate     /etc/letsencrypt/live/vault.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/vault.example.com/privkey.pem;

    # Vault saves can be up to 10 MiB; nginx's default limit is 1 MiB.
    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    }
}
```

Traefik and other proxies work the same way: route the hostname to port 3000
and pass the original `Host` header through.

These examples give Portunus its own hostname. Serving it under a sub-path
(`example.com/vault`) isn't covered here.

## Option 2: Cloudflare Tunnel

A [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
gives you a public HTTPS hostname without opening any ports. You need a domain
whose DNS is on Cloudflare.

1. In the Cloudflare dashboard, create a tunnel and copy its token.
2. Add a **public hostname** for the tunnel, such as `vault.example.com`, with
   the service `http://portunus:3000`.
3. Run `cloudflared` next to Portunus:

```yaml
# docker-compose.yml
services:
  portunus:
    image: ghcr.io/ralphv/portunus:latest
    env_file: .env            # AUTH_URL=https://vault.example.com
    restart: unless-stopped

  cloudflared:
    image: cloudflare/cloudflared:latest
    command: tunnel run
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN}
    restart: unless-stopped
```

{: .note }
With a tunnel, Cloudflare terminates TLS, so it handles the pages and
JavaScript your browser loads. Your vault is still encrypted in the browser
before it's sent, but [SECURITY.md](https://github.com/ralphv/portunus/blob/main/SECURITY.md#trust-boundaries)
is clear that you have to trust the code your browser runs — and whoever serves
it. Decide whether that's acceptable for you.

Turn off Cloudflare features that rewrite pages or scripts, such as **Rocket
Loader**, for this hostname. Portunus sends a strict Content-Security-Policy,
so rewritten scripts are blocked and the app breaks.

## Option 3: Tailscale Serve

[Tailscale Serve](https://tailscale.com/kb/1312/serve) puts Portunus on an
HTTPS address like `https://homeserver.your-tailnet.ts.net`, reachable only
from devices signed in to your tailnet. `ts.net` is a public domain suffix, so
Google accepts it as a redirect URI.

1. In the Tailscale admin console, enable **MagicDNS** and **HTTPS
   certificates**.
2. On the machine running Portunus (with the container published on port
   3000):

   ```bash
   tailscale serve --bg 3000
   ```

3. Set `AUTH_URL` to the `https://….ts.net` address Tailscale prints, and add
   the matching redirect URI in Google.

Every device you want to use Portunus from needs Tailscale installed and signed
in.

## Home-server app platforms

Platforms such as Umbrel and CasaOS usually open apps at addresses like
`http://umbrel.local:PORT` or `http://192.168.x.x:PORT`. For the reasons at the
top of this page, Portunus can't sign in or unlock at those addresses. If you
run it on one of these platforms, put one of the options above in front of it
and use that HTTPS address everywhere.

## Checklist

- [ ] The address starts with `https://` and uses a hostname, not an IP.
- [ ] `AUTH_URL` is exactly that address — no trailing path.
- [ ] The Google OAuth client lists `<AUTH_URL>/api/auth/callback/google`.
- [ ] Your proxy passes the original `Host` header and `X-Forwarded-Proto`.
- [ ] Your proxy accepts request bodies of at least 10 MiB, so large vaults
      can be saved.
- [ ] The server can reach `accounts.google.com`, `oauth2.googleapis.com` and
      `www.googleapis.com`.
