"use client";

import { useEffect, useState } from "react";

import {
  classifyScript,
  SCRIPT_RECORDER_GLOBAL,
  sha256Base64,
  type ScriptFindingInterface,
  type ScriptIntegrityManifestInterface,
  type ScriptRecorderInterface,
} from "@/lib/script-integrity";

// Best-effort runtime script self-check (see src/lib/script-integrity.ts).
//
// Tamper-evidence for page-level / supply-chain script injection only: it
// compares every <script> in the document — the initial snapshot plus any
// added later, via the persistent MutationObserver started by the <head>
// recorder — against the build-time allowlist, and shows a NON-BLOCKING
// warning. It never removes nodes or blocks execution; the strict CSP does
// the blocking. It does NOT protect against browser extensions (isolated-world
// content scripts add no <script> tags, and an extension can run before this
// or patch MutationObserver/querySelectorAll/fetch to blind it).
type Status = "checking" | "ok" | "unexpected" | "unavailable";

export function ScriptIntegrityCheck() {
  const [findings, setFindings] = useState<ScriptFindingInterface[]>([]);
  const [dismissedCount, setDismissedCount] = useState(0);

  useEffect(() => {
    // Dev server: HMR/overlay scripts and no generated manifest.
    if (process.env.NODE_ENV !== "production") return;
    let cancelled = false;
    const root = document.documentElement;
    const setStatus = (s: Status) => {
      root.dataset.scriptIntegrity = s;
    };
    setStatus("checking");

    const report = (f: ScriptFindingInterface) => {
      if (cancelled) return;
      setStatus("unexpected");
      setFindings((prev) =>
        prev.some((p) => p.label === f.label && p.reason === f.reason)
          ? prev
          : [...prev, f],
      );
    };

    const initial = Array.from(document.scripts);
    // The server-rendered scripts of a dynamic render share one nonce; take
    // it from the earliest script in document order that carries one.
    const pageNonce = initial.find((s) => s.nonce)?.nonce || null;
    const seen = new WeakSet<HTMLScriptElement>();
    const verifiedChunks = new Set<string>();
    let manifest: ScriptIntegrityManifestInterface | null = null;
    let pending: HTMLScriptElement[] = [];

    async function verifyChunk(path: string, expected: string) {
      if (verifiedChunks.has(path)) return;
      verifiedChunks.add(path);
      try {
        const res = await fetch(path);
        if (!res.ok) return;
        const actual = await sha256Base64(await res.arrayBuffer());
        if (actual !== expected) {
          report({ label: path, reason: "content differs from this build" });
        }
      } catch {
        // Offline / transient — nothing to conclude.
      }
    }

    async function check(el: HTMLScriptElement, m: ScriptIntegrityManifestInterface) {
      const src = el.getAttribute("src");
      const text = src === null ? (el.textContent ?? "") : "";
      const textHash = text.trim() ? await sha256Base64(text) : null;
      const verdict = classifyScript(
        { src, type: el.type, nonce: el.nonce ?? "" },
        text,
        textHash,
        m,
        { origin: location.origin, pageNonce },
      );
      if (!verdict.ok) report(verdict.finding);
      else if (verdict.chunk) await verifyChunk(verdict.chunk, m.chunks[verdict.chunk]);
    }

    const enqueue = (el: HTMLScriptElement) => {
      if (seen.has(el)) return;
      seen.add(el);
      if (manifest) void check(el, manifest);
      else pending.push(el);
    };

    const recorder = (window as unknown as Record<string, ScriptRecorderInterface | undefined>)[
      SCRIPT_RECORDER_GLOBAL
    ];
    let observer: MutationObserver | null = null;
    if (recorder) {
      recorder.onAdd = enqueue;
    } else {
      // Recorder missing (blocked/removed) — that alone is suspicious, but
      // still watch from here on.
      report({ label: "script recorder", reason: "early recorder did not run" });
      observer = new MutationObserver((records) => {
        for (const r of records) {
          for (const n of r.addedNodes) {
            if (n instanceof HTMLScriptElement) enqueue(n);
            else if (n instanceof Element) n.querySelectorAll("script").forEach(enqueue);
          }
        }
      });
      observer.observe(root, { childList: true, subtree: true });
    }
    for (const el of initial) enqueue(el);
    for (const el of recorder?.nodes ?? []) enqueue(el);

    fetch("/api/script-integrity", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<ScriptIntegrityManifestInterface>) : null))
      .then(async (m) => {
        if (cancelled) return;
        if (!m?.generated) {
          setStatus("unavailable");
          return;
        }
        manifest = m;
        const batch = pending;
        pending = [];
        await Promise.all(batch.map((el) => check(el, m)));
        if (!cancelled && root.dataset.scriptIntegrity === "checking") setStatus("ok");
      })
      .catch(() => {
        if (!cancelled) setStatus("unavailable");
      });

    return () => {
      cancelled = true;
      if (recorder?.onAdd === enqueue) recorder.onAdd = null;
      observer?.disconnect();
    };
  }, []);

  if (findings.length <= dismissedCount) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-50 border-b border-amber-500/60 bg-navy-900/95 px-4 py-2 text-sm text-amber-300 shadow-lg backdrop-blur"
    >
      <div className="mx-auto flex max-w-3xl items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            Unexpected script detected; verify your deployment/extensions.
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-slate-400">
            {findings.slice(0, 5).map((f) => (
              <li key={`${f.label}|${f.reason}`} className="truncate">
                <span className="font-mono">{f.label}</span> — {f.reason}
              </li>
            ))}
            {findings.length > 5 && <li>…and {findings.length - 5} more</li>}
          </ul>
        </div>
        <button
          type="button"
          onClick={() => setDismissedCount(findings.length)}
          className="shrink-0 rounded border border-amber-500/50 px-2 py-0.5 text-xs hover:bg-amber-500/10"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
