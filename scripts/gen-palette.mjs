// Generates the app's Material 3 colour palette — src/app/palette.css, the
// single file every colour comes from — from a seed colour, then syncs the
// few places that need literal hex values: the THEME_COLOR_* constants
// (theme-color meta, PWA manifest) and the app icons (scripts/gen-icons.mjs).
//
// Usage (also: npm run palette -- …):
//   node scripts/gen-palette.mjs --seed "#1D4ED8" --scheme vibrant --tertiary "#B8860B"
//
//   --seed      hex seed colour (required)
//   --scheme    tonal-spot | vibrant | fidelity | content | expressive | neutral
//               (Material's DynamicScheme variants; default vibrant)
//   --tertiary  optional hex colour whose tonal palette replaces the tertiary
//               role (e.g. a brand accent)
//   --secondary optional hex colour whose tonal palette replaces the secondary
//               role (chroma kept at 30 for calm containers)
//   --contrast  -1 … 1, Material contrast level (default 0)
//
// To swap the palette by hand instead, edit src/app/palette.css directly
// (keep every role, each as light-dark(<light>, <dark>)) and run
// `node scripts/gen-palette.mjs --sync` to re-sync the constants and icons;
// src/lib/palette.test.ts fails if they drift.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  argbFromHex,
  Blend,
  DynamicScheme,
  hexFromArgb,
  Hct,
  MaterialDynamicColors as C,
  SchemeContent,
  SchemeExpressive,
  SchemeFidelity,
  SchemeNeutral,
  SchemeTonalSpot,
  SchemeVibrant,
  TonalPalette,
} from "@material/material-color-utilities";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PALETTE_CSS = join(ROOT, "src/app/palette.css");
const CONSTANTS_TS = join(ROOT, "src/constants.ts");

// Material roles the app uses (Tailwind utilities: bg-primary, text-on-surface…).
const ROLES = {
  primary: C.primary,
  "on-primary": C.onPrimary,
  "primary-container": C.primaryContainer,
  "on-primary-container": C.onPrimaryContainer,
  "secondary-container": C.secondaryContainer,
  "on-secondary-container": C.onSecondaryContainer,
  "tertiary-container": C.tertiaryContainer,
  "on-tertiary-container": C.onTertiaryContainer,
  error: C.error,
  "error-container": C.errorContainer,
  "on-error-container": C.onErrorContainer,
  surface: C.surface,
  "surface-container-lowest": C.surfaceContainerLowest,
  "surface-container-low": C.surfaceContainerLow,
  "surface-container": C.surfaceContainer,
  "surface-container-high": C.surfaceContainerHigh,
  "surface-container-highest": C.surfaceContainerHighest,
  "on-surface": C.onSurface,
  "on-surface-variant": C.onSurfaceVariant,
  outline: C.outline,
  "outline-variant": C.outlineVariant,
  "inverse-surface": C.inverseSurface,
  "inverse-on-surface": C.inverseOnSurface,
};

// Status colours outside Material's scheme ("custom colors"), harmonised
// toward the seed: role = tone 40 / 80, container = tone 90 / 30.
const CUSTOM = { warning: "#F2A900", success: "#2E9E44", info: "#0288D1" };

const SCHEMES = {
  "tonal-spot": SchemeTonalSpot,
  vibrant: SchemeVibrant,
  fidelity: SchemeFidelity,
  content: SchemeContent,
  expressive: SchemeExpressive,
  neutral: SchemeNeutral,
};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--sync") out.sync = true;
    else if (a.startsWith("--")) out[a.slice(2)] = argv[++i];
  }
  return out;
}

function scheme({ seed, scheme: kind = "vibrant", tertiary, secondary, contrast = "0" }, dark) {
  const Cls = SCHEMES[kind];
  if (!Cls) throw new Error(`unknown --scheme ${kind}`);
  const level = Number(contrast);
  const base = new Cls(Hct.fromInt(argbFromHex(seed)), dark, level);
  const fromHex = (hex, chroma) => {
    const h = Hct.fromInt(argbFromHex(hex));
    return TonalPalette.fromHueAndChroma(h.hue, chroma ?? h.chroma);
  };
  return new DynamicScheme({
    sourceColorArgb: base.sourceColorArgb,
    variant: base.variant,
    contrastLevel: level,
    isDark: dark,
    primaryPalette: base.primaryPalette,
    secondaryPalette: secondary ? fromHex(secondary, 30) : base.secondaryPalette,
    tertiaryPalette: tertiary ? fromHex(tertiary) : base.tertiaryPalette,
    neutralPalette: base.neutralPalette,
    neutralVariantPalette: base.neutralVariantPalette,
  });
}

