// Best-effort runtime script integrity self-check — shared, pure logic.
//
// This is TAMPER-EVIDENCE for page-level / supply-chain script injection
// (e.g. a compromised dependency or a modified deployment adding a <script>
// to the page). It complements, and does NOT replace, the strict CSP sent by
// src/middleware.ts, which is what actually blocks unexpected scripts.
//
// It does NOT stop or reliably detect browser extensions: content scripts
// run in an isolated world without adding <script> tags, and an extension
// (or any script that already runs on the page) can act before this check or
// patch MutationObserver / querySelectorAll / fetch to neutralize it.
// Malicious extensions stay out of the threat model (see SECURITY.md).

/** Build-time expected script set (src/generated/script-integrity.ts). */
export interface ScriptIntegrityManifestInterface {
  /** false = stub (dev server, or `next build` run without the generator). */
  generated: boolean;
  /** Emitted script chunk path (`/_next/static/...`) → base64 SHA-256. */
  chunks: Record<string, string>;
  /** Base64 SHA-256 of every inline script in the prerendered HTML. */
  inline: string[];
}

export interface ObservedScriptInterface {
  /** Raw `src` attribute, or null for inline scripts. */
  src: string | null;
  type: string;
  /** `HTMLScriptElement.nonce` (the attribute itself is hidden after load). */
  nonce: string;
}

export interface ScriptFindingInterface {
  /** Short description of the script (URL, or an inline-script preview). */
  label: string;
  reason: string;
}

export type ScriptVerdict =
  | { ok: true; chunk?: string }
  | { ok: false; finding: ScriptFindingInterface };

// Data blocks never execute; everything else (classic, module, importmap,
// speculationrules, unknown types) is checked.
const DATA_SCRIPT_TYPES = new Set(["application/json", "application/ld+json"]);

export function isDataScript(type: string): boolean {
  return DATA_SCRIPT_TYPES.has(type.trim().toLowerCase());
}

export async function sha256Base64(data: string | ArrayBuffer): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let bin = "";
  for (const b of digest) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function inlinePreview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return `inline: ${flat.length > 60 ? `${flat.slice(0, 60)}…` : flat}`;
}

/**
 * Classify one script against the build-time allowlist.
 * - `src` scripts: must be same-origin and an emitted chunk path.
 * - inline scripts: must hash to a prerendered inline script, or carry the
 *   page's CSP nonce (server-streamed scripts of dynamic renders).
 * `textHash` is the SHA-256 of an inline script's text (null if empty).
 */
export function classifyScript(
  script: ObservedScriptInterface,
  text: string,
  textHash: string | null,
  manifest: ScriptIntegrityManifestInterface,
  ctx: { origin: string; pageNonce: string | null },
): ScriptVerdict {
  if (isDataScript(script.type)) return { ok: true };
  if (script.src !== null) {
    let url: URL;
    try {
      url = new URL(script.src, ctx.origin);
    } catch {
      return {
        ok: false,
        finding: { label: script.src, reason: "unparseable script URL" },
      };
    }
    if (url.origin !== ctx.origin) {
      return {
        ok: false,
        finding: { label: url.href, reason: "cross-origin script" },
      };
    }
    if (!(url.pathname in manifest.chunks)) {
      return {
        ok: false,
        finding: { label: url.pathname, reason: "not a chunk of this build" },
      };
    }
    return { ok: true, chunk: url.pathname };
  }
  if (textHash === null) return { ok: true };
  if (manifest.inline.includes(textHash)) return { ok: true };
  if (ctx.pageNonce && script.nonce === ctx.pageNonce) return { ok: true };
  return {
    ok: false,
    finding: {
      label: inlinePreview(text),
      reason: script.nonce
        ? "inline script with a foreign nonce"
        : "inline script not in this build",
    },
  };
}

/** Global the pre-hydration recorder writes to (see the init script). */
export const SCRIPT_RECORDER_GLOBAL = "__portunusScripts";

export interface ScriptRecorderInterface {
  nodes: HTMLScriptElement[];
  onAdd: ((el: HTMLScriptElement) => void) | null;
}

// Inline <head> script (allowed by its build-time CSP hash). Starts the one
// persistent MutationObserver as early as possible, so scripts inserted
// before hydration — even ones removed again — are recorded for the checker,
// which later attaches via `onAdd`. Never removes or blocks anything.
export const scriptRecorderInitScript = `(function(){try{if(window.${SCRIPT_RECORDER_GLOBAL})return;var r={nodes:[],onAdd:null};window.${SCRIPT_RECORDER_GLOBAL}=r;function a(n){r.nodes.push(n);if(r.onAdd)r.onAdd(n)}new MutationObserver(function(m){for(var i=0;i<m.length;i++){var d=m[i].addedNodes;for(var j=0;j<d.length;j++){var n=d[j];if(n.nodeType!==1)continue;if(n.tagName==="SCRIPT")a(n);else{var s=n.getElementsByTagName("script");for(var k=0;k<s.length;k++)a(s[k])}}}}).observe(document.documentElement,{childList:true,subtree:true})}catch(e){}})()`;
