# FAQ

## Why Google Drive?

Drive is a dumb pipe here. It only ever holds ciphertext.

- **Google can't read your vault.** Encryption and decryption happen entirely
  in your browser. What lands in Drive is `portunus.vault.json`, an opaque
  XChaCha20-Poly1305 envelope.
- **Portunus can't read the rest of your Drive.** The OAuth scope is
  `drive.file`, which grants access only to files this app created. A
  compromised Portunus server can't silently widen it.
- **What you get for it:** no database to run, secure, migrate, or back up.
  Your vault inherits the durability, version history, and sync of storage you
  already maintain.

## I don't want Google in the loop at all

That's a legitimate position, and today it means Portunus isn't for you.
Storage sits behind a provider interface
([`src/lib/store/store-interface.ts`](https://github.com/ralphv/portunus/blob/main/src/lib/store/store-interface.ts)),
so other backends (S3-compatible, WebDAV, local disk) are a natural
contribution. If you want one,
[open a discussion](https://github.com/ralphv/portunus/discussions).

## Can I share entries with my family or team?

No. Portunus is a **personal** vault, by design. Each user's vault is their own
encrypted file in their own Google Drive, unlocked by their own password and
keyfile. There's no central database or shared key infrastructure to share
entries through, and no orgs, roles, shared folders, or admin recovery.

## What happens if I lose my keyfile?

Unlock with your **recovery code**, the Crockford-Base32 code shown when you
created the vault. If you lose every copy of the keyfile **and** the recovery
code, the vault can't be recovered by anyone, including the server operator.
There is no password reset.

## Why do I need both a password and a keyfile?

The key that unlocks your vault is derived from both:
`KEK = Argon2id(password ‖ keyfile)`. A leaked password alone can't be used to
brute-force the vault, and neither can the keyfile alone.

## How do I use it on another device?

Bring the keyfile (or your recovery code) to the new device. You can install
the keyfile in that browser, or load it for a single session. Sign in with the
same Google account and unlock with your master password.

## Why doesn't it work over plain HTTP on my LAN?

The unlock flow uses WebCrypto, which browsers only allow in secure contexts:
HTTPS or `localhost`. See [Running over HTTPS](./https) for reverse proxy,
Cloudflare Tunnel, and Tailscale setups.

## What if the server or Google Drive is down?

With offline mode (on by default), the vault opens **read-only** from a
cached copy of the ciphertext in your browser and recovers automatically when
connectivity returns. If the server itself is gone, start another one. It's
stateless, so losing it costs you nothing but the time to start a new one.

## Does Portunus send my passwords to Have I Been Pwned?

No. Breach checks use k-anonymity: only the first 5 hex characters of the
password's SHA-1 hash leave the browser, sent directly to
`api.pwnedpasswords.com` rather than through the Portunus server. You can turn
the automatic check off per vault in Settings, or for the whole instance with
[`PORTUNUS_HIBP_ON_EDIT=0`](./configuration#have-i-been-pwned-checks).

## Has it been audited?

No. Portunus has not been independently audited. See the
[Security model](./security#not-independently-audited).

## Can I try it without setting anything up?

Yes: run [demo mode](./demo) locally with one `docker run` command. Never
put real secrets in it.

## What's the license?

[AGPL-3.0](https://github.com/ralphv/portunus/blob/main/LICENSE). You can
self-host it and fork it, but if you offer a modified version as a hosted
service you must share the source.
