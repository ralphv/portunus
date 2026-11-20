// Best-effort runtime check that the browser builtins Portunus relies on to
// move and protect plaintext have not been monkey-patched — the technique a
// malicious extension's MAIN-world content script uses (see
// attack-extension/). Like the script self-check (script-integrity.ts) this is
// NON-BLOCKING tamper-evidence, not a defense: an extension runs as a peer of
// the page and can defeat any in-page check (e.g. by also patching
// Function.prototype.toString to return native-looking strings for everything,
// or wrapping a builtin in a Proxy). Malicious extensions remain out of scope
// (SECURITY.md); this only raises the cost of the laziest, most generic
// stealers and gives the user a chance to notice.
//
// Findings are tiered to avoid crying wolf:
//   tier 1 — builtins that carry Portunus's own secrets (the vault Worker
//            channel, WebCrypto, the RNG) and that benign extensions rarely
//            touch. These surface the warning banner.
//   tier 2 — exfiltration / input-interception primitives that malicious
//            extensions might use, but that legitimate extensions (password
//            managers, Grammarly, React DevTools, ad blockers) also patch, so
//            a banner would false-positive. These are logged to the console
//            only.

export interface NativeFindingInterface {
  /** Human-readable name of the builtin, e.g. "Worker.prototype.postMessage". */
  label: string;
  reason: string;
  tier: 1 | 2;
}

const NATIVE_MARKER = "[native code]";
const NOT_NATIVE_REASON = "no longer a native function";

