"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { HIDDEN_COVER_CAPTION } from "@/constants";
import {
  clearFilePickerOpen,
  isFilePickerOpen,
  shouldLockWhileHidden,
} from "@/lib/hidden-lock";

// While the page is hidden (tab switched, window minimised, app in the
// background, screen off), cover the open vault and lock it once it has
// been hidden for `graceSeconds` (PORTUNUS_HIDDEN_LOCK_SECONDS). Coming back
// sooner just removes the cover. Returns whether the cover is up; the
// caller renders <HiddenCover /> and marks the vault `inert` while it is.
//
// Two paths to the lock, because a hidden page's timers can't be trusted:
// background tabs throttle them and mobile browsers freeze the page
// outright. The timer locks while still hidden when it does fire; the
// visibility handler re-checks the elapsed time on return.
export function useHiddenLock(
  graceSeconds: number,
  dirty: boolean,
  onLock: () => void,
): boolean {
  const [covered, setCovered] = useState(false);
  const dirtyRef = useRef(dirty);
  const onLockRef = useRef(onLock);
  useEffect(() => {
    dirtyRef.current = dirty;
    onLockRef.current = onLock;
  }, [dirty, onLock]);

  useEffect(() => {
    let hiddenAt: number | null = null;
    let timer: number | undefined;
    const due = () =>
      hiddenAt !== null &&
      shouldLockWhileHidden({
        graceSeconds,
        hiddenForMs: Date.now() - hiddenAt,
        dirty: dirtyRef.current,
        filePickerOpen: isFilePickerOpen(),
      });
    const onTimer = () => {
      if (document.visibilityState === "hidden" && due()) onLockRef.current();
    };
    const onVisibility = () => {
      window.clearTimeout(timer);
      if (document.visibilityState === "hidden") {
        hiddenAt ??= Date.now();
        setCovered(true);
        if (due()) {
          onLockRef.current();
          return;
        }
        timer = window.setTimeout(onTimer, graceSeconds * 1000);
        return;
      }
      const lock = due();
      hiddenAt = null;
      clearFilePickerOpen();
      if (lock) onLockRef.current();
      else setCovered(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
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
