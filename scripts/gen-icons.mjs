// Generates the PWA icons (navy + bronze Portunus keyhole emblem) as PNGs —
// no dependencies, hand-rolled PNG encoder.
// Usage: node scripts/gen-icons.mjs   →   public/icons/icon-{192,512}.png
//        and public/icons/icon-512-maskable.png
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const NAVY_900 = [10, 22, 40]; // #0a1628
const NAVY_800 = [16, 32, 58]; // #10203a
const BRONZE = [201, 162, 39]; // #c9a227
const BRONZE_LIGHT = [226, 197, 88]; // #e2c558

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../public/icons");

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

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const d = Math.hypot(dx, dy);
      let rgb = null;
      if (d <= discR) rgb = NAVY_800;
      if (d > ringR1 && d <= ringR2) rgb = BRONZE;
      // keyhole head
      const kx = x + 0.5 - ox;
      const ky = y + 0.5 - ox;
      if (Math.hypot(kx - khCx, ky - khCy) <= khR) rgb = BRONZE_LIGHT;
      // keyhole slot
      if (ky > slotTop && ky <= slotBot && Math.abs(kx - khCx) <= halfW(ky)) {
        rgb = BRONZE_LIGHT;
      }
      const i = (y * size + x) * 4;
      const col = rgb ?? NAVY_900;
      px[i] = col[0];
      px[i + 1] = col[1];
      px[i + 2] = col[2];
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
