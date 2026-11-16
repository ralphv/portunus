// Guards the single-file palette (src/app/palette.css): every colour role
// the UI uses is defined there for both schemes, and the hex copies in
// src/constants.ts (theme-color meta, manifest) match it.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { THEME_COLOR_DARK, THEME_COLOR_LIGHT } from "@/constants";
import { ACCENT_COUNT } from "./accent-color";
// The same parser the generator and the icon script use.
import { parsePalette } from "../../scripts/palette-css.mjs";

const SRC = join(__dirname, "..");
const PALETTE = readFileSync(join(SRC, "app/palette.css"), "utf8");

// role → { light, dark }
const ROLES = parsePalette(PALETTE);

// Colour-role names the components use (bg-primary, text-on-surface-variant…).
const ROLE_PREFIX = /^(on-|primary|secondary|tertiary|error|warning|success|info|surface|outline|inverse|scrim|label-|avatar-)/;
function usedRoles(): Set<string> {
  const used = new Set<string>();
  const files = [
    ...readdirSync(join(SRC, "components")).map((f) => join(SRC, "components", f)),
    ...readdirSync(join(SRC, "app")).map((f) => join(SRC, "app", f)),
  ].filter((f) => f.endsWith(".tsx"));
  files.push(join(SRC, "lib/accent-color.ts")); // label-N / avatar-N classes
  const util =
    /(?<![\w-])(?:bg|text|border|ring|fill|stroke|decoration|accent|outline|placeholder|caret|divide)-([a-z][a-z0-9-]*?)(?:\/[\d.]+)?(?![\w-])/g;
  for (const f of files) {
    for (const m of readFileSync(f, "utf8").matchAll(util)) {
      if (ROLE_PREFIX.test(m[1])) used.add(m[1]);
    }
  }
  return used;
}

describe("palette.css", () => {
  it("defines every role as a light/dark pair", () => {
    expect(ROLES.size).toBeGreaterThan(20);
    const declared = [...PALETTE.matchAll(/--color-([a-z0-9-]+):/g)].map((m) => m[1]);
    const unpaired = declared.filter((r) => r !== "scrim" && !ROLES.has(r));
    expect(unpaired).toEqual([]);
  });

  it("defines the six label / avatar accents", () => {
    for (let n = 1; n <= ACCENT_COUNT; n++) {
      for (const r of [`label-${n}`, `on-label-${n}`, `avatar-${n}`, `on-avatar-${n}`]) {
        expect(ROLES.has(r), r).toBe(true);
      }
    }
    // …and no more than accent-color.ts has classes for.
    expect(ROLES.has(`label-${ACCENT_COUNT + 1}`)).toBe(false);
    expect(PALETTE).toMatch(/--brand-lightness-light:\s*[\d.]+;/);
    expect(PALETTE).toMatch(/--brand-lightness-dark:\s*[\d.]+;/);
  });

  it("defines every colour role the UI uses", () => {
    const used = usedRoles();
    expect(used.size).toBeGreaterThan(10); // the scan itself still works
    const missing = [...used].filter((r) => r !== "scrim" && !ROLES.has(r));
    expect(missing).toEqual([]);
  });

  it("matches the THEME_COLOR_* constants", () => {
    expect(THEME_COLOR_LIGHT).toBe(ROLES.get("surface")?.light);
    expect(THEME_COLOR_DARK).toBe(ROLES.get("surface")?.dark);
  });
});
