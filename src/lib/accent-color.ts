// Colour coding for label chips, letter avatars and brand icons. The colours
// themselves live in src/app/palette.css (label-N / avatar-N roles and the
// brand lightness); this only picks which one a label or name gets.

import type { CSSProperties } from "react";

// Tailwind needs literal class names, one per palette accent (label-1…6).
const LABEL_CLASSES = [
  "bg-label-1 text-on-label-1",
  "bg-label-2 text-on-label-2",
  "bg-label-3 text-on-label-3",
  "bg-label-4 text-on-label-4",
  "bg-label-5 text-on-label-5",
  "bg-label-6 text-on-label-6",
] as const;

const AVATAR_CLASSES = [
  "bg-avatar-1 text-on-avatar-1",
  "bg-avatar-2 text-on-avatar-2",
  "bg-avatar-3 text-on-avatar-3",
  "bg-avatar-4 text-on-avatar-4",
  "bg-avatar-5 text-on-avatar-5",
  "bg-avatar-6 text-on-avatar-6",
] as const;

export const ACCENT_COUNT = LABEL_CLASSES.length;

// Stable index for a text (case-insensitive), so a label has the same colour
// on every row, in the editor and on every device — nothing is stored.
// (32-bit FNV-1a: spreads short, similar labels like "work" / "dev" / "home"
// over different accents.)
export function accentIndex(text: string): number {
  let h = 0x811c9dc5;
  for (const ch of text.trim().toLowerCase()) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % ACCENT_COUNT;
}

export function labelColorClass(label: string): string {
  return LABEL_CLASSES[accentIndex(label)];
}

export function avatarColorClass(name: string): string {
  return AVATAR_CLASSES[accentIndex(name)];
}

// Black, white and grey logos (GitHub, Notion…) carry no hue to keep: they
// stay in the text colour instead of a brand tint.
const NEUTRAL_SPREAD = 40;

export function isChromaticBrand(hex: string | undefined): hex is string {
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return Math.max(r, g, b) - Math.min(r, g, b) >= NEUTRAL_SPREAD;
}

// Inline custom property for .brand-icon (globals.css): the brand colour,
// re-toned per scheme. Set from client components only (CSSOM, so the
// strict CSP's style-src doesn't apply).
export function brandIconStyle(hex: string): CSSProperties {
  return { "--brand": `#${hex}` } as CSSProperties;
}
