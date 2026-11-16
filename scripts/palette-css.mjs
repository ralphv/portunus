// The one parser for src/app/palette.css, shared by scripts/gen-palette.mjs,
// scripts/gen-icons.mjs and src/lib/palette.test.ts. Each colour role is
// written as `--color-<role>: light-dark(<light hex>, <dark hex>);`.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PALETTE_CSS = join(dirname(fileURLToPath(import.meta.url)), "../src/app/palette.css");

const ROLE = /--color-([a-z0-9-]+):\s*light-dark\(\s*(#[0-9a-f]{6})\s*,\s*(#[0-9a-f]{6})\s*\)/gi;

/** @returns {Map<string, { light: string, dark: string }>} role → lower-case hex pair */
export function parsePalette(css = readFileSync(PALETTE_CSS, "utf8")) {
  const roles = new Map();
  for (const m of css.matchAll(ROLE)) {
    roles.set(m[1], { light: m[2].toLowerCase(), dark: m[3].toLowerCase() });
  }
  return roles;
}

/**
 * One role's hex in the light or dark scheme; throws if palette.css lacks it.
 * @param {string} role
 * @param {"light" | "dark"} [scheme]
 * @param {string} [css]
 */
export function readRole(role, scheme = "light", css) {
  const pair = parsePalette(css).get(role);
  if (!pair) throw new Error(`palette.css has no --color-${role}`);
  return pair[scheme];
}
