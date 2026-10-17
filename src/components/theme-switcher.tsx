"use client";

import { useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY } from "@/lib/theme";

const THEMES = [
  { id: "original", label: "Original" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
] as const;

type Theme = (typeof THEMES)[number]["id"];

const DEFAULT_THEME: Theme = "original";
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

function applyTheme(theme: Theme) {
  if (theme === DEFAULT_THEME) {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
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

  return (
    <div
      role="group"
      aria-label="Theme"
      className="inline-flex overflow-hidden rounded-md border border-slate-700"
    >
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={theme === t.id}
          onClick={() => setTheme(t.id)}
          className={`px-2 py-0.5 transition ${
            theme === t.id
              ? "bg-bronze/10 text-bronze"
              : "text-slate-500 hover:text-slate-300"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
