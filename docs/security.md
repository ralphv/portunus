# Security model

::: info SECURITY.md is the source of truth
This page is a short guide to Portunus's security model. The full threat
model, trust boundaries, and a file-by-file audit map live in
[SECURITY.md](https://github.com/ralphv/portunus/blob/main/SECURITY.md). If the
two ever disagree, SECURITY.md wins.
:::

## Reporting a vulnerability

**Please don't open a public issue, discussion, or PR for security problems.**
Use
[GitHub private vulnerability reporting](https://github.com/ralphv/portunus/security/advisories/new).
See [Reporting a vulnerability](https://github.com/ralphv/portunus/blob/main/SECURITY.md#reporting-a-vulnerability)
for what to include, what to expect, and what's in
[scope](https://github.com/ralphv/portunus/blob/main/SECURITY.md#scope).

## Not independently audited

Portunus has **not** been independently security-audited, and no third party
has formally reviewed its cryptography. Judge it on the basis described in
[No independent audit](https://github.com/ralphv/portunus/blob/main/SECURITY.md#no-independent-audit):
standard primitives, a small security-relevant surface, and a
[What to audit](https://github.com/ralphv/portunus/blob/main/SECURITY.md#what-to-audit)
map you can review yourself. If you need audited software, use an audited
password manager.

## How the vault is encrypted

All encryption and decryption happens **in the browser**:

```txt
vault plaintext ──▶ XChaCha20-Poly1305 (random data key)
                        │
data key ──▶ wrapped by KEK = Argon2id(password ‖ keyfile_bytes)
                        │
envelope (ciphertext + wrapped key + kdf params) ──▶ Google Drive
```

- Argon2id parameters follow OWASP guidance (19 MiB, t=2, p=1).
- Unlock requires **both** the master password and the keyfile
  (`portunus.key`, or its recovery code).
- Header fields are bound as AEAD additional data, so tampering with the KDF
  params, the engine id, or the wrapped key fails decryption.
- Fresh random nonces are used for every wrap and save.

The exact construction is in
[Zero-knowledge design](https://github.com/ralphv/portunus/blob/main/SECURITY.md#zero-knowledge-design).

## What the server sees, and what it never sees

The Portunus server brokers Google OAuth and proxies Drive calls. It handles
OAuth tokens, the opaque ciphertext envelope, Drive file metadata, and your
Google account email and name. It never sees vault plaintext, the master
password, the keyfile or recovery code, or the encryption keys.

The full lists are in
[What the server sees](https://github.com/ralphv/portunus/blob/main/SECURITY.md#what-the-server-sees)
and
[What the server never sees](https://github.com/ralphv/portunus/blob/main/SECURITY.md#what-the-server-never-sees).
What each component (browser, server, Google Drive, Google OAuth, Have I Been
Pwned) is trusted with is in
[Trust boundaries](https://github.com/ralphv/portunus/blob/main/SECURITY.md#trust-boundaries).

## You must trust the code your browser runs

Zero-knowledge storage doesn't protect against a malicious or compromised
server operator serving modified JavaScript that exfiltrates secrets at unlock
time. SECURITY.md's advice: self-host from a release you have verified (images
are signed with cosign), and serve over [HTTPS](./https).

## Script injection

A **strict Content-Security-Policy** is the primary control. It blocks
injected scripts before they run. A **runtime script self-check** adds
best-effort tamper-evidence: it shows a non-blocking banner if a script the
build didn't emit appears on the page.

The self-check is **not** a defense against browser extensions, and it is
**not** proof of a trustworthy server. Malicious extensions and fully
compromised client devices are out of scope. See
[Script injection: CSP first, self-check second](https://github.com/ralphv/portunus/blob/main/SECURITY.md#script-injection-csp-first-self-check-second).

## Keep your keyfile and recovery code safe

The keyfile is per-device. Losing all copies **and** the recovery code means
the vault is unrecoverable. Nobody, including the server operator, can get it
back. There is no password reset; that's the point.
