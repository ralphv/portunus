import { InvalidKeyfileError } from "./errors";
import { KEYFILE_KEY_BYTES } from "./keyfile";

// Printable recovery encoding of a keyfile key: Crockford Base32, groups of
// four, e.g. "07QK-9M4X-…". 32 bytes = 256 bits → 52 chars (13 groups).
// The alphabet excludes I, L, O, U; decoding accepts i/l→1 and o→0.

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CHARS = 52;
const GROUP = 4;

const DECODE: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) DECODE[ALPHABET[i]] = i;
DECODE.I = 1;
DECODE.L = 1;
DECODE.O = 0;

export function encodeRecoveryKey(key: Uint8Array): string {
  if (key.length !== KEYFILE_KEY_BYTES) {
    throw new InvalidKeyfileError("Recovery encoding requires a 32-byte key");
  }
  let acc = 0;
  let bits = 0;
  let out = "";
  for (const b of key) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(acc >>> bits) & 31];
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(acc << (5 - bits)) & 31];
  const groups: string[] = [];
  for (let i = 0; i < out.length; i += GROUP) {
    groups.push(out.slice(i, i + GROUP));
  }
  return groups.join("-");
}

export function decodeRecoveryKey(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (clean.length !== CHARS) {
    throw new InvalidKeyfileError("Recovery key has wrong length");
  }
  const key = new Uint8Array(KEYFILE_KEY_BYTES);
  let len = 0;
  let acc = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = DECODE[ch];
    if (v === undefined) {
      throw new InvalidKeyfileError(`Recovery key has invalid character "${ch}"`);
    }
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      key[len++] = (acc >>> bits) & 0xff;
    }
    acc &= (1 << bits) - 1;
  }
  // 52 chars carry 260 bits; the 4 trailing bits are padding written as zero
  // by the encoder — nonzero means the transcription decodes to another key.
  if (len !== KEYFILE_KEY_BYTES || bits !== 4 || acc !== 0) {
    throw new InvalidKeyfileError("Recovery key is invalid");
  }
  return key;
}
