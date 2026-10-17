import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import pkg from "../../package.json";
import { RegisterSW } from "@/components/register-sw";
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <footer className="px-6 pb-4 text-center text-xs text-slate-600">
          Portunus v{pkg.version}
        </footer>
        <RegisterSW />
      </body>
    </html>
  );
}
