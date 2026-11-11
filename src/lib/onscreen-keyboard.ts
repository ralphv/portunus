// Layouts for the unlock form's on-screen keyboard. Keys are shuffled with
// crypto.getRandomValues each time the keyboard opens, so recorded click
// positions alone don't reveal which characters were entered.

export const KEYBOARD_LETTERS = "abcdefghijklmnopqrstuvwxyz0123456789";
export const KEYBOARD_SYMBOLS = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

// Columns per page: 9 × 4 letters/digits, 8 × 4 symbols — both fill the grid.
export const KEYBOARD_LETTER_COLUMNS = 9;
export const KEYBOARD_SYMBOL_COLUMNS = 8;

export type KeyboardLayout = { letters: string[]; symbols: string[] };

/** Uniform integer in [0, n) from crypto.getRandomValues (rejection sampling). */
function randomBelow(n: number): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

/** Fisher–Yates shuffle into a new array. */
export function secureShuffle<T>(items: readonly T[], random = randomBelow): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function shuffledKeyboardLayout(random = randomBelow): KeyboardLayout {
  return {
    letters: secureShuffle([...KEYBOARD_LETTERS], random),
    symbols: secureShuffle([...KEYBOARD_SYMBOLS], random),
  };
}
