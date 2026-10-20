"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  SITE_ICON_SLUGS,
  siteIcon,
  siteIconSlug,
} from "@/lib/site-icon";

function monogram(name: string): string {
  const ch = (name.trim().match(/[\p{L}\p{N}]/u) ?? ["?"])[0];
  return ch.toUpperCase();
}

export function EntryIcon({
  entry,
  className = "h-4 w-4",
}: {
  entry: { url: string; name: string; iconSlug?: string };
  className?: string;
}) {
  const slug = siteIconSlug(entry.url, entry.name, entry.iconSlug);
  return <SlugOrMonogram slug={slug} name={entry.name} className={className} />;
}

export function SlugOrMonogram({
  slug,
  name,
  className = "h-4 w-4",
}: {
  slug: string | null;
  name: string;
  className?: string;
}) {
  const icon = slug ? siteIcon(slug) : undefined;
  if (icon) {
    return (
      <svg
        viewBox="0 0 24 24"
        role="img"
        aria-label={icon.title}
        className={`${className} shrink-0 text-slate-300`}
        fill="currentColor"
      >
        <path d={icon.path} />
      </svg>
    );
  }
  return (
    <span
      aria-hidden
      className={`${className} flex shrink-0 items-center justify-center rounded bg-navy-700 text-[10px] font-semibold leading-none text-slate-300`}
    >
      {monogram(name)}
    </span>
  );
}

// Searchable grid of the curated brand icons; choosing "Auto" clears the
// override so the icon follows the entry's URL/name again.
export function EntryIconPicker({
  entry,
  readOnly,
  onChange,
}: {
  entry: { url: string; name: string; iconSlug?: string };
  readOnly: boolean;
  onChange: (slug: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const autoSlug = siteIconSlug(entry.url, entry.name);
  const effective = siteIconSlug(entry.url, entry.name, entry.iconSlug);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SITE_ICON_SLUGS;
    return SITE_ICON_SLUGS.filter((slug) => {
      const icon = siteIcon(slug);
      return (
        slug.includes(q) ||
        icon?.title.toLowerCase().includes(q.replace(/\s+/g, "")) ||
        icon?.title.toLowerCase().includes(q)
      );
    });
  }, [query]);

  // An iconSlug that isn't a known icon (e.g. synced from a newer version)
  // falls back to the automatic icon, so the label says Auto too.
  const overrideIcon = entry.iconSlug ? siteIcon(entry.iconSlug) : undefined;
  const label = overrideIcon
    ? overrideIcon.title
    : autoSlug
      ? `Auto (${siteIcon(autoSlug)?.title ?? autoSlug})`
      : "Auto";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={readOnly}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Choose icon"
        className="mt-1 flex w-full items-center gap-2 rounded-lg border border-slate-600 bg-navy-900/60 px-3 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-60"
      >
        <SlugOrMonogram slug={effective} name={entry.name} />
        <span className="truncate">{label}</span>
        <span className="ml-auto text-xs text-slate-500">
          {readOnly ? "" : "change"}
        </span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-600 bg-navy-800 p-2 shadow-xl shadow-black/40">
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search icons…"
            className="w-full rounded border border-slate-600 bg-navy-900 px-2 py-1 text-sm text-slate-200 outline-none placeholder:text-slate-500 focus:border-bronze"
          />
          <div className="mt-2 grid max-h-56 grid-cols-6 gap-1 overflow-auto sm:grid-cols-8">
            <button
              type="button"
              title="Auto (follows the URL)"
              onClick={() => {
                onChange(undefined);
                setOpen(false);
                setQuery("");
              }}
              className={`flex flex-col items-center gap-1 rounded p-1.5 text-slate-300 hover:bg-navy-700 ${
                !overrideIcon ? "bg-navy-700 ring-1 ring-bronze" : ""
              }`}
            >
              <SlugOrMonogram slug={autoSlug} name={entry.name} />
              <span className="text-[10px]">Auto</span>
            </button>
            {filtered.map((slug) => {
              const icon = siteIcon(slug);
              if (!icon) return null;
              const selected = entry.iconSlug === slug;
              return (
                <button
                  key={slug}
                  type="button"
                  title={icon.title}
                  aria-pressed={selected}
                  onClick={() => {
                    onChange(slug);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={`flex items-center justify-center rounded p-1.5 text-slate-300 hover:bg-navy-700 ${
                    selected ? "bg-navy-700 ring-1 ring-bronze" : ""
                  }`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-5 w-5"
                    fill="currentColor"
                    aria-hidden
                  >
                    <path d={icon.path} />
                  </svg>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="col-span-full py-3 text-center text-xs text-slate-500">
                No icons match “{query}” — the entry letter is used instead.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
