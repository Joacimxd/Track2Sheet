import { useMemo } from 'react'

/** Deterministic pseudo-random so the crowd looks the same on every render. */
function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
}

/** Concert stage behind the highway: haze, spotlights, truss, amps and a crowd silhouette. */
export function StageBackdrop() {
  const crowd = useMemo(() => {
    const rand = rng(7)
    const people: { x: number; y: number; r: number; arm?: number }[] = []
    for (let row = 0; row < 3; row++) {
      for (let x = -10; x < 1010; x += 26 + rand() * 18) {
        people.push({ x, y: 250 + row * 34 + rand() * 12, r: 15 + row * 3 + rand() * 4, arm: rand() < 0.28 ? rand() * 2 - 1 : undefined })
      }
    }
    return people
  }, [])

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden bg-[#070b16]">
      {/* stage glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_35%,rgba(40,90,180,0.55),transparent_60%),radial-gradient(ellipse_at_15%_10%,rgba(56,214,255,0.25),transparent_45%),radial-gradient(ellipse_at_85%_10%,rgba(90,120,255,0.25),transparent_45%)]" />
      {/* truss */}
      <div className="absolute inset-x-[8%] top-[6%] h-3 border-y border-slate-400/20 bg-[repeating-linear-gradient(45deg,transparent_0_6px,rgba(148,163,184,0.18)_6px_8px)]" />
      <div className="absolute top-[6%] bottom-[30%] left-[8%] w-3 border-x border-slate-400/20 bg-[repeating-linear-gradient(45deg,transparent_0_6px,rgba(148,163,184,0.18)_6px_8px)]" />
      <div className="absolute top-[6%] right-[8%] bottom-[30%] w-3 border-x border-slate-400/20 bg-[repeating-linear-gradient(45deg,transparent_0_6px,rgba(148,163,184,0.18)_6px_8px)]" />
      {/* amps */}
      <div className="absolute top-[32%] left-[14%] h-[26%] w-[13%] rounded-sm border border-slate-500/20 bg-gradient-to-b from-slate-800/50 to-slate-900/30" />
      <div className="absolute top-[32%] right-[14%] h-[26%] w-[13%] rounded-sm border border-slate-500/20 bg-gradient-to-b from-slate-800/50 to-slate-900/30" />
      {/* light beams */}
      {[12, 30, 70, 88].map((left, i) => (
        <div
          key={left}
          className="stage-beam absolute -top-[5%] h-[90%] w-[18%]"
          style={{ left: `${left - 9}%`, animationDelay: `${i * -1.7}s`, animationDuration: `${6 + i}s` }}
        />
      ))}
      {/* haze */}
      <div className="absolute inset-x-0 top-[35%] h-[30%] bg-[radial-gradient(ellipse_at_center,rgba(120,160,220,0.18),transparent_70%)] blur-xl" />
      {/* crowd */}
      <svg className="absolute inset-x-0 bottom-0 h-[45%] w-full" viewBox="0 0 1000 360" preserveAspectRatio="none">
        <defs>
          <linearGradient id="crowd-fade" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#03050a" stopOpacity="0.85" />
            <stop offset="1" stopColor="#020308" stopOpacity="1" />
          </linearGradient>
        </defs>
        <g fill="url(#crowd-fade)">
          {crowd.map((p, i) => (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r={p.r} />
              <rect x={p.x - p.r * 1.5} y={p.y + p.r * 0.7} width={p.r * 3} height={360} rx={p.r} />
              {p.arm !== undefined && (
                <rect
                  x={p.x + p.r * 0.9}
                  y={p.y - p.r * 4}
                  width={p.r * 0.55}
                  height={p.r * 4.5}
                  rx={p.r * 0.3}
                  transform={`rotate(${p.arm * 20} ${p.x + p.r} ${p.y + p.r})`}
                />
              )}
            </g>
          ))}
        </g>
      </svg>
    </div>
  )
}
