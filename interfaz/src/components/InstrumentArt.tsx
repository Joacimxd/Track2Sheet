// Inline SVG avatars for the instruments (no external images needed).

export function GuitarArt({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden>
      <defs>
        <linearGradient id="gt-body" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#ffd27a" />
          <stop offset="0.55" stopColor="#f0a531" />
          <stop offset="1" stopColor="#a65b12" />
        </linearGradient>
        <linearGradient id="gt-neck" x1="0" x2="1">
          <stop offset="0" stopColor="#6b3a17" />
          <stop offset="1" stopColor="#3b1e0a" />
        </linearGradient>
      </defs>
      <g transform="rotate(-38 60 60)">
        <rect x="55" y="4" width="10" height="56" rx="2" fill="url(#gt-neck)" />
        <rect x="52" y="0" width="16" height="14" rx="3" fill="#2a1408" />
        {[3, 7, 11].map((y) => (
          <g key={y}>
            <circle cx="50" cy={y} r="2" fill="#d6dde6" />
            <circle cx="70" cy={y} r="2" fill="#d6dde6" />
          </g>
        ))}
        {[16, 24, 31, 38, 44, 50].map((y) => (
          <rect key={y} x="55" y={y} width="10" height="1" fill="#c9ced6" opacity="0.8" />
        ))}
        <path d="M60 52c-14 0-20 8-17 19 2 6-6 9-6 21 0 15 11 24 23 24s23-9 23-24c0-12-8-15-6-21 3-11-3-19-17-19z" fill="url(#gt-body)" stroke="#5a2d0c" strokeWidth="1.5" />
        <circle cx="60" cy="80" r="7" fill="#1d0f06" stroke="#3b1e0a" strokeWidth="2" />
        <rect x="51" y="98" width="18" height="4" rx="1" fill="#2a1408" />
        {[57, 59, 61, 63].map((x) => (
          <line key={x} x1={x} y1="6" x2={x} y2="100" stroke="#eef2f7" strokeWidth="0.5" />
        ))}
      </g>
    </svg>
  )
}

export function DrumKitArt({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 120" className={className} aria-hidden>
      <defs>
        <linearGradient id="dk-shell" x1="0" x2="1">
          <stop offset="0" stopColor="#14161b" />
          <stop offset="0.5" stopColor="#3a3d45" />
          <stop offset="1" stopColor="#14161b" />
        </linearGradient>
        <linearGradient id="dk-cym" x1="0" x2="1">
          <stop offset="0" stopColor="#8a6a1f" />
          <stop offset="0.5" stopColor="#f3d27a" />
          <stop offset="1" stopColor="#8a6a1f" />
        </linearGradient>
      </defs>
      <g stroke="#9aa3ad" strokeWidth="1.5">
        <line x1="22" y1="30" x2="16" y2="112" />
        <line x1="138" y1="26" x2="146" y2="112" />
        <line x1="16" y1="112" x2="8" y2="118" />
        <line x1="16" y1="112" x2="24" y2="118" />
        <line x1="146" y1="112" x2="138" y2="118" />
        <line x1="146" y1="112" x2="154" y2="118" />
      </g>
      <ellipse cx="24" cy="29" rx="20" ry="4" fill="url(#dk-cym)" />
      <ellipse cx="136" cy="25" rx="22" ry="4.5" fill="url(#dk-cym)" />
      {/* toms */}
      <g>
        <rect x="46" y="36" width="28" height="20" rx="3" fill="url(#dk-shell)" stroke="#c9a54a" strokeWidth="1.5" />
        <ellipse cx="60" cy="36" rx="14" ry="4" fill="#e9edf2" stroke="#c9a54a" />
        <rect x="86" y="36" width="28" height="20" rx="3" fill="url(#dk-shell)" stroke="#c9a54a" strokeWidth="1.5" />
        <ellipse cx="100" cy="36" rx="14" ry="4" fill="#e9edf2" stroke="#c9a54a" />
      </g>
      {/* snare & floor tom */}
      <rect x="20" y="64" width="30" height="16" rx="3" fill="url(#dk-shell)" stroke="#c9a54a" strokeWidth="1.5" />
      <ellipse cx="35" cy="64" rx="15" ry="4" fill="#e9edf2" stroke="#c9a54a" />
      <rect x="112" y="62" width="32" height="30" rx="3" fill="url(#dk-shell)" stroke="#c9a54a" strokeWidth="1.5" />
      <ellipse cx="128" cy="62" rx="16" ry="4.5" fill="#e9edf2" stroke="#c9a54a" />
      {/* bass drum */}
      <circle cx="80" cy="86" r="30" fill="url(#dk-shell)" stroke="#c9a54a" strokeWidth="3" />
      <circle cx="80" cy="86" r="24" fill="#dfe6ee" opacity="0.92" />
      <path d="M64 74l30 24M70 70l26 20" stroke="#ffffff" strokeWidth="2" opacity="0.7" />
    </svg>
  )
}
