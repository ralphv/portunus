// Password generator — crypto.getRandomValues with rejection sampling
// (avoids modulo bias).

const SETS = {
  lower: "abcdefghijklmnopqrstuvwxyz",
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{};:,.?",
} as const;

export type PasswordGenOptions = {
  length?: number;
  lower?: boolean;
  upper?: boolean;
  digits?: boolean;
  symbols?: boolean;
};

export function generatePassword(opts: PasswordGenOptions = {}): string {
  const { length = 20, lower = true, upper = true, digits = true, symbols = true } =
    opts;
  const alphabet =
    (lower ? SETS.lower : "") +
    (upper ? SETS.upper : "") +
    (digits ? SETS.digits : "") +
    (symbols ? SETS.symbols : "");
  if (!alphabet || length < 1) throw new Error("No usable character set");

  // Rejection sampling: discard values >= largest multiple of alphabet.length
  // that fits in a byte, so every character is equally likely.
  const limit = Math.floor(256 / alphabet.length) * alphabet.length;
  const out = new Array<string>(length);
  const buf = new Uint8Array(length * 2);
  let i = 0;
  while (i < length) {
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < limit) {
        out[i++] = alphabet[b % alphabet.length];
        if (i === length) break;
      }
    }
  }
  return out.join("");
}
