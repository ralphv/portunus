# PoC: malicious browser extension vs. Portunus

**Authorized security research against our own code.** This unpacked Chrome
MV3 extension demonstrates that a hostile browser extension defeats every
in-page defense Portunus currently has. It is a *local-only* demonstrator: it
intercepts secrets and logs them to the page/console (and shows a red badge),
but performs **no network exfiltration**. Do not extend it into a real stealer.

## Why it works: the MAIN world is outside the CSP

Portunus's security model names the Content-Security-Policy as "the primary,
browser-enforced control against injected scripts" (`src/lib/csp.ts`), and
`secret-input.tsx` notes: *"the CSP is what keeps such script out."*

A Chrome extension content script declared with `"world": "MAIN"`
(`manifest.json`) runs **in the page's own JavaScript realm, with the page's
own privileges, and is not subject to the page's CSP.** The page CSP governs
what the *page's* HTML/scripts may load and execute; it does not govern
scripts the browser injects on an extension's behalf. With
`"run_at": "document_start"` our hook installs **before** Portunus's bundle
runs — before the vault Worker is ever created.

So the entire perimeter ("keep hostile script out of the page") is bypassed by
design. Once attacker JS runs in the page realm, it is a peer of Portunus's own
code.

## What it steals, and how

`harvester.js` (MAIN world) hooks three things:

1. **The vault Worker message channel** — the single chokepoint for *all*
   plaintext. Portunus isolates keys and secrets in a dedicated Worker and
   talks to it via `postMessage`. That is a memory/process boundary, not a
   trust boundary against same-realm script. We wrap `window.Worker`, so for
   every vault we see both directions:
   - **outgoing** `open` / `create` / `verifyPassword` / `changePassword`
     carry the **master password and keyfile bytes** as call arguments;
   - **incoming** `reveal` / `totp` / `exportKeyfile` responses carry **every
     secret the user views**, in plaintext.
2. **The clipboard** — `navigator.clipboard.writeText`, so "copy password" and
   "copy recovery code" are captured.
3. **Password-field keystrokes** — a fallback keylogger on the unlock screen.

`bridge.js` (ISOLATED world) and `background.js` (service worker) show where a
real attacker would relay and exfiltrate — the background worker has the
extension's own host permissions and is **not** bound by the page's
`connect-src 'self'`, so it could POST the loot anywhere. This PoC deliberately
only tallies a counter in `chrome.storage`.

## Proven capture (demo-mode run)

Captured verbatim by `harvester.js` driving the real UI:

```
CLIPBOARD        : KEXT-QZ3K-...-N62G                     (recovery code = keyfile)
MASTER-CREDENTIAL: create     ["Tr0ub4dour&3-horse-staple", "<32 key bytes>"]
MASTER-CREDENTIAL: setSecret  [id, "password", "hunter2-amazon-prod-password"]
MASTER-CREDENTIAL: reveal     [id]
REVEALED-SECRET  : ["hunter2-amazon-prod-password"]       ← viewed while unlocked
```

Both factors needed to decrypt the vault (master password + keyfile) **and**
the individual secrets were intercepted, despite the strict CSP, the Worker
isolation, and the `SecretField` DOM-minimization work.

## Run it yourself

```bash
PORTUNUS_DEMO_MODE=1 npm run dev          # serve on :3000
```

Load `attack-extension/` at `chrome://extensions` (Developer mode → "Load
unpacked"), open the app, and watch the red badge count captures. Or drive it
headless with a Playwright script that launches Chromium with
`--load-extension=attack-extension`.

## The uncomfortable conclusion

A web password manager **cannot** keep its plaintext secret from a malicious
extension the user has installed, because such an extension runs as a peer of
the page. Hardening can raise the cost and narrow the window (see
`FINDINGS.md`), but it cannot make a browser-tab vault immune to code running
in its own realm. Defenses worth having are about *tamper-evidence, blast-radius
reduction, and detection* — not a hard guarantee.
