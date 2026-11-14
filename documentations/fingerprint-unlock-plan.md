# Fingerprint unlock — implementation plan

Status: Phases 1–4 implemented. Phase 0 (real-device check) is up to the
owner. The UI says "biometrics" (fingerprint, face or screen lock); the
second flag `PORTUNUS_BIOMETRIC_SAVE_CONFIRM=0` keeps saves on the master
password (default: biometrics may confirm a save). User-facing docs: README
"Biometric unlock", docs/configuration.md, SECURITY.md.

## Summary

An opt-in, per-device shortcut that unlocks the vault with the phone's
fingerprint/face check (WebAuthn passkey + PRF extension) instead of typing
the master password. Off unless the operator sets
`PORTUNUS_BIOMETRIC_UNLOCK=1`.

The vault file in Drive is **never changed** by this feature: its data key
stays wrapped by `Argon2id(master password ‖ keyfile)`, and every device can
always unlock with password + keyfile. An enrolled device additionally keeps,
in its own localStorage, a copy of the **data key** encrypted under a secret
the phone releases only after a fingerprint check.

```
Password path (every device):    password + keyfile → Argon2id → data key → vault
Fingerprint path (enrolled only): fingerprint → PRF secret → local blob → data key → vault
```

## Decisions

| Topic | Decision |
|---|---|
| What the device blob holds | The **data key** (not the master password) — passing the fingerprint check never reveals the password |
| Feature flag | `PORTUNUS_BIOMETRIC_UNLOCK=1` enables it; unset/anything else = off |
| Flag off | No fingerprint UI anywhere; leftover blobs deleted on next load (kill switch) |
| Fingerprint accepted for | Unlock, and the save confirmation |
| Password still required for | Change password, export keyfile, enable/disable 2FA, enrolling, engine upgrade |
| Keyfile | Must be installed in this browser to enroll; removing it also removes the enrollment |
| Server-side 2FA (TOTP) | Unchanged — still asked when enabled |
| Removal | Per device, no password needed; deletes the blob, best-effort asks the passkey manager to drop the passkey |
| Revoke all devices | Change the master password (new data key → every blob is stale) |
| Server changes | None besides reading the env flag (no new API, no stored state) |

## Crypto

- **PRF secret**: `navigator.credentials.get({ publicKey: { allowCredentials:
  [credentialId], userVerification: "required", extensions: { prf: { eval: {
  first: prfSalt } } } } })` → 32 bytes, deterministic per (passkey, salt),
  released only after user verification. Never stored.
- **Wrap key**: `HKDF-SHA256(prf, salt = prfSalt, info = "portunus-device-unlock-v1")`.
- **Blob encryption**: XChaCha20-Poly1305 (libsodium), AAD =
  canonical `{ v, kid, credentialId, headerDigest }`.
- **headerDigest**: SHA-256 of the vault's key-wrap header (`format`,
  `version`, `engine`, `kdf`, `wrappedDataKey`). A password change or engine
  upgrade changes it → blob detected as stale before decrypting.
- **Stored blob** (localStorage key in `src/constants.ts`, one per keyfile kid):
  `{ v: 1, kid, credentialId, prfSalt, headerDigest, nonce, wrappedDataKey, createdAt }`
  — validated with hand-written checks (browser input; Zod stays server-side
  per AGENTS.md).
- The PRF secret is computed on the main thread (WebAuthn is not available in
  Workers) and sent once to the vault Worker, which does all unwrap/decrypt;
  the data key never leaves the Worker.

## Lifecycle

| Event | Effect on enrollment |
|---|---|
| Enroll | Password unlock first → fingerprint → blob written |
| Normal save | Unchanged (same data key) |
| Change master password | All blobs stale; current device offered re-enroll right away |
| Engine upgrade on save | Same as password change |
| Remove fingerprint unlock | Blob deleted; `PublicKeyCredential.signalUnknownCredential` where supported |
| Remove keyfile from browser | Blob deleted too |
| Flag turned off | Blobs deleted on next load |
| Stale blob at unlock | Deleted; message "Fingerprint unlock needs to be re-enabled"; password unlock shown |
| Offline | Works with the cached ciphertext (same data key) |

## Phases

### Phase 0 — device spike (½ day)
Confirm PRF at `create()` and `get()` on: Android Chrome + Google Password
Manager, iOS/iPadOS 18+ Safari + iCloud Keychain, both in-browser and as the
installed PWA; note behaviour with 1Password/Bitwarden as passkey provider.
Handle platforms that return PRF only at `get()` (enroll = create + immediate get).

### Phase 1 — crypto + Worker (no UI) — done
- `src/crypto/device-unlock.ts`: `vaultHeaderDigest()`,
  `wrapDataKeyForDevice()`, `unwrapDeviceDataKey()`,
  `checkDeviceUnlockRecord()` / `parseDeviceUnlockRecord()`,
  `generatePrfSalt()`, `sameKey()`; client-safe
  (`src/crypto/device-unlock.test.ts`).
