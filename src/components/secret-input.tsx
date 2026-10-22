"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { InputHTMLAttributes } from "react";

// Inputs for secrets (vault passwords, TOTP seeds, the master password).
//
// React writes a controlled input's value into the HTML `value` attribute as
// well as the live `.value` property. That puts the plaintext in outerHTML /
// DOM snapshots (session replay, "save page", error reporters) and lets
// injected CSS exfiltrate it via attribute selectors (`input[value^="a"]`).
// These components only ever set the `.value` property, through a ref.
//
// This limits what a DOM snapshot or CSS can see. It does not hide secrets
// from script running in the page: that can read `.value` or the decrypted
// vault in memory. The CSP is what keeps such script out.

type PropertyValueInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "defaultValue" | "onChange"
> & {
  value: string;
  onValueChange?: (value: string) => void;
};

/** An `<input>` whose value never appears as an HTML attribute. */
export function PropertyValueInput({
  value,
  onValueChange,
  ...props
}: PropertyValueInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.value !== value) el.value = value;
  }, [value]);
  useEffect(() => {
    const el = ref.current;
    return () => {
      if (el) el.value = "";
    };
  }, []);
  return (
    <input
      // Revealed (type="text") secrets mustn't go to a spellcheck service.
      spellCheck={false}
      {...props}
      ref={ref}
      onChange={(e) => onValueChange?.(e.target.value)}
    />
  );
}

/** Revealed/edited secrets re-mask after this long without interaction. */
export const SECRET_REVEAL_IDLE_MS = 30_000;
const MASK = "••••••••";

type SecretMode = "hidden" | "edit" | "shown";

/**
 * A secret rendered on demand. Hidden by default: a fixed-length mask (no
 * length leak) and no `<input>` holding the value. Clicking the mask (edit)
 * or "show" mounts the input; it unmounts again on "hide", when focus leaves
 * the field, when the tab is hidden, or after `idleMs` without interaction.
 */
export function SecretField({
  value,
  onValueChange,
  readOnly = false,
  disabled = false,
  label,
  className,
  toggleClassName,
  inputProps,
  idleMs = SECRET_REVEAL_IDLE_MS,
}: {
  value: string;
  onValueChange?: (value: string) => void;
  readOnly?: boolean;
  disabled?: boolean;
  /** Accessible name, e.g. "Password". */
  label: string;
  className: string;
  toggleClassName: string;
  inputProps?: Omit<PropertyValueInputProps, "value" | "onValueChange" | "type">;
  idleMs?: number;
}) {
  const [mode, setMode] = useState<SecretMode>("hidden");
  const [focusOnMount, setFocusOnMount] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const editable = !readOnly && !disabled && Boolean(onValueChange);
  // An empty editable field has nothing to hide — show the input so a new
  // entry can be typed straight in; focusing it switches to "edit".
  const active = mode !== "hidden" || (value === "" && editable);

  function arm() {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMode("hidden"), idleMs);
  }

  useEffect(() => {
    if (mode === "hidden") {
      window.clearTimeout(timer.current);
      return;
    }
    arm();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") setMode("hidden");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // arm only reads refs + idleMs; re-running on mode/idleMs is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, idleMs]);

  function open(next: SecretMode) {
    setFocusOnMount(true);
    setMode(next);
  }

  return (
    <div
      className="flex min-w-0 flex-1 gap-2"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setMode("hidden");
        }
      }}
      onKeyDown={() => mode !== "hidden" && arm()}
      onPointerDown={() => mode !== "hidden" && arm()}
    >
      {active ? (
        <PropertyValueInput
          {...inputProps}
          className={className}
          type={mode === "shown" ? "text" : "password"}
          value={value}
          onValueChange={onValueChange}
          onFocus={(e) => {
            if (mode === "hidden") setMode("edit");
            inputProps?.onFocus?.(e);
          }}
          readOnly={!editable}
          disabled={disabled}
          aria-label={label}
          autoFocus={focusOnMount}
        />
      ) : (
        <button
          type="button"
          className={`${className} cursor-text text-left`}
          onClick={() => open(editable ? "edit" : "shown")}
          disabled={disabled && !value}
          aria-label={`${label} (hidden) — ${editable ? "click to edit" : "click to reveal"}`}
        >
          {value ? MASK : <span className="text-slate-500">—</span>}
        </button>
      )}
      <button
        type="button"
        onClick={() => (mode === "shown" ? setMode("hidden") : open("shown"))}
        disabled={!value}
        className={toggleClassName}
      >
        {mode === "shown" ? "hide" : "show"}
      </button>
    </div>
  );
}
