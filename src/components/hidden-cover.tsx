"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { HIDDEN_COVER_CAPTION, HIDDEN_LOCK_RECHECK_MS } from "@/constants";
import {
  endFilePickerGuard,
  isExternalUiOpen,
  shouldLockWhileHidden,
} from "@/lib/hidden-lock";

// While the user is away from the page — it is hidden (tab switched, window
// minimised, app in the background, screen off) or the window has lost
// focus (another app or window, the address bar, DevTools, Android's Recent
// apps screen) — cover the open vault, and lock it once they have been away
// for `graceSeconds` (PORTUNUS_HIDDEN_LOCK_SECONDS). Coming back sooner (the
// page visible and focused again) just removes the cover. Returns whether the cover is up; the
// caller renders <HiddenCover /> and marks the vault `inert` while it is.
//
// Two paths to the lock, because a hidden page's timers can't be trusted:
// background tabs throttle them and mobile browsers freeze the page
// outright. The timer locks while still hidden when it does fire (and keeps
// re-checking while unsaved changes or app-opened UI hold the lock off);
// the visibility handler re-checks the elapsed time on return.
export function useHiddenLock(
  graceSeconds: number,
  dirty: boolean,
  onLock: () => void,
): boolean {
  const [covered, setCovered] = useState(false);
  const dirtyRef = useRef(dirty);
  const onLockRef = useRef(onLock);
  // What had focus when the cover went up: `inert` takes focus away, so it
  // is handed back when the cover comes down.
  const focusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    dirtyRef.current = dirty;
    onLockRef.current = onLock;
  }, [dirty, onLock]);

  useEffect(() => {
    if (covered) return;
    const el = focusRef.current;
    focusRef.current = null;
    if (el?.isConnected && document.activeElement !== el) el.focus({ preventScroll: true });
  }, [covered]);

  useEffect(() => {
    let hiddenAt: number | null = null;
    // App-opened system UI (file chooser, passkey sheet, confirm dialog) was
    // up when the user left: that whole time away is exempt, even if the UI
    // reports back before the page is visible and focused again.
    let exempt = false;
    let timer: number | undefined;
    const due = () =>
      hiddenAt !== null &&
      shouldLockWhileHidden({
        graceSeconds,
        hiddenForMs: Date.now() - hiddenAt,
        dirty: dirtyRef.current,
        externalUiOpen: exempt || isExternalUiOpen(),
      });
    const arm = (ms: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(onTimer, ms);
    };
    // Away = hidden, or the window doesn't have focus. During a blur/focus
    // event, trust the event over document.hasFocus().
    const away = (e?: Event) =>
      document.visibilityState === "hidden" ||
      (e?.type === "blur" ? true : e?.type === "focus" ? false : !document.hasFocus());
    function onTimer() {
      if (!away()) return;
      if (due()) onLockRef.current();
      // Held off (e.g. a save still in flight): check again shortly.
      else arm(HIDDEN_LOCK_RECHECK_MS);
    }
    const onChange = (e?: Event) => {
      if (away(e)) {
        if (hiddenAt === null) {
          hiddenAt = Date.now();
          exempt = isExternalUiOpen();
          const active = document.activeElement;
          focusRef.current = active instanceof HTMLElement ? active : null;
        }
        setCovered(true);
        if (due()) {
          onLockRef.current();
          return;
        }
        arm(graceSeconds * 1000);
        return;
      }
      window.clearTimeout(timer);
      const lock = due();
      hiddenAt = null;
      exempt = false;
      endFilePickerGuard();
      if (lock) onLockRef.current();
      else setCovered(false);
    };
    document.addEventListener("visibilitychange", onChange);
    window.addEventListener("blur", onChange);
    window.addEventListener("focus", onChange);
    // The vault can open while the user is already away (they left during
    // the unlock's key derivation): no event will come until they return.
    if (away()) onChange();
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onChange);
      window.removeEventListener("blur", onChange);
      window.removeEventListener("focus", onChange);
    };
  }, [graceSeconds]);

  return covered;
}

// A tint over the whole viewport with an opaque lock badge in the middle;
// while it is in the page, globals.css heavily blurs the rest of <body>. The vault under it is `inert` (set by the caller), so it is also
// out of the accessibility tree; revealed secrets already re-mask on
// visibilitychange (secret-input.tsx). Portalled to <body> so it sits
// outside that inert subtree and its status caption stays announced.
export function HiddenCover() {
  return createPortal(
    <div
      data-hidden-cover=""
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-5 bg-surface/45"
    >
      <div className="flex h-28 w-28 items-center justify-center rounded-full border border-primary/35 bg-primary-container text-on-primary-container shadow-m3-3 sm:h-[136px] sm:w-[136px]">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-[56%] w-[56%]"
          fill="currentColor"
        >
          <path d="M12 1.75a5.25 5.25 0 0 0-5.25 5.25v3H6a2.25 2.25 0 0 0-2.25 2.25v8.5A2.25 2.25 0 0 0 6 23h12a2.25 2.25 0 0 0 2.25-2.25v-8.5A2.25 2.25 0 0 0 18 10h-.75V7A5.25 5.25 0 0 0 12 1.75Zm-3.25 5.25a3.25 3.25 0 0 1 6.5 0v3h-6.5V7ZM12 14a1.75 1.75 0 0 1 1 3.19V19a1 1 0 1 1-2 0v-1.81A1.75 1.75 0 0 1 12 14Z" />
        </svg>
      </div>
      <p
        role="status"
        className="rounded-full bg-surface-container-high px-3.5 py-1.5 text-sm text-on-surface-variant shadow-m3-1"
      >
        {HIDDEN_COVER_CAPTION}
      </p>
    </div>,
    document.body,
  );
}
