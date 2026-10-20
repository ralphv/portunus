import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import pkg from "../../package.json";
import { RegisterSW } from "@/components/register-sw";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Portunus",
  description: "Self-hosted, Google Drive–backed secrets manager",
};

export const viewport: Viewport = {
  themeColor: "#0a1628",
};

// The Docker build injects NEXT_PUBLIC_APP_VERSION (the image tag's
// version); fall back to package.json for local dev. Normalize so both
// "v0.1.0" and "0.1.0" render as "v0.1.0" — non-semver build refs like
// "nightly" or "main" display raw.
function appVersion(): string {
  const raw = process.env.NEXT_PUBLIC_APP_VERSION || pkg.version;
  return /^v?\d/.test(raw) ? `v${raw.replace(/^v/, "")}` : raw;
}

// Runs before first paint so a stored non-default theme doesn't flash.
const themeInitScript = `try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <footer className="flex flex-wrap items-center justify-center gap-3 px-6 pb-3 text-xs text-slate-600 sm:pb-4">
          <a
            href="https://github.com/ralphv/portunus"
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-2 hover:text-slate-400 hover:underline"
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