/** Read a dotted path off an object tree, returning undefined on any miss. */
function get(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const key of path.split(".")) {
    if (cur === null || (typeof cur !== "object" && typeof cur !== "function"))
      return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** True if `fn` is an unmodified native function. */
function isNativeFn(fn: unknown, expectedName?: string): boolean {
  if (typeof fn !== "function") return false;
  let src: string;
  try {
    src = Function.prototype.toString.call(fn);
  } catch {
    // A Proxy's toString trap can throw — treat as tampered.
    return false;
  }
  if (!src.includes(NATIVE_MARKER)) return false;
  // Replacing a builtin usually changes its .name ("PatchedWorker", "", or a
  // "bound " prefix on a bound native). Only flag a present, mismatched name.
  if (expectedName && fn.name && fn.name !== expectedName) return false;
  return true;
}

/**
 * True unless the target is present and demonstrably patched. An absent target
 * (a builtin this browser doesn't have) is "can't tell", not a finding, so
 * missing globals never raise the banner.
 */
function okFn(fn: unknown, expectedName?: string): boolean {
  if (fn == null) return true;
  return isNativeFn(fn, expectedName);
}

/** True unless the accessor pair of a property descriptor is patched. */
function okAccessor(owner: unknown, prop: string): boolean {
  if (owner === null || typeof owner !== "object") return true;
  const d = Object.getOwnPropertyDescriptor(owner, prop);
  if (!d || (!("get" in d) && !("set" in d))) return true; // absent/data prop
  return (!d.get || isNativeFn(d.get)) && (!d.set || isNativeFn(d.set));
}

type Check = { label: string; tier: 1 | 2; ok: () => boolean };

/**
 * Evaluate every builtin check against the given realm (defaults to the global
 * object; tests pass a stub). Each check is wrapped so a throw (missing global,
 * exotic object) is treated as "can't tell", never as a finding.
 */
export function checkNativeIntegrity(
  scope: typeof globalThis = globalThis,
): NativeFindingInterface[] {
  const s: unknown = scope;
  const checks: Check[] = [
    // --- meta: if toString itself lies, native-code checks are unreliable ---
    {
      label: "Function.prototype.toString",
      tier: 1,
      ok: () =>
        Function.prototype.toString
          .call(Function.prototype.toString)
          .includes(NATIVE_MARKER),
    },

    // --- tier 1: the vault Worker channel (how the PoC stole everything) ---
    { label: "Worker", tier: 1, ok: () => okFn(get(s, "Worker"), "Worker") },
    {
      label: "Worker.prototype.postMessage",
      tier: 1,
      ok: () => okFn(get(s, "Worker.prototype.postMessage"), "postMessage"),
    },
    {
      label: "Worker.prototype.terminate",
      tier: 1,
      ok: () => okFn(get(s, "Worker.prototype.terminate"), "terminate"),
    },
    {
      label: "Worker.prototype.onmessage",
      tier: 1,
      ok: () => okAccessor(get(s, "Worker.prototype"), "onmessage"),
    },
    {
      label: "MessagePort.prototype.postMessage",
      tier: 1,
      ok: () => okFn(get(s, "MessagePort.prototype.postMessage"), "postMessage"),
    },

    // --- tier 1: WebCrypto + RNG (key derivation / password generation) ---
    {
      label: "crypto.getRandomValues",
      tier: 1,
      ok: () => okFn(get(s, "crypto.getRandomValues"), "getRandomValues"),
    },
    {
      label: "crypto.subtle",
      tier: 1,
      ok: () => {
        const subtle = get(s, "crypto.subtle");
        if (subtle == null) return true;
        if (Object.prototype.toString.call(subtle) !== "[object SubtleCrypto]")
          return false;
        return ["encrypt", "decrypt", "importKey", "deriveKey", "deriveBits", "digest"].every(
          (m) => isNativeFn(get(subtle, m), m),
        );
      },
    },

    // --- tier 2: exfiltration primitives (console only — benign-patched) ---
    {
      label: "navigator.clipboard.writeText",
      tier: 2,
      ok: () => okFn(get(s, "navigator.clipboard.writeText"), "writeText"),
    },
    {
      label: "navigator.clipboard.write",
      tier: 2,
      ok: () => okFn(get(s, "navigator.clipboard.write"), "write"),
    },
    {
      label: "document.execCommand",
      tier: 2,
      ok: () => okFn(get(s, "document.execCommand"), "execCommand"),
    },
    { label: "fetch", tier: 2, ok: () => okFn(get(s, "fetch"), "fetch") },
    {
      label: "XMLHttpRequest.prototype.open",
      tier: 2,
      ok: () => okFn(get(s, "XMLHttpRequest.prototype.open"), "open"),
    },
    {
      label: "XMLHttpRequest.prototype.send",
      tier: 2,
      ok: () => okFn(get(s, "XMLHttpRequest.prototype.send"), "send"),
    },
    {
      label: "navigator.sendBeacon",
      tier: 2,
      ok: () => okFn(get(s, "navigator.sendBeacon"), "sendBeacon"),
    },
    { label: "WebSocket", tier: 2, ok: () => okFn(get(s, "WebSocket"), "WebSocket") },

    // --- tier 2: input interception (console only — autofill-patched) ---
    {
      label: "EventTarget.prototype.addEventListener",
      tier: 2,
      ok: () =>
        okFn(get(s, "EventTarget.prototype.addEventListener"), "addEventListener"),
    },
    {
      label: "HTMLInputElement.prototype.value",
      tier: 2,
      ok: () => okAccessor(get(s, "HTMLInputElement.prototype"), "value"),
    },

    // --- tier 2: hook-hiding primitives (console only) ---
    {
      label: "Object.defineProperty",
      tier: 2,
      ok: () => okFn(Object.defineProperty, "defineProperty"),
    },
    {
      label: "Object.getOwnPropertyDescriptor",
      tier: 2,
      ok: () => okFn(Object.getOwnPropertyDescriptor, "getOwnPropertyDescriptor"),
    },
  ];

  const findings: NativeFindingInterface[] = [];
  for (const c of checks) {
    let ok = true;
    try {
      ok = c.ok();
    } catch {
      ok = true; // Can't evaluate — don't invent a finding.
    }
    if (!ok) findings.push({ label: c.label, reason: NOT_NATIVE_REASON, tier: c.tier });
  }
  return findings;
}
