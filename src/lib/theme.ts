// Shared by the client ThemeSwitcher and the server layout's pre-paint
// script; kept out of the "use client" module so the server gets the value.
export const THEME_STORAGE_KEY = "portunus-theme";

// Browser / PWA chrome colour for an explicit Light or Dark choice: one
// theme-color meta of our own, placed first in <head> so it wins over the
// per-media metas Next renders (which are left untouched, so React's
// hydration never sees changed attributes). System removes it, so the
// per-media metas apply again.
//
// The single implementation: ThemeSwitcher calls it, and the layout inlines
// its source (toString) into the pre-paint script. Keep it self-contained —
// no imports, closures or helpers.
export function applyThemeColorOverride(
  theme: string,
  light: string,
  dark: string,
  metaId: string,
  metaName: string,
): void {
  let meta = document.getElementById(metaId);
  if (theme !== "light" && theme !== "dark") {
    if (meta) meta.remove();
    return;
  }
  if (!meta) {
    meta = document.createElement("meta");
    meta.id = metaId;
    meta.setAttribute("name", metaName);
    document.head.prepend(meta);
  }
  meta.setAttribute("content", theme === "dark" ? dark : light);
}
