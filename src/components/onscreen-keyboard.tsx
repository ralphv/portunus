"use client";

import { useEffect, useState } from "react";
import type { MouseEvent, RefObject } from "react";

import {
  MODIFIER_CAPS_LOCK,
  MODIFIER_SHIFT,
  ONSCREEN_KEYBOARD_BACKSPACE_LABEL,
  ONSCREEN_KEYBOARD_CAPTIONS,
  ONSCREEN_KEYBOARD_DONE_LABEL,
  ONSCREEN_KEYBOARD_LABEL,
  ONSCREEN_KEYBOARD_LETTERS_LABEL,
  ONSCREEN_KEYBOARD_SHIFT_LABEL,
  ONSCREEN_KEYBOARD_SHUFFLE_LABEL,
  ONSCREEN_KEYBOARD_SHUFFLED_NOTE,
  ONSCREEN_KEYBOARD_SPACE_LABEL,
  ONSCREEN_KEYBOARD_SYMBOLS_LABEL,
} from "@/constants";
import {
  KEYBOARD_LETTER_COLUMNS,
  KEYBOARD_SYMBOL_COLUMNS,
  deleteBeforeCaret,
  insertAtCaret,
  keyboardUpperCase,
  shuffledKeyboardLayout,
} from "@/lib/onscreen-keyboard";

// Keys stay out of the Tab order and never take focus (mousedown is
// cancelled), so the password field keeps it. No hover or press highlight:
// nothing on screen marks which key was used.
const baseKeyCls = "h-11 min-w-0 rounded-lg border sm:h-10";
const keyCls = `${baseKeyCls} border-slate-600 bg-navy-900/60 text-base text-slate-100`;
const labelKeyCls = `${baseKeyCls} border-slate-600 bg-navy-900/60 text-sm`;

type Modifiers = { shift: boolean; capsLock: boolean };
type ModifierEvent = { getModifierState(key: string): boolean };

const readModifiers = (e: ModifierEvent): Modifiers => ({
  shift: e.getModifierState(MODIFIER_SHIFT),
  capsLock: e.getModifierState(MODIFIER_CAPS_LOCK),
});

const MODIFIER_EVENTS = ["keydown", "keyup", "pointermove", "pointerdown"] as const;

// The physical Shift / Caps Lock state, so the key captions match what a
// click types. A click itself reads the state from its own event.
function usePhysicalModifiers(): Modifiers {
  const [mods, setMods] = useState<Modifiers>({ shift: false, capsLock: false });
  useEffect(() => {
    const update = (e: ModifierEvent & { key?: string }) => {
      const read = readModifiers(e);
      setMods((prev) => {
        // The Caps Lock key's own events can report the old state (Linux
        // reports it on until the release after turning it off); the next
        // pointer move has the real one.
        const next = e.key === MODIFIER_CAPS_LOCK ? { ...read, capsLock: prev.capsLock } : read;
        return prev.shift === next.shift && prev.capsLock === next.capsLock ? prev : next;
      });
    };
    const release = () => setMods((prev) => (prev.shift ? { ...prev, shift: false } : prev));
    for (const type of MODIFIER_EVENTS) window.addEventListener(type, update);
    window.addEventListener("blur", release);
    return () => {
      for (const type of MODIFIER_EVENTS) window.removeEventListener(type, update);
      window.removeEventListener("blur", release);
    };
  }, []);
  return mods;
}

/**
 * A shuffled on-screen keyboard that edits `input` at its caret and keeps no
 * copy of what's entered: the field holds the value, reported through
 * `onValueChange`. The layout is shuffled when it mounts (each time it
 * opens) and on Shuffle. Letters follow the on-screen ⇧ and the physical
 * Shift and Caps Lock.
 */
