# Configuration

Portunus is configured entirely through environment variables. Set them in
your compose file, or in an `.env` file (`.env.local` for development) that
stays out of git.

| Variable | Required | Description |
|---|---|---|
| `AUTH_GOOGLE_ID` | yes | Google OAuth client ID ([setup](./google-oauth)) |
| `AUTH_GOOGLE_SECRET` | yes | Google OAuth client secret |
| `AUTH_SECRET` | yes | Session encryption secret. Generate with `openssl rand -hex 32` (or `npx auth secret`) |
| `AUTH_URL` | yes | Public origin, for example `https://vault.example.com` ([HTTPS](./https)) |
| `PORTUNUS_HIBP_ON_EDIT` | no | `0` disables the silent Have I Been Pwned re-check on password edits entirely and hides its Settings toggle (default: on) |
| `DISABLE_OFFLINE_MODE` | no | `1` disables the offline mode feature entirely (default: off) |
| `PORTUNUS_BIOMETRIC_UNLOCK` | no | `1` turns on biometric unlock: a device can unlock with its fingerprint, face or screen lock instead of the master password, after the user enables it there (default: off) — see [Biometric unlock](#biometric-unlock) |
| `PORTUNUS_BIOMETRIC_SAVE_CONFIRM` | no | `0` makes saves always ask for the master password, even on a device with biometric unlock; otherwise biometrics can confirm a save (default: on; only applies with `PORTUNUS_BIOMETRIC_UNLOCK=1`) |
| `PORTUNUS_DEMO_MODE` | no | `1` enables demo mode with in-memory storage and stubbed sign-in (default: off). **Never use with real secrets** |

**The server refuses to start if any required variable is missing.** Demo
mode is the exception: it needs no `AUTH_*` variables and skips the check.

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

## Demo mode

`PORTUNUS_DEMO_MODE=1` replaces Google sign-in with a stubbed session and
Google Drive with an in-memory store. It works in the published Docker image
and powers the [local demo](./demo). Demo mode is intentionally
unauthenticated; never put real secrets in it.
