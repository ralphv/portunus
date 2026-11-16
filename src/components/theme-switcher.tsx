"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  THEME_COLOR_DARK,
  THEME_COLOR_LIGHT,
  THEME_DARK_LABEL,
  THEME_GROUP_LABEL,
  THEME_COLOR_META_ID,
  THEME_COLOR_META_NAME,
  THEME_LIGHT_LABEL,
  THEME_SYSTEM_LABEL,
} from "@/constants";
import { applyThemeColorOverride, THEME_STORAGE_KEY } from "@/lib/theme";

// Material 3 light and dark schemes (src/app/globals.css). "system" sets no
// data-theme and follows the OS's prefers-color-scheme.
const THEMES = [
  { id: "system", label: THEME_SYSTEM_LABEL },
  { id: "light", label: THEME_LIGHT_LABEL },
  { id: "dark", label: THEME_DARK_LABEL },
] as const;

type Theme = (typeof THEMES)[number]["id"];

const DEFAULT_THEME: Theme = "system";
const CHANGE_EVENT = "portunus-theme-change";

function isTheme(value: unknown): value is Theme {
  return THEMES.some((t) => t.id === value);
}

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

// Browser / PWA chrome colour for the chosen scheme (src/lib/theme.ts).
function applyThemeColor(theme: Theme) {
  applyThemeColorOverride(
    theme,
    THEME_COLOR_LIGHT,
    THEME_COLOR_DARK,
    THEME_COLOR_META_ID,
    THEME_COLOR_META_NAME,
  );
}

function applyTheme(theme: Theme) {
  if (theme === DEFAULT_THEME) {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
  applyThemeColor(theme);
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_STORAGE_KEY) return;
    applyTheme(readTheme());
    onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function setTheme(theme: Theme) {
  applyTheme(theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage unavailable (private mode) — theme still applies this page.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function ThemeSwitcher() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => DEFAULT_THEME);
  // Re-apply on mount: covers anything that ran before or replaced the
  // pre-paint script's meta.
  useEffect(() => applyThemeColor(readTheme()), []);

  return (
    <div
      role="group"
      aria-label={THEME_GROUP_LABEL}
      className="inline-flex overflow-hidden rounded-full border border-outline"
    >
      {THEMES.map((t, i) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={theme === t.id}
          onClick={() => setTheme(t.id)}
          className={`inline-flex h-8 items-center gap-1 px-3 text-xs font-medium transition ${
            i > 0 ? "border-l border-outline" : ""
          } ${
            theme === t.id
              ? "bg-secondary-container text-on-secondary-container"
              : "text-on-surface hover:bg-on-surface/8"
          }`}
        >
          {theme === t.id && (
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12l5 5 9-10" />
            </svg>
          )}
          {t.label}
        </button>
      ))}
    </div>
  );
}