function generate(opts) {
  const light = scheme(opts, false);
  const dark = scheme(opts, true);
  const lines = [];
  for (const [role, color] of Object.entries(ROLES)) {
    lines.push(`  --color-${role}: light-dark(${hexFromArgb(color.getArgb(light))}, ${hexFromArgb(color.getArgb(dark))});`);
  }
  for (const [role, hex] of Object.entries(CUSTOM)) {
    const p = TonalPalette.fromInt(Blend.harmonize(argbFromHex(hex), argbFromHex(opts.seed)));
    lines.push(`  --color-${role}: light-dark(${hexFromArgb(p.tone(40))}, ${hexFromArgb(p.tone(80))});`);
    lines.push(`  --color-${role}-container: light-dark(${hexFromArgb(p.tone(90))}, ${hexFromArgb(p.tone(30))});`);
  }
  const cmd = ["node scripts/gen-palette.mjs", `--seed "${opts.seed}"`, `--scheme ${opts.scheme ?? "vibrant"}`]
    .concat(opts.tertiary ? [`--tertiary "${opts.tertiary}"`] : [])
    .concat(opts.secondary ? [`--secondary "${opts.secondary}"`] : [])
    .concat(opts.contrast ? [`--contrast ${opts.contrast}`] : [])
    .join(" ");
  return `/* Portunus colour palette — the single source of every app colour.
 *
 * GENERATED by: ${cmd}
 * (Material 3 dynamic colour, @material/material-color-utilities.)
 *
 * Each role is light-dark(<light scheme>, <dark scheme>); the color-scheme
 * rules in globals.css (System / Light / Dark theme) pick the value.
 * Tailwind exposes them as utilities: bg-primary, text-on-surface-variant…
 * To change the look, re-run the generator with another seed/scheme, or edit
 * the values here and run \`node scripts/gen-palette.mjs --sync\`.
 */
@theme {
${lines.join("\n")}
  --color-scrim: #000000;
}
`;
}

// Light-scheme value of a role, read back from palette.css.
export function readRole(css, role, scheme = "light") {
  const m = new RegExp(`--color-${role}:\\s*light-dark\\((#[0-9a-f]{6}),\\s*(#[0-9a-f]{6})\\)`, "i").exec(css);
  if (!m) throw new Error(`palette.css has no --color-${role}`);
  return (scheme === "light" ? m[1] : m[2]).toLowerCase();
}

function syncConstants(css) {
  let ts = readFileSync(CONSTANTS_TS, "utf8");
  const set = (name, value) => {
    const re = new RegExp(`(export const ${name} = )"#[0-9a-fA-F]{6}";`);
    if (!re.test(ts)) throw new Error(`constants.ts has no ${name}`);
    ts = ts.replace(re, `$1"${value}";`);
  };
  set("THEME_COLOR_LIGHT", readRole(css, "surface", "light"));
  set("THEME_COLOR_DARK", readRole(css, "surface", "dark"));
  set("THEME_COLOR_PRIMARY", readRole(css, "primary", "light"));
  writeFileSync(CONSTANTS_TS, ts);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.sync) {
    if (!opts.seed) {
      console.error("usage: node scripts/gen-palette.mjs --seed <#hex> [--scheme vibrant] [--tertiary <#hex>] [--secondary <#hex>] [--contrast 0]\n       node scripts/gen-palette.mjs --sync");
      process.exit(1);
    }
    writeFileSync(PALETTE_CSS, generate(opts));
    console.log("wrote src/app/palette.css");
  }
  const css = readFileSync(PALETTE_CSS, "utf8");
  syncConstants(css);
  console.log("synced THEME_COLOR_* in src/constants.ts");
  execFileSync(process.execPath, [join(ROOT, "scripts/gen-icons.mjs")], { stdio: "inherit" });
}
