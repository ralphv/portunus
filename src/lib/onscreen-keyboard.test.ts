import { describe, expect, it } from "vitest";

import {
  ONSCREEN_KEYBOARD_LETTERS as KEYBOARD_LETTERS,
  ONSCREEN_KEYBOARD_SYMBOLS as KEYBOARD_SYMBOLS,
} from "@/constants";

import {
  KEYBOARD_LETTER_COLUMNS,
  KEYBOARD_SYMBOL_COLUMNS,
  deleteBeforeCaret,
  insertAtCaret,
  keyboardUpperCase,
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

  it("combines on-screen ⇧, Shift and Caps Lock like a physical keyboard", () => {
    expect(keyboardUpperCase(false, false, false)).toBe(false);
    expect(keyboardUpperCase(true, false, false)).toBe(true);
    expect(keyboardUpperCase(false, true, false)).toBe(true);
    expect(keyboardUpperCase(false, false, true)).toBe(true);
    expect(keyboardUpperCase(false, true, true)).toBe(false);
    expect(keyboardUpperCase(true, false, true)).toBe(false);
    expect(keyboardUpperCase(true, true, false)).toBe(false);
    expect(keyboardUpperCase(true, true, true)).toBe(true);
  });
});

// A minimal stand-in for an <input>'s value/selection API.
function fakeInput(value: string, start: number, end = start) {
  const el = {
    value,
    selectionStart: start,
    selectionEnd: end,
    setRangeText(text: string, s: number, e: number) {
      el.value = el.value.slice(0, s) + text + el.value.slice(e);
      el.selectionStart = el.selectionEnd = s + text.length;
    },
  };
  return el;
}

describe("on-screen keyboard editing", () => {
  const asInput = (el: ReturnType<typeof fakeInput>) => el as unknown as HTMLInputElement;

  it("types at the caret, not at the end", () => {
    const el = fakeInput("hrse", 1);
    insertAtCaret(asInput(el), "o");
    expect(el.value).toBe("horse");
    expect(el.selectionStart).toBe(2);
  });

  it("replaces a selection", () => {
    const el = fakeInput("horse", 1, 4);
    insertAtCaret(asInput(el), "X");
    expect(el.value).toBe("hXe");
  });

  it("Backspace deletes before the caret, or the selection", () => {
    const el = fakeInput("horse", 2);
    deleteBeforeCaret(asInput(el));
    expect(el.value).toBe("hrse");
    const sel = fakeInput("horse", 1, 4);
    deleteBeforeCaret(asInput(sel));
    expect(sel.value).toBe("he");
    const start = fakeInput("horse", 0);
    deleteBeforeCaret(asInput(start));
    expect(start.value).toBe("horse");
  });
});
