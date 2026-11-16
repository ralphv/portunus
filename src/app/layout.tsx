import type { Metadata, Viewport } from "next";
import { Roboto, Roboto_Mono } from "next/font/google";
import pkg from "../../package.json";
import { RegisterSW } from "@/components/register-sw";
import { ScriptIntegrityCheck } from "@/components/script-integrity-check";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { scriptRecorderInitScript } from "@/lib/script-integrity";
import {
  THEME_COLOR_DARK,
  THEME_COLOR_LIGHT,
  THEME_MEDIA_DARK,
  THEME_MEDIA_LIGHT,
} from "@/constants";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import "./globals.css";

// Material 3 type: Roboto for text, Roboto Mono for secrets and codes
// (wired to font-sans / font-mono in globals.css).
const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const robotoMono = Roboto_Mono({
  variable: "--font-roboto-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Portunus",
  description: "Self-hosted, Google Drive–backed secrets manager",
};

// Material 3 surface colours of the light and dark schemes (globals.css).
export const viewport: Viewport = {
  themeColor: [
    { media: THEME_MEDIA_LIGHT, color: THEME_COLOR_LIGHT },
    { media: THEME_MEDIA_DARK, color: THEME_COLOR_DARK },
  ],
};

// The Docker build injects NEXT_PUBLIC_APP_VERSION (the image tag's
// version); fall back to package.json for local dev. Normalize so both
// "v0.1.0" and "0.1.0" render as "v0.1.0" — non-semver build refs like
// "nightly" or "main" display raw.
function appVersion(): string {
  const raw = process.env.NEXT_PUBLIC_APP_VERSION || pkg.version;
  return /^v?\d/.test(raw) ? `v${raw.replace(/^v/, "")}` : raw;
}

// Runs before first paint so a stored Light/Dark choice doesn't flash
// ("system" sets nothing and follows prefers-color-scheme).
// Inline scripts here are allowed by their build-time CSP hash (src/lib/csp.ts).
// Every theme-color meta (browser / PWA chrome) follows the scheme: an
// explicit Light/Dark choice sets them all; System leaves each its own
// prefers-color-scheme colour. Next streams metadata, so metas can arrive
// after this runs — re-apply on DOM changes until the page has loaded.
const themeInitScript = `try{var s=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(s==="light"||s==="dark")document.documentElement.dataset.theme=s;var f=function(){var t=document.documentElement.dataset.theme;document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){var k=t||(m.media===${JSON.stringify(
  THEME_MEDIA_DARK,
)}?"dark":"light");m.setAttribute("content",k==="dark"?${JSON.stringify(
  THEME_COLOR_DARK,
)}:${JSON.stringify(
  THEME_COLOR_LIGHT,
)})})},o=new MutationObserver(f);f();o.observe(document.documentElement,{childList:true,subtree:true});addEventListener("load",function(){f();o.disconnect()})}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${roboto.variable} ${robotoMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {/* Best-effort script tamper-evidence, secondary to the CSP — not a
            defense against browser extensions (see SECURITY.md). */}
        <script dangerouslySetInnerHTML={{ __html: scriptRecorderInitScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ScriptIntegrityCheck />
        {children}
        <footer className="flex flex-wrap items-center justify-center gap-3 px-6 pb-3 text-xs text-outline sm:pb-4">
          <a
            href="https://github.com/ralphv/portunus"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-outline-variant underline-offset-2 hover:text-on-surface-variant hover:decoration-outline"
          >
            Portunus {appVersion()}
          </a>
          <ThemeSwitcher />
        </footer>
        <RegisterSW />
      </body>
    </html>
  );
}
