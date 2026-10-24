---
layout: home

hero:
  name: Portunus
  text: Your secrets, encrypted in your browser
  tagline: Self-hosted, stateless, zero-knowledge secrets manager backed by your own Google Drive.
  actions:
    - theme: brand
      text: Try the live demo
      link: /demo
    - theme: alt
      text: Install
      link: /install
    - theme: alt
      text: GitHub
      link: https://github.com/ralphv/portunus

features:
  - title: Zero-knowledge server
    details: Argon2id + XChaCha20-Poly1305, all client-side. The server brokers OAuth and proxies Drive calls; it never sees plaintext, your master password, or your keyfile.
  - title: Password and keyfile
    details: "KEK = Argon2id(password ‖ keyfile). A leaked password alone can't brute-force the vault; neither can the keyfile alone."
  - title: Your own Google Drive
    details: The vault is one ciphertext file, portunus.vault.json, in your Drive. The drive.file scope means the app only sees files it created.
  - title: One stateless Docker image
    details: No database to run, back up, migrate, or secure. Losing the server costs you nothing but the time to start another one.
---

![Portunus demo: sign in, create a vault, unlock with keyfile, add entries, search and copy](./screenshots/demo.gif)

## Where to start

- **Just looking?** Open the [live demo](./demo). Nothing to install, and no Google account is used.
- **Self-hosting?** Follow [Install](./install), then [Google OAuth setup](./google-oauth) and [Running over HTTPS](./https).
- **Deciding whether to trust it?** Read the [Security model](./security) and the [FAQ](./faq).

Portunus is a **personal** vault, by design. It is not a team or family
password manager. It **has not been independently audited**; see the
[Security model](./security) for what that means.
