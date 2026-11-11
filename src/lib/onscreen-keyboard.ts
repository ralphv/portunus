// Layouts for the unlock form's on-screen keyboard. Keys are shuffled with
// crypto.getRandomValues each time the keyboard opens, so recorded click
// positions alone don't reveal which characters were entered.

import { ONSCREEN_KEYBOARD_LETTERS, ONSCREEN_KEYBOARD_SYMBOLS } from "@/constants";

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
    letters: secureShuffle([...ONSCREEN_KEYBOARD_LETTERS], random),
    symbols: secureShuffle([...ONSCREEN_KEYBOARD_SYMBOLS], random),
  };
}

/**
 * Letter keys type upper case when an odd number of on-screen ⇧, physical
 * Shift and Caps Lock are on (Caps Lock + Shift types lower case, as usual).
 */
export function keyboardUpperCase(onScreenShift: boolean, shift: boolean, capsLock: boolean): boolean {
  return onScreenShift !== (shift !== capsLock);
}

/** Types `text` over the input's selection (or at the caret). */
export function insertAtCaret(el: HTMLInputElement, text: string): void {
  const start = el.selectionStart ?? el.value.length;
  el.setRangeText(text, start, el.selectionEnd ?? start, "end");
}

/**
 * Backspace: deletes the selection, or the character before the caret (both
 * halves of a surrogate pair, e.g. an emoji typed on the physical keyboard).
 */
export function deleteBeforeCaret(el: HTMLInputElement): void {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  if (start !== end) {
    el.setRangeText("", start, end, "end");
    return;
  }
  if (start === 0) return;
  const pair = start > 1 && isSurrogatePair(el.value.charCodeAt(start - 2), el.value.charCodeAt(start - 1));
  el.setRangeText("", start - (pair ? 2 : 1), start, "end");
}

const isSurrogatePair = (high: number, low: number) =>
  high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff;
