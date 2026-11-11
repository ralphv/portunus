"use client";

import { useState } from "react";

import {
  KEYBOARD_LETTER_COLUMNS,
  KEYBOARD_SYMBOL_COLUMNS,
  shuffledKeyboardLayout,
} from "@/lib/onscreen-keyboard";

// Keys stay out of the Tab order and never take focus (mousedown is
// cancelled), so the password field keeps it. No hover or press highlight:
// nothing on screen marks which key was used.
const baseKeyCls = "h-11 min-w-0 rounded-lg border sm:h-10";
const keyCls = `${baseKeyCls} border-slate-600 bg-navy-900/60 text-base text-slate-100`;
const labelKeyCls = `${baseKeyCls} border-slate-600 bg-navy-900/60 text-sm`;

/**
 * A shuffled on-screen keyboard. It keeps no copy of what's entered: each key
 * is reported through `onKey` / `onBackspace` and the field holds the value.
 * The layout is shuffled when it mounts (each time it opens) and on Shuffle.
 */
export function OnScreenKeyboard({
  onKey,
  onBackspace,
  onDone,
}: {
  onKey: (char: string) => void;
  onBackspace: () => void;
  onDone: () => void;
}) {
  const [layout, setLayout] = useState(shuffledKeyboardLayout);
  const [symbols, setSymbols] = useState(false);
  const [shift, setShift] = useState(false);
  const keys = symbols
    ? layout.symbols
    : layout.letters.map((c) => (shift ? c.toUpperCase() : c));
  const press = (fn: () => void) => ({
    type: "button" as const,
    tabIndex: -1,
    onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
    onClick: fn,
  });

  return (
    <div
      role="group"
      aria-label="On-screen keyboard"
      className="-mx-2 mt-2 select-none rounded-xl border border-slate-700 bg-navy-900 p-1.5 sm:mx-0 sm:p-2.5"
    >
      <div className="mb-2 flex items-center justify-between gap-2 px-0.5">
        <span className="text-[0.65rem] uppercase tracking-wider text-slate-500">
          On-screen keyboard<span className="hidden sm:inline"> · layout shuffled</span>
        </span>
        <button
          {...press(() => setLayout(shuffledKeyboardLayout()))}
          aria-label="Shuffle keys"
          className="shrink-0 text-xs text-bronze"
        >
          ↻ Shuffle
        </button>
      </div>
      <div
        className="grid gap-1 sm:gap-1.5"
        style={{
          gridTemplateColumns: `repeat(${symbols ? KEYBOARD_SYMBOL_COLUMNS : KEYBOARD_LETTER_COLUMNS}, minmax(0, 1fr))`,
        }}
      >
        {keys.map((c) => (
          <button key={c} {...press(() => onKey(c))} className={keyCls}>
            {c}
          </button>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-[1fr_1fr_2.2fr_1fr_1.4fr] gap-1 sm:mt-1.5 sm:gap-1.5">
        <button
          {...press(() => setShift((s) => !s))}
          aria-label="Shift"
          aria-pressed={shift}
          disabled={symbols}
          className={`${baseKeyCls} bg-navy-900/60 text-base disabled:opacity-40 ${shift && !symbols ? "border-bronze text-bronze" : "border-slate-600 text-slate-100"}`}
        >
          ⇧
        </button>
        <button
          {...press(() => setSymbols((s) => !s))}
          aria-label={symbols ? "Letters and digits" : "Symbols"}
          className={`${labelKeyCls} text-slate-100`}
        >
          {symbols ? "abc" : "#+="}
        </button>
        <button {...press(() => onKey(" "))} aria-label="Space" className={`${labelKeyCls} text-slate-400`}>
          space
        </button>
        <button {...press(onBackspace)} aria-label="Backspace" className={keyCls}>
          ⌫
        </button>
        <button
          {...press(onDone)}
          className={`${baseKeyCls} border-bronze bg-bronze text-base font-semibold text-navy-900`}
        >
          Done
        </button>
      </div>
    </div>
  );
}
