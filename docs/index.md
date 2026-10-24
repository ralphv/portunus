---
title: Home
nav_order: 1
description: Self-hosted, stateless, zero-knowledge secrets manager backed by your own Google Drive.
permalink: /
---

# Portunus

**Self-hosted, stateless, zero-knowledge secrets manager backed by your own Google Drive.**
{: .fs-6 .fw-300 }

[Try the live demo](https://demo.portunus-vault.app/){: .btn .btn-primary .mr-2 }
[Install it](install.md){: .btn .mr-2 }
[View on GitHub](https://github.com/ralphv/portunus){: .btn }

Your secrets are encrypted **in your browser** — before anything touches the
network — and stored as a single file (`portunus.vault.json`) in your Google
Drive. The server brokers OAuth and proxies Drive calls; it never sees
plaintext, your master password, or your keyfile. No database, one stateless
Docker image.

![Portunus demo — sign in, create a vault, unlock with keyfile, add entries with site icons, SSO, 2FA codes and labels, then search and copy](screenshots/demo.gif)

## Who it's for

Portunus is a **personal** vault. It suits you if you want a password manager
you control, but you don't want to run and back up a stateful service: the
container keeps no state, and the only copy of your secrets is ciphertext in a
Drive file you already own.

It is **not** a good fit if you need sharing between accounts, team or family
administration, a storage backend other than Google Drive, or independently
audited software. The [FAQ](faq.md) covers each of these.

## Where to go next

| I want to… | Read |
|---|---|
| Click around without installing anything | [Live demo](demo.md) |
| Run my own instance | [Install](install.md), then [Google OAuth setup](google-oauth.md) |
| Reach it from my phone or another machine | [Running it over HTTPS](https.md) |
| See every environment variable | [Configuration](configuration.md) |
| Understand what the server can and can't see | [Security model](security.md) |
| Know why it uses Google Drive, and what happens if I lose my keyfile | [FAQ](faq.md) |

Portunus is open source under [AGPL-3.0](https://github.com/ralphv/portunus/blob/main/LICENSE).
Bugs, questions and ideas are welcome in
[issues](https://github.com/ralphv/portunus/issues) and
[discussions](https://github.com/ralphv/portunus/discussions).
