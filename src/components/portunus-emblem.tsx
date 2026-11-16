// The Portunus emblem: a gate ring, light breathing through a
// keyhole, and a slow beacon sweep — the god of keys, doors, and harbors.
// Pure SVG + CSS (see globals.css); renders on the server, animates client-side.
export function PortunusEmblem({
  className = "h-14 w-14 sm:h-[70px] sm:w-[70px]",
}: {
  className?: string;
}) {
  return (
    <div
      className={`portunus-emblem ${className}`}
      role="img"
      aria-label="Portunus keyhole emblem"
    >
      <svg viewBox="0 0 64 64" className="h-full w-full">
        <defs>
          <radialGradient id="portunus-glow" cx="50%" cy="42%" r="65%">
            <stop offset="0%" className="[stop-color:var(--color-on-primary-container)]" />
            <stop offset="55%" className="[stop-color:var(--color-primary)]" />
            <stop offset="100%" className="[stop-color:var(--color-primary)] [stop-opacity:0]" />
          </radialGradient>
        </defs>
        {/* gate ring */}
        <circle
          cx="32"
          cy="32"
          r="30"
          className="fill-primary-container stroke-primary/50"
          strokeWidth="1.5"
        />
        {/* harbor beacon, slowly sweeping inside the gate */}
        <g className="portunus-beam">
          <polygon points="32,34 20,5 44,5" className="fill-primary" opacity="0.14" />
        </g>
        {/* keyhole — breathing light */}
        <g className="portunus-keyhole" fill="url(#portunus-glow)">
          <circle cx="32" cy="26" r="9" />
          <polygon points="28,31 36,31 40,52 24,52" />
        </g>
      </svg>
    </div>
  );
}
