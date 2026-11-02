// RFC 6238 TOTP (SHA-1, 6 digits, 30 s — the app's TOTP_DEFAULTS) for the
// smoke tests, so they can answer the two-factor prompts like an
// authenticator app would. Node-only on purpose: the app's own
// implementation (src/lib/totp.ts) is what's under test.

import { createHmac } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input) {
  const clean = input.replace(/[\s=]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`invalid base32 character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

export function totpCode(secret, timeMs = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timeMs / 1000 / 30)));
  const mac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(bin % 1_000_000).padStart(6, "0");
}

const step = (timeMs) => Math.floor(timeMs / 1000 / 30);

// The server rejects a code from a time step it already accepted (replay
// protection, src/lib/vault-totp.ts), and a code about to expire may land
// in the next step. So wait until we're in a step newer than the last one
// used, with at least 3 s left, then hand out its code. `state.totpStep`
// remembers the step across tests.
export async function freshTotpCode(secret, state) {
  for (;;) {
    const now = Date.now();
    const left = 30 - (Math.floor(now / 1000) % 30);
    if (step(now) > (state.totpStep ?? -1) && left >= 3) {
      state.totpStep = step(now);
      return totpCode(secret, now);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}
