// applyThemeColorOverride runs in the browser (ThemeSwitcher) and, via its
// source, in the layout's pre-paint script; a tiny fake document is enough
// to check what it does to <head>.
import { describe, expect, it } from "vitest";

import { applyThemeColorOverride } from "./theme";

type FakeMeta = { id: string; attrs: Record<string, string>; removed: boolean };

function fakeDocument() {
  const head: FakeMeta[] = [];
  const doc = {
    head: { prepend: (m: FakeMeta) => head.unshift(m) },
    getElementById: (id: string) => head.find((m) => m.id === id && !m.removed) ?? null,
    createElement: () => {
      const m: FakeMeta = {
        id: "",
        attrs: {},
        removed: false,
      };
      return Object.assign(m, {
        setAttribute: (k: string, v: string) => (m.attrs[k] = v),
        remove: () => (m.removed = true),
      });
    },
  };
  return { doc, head };
}

function run(theme: string, doc: unknown) {
  const saved = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = doc;
  try {
    applyThemeColorOverride(theme, "#light1", "#dark01", "tc-id", "theme-color");
  } finally {
    (globalThis as { document?: unknown }).document = saved;
  }
}

describe("applyThemeColorOverride", () => {
  it("adds one theme-color meta first in <head> for an explicit choice", () => {
    const { doc, head } = fakeDocument();
    run("dark", doc);
    expect(head).toHaveLength(1);
    expect(head[0]).toMatchObject({ id: "tc-id", attrs: { name: "theme-color", content: "#dark01" } });
    run("light", doc); // reused, not duplicated
    expect(head.filter((m) => !m.removed)).toHaveLength(1);
    expect(head[0].attrs.content).toBe("#light1");
  });

  it("removes it for System (or anything unknown)", () => {
    const { doc, head } = fakeDocument();
    run("light", doc);
    run("system", doc);
    expect(head.every((m) => m.removed)).toBe(true);
    run("original", doc); // nothing to remove: still fine
    expect(head.filter((m) => !m.removed)).toHaveLength(0);
  });

  it("is self-contained, so its source can be inlined in the pre-paint script", () => {
    const src = applyThemeColorOverride.toString();
    expect(src).not.toMatch(/\b(import|require)\b/);
    // Evaluated on its own, the inlined source still works.
    const inlined = new Function(`return (${src})`)() as typeof applyThemeColorOverride;
    const { doc, head } = fakeDocument();
    const saved = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = doc;
    try {
      inlined("dark", "#light1", "#dark01", "tc-id", "theme-color");
    } finally {
      (globalThis as { document?: unknown }).document = saved;
    }
    expect(head[0].attrs.content).toBe("#dark01");
  });
});
