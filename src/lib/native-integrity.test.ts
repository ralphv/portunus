import { describe, expect, it } from "vitest";

import { checkNativeIntegrity, type NativeFindingInterface } from "./native-integrity";

// A real native function with a given .name, borrowed from the runtime, so
// "clean" cases use genuine `[native code]` functions (which JS cannot forge —
// that is the whole point of the check).
const nativePostMessage = (globalThis as unknown as { MessagePort: { prototype: { postMessage: unknown } } })
  .MessagePort.prototype.postMessage;

/** Cast a stub realm to the scope type the function expects. */
const asScope = (o: object) => o as unknown as typeof globalThis;

function labels(findings: NativeFindingInterface[]): string[] {
  return findings.map((f) => f.label);
}

describe("checkNativeIntegrity", () => {
  it("reports nothing for a realm whose present builtins are native", () => {
    // Only MessagePort is supplied (native); every DOM-only global is absent
    // and must be skipped, not flagged. Object.* and Function.prototype.toString
    // are read from the real runtime (native in Node) by the check itself.
    const scope = asScope({ MessagePort: (globalThis as unknown as { MessagePort: unknown }).MessagePort });
    expect(checkNativeIntegrity(scope)).toEqual([]);
  });

  it("flags a patched Worker channel as tier 1 (the PoC's technique)", () => {
    const scope = asScope({
      Worker: Object.assign(function Worker() {}, {
        // postMessage patched (JS); terminate left absent (skipped).
        prototype: { postMessage() {} },
      }),
    });
    const found = checkNativeIntegrity(scope);
    const l = labels(found);
    expect(l).toContain("Worker");
    expect(l).toContain("Worker.prototype.postMessage");
    expect(l).not.toContain("Worker.prototype.terminate"); // absent → skipped
    expect(found.every((f) => f.tier === 1)).toBe(true);
  });

  it("flags a renamed-but-native-looking wrapper via the name check", () => {
    // A bound native reports `[native code]` but its name gains a "bound " prefix.
    const bound = (nativePostMessage as (...a: unknown[]) => unknown).bind(null);
    const scope = asScope({ MessagePort: { prototype: { postMessage: bound } } });
    expect(labels(checkNativeIntegrity(scope))).toContain(
      "MessagePort.prototype.postMessage",
    );
  });

  it("flags patched WebCrypto and the RNG as tier 1", () => {
    const scope = asScope({
      crypto: { getRandomValues() {}, subtle: Object.create(null) },
    });
    const l = labels(checkNativeIntegrity(scope));
    expect(l).toContain("crypto.getRandomValues");
    expect(l).toContain("crypto.subtle"); // wrong [object ...] tag
  });

  it("puts exfiltration/input primitives in tier 2", () => {
    const scope = asScope({
      navigator: { clipboard: { writeText() {}, write() {} }, sendBeacon() {} },
      fetch() {},
      WebSocket: function WebSocket() {},
    });
    const found = checkNativeIntegrity(scope);
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((f) => f.tier === 2)).toBe(true);
    expect(labels(found)).toContain("navigator.clipboard.writeText");
  });

  it("flags a hooked input value accessor (tier 2)", () => {
    const proto: Record<string, unknown> = {};
    Object.defineProperty(proto, "value", { get() {}, set() {}, configurable: true });
    const scope = asScope({ HTMLInputElement: { prototype: proto } });
    expect(labels(checkNativeIntegrity(scope))).toContain(
      "HTMLInputElement.prototype.value",
    );
  });

  it("detects a lazily-spoofed Function.prototype.toString (the meta tell)", () => {
    // A naive patch that no longer returns the native marker. (A sophisticated
    // patch that returns marker strings for everything defeats this — the
    // documented ceiling; see the module header and SECURITY.md.)
    const orig = Function.prototype.toString;
    Function.prototype.toString = function toString() {
      return "patched";
    };
    try {
      expect(labels(checkNativeIntegrity(asScope({})))).toContain(
        "Function.prototype.toString",
      );
    } finally {
      Function.prototype.toString = orig;
    }
  });

  it("never throws, even on a hostile scope with throwing getters", () => {
    const scope = asScope({
      get Worker() {
        throw new Error("boom");
      },
    });
    expect(() => checkNativeIntegrity(scope)).not.toThrow();
  });
});
