// The Portunus emblem: a bronze gate ring, warm light breathing through a
// keyhole, and a slow beacon sweep — the god of keys, doors, and harbors.
// Pure SVG + CSS (see globals.css); renders on the server, animates client-side.
export function PortunusEmblem({ size = 70 }: { size?: number }) {
  return (
    <div
      className="portunus-emblem"
      style={{ width: size, height: size }}
      role="img"
      aria-label="Portunus keyhole emblem"
    >
      <svg viewBox="0 0 64 64" className="h-full w-full">
        <defs>
          <radialGradient id="portunus-glow" cx="50%" cy="42%" r="65%">
            <stop offset="0%" stopColor="#e2c558" />
            <stop offset="55%" stopColor="#c9a227" />
            <stop offset="100%" stopColor="#c9a227" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* gate ring */}
        <circle
          cx="32"
          cy="32"
          r="30"
          fill="#10203a"
          stroke="#c9a227"
          strokeOpacity="0.5"
          strokeWidth="1.5"
        />
        {/* harbor beacon, slowly sweeping inside the gate */}
        <g className="portunus-beam">
          <polygon points="32,34 20,5 44,5" fill="#c9a227" opacity="0.14" />
        </g>
        {/* keyhole — breathing bronze light */}
        <g className="portunus-keyhole" fill="url(#portunus-glow)">
          <circle cx="32" cy="26" r="9" />
          <polygon points="28,31 36,31 40,52 24,52" />
        </g>
      </svg>
    </div>
  );
}
