---
title: Security model
nav_order: 7
---

# Security model

The authoritative document is
**[SECURITY.md](https://github.com/ralphv/portunus/blob/main/SECURITY.md)** in
the repository: the full threat model, trust boundaries, and a file-by-file
audit map. This page is a short guide to it. Where the two differ, SECURITY.md
wins.

{: .important }
Portunus has **not** been independently security-audited, and no third party
has formally reviewed its cryptography.
[Read what that means](https://github.com/ralphv/portunus/blob/main/SECURITY.md#no-independent-audit).

## How a vault is encrypted

```
vault plaintext ──▶ XChaCha20-Poly1305 (random data key)
                        │
data key ──▶ wrapped by KEK = Argon2id(password ‖ keyfile_bytes)
                        │
envelope (ciphertext + wrapped key + kdf params) ──▶ Google Drive
```

All encryption and decryption happens **in the browser**. Unlock requires
**both** the master password and the 32-byte keyfile (`portunus.key`, or its
recovery code). Details:
[Zero-knowledge design](https://github.com/ralphv/portunus/blob/main/SECURITY.md#zero-knowledge-design).

## What the server sees, and what it never sees

| The server sees | The server never sees |
|---|---|
| Google OAuth tokens, in the encrypted session cookie | Vault plaintext — entries, password history, TOTP secrets, per-vault settings |
| The opaque ciphertext envelope, size-checked but never parsed | The master password |
| Drive file metadata (file id, modified time, parent folder ids) | The keyfile or recovery code |
| Your Google account email and name, request paths and client IPs | The KEK or the data key |

Full lists:
[What the server sees](https://github.com/ralphv/portunus/blob/main/SECURITY.md#what-the-server-sees) ·
[What the server never sees](https://github.com/ralphv/portunus/blob/main/SECURITY.md#what-the-server-never-sees) ·
[Trust boundaries](https://github.com/ralphv/portunus/blob/main/SECURITY.md#trust-boundaries).

## The limit you should know about

**You must trust the code your browser runs.** A malicious or compromised server
operator could serve modified JavaScript that exfiltrates secrets at unlock
time; zero-knowledge storage does not protect against that. Self-host from a
release you have verified (images are signed with cosign), and serve over HTTPS
— see [Running it over HTTPS](https.md).

Malicious browser extensions and compromised devices are out of scope; see
[Scope](https://github.com/ralphv/portunus/blob/main/SECURITY.md#scope).

## Reviewing the code

The security-relevant surface is deliberately small, and independent review is
actively welcome.
[What to audit](https://github.com/ralphv/portunus/blob/main/SECURITY.md#what-to-audit)
names every file that matters and the invariant each one has to hold.

## Reporting a vulnerability

Please report vulnerabilities privately, as described in
[Reporting a vulnerability](https://github.com/ralphv/portunus/blob/main/SECURITY.md#reporting-a-vulnerability)
— not in a public issue. Only the latest release (and `main`) receives security
fixes.
