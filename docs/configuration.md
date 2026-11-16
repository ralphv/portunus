# Configuration

Portunus is configured entirely through environment variables. Set them in
your compose file, or in an `.env` file (`.env.local` for development) that
stays out of git. The repository's
[`.env.example`](https://github.com/ralphv/portunus/blob/main/.env.example)
lists every variable with placeholder values.

| Variable | Required | Description |
|---|---|---|
| `AUTH_GOOGLE_ID` | yes | Google OAuth client ID ([setup](./google-oauth)) |
| `AUTH_GOOGLE_SECRET` | yes | Google OAuth client secret |
| `AUTH_SECRET` | yes | Session encryption secret. Generate with `openssl rand -hex 32` (or `npx auth secret`) |
| `AUTH_URL` | yes | Public origin, for example `https://vault.example.com` ([HTTPS](./https)) |
| `PORTUNUS_SIGNING_PRIVATE_KEY` | yes, unless signatures are disabled or in demo mode | Ed25519 private key used to sign and verify the Drive vault file: base64 of the DER-encoded PKCS#8 key, one line. See [Vault signatures](#vault-signatures) |
| `PORTUNUS_SIGNATURES_DISABLED` | no | `1` turns vault signatures off entirely: no key needed, the vault is stored and read as a bare envelope (default: off) |
| `PORTUNUS_ALLOW_MISSING_SIGNATURE` | no | `1` accepts legacy **unsigned** vault files during migration; a present but invalid signature is still rejected. Remove once every vault has been re-saved (default: off) |
| `PORTUNUS_HIBP_ON_EDIT` | no | `0` disables the silent Have I Been Pwned re-check on password edits entirely and hides its Settings toggle (default: on) |
| `DISABLE_OFFLINE_MODE` | no | `1` disables the offline mode feature entirely (default: off) |
| `PORTUNUS_BIOMETRIC_UNLOCK` | no | `1` turns on biometric unlock: a device can unlock with its fingerprint, face or screen lock instead of the master password, after the user enables it there (default: off) — see [Biometric unlock](#biometric-unlock) |
| `PORTUNUS_BIOMETRIC_SAVE_CONFIRM` | no | `0` makes saves always ask for the master password, even on a device with biometric unlock; otherwise biometrics can confirm a save (default: on; only applies with `PORTUNUS_BIOMETRIC_UNLOCK=1`) |
| `PORTUNUS_DEMO_MODE` | no | `1` enables demo mode with in-memory storage and stubbed sign-in; vault signing is skipped (default: off). **Never use with real secrets** |

**The server refuses to start if any required variable is missing**,
including `PORTUNUS_SIGNING_PRIVATE_KEY` being unset or unparseable while
signatures are enabled. Demo mode is the exception: it needs no `AUTH_*`
variables and skips the check.

## `AUTH_URL`

`AUTH_URL` must match the origin users type into the browser. It drives OAuth
callback URLs and cookie flags. Your Google OAuth client's redirect URI must be
`<AUTH_URL>/api/auth/callback/google`.

## Have I Been Pwned checks

Portunus can check passwords against
[Have I Been Pwned](https://haveibeenpwned.com/Passwords) using k-anonymity:
only the first 5 hex characters of the password's SHA-1 hash leave the browser,
and the request goes directly from the browser, not through the Portunus
server. Checks run from the menu's audit and, by default, automatically when a
password is edited.

`PORTUNUS_HIBP_ON_EDIT=0` stops the automatic on-edit check, so the app never
contacts `api.pwnedpasswords.com` on its own. You may want this when:

- Your policy forbids any third-party requests during secret handling.
- The instance is meant for fully offline or air-gapped use.
- You prefer explicit consent. The menu's audit stays available either way.

With the variable on (the default), each user can still turn the on-edit check
off for their own vault in **Settings**. That preference is stored inside the
encrypted vault and syncs to their other devices. Setting the variable to `0`
hides the toggle and disables the check no matter the saved preference.

## Offline mode

By default, the browser keeps a cached copy of the vault **ciphertext** in
`localStorage`. If Drive or the server is unreachable, the vault opens
read-only from that cache and recovers automatically when connectivity
returns. Set `DISABLE_OFFLINE_MODE=1` to turn the feature off.

## Biometric unlock

Optional, per device, and off unless the operator sets
`PORTUNUS_BIOMETRIC_UNLOCK=1`. A user then enables it on a device under
Security → *Biometric unlock* (master password, then the device's fingerprint,
face or screen-lock check), or from the one-time "Unlock with biometrics next
time?" offer after a password unlock on a device with a built-in sensor. On
that device the unlock screen leads with *Unlock with biometrics*, and the
save dialog offers *Confirm with biometrics* unless
`PORTUNUS_BIOMETRIC_SAVE_CONFIRM=0`. When the page loads, the check starts by
itself (once the tab is visible and focused); after *Lock* it waits for the
button, and on a two-factor vault it waits for the code. Browsers that only
allow WebAuthn after a tap (Safari on iOS) just show the button.

**How it works.** It uses a WebAuthn passkey with the PRF extension, which
releases a fixed 32-byte secret only after the device verifies the user. A key
derived from that secret encrypts a copy of the vault's data key, and that
record stays in the device's `localStorage`. The vault file in Drive is not
changed: its data key is still wrapped by `Argon2id(password ‖ keyfile)`, so
the master password keeps working on every device. The master password is
never stored. Nothing new reaches the server.

**What changes on an enrolled device.** Unlocking there needs the device, its
installed keyfile, and its biometric or screen-lock check. Any check the
device accepts counts, including its PIN or pattern: a website can't require a
fingerprint specifically. Changing the master password, exporting the keyfile
and turning two-factor on or off still need the master password, and
two-factor still asks for its code.

**Turning it off.** *Remove biometric unlock* (Security dialog or unlock
screen, no password needed) deletes the device's record. *Remove key* does the
same. Changing the master password gives the vault a new data key, which turns
biometric unlock off on **every** device. Turning the flag off deletes any
records on the next visit. Phones and laptops with a fingerprint or face
sensor work, and so do FIDO2 security keys that support PRF (`hmac-secret`;
user verification is the key's PIN). Moving the app to another domain
(`AUTH_URL`) requires setting it up again.

## Vault signatures

Every save goes through the Portunus server, which signs the vault file with
Ed25519 before it is stored in Drive. The signature covers the encrypted
payload **and the Drive file id**, so a signed file copied over another vault
file doesn't verify. On load the server checks it before returning anything;
if the signature is missing or wrong, the app refuses to unlock ("vault
signature invalid — the file may have been tampered with"). The browser never
sees the signature wrapper.

This detects edits to `portunus.vault.json` made outside Portunus, by someone
with access to your Google account or Drive, a sync client, or another tool.
It doesn't protect against a compromised Portunus server (which holds the key),
and it doesn't stop someone with Drive access from putting back an older copy
of the same file (rollback).

Generate the key once per deployment, as shown in
[Install](./install#docker-compose), and keep it as secret as `AUTH_SECRET`.

**Upgrading an install whose vaults predate signatures.** Unsigned vaults are
rejected by an enforcing server, and every save writes the signed format:

1. Set `PORTUNUS_SIGNING_PRIVATE_KEY` **and**
   `PORTUNUS_ALLOW_MISSING_SIGNATURE=1`, then restart.
2. Have each user unlock and **save** their vault once.
3. Once the server stops logging `[vault] accepted unsigned vault …`, remove
   `PORTUNUS_ALLOW_MISSING_SIGNATURE` and restart.

::: warning
While `PORTUNUS_ALLOW_MISSING_SIGNATURE=1` is set, a tampered file with its
signature stripped would be accepted too. Keep the migration window short. A
file that *has* a signature is always verified.
:::

**Rotating or losing the key.** Every signed vault fails verification under a
different key. To rotate, set `PORTUNUS_SIGNATURES_DISABLED=1`, re-save every
vault, then remove the flag and restart with the new key, with
`PORTUNUS_ALLOW_MISSING_SIGNATURE=1` until the vaults are saved again.

The full design is in README's
[Vault signatures](https://github.com/ralphv/portunus/blob/main/README.md#vault-signatures).

## Two-factor vault delivery

Optional, per vault, and needs no server configuration: in the app, open
**Security → Enable two-factor authentication**, re-enter your master
password, scan the QR code (or type the manual key) into an authenticator
app, and confirm a code. From then on the server serves the vault only after
a fresh 6-digit code, on every unlock, including after a lock or a reload. A
failed unlock says "Wrong password, keyfile or two-factor code" without
telling which one. **Disable 2FA** in the same dialog removes it.

The TOTP secret is stored next to the ciphertext in the signed wrapper, so it
can't be stripped or swapped without the file failing verification.

**What it does and doesn't protect.** It gates the Portunus server's delivery
of the vault only. It stops someone who has your password and keyfile and can
sign in as you, but doesn't have your authenticator. Anyone who can read the
Drive file directly still gets the ciphertext, which still needs the password
**and** the keyfile; and a device that has cached the vault for
[offline mode](#offline-mode) can open it read-only without a code.

::: warning Keep the manual key
Losing the authenticator locks the app out of your vault. Recovery needs the
server operator: run with `PORTUNUS_SIGNATURES_DISABLED=1`, delete the `totp`
key from the Drive file, unlock and save once, then re-enable signatures with
`PORTUNUS_ALLOW_MISSING_SIGNATURE=1` until the next save re-signs it.
:::

Details are in README's
[Two-factor vault delivery](https://github.com/ralphv/portunus/blob/main/README.md#two-factor-vault-delivery).

## Demo mode

`PORTUNUS_DEMO_MODE=1` replaces Google sign-in with a stubbed session and
Google Drive with an in-memory store. It works in the published Docker image
and powers the [local demo](./demo). Demo mode is intentionally
unauthenticated; never put real secrets in it.
