# Findings: extension attack & hardening options

## Result

A ~130-line MV3 extension (`attack-extension/`) captured, from a live Portunus
session in a normal browser:

- the **master password** and **keyfile bytes** (at unlock/create),
- the **recovery code** (keyfile material) when copied,
- **every secret the user revealed**, in plaintext.

It did this with the strict CSP, the vault-Worker isolation, and the
`SecretField` DOM-minimization all in force. See `README.md` for the mechanism.

## This is a confirmed limit, not a new bug

`SECURITY.md` already places malicious extensions **out of scope** and even
predicts this exact technique: *"Content scripts run in an isolated world and
need no `<script>` tag; an extension can also run before the check or patch
`MutationObserver`, `querySelectorAll`, `fetch`, or `crypto.subtle`."* The PoC
turns that paragraph into a working demonstration.

**The root cause is structural:** a `"world": "MAIN"` content script executes in
the page's own JS realm, at `document_start`, outside the page CSP. It is a
*peer* of Portunus's own code. Any plaintext that must exist in the page
realm — because it is typed into an input, shown on screen, or copied — is
reachable by a peer. No amount of in-page engineering changes that. A browser
tab cannot keep a secret from code the user has authorized to run inside that
tab.

So the honest framing for "hardening" is **not** "make the web vault immune."
It is: *raise attacker cost, shrink the exposure window, and make tampering
detectable.* None of the below is a guarantee; each is defense-in-depth with a
clear ceiling.

## What is already good (keep it)

- **On-demand reveal.** The decrypted vault document and the bulk of secrets
  stay in the Worker; the main thread only receives a secret when the user
  actually reveals/copies it. A channel hook therefore leaks *only what the
  user views*, not the whole vault in one shot. This is a real blast-radius
  win — do not regress it by bulk-returning secrets to the main thread.
- **Short reveal + aggressive auto-lock.** Narrows the window in which `reveal`
  responses flow.
- **`.value`-only secret inputs.** Defeats DOM-snapshot/CSS exfiltration (a
  weaker attacker than an extension). Still worth keeping.

## Options worth weighing (all defense-in-depth)

### 1. Tamper-evidence: detect patched native APIs (highest value/cost ratio)
Extend the existing runtime self-check to notice that `window.Worker`,
`navigator.clipboard.writeText`, `MessagePort.prototype.postMessage`,
`crypto.subtle`, or `EventTarget.prototype.addEventListener` are no longer
native (`Function.prototype.toString` not `[native code]`, constructor
`.name` changed, etc.) and surface the existing *"an extension may be reading
this page"* banner.
- **Ceiling:** a competent extension patches `toString` too, or hooks earlier.
  Catches lazy/generic stealers, not a targeted one. Cheap, no false positives
  on a clean browser (needs testing against common benign extensions —
  password managers, React DevTools — which also patch globals, so this risks
  noise). **Recommend as opt-in or warn-only, carefully tuned.**

### 2. Reduce what crosses the Worker boundary
Today `open`/`create` ship the **master password** across `postMessage`. The
password is already in the page realm (it was typed into an input), so moving
the KDF entirely into the Worker does **not** hide it from a keylogger — but it
does remove one clean, generic chokepoint (`Worker.postMessage`) that catches
the password without any field-detection logic.
- **Ceiling:** marginal. A keylogger or an input-`.value` read still gets it.
  Low priority; only worth it if it falls out of other refactoring.

### 3. Prefer WebAuthn PRF (biometric) unlock where available
With passkey-PRF unlock the **master password is never typed into the page** on
that device, removing the keylog/clipboard/`open`-argument exposure of the
password itself.
- **Ceiling:** the PRF-derived key material still transits `postMessage` to the
  Worker, so a channel hook still captures an effective unlocking secret; and
  revealed secrets still leak. It narrows the attack (no reusable *password*),
  it does not close it. Already supported — worth recommending to users as the
  safer unlock, and documenting *why* in SECURITY.md.

### 4. Clipboard hygiene
Auto-clear the clipboard after a timeout and prefer a reveal-then-manual-copy
flow over programmatic `writeText` where practical.
- **Ceiling:** does nothing against the hook itself (it fires on write); only
  limits how long plaintext persists in the OS clipboard for *other* readers.
  Minor, independent of this threat.

### 5. User-facing documentation (do this regardless)
The strongest honest control is informing the user: a short "Browser extensions
can read anything on this page, including your vault while unlocked. Install
only extensions you trust; consider a dedicated browser profile for Portunus."
note in the UI/README. This matches the real trust boundary.

## Recommendation

1. Keep the architecture as-is (on-demand reveal is doing real work).
2. Add the native-API tamper-evidence check (#1) as **warn-only**, after
   testing it doesn't false-positive on common benign extensions — or decide
   the noise isn't worth it and skip.
3. Document the extension trust boundary in-product (#5) and point users to
   PRF/biometric unlock (#3).
4. Do **not** invest in #2/#4 as security controls; they don't move the needle
   against this attacker.

The one thing not to do is imply to users that the web app can defend the vault
from extensions. It can't, SECURITY.md already says so, and this PoC is the
receipt.
