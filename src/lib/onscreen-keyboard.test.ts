import { describe, expect, it } from "vitest";

import {
  KEYBOARD_LETTER_COLUMNS,
  KEYBOARD_LETTERS,
  KEYBOARD_SYMBOL_COLUMNS,
  KEYBOARD_SYMBOLS,
  secureShuffle,
  shuffledKeyboardLayout,
} from "./onscreen-keyboard";

const sorted = (keys: string[]) => [...keys].sort().join("");

describe("on-screen keyboard layout", () => {
  it("fills whole rows on both pages", () => {
    expect(KEYBOARD_LETTERS.length % KEYBOARD_LETTER_COLUMNS).toBe(0);
    expect(KEYBOARD_SYMBOLS.length % KEYBOARD_SYMBOL_COLUMNS).toBe(0);
  });

  it("covers every printable ASCII character once", () => {
    const all = KEYBOARD_LETTERS + KEYBOARD_LETTERS.toUpperCase() + KEYBOARD_SYMBOLS + " ";
    const unique = new Set(all);
    for (let c = 0x20; c <= 0x7e; c++) expect(unique.has(String.fromCharCode(c))).toBe(true);
    expect(KEYBOARD_SYMBOLS.length).toBe(new Set(KEYBOARD_SYMBOLS).size);
  });

  it("shuffles into a permutation of the same keys", () => {
    const layout = shuffledKeyboardLayout();
    expect(sorted(layout.letters)).toBe(sorted([...KEYBOARD_LETTERS]));
    expect(sorted(layout.symbols)).toBe(sorted([...KEYBOARD_SYMBOLS]));
  });

  it("gives a different order each time", () => {
    const a = shuffledKeyboardLayout().letters.join("");
    const b = shuffledKeyboardLayout().letters.join("");
    expect(a).not.toBe(b);
  });

  it("is a Fisher–Yates shuffle over the injected random source", () => {
    // Always picking index 0 rotates the first element to the end.
    expect(secureShuffle([1, 2, 3, 4], () => 0)).toEqual([2, 3, 4, 1]);
    // Always picking i (no swap) keeps the order and leaves the input alone.
    const input = [1, 2, 3];
    expect(secureShuffle(input, (n) => n - 1)).toEqual([1, 2, 3]);
    expect(input).toEqual([1, 2, 3]);
  });
});