- `VaultSession`: `fromRemoteWithDevice(remote, record, prf, keyfile)`,
  `wrapForDevice(prf, meta)`, `verifyDevice(record, prf)`.
- `VaultWorkerCore` + `VAULT_WORKER_METHODS`:
  `enrollDevice(password, prf, meta)` (re-checks the master password),
  `openWithDevice(remote, record, prf, keyfile)`, `verifyDevice(record, prf)`;
  the PRF copy handed to the Worker is wiped after use
  (`src/lib/vault-worker-core.device.test.ts`).
- `VaultClient.openWithDevice()` on the main thread.
- `DeviceUnlockError` (generic) / `DeviceUnlockStaleError` cross the Worker
  boundary intact, so the UI can tell "re-enable" from "failed".

### Phase 2 — WebAuthn component (`src/lib/biometric/`) — done
- `biometric-interface.ts` → `BiometricInterface`: `isSupported()`,
  `enroll(kid)` → `{ credentialId, prfSalt, prf }`, `evaluate(credentialId, prfSalt)`,
  `forget(credentialId)`.
- `providers/webauthn-prf-biometric-provider.ts`: support =
  `isUserVerifyingPlatformAuthenticatorAvailable()` and
  `getClientCapabilities()["extension:prf"]`; `userVerification: "required"`,
  random user id, rpId = page origin. No `authenticatorAttachment` restriction,
  so FIDO2 security keys with `hmac-secret` (PRF) work too — user verification
  on a key is its FIDO2 PIN (or its own fingerprint reader).
- `providers/nop-biometric-provider.ts`: unsupported, used when the flag is off.
- `factory.ts` → `createBiometricFactory(enabled)`; re-exported from `@/factory`.
- `src/lib/device-unlock-store.ts`: read/write/delete blobs in localStorage.
- All strings in `src/constants.ts`.

### Phase 3 — flag + UI — done
- `src/app/page.tsx`: `biometricUnlock={process.env.PORTUNUS_BIOMETRIC_UNLOCK === "1"}`
  → `VaultApp` → unlock screen / editor (same pattern as `hibpOnEdit`).
- **Unlock screen**: enrolled for the loaded kid → primary "Unlock with
  fingerprint" (tap-triggered; iOS requires a gesture) + "Use master
  password"; "Remove fingerprint unlock" link. Failures show the generic
  unlock message.
- **After a password unlock** on a supported, unenrolled device: one-time,
  dismissible "Unlock with fingerprint next time?" (dismissal remembered per
  device).
- **Security dialog**: "Enable fingerprint unlock on this device" (password →
  fingerprint) / "Remove fingerprint unlock" + "enabled on {date}".
- **Save dialog**: "Confirm with fingerprint" alongside the password field.
- **Change password**: on success, offer re-enroll on this device.
- No CSP / Permissions-Policy change (WebAuthn defaults to same-origin).

### Phase 4 — tests + docs — done
- `scripts/smoke/tests/biometric.mjs` via CDP virtual authenticator
  (`WebAuthn.addVirtualAuthenticator`, `hasPrf: true`, `hasUserVerification: true`):
  - flag off: no fingerprint UI even with an authenticator
  - flag on, no PRF / no authenticator: no fingerprint UI
  - prompt after password unlock; dismiss; enroll from Security
  - lock → unlock with fingerprint
  - `isUserVerified: false` → generic error, password still works
  - save confirmed by fingerprint
  - change password → stale message, blob cleared, re-enroll
  - remove (unlock screen + Security) → button gone
  - remove keyfile → enrollment gone
- Smoke harness: run the container with the flag on, plus one flag-off check.
- Update: `SMOKE.md`, README Features + configuration table,
  `docs/configuration.md`, `.env.example`, `SECURITY.md`/`docs/security.md`
  (trust model below), `.devin/blueprint.yaml`, `CHANGELOG.md`.

## Security notes for the docs

- On an enrolled device, "password + keyfile" becomes "this device + its
  keyfile + its screen lock". The phone's PIN/pattern also passes the check
  (WebAuthn can't require a fingerprint specifically).
- Passing the check gives read access to the current vault on that device
  only; it never reveals the master password, and sensitive actions still
  require it.
- Changing the master password revokes every enrolled device.
- Passkeys may sync (Google / iCloud); harmless without the device-local blob.
- Changing the app's domain (`AUTH_URL`) invalidates enrollments.

## Out of scope (possible later)

Passkey as a server-verified second factor alongside TOTP (public key in the
signed vault wrapper, challenge cookie like the TOTP grant cookies).
