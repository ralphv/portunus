---
title: FAQ
nav_order: 8
---

# FAQ
{: .no_toc }

1. TOC
{:toc}

## Why Google Drive?

Drive is a dumb pipe here, and it never holds anything but ciphertext.

- **Google cannot read your vault.** Encryption and decryption happen entirely
  in your browser. What lands in Drive is `portunus.vault.json` — an opaque
  XChaCha20-Poly1305 envelope.
- **Portunus cannot read the rest of your Drive.** The OAuth scope is
  `drive.file`, which grants access only to files this app itself created.
- **What you get for it:** no database to run, secure, migrate, or back up.
  Your vault inherits the durability, version history, and sync of storage you
  already maintain. The server stays stateless; losing it costs you nothing but
  the time to start another one.

The longer answer is in the README's
[Why Google Drive?](https://github.com/ralphv/portunus#why-google-drive)
section.

## Can I use it without Google?

Not today. If you don't want Google in the loop, that's a legitimate position,
and right now it means Portunus is not for you.

Storage sits behind a provider interface
([`src/lib/store/store-interface.ts`](https://github.com/ralphv/portunus/blob/main/src/lib/store/store-interface.ts)),
so other backends — S3-compatible, WebDAV, local disk — are a natural
contribution. If you want one,
[open a discussion](https://github.com/ralphv/portunus/discussions).

## What happens if I lose my keyfile?

Use your recovery code instead: the unlock screen has **Restore from recovery
code instead**. If you've lost all copies of the keyfile **and** the recovery
code, the vault is unrecoverable. Nobody — including the server operator — can
get it back. There is no password reset; that's the point.

While the vault is unlocked you can export the keyfile and recovery code again
from the vault's security settings.

## What happens if I forget my master password?

The same: there's no reset. The vault needs both the password and the keyfile.

## How do I back up my vault?

Your vault is the `portunus.vault.json` file in the `Portunus Application`
folder of your Google Drive, so it's covered by whatever already protects your
Drive, including Drive's own version history. The container has nothing to back
up.

Back up your **keyfile and recovery code** separately — the README suggests
printing the code or keeping it in another password manager. A copy of the
vault file is useless without them.

## Can I share entries with family or a team?

No. Portunus is a **personal** vault, by design. Each user's vault is their own
encrypted file in their own Google Drive, unlocked by their own password and
keyfile. There's no central database or shared key infrastructure to share
entries through, and no orgs, roles, shared folders or admin recovery.

If you need sharing, a team or family password manager is the better choice.

## Who can sign in to my instance?

Any Google account your OAuth client accepts. While your consent screen is in
**Testing**, that's only the accounts you list as test users. Once it's **In
production**, anyone with a Google account who can reach your instance can sign
in and create their own vault — in *their* Drive, with their own password and
keyfile. They can't see your vault, but they are using your server.

To keep an instance to yourself, leave the consent screen in Testing with only
your accounts listed, or make the instance reachable only to you, for example
with [Tailscale](https.md#option-3-tailscale-serve).

## Why am I asked to sign in with Google every week?

Your OAuth consent screen is in *Testing*, where Google's refresh tokens expire
after 7 days. See
[Google OAuth setup](google-oauth.md#testing-mode-and-the-7-day-sign-in).

## Why doesn't it work at `http://192.168.x.x` or `http://something.local`?

Browsers only allow the unlock cryptography on HTTPS or `localhost`, and Google
refuses those addresses as sign-in redirects. See
[Running it over HTTPS](https.md).

## Does it work offline?

Partly. With offline mode on (the default), the vault opens **read-only** from
a cached copy of the ciphertext and recovers automatically when connectivity
returns. Operators can turn it off with `DISABLE_OFFLINE_MODE=1`.

## Is there a browser extension or mobile app?

No. Portunus is a web app; on a phone you use it in the browser.

## Has it been audited?

No. Portunus has not been independently security-audited. See the
[Security model](security.md) page and
[SECURITY.md](https://github.com/ralphv/portunus/blob/main/SECURITY.md#no-independent-audit)
for what that means and what to review.

## What does AGPL-3.0 mean for me?

Self-host it, fork it — but if you offer a modified version as a hosted service
you must share the source. See [LICENSE](https://github.com/ralphv/portunus/blob/main/LICENSE).
