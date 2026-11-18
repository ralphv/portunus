// Generates the app icons from the palette (src/app/palette.css, light
// scheme): the PWA PNGs (Portunus keyhole emblem) — hand-rolled PNG encoder,
// no image dependencies — and the src/app/icon.svg favicon.
// Usage: node scripts/gen-icons.mjs   →   public/icons/icon-{192,512}.png,
//        public/icons/icon-512-maskable.png and src/app/icon.svg
// (scripts/gen-palette.mjs runs it after regenerating the palette).
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readRole } from "./palette-css.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public/icons");
const SVG_OUT = join(ROOT, "src/app/icon.svg");
// Vector emblem (same geometry as the PNGs, round, no background tile) for
// the docs site, where the logo is shown far larger than any PNG icon.
const EMBLEM_SVG_OUT = join(OUT_DIR, "emblem.svg");

// Light-scheme value of a palette role, as "#rrggbb".
const role = (name) => readRole(name, "light");
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

const HEX = {
  background: role("primary-container"),
  disc: role("surface"),
  ring: role("primary"),
  keyhole: role("on-primary-container"),
};
const PRIMARY_CONTAINER = rgb(HEX.background);
const SURFACE = rgb(HEX.disc);
const PRIMARY = rgb(HEX.ring);
const ON_PRIMARY_CONTAINER = rgb(HEX.keyhole);

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(width, height, pixels) {
  // pixels: Uint8Array RGBA. Prepend filter byte 0 to each scanline.
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0;
    Buffer.from(pixels.buffer, y * width * 4, width * 4).copy(
      raw,
      y * (1 + width * 4) + 1,
    );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Supersampling factor per axis (SS² samples per pixel).
const SS = 4;

// Rasterize the emblem into an RGBA buffer. `scale` shrinks the motif —
// maskable icons need the art inside the inner ~80% safe zone.
function drawEmblem(size, scale = 1) {
  const px = new Uint8Array(size * size * 4);
  const c = size / 2;
  const u = size / 64; // viewBox unit → pixels
  const ringR1 = 30 * u * scale;
  const ringR2 = 31.6 * u * scale;
  const discR = 30 * u * scale;
  const khCx = 32 * u * scale;
  const khCy = 26 * u * scale;
  const khR = 9 * u * scale;
  // slot: trapezoid from (28..36, 31) widening to (24..40, 52), in viewBox units
  const slotTop = 31 * u * scale;
  const slotBot = 52 * u * scale;
  const halfW = (y) => {
    const t = Math.min(Math.max((y - slotTop) / (slotBot - slotTop), 0), 1);
    return (4 + t * 4) * u * scale; // half-width 4→8 units
  };
  const ox = c - 32 * u * scale; // center the 64-unit motif

  // Colour of one sample point (pixel coordinates).
  const sample = (sx, sy) => {
    const d = Math.hypot(sx - c, sy - c);
    let rgb = null;
    if (d <= discR) rgb = SURFACE;
    if (d > ringR1 && d <= ringR2) rgb = PRIMARY;
    // keyhole head
    const kx = sx - ox;
    const ky = sy - ox;
    if (Math.hypot(kx - khCx, ky - khCy) <= khR) rgb = ON_PRIMARY_CONTAINER;
    // keyhole slot
    if (ky > slotTop && ky <= slotBot && Math.abs(kx - khCx) <= halfW(ky)) {
      rgb = ON_PRIMARY_CONTAINER;
    }
    return rgb ?? PRIMARY_CONTAINER;
  };

  // Anti-alias: average an SS×SS grid of samples per pixel, so the ring and
  // keyhole edges are smooth instead of stair-stepped.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0];
      for (let j = 0; j < SS; j++) {
        for (let k = 0; k < SS; k++) {
          const col = sample(x + (k + 0.5) / SS, y + (j + 0.5) / SS);
          sum[0] += col[0];
          sum[1] += col[1];
          sum[2] += col[2];
        }
      }
      const i = (y * size + x) * 4;
      px[i] = Math.round(sum[0] / (SS * SS));
      px[i + 1] = Math.round(sum[1] / (SS * SS));
      px[i + 2] = Math.round(sum[2] / (SS * SS));
      px[i + 3] = 255;
    }
  }
  return px;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, size, scale] of [
  ["icon-192.png", 192, 1],
  ["icon-512.png", 512, 1],
  ["icon-512-maskable.png", 512, 0.78],
]) {
  writeFileSync(join(OUT_DIR, name), encodePng(size, size, drawEmblem(size, scale)));
  console.log(`wrote ${name} (${size}px, scale ${scale})`);
}

// Favicon: the key glyph in primary on a primary-container tile.
writeFileSync(
  SVG_OUT,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="16" fill="${HEX.background}"/>
  <circle cx="26" cy="26" r="10" fill="none" stroke="${HEX.ring}" stroke-width="5"/>
  <path d="M33 33 L50 50" stroke="${HEX.ring}" stroke-width="5" stroke-linecap="round"/>
  <path d="M44 44 L50 38" stroke="${HEX.ring}" stroke-width="5" stroke-linecap="round"/>
  <path d="M38 38 L43 33" stroke="${HEX.ring}" stroke-width="5" stroke-linecap="round"/>
</svg>
`,
);
console.log("wrote src/app/icon.svg");

// Docs-site emblem: the PNG emblem's geometry as a vector, so it stays crisp
// at any size (the docs hero shows it at 192 CSS px, ~500 device pixels on a
// high-DPI phone). width/height keep that intrinsic size: without them the
// docs theme shrinks the image.
writeFileSync(
  EMBLEM_SVG_OUT,
  `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="31.6" fill="${HEX.ring}"/>
  <circle cx="32" cy="32" r="30" fill="${HEX.disc}"/>
  <circle cx="32" cy="26" r="9" fill="${HEX.keyhole}"/>
  <polygon points="28,31 36,31 40,52 24,52" fill="${HEX.keyhole}"/>
</svg>
`,
);
console.log("wrote public/icons/emblem.svg");