export function OnScreenKeyboard({
  input,
  onValueChange,
  onDone,
}: {
  input: RefObject<HTMLInputElement | null>;
  onValueChange: (value: string) => void;
  onDone: () => void;
}) {
  const [layout, setLayout] = useState(shuffledKeyboardLayout);
  const [symbols, setSymbols] = useState(false);
  const [shift, setShift] = useState(false);
  const physical = usePhysicalModifiers();
  const upper = !symbols && keyboardUpperCase(shift, physical.shift, physical.capsLock);
  const keys = symbols ? layout.symbols : layout.letters;

  const edit = (change: (el: HTMLInputElement) => void) => {
    const el = input.current;
    if (!el) return;
    change(el);
    onValueChange(el.value);
  };
  const typeKey = (c: string, e: MouseEvent) => {
    const mods = readModifiers(e);
    const char =
      !symbols && keyboardUpperCase(shift, mods.shift, mods.capsLock) ? c.toUpperCase() : c;
    edit((el) => insertAtCaret(el, char));
  };
  const press = (fn: (e: MouseEvent) => void) => ({
    type: "button" as const,
    tabIndex: -1,
    onMouseDown: (e: MouseEvent) => e.preventDefault(),
    onClick: fn,
  });

  return (
    <div
      role="group"
      aria-label={ONSCREEN_KEYBOARD_LABEL}
      className="-mx-2 mt-2 select-none rounded-xl border border-slate-700 bg-navy-900 p-1.5 sm:mx-0 sm:p-2.5"
    >
      <div className="mb-2 flex items-center justify-between gap-2 px-0.5">
        <span className="text-[0.65rem] uppercase tracking-wider text-slate-500">
          {ONSCREEN_KEYBOARD_LABEL}
          <span className="hidden sm:inline">{ONSCREEN_KEYBOARD_SHUFFLED_NOTE}</span>
        </span>
        <button
          {...press(() => setLayout(shuffledKeyboardLayout()))}
          aria-label={ONSCREEN_KEYBOARD_SHUFFLE_LABEL}
          className="shrink-0 text-xs text-bronze"
        >
          {ONSCREEN_KEYBOARD_CAPTIONS.shuffle}
        </button>
      </div>
      <div
        className="grid gap-1 sm:gap-1.5"
        style={{
          gridTemplateColumns: `repeat(${symbols ? KEYBOARD_SYMBOL_COLUMNS : KEYBOARD_LETTER_COLUMNS}, minmax(0, 1fr))`,
        }}
      >
        {keys.map((c) => (
          <button key={c} {...press((e) => typeKey(c, e))} className={keyCls}>
            {upper ? c.toUpperCase() : c}
          </button>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-[1fr_1fr_2.2fr_1fr_1.4fr] gap-1 sm:mt-1.5 sm:gap-1.5">
        <button
          {...press(() => setShift((s) => !s))}
          aria-label={ONSCREEN_KEYBOARD_SHIFT_LABEL}
          aria-pressed={shift}
          disabled={symbols}
          className={`${baseKeyCls} bg-navy-900/60 text-base disabled:opacity-40 ${shift && !symbols ? "border-bronze text-bronze" : "border-slate-600 text-slate-100"}`}
        >
          {ONSCREEN_KEYBOARD_CAPTIONS.shift}
        </button>
        <button
          {...press(() => setSymbols((s) => !s))}
          aria-label={symbols ? ONSCREEN_KEYBOARD_LETTERS_LABEL : ONSCREEN_KEYBOARD_SYMBOLS_LABEL}
          className={`${labelKeyCls} text-slate-100`}
        >
          {symbols ? ONSCREEN_KEYBOARD_CAPTIONS.letters : ONSCREEN_KEYBOARD_CAPTIONS.symbols}
        </button>
        <button
          {...press(() => edit((el) => insertAtCaret(el, " ")))}
          aria-label={ONSCREEN_KEYBOARD_SPACE_LABEL}
          className={`${labelKeyCls} text-slate-400`}
        >
          {ONSCREEN_KEYBOARD_CAPTIONS.space}
        </button>
        <button
          {...press(() => edit(deleteBeforeCaret))}
          aria-label={ONSCREEN_KEYBOARD_BACKSPACE_LABEL}
          className={keyCls}
        >
          {ONSCREEN_KEYBOARD_CAPTIONS.backspace}
        </button>
        <button
          {...press(onDone)}
          className={`${baseKeyCls} border-bronze bg-bronze text-base font-semibold text-navy-900`}
        >
          {ONSCREEN_KEYBOARD_DONE_LABEL}
        </button>
      </div>
    </div>
  );
}
