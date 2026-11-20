import { useEffect, useMemo, useRef } from 'react'
import type { InstrumentId, MidiNote, ParsedMidi } from '../types'
import { LANES } from '../utils/midiParser'
import { useCanvas } from '../hooks/useCanvas'
import { StageBackdrop } from './StageBackdrop'

interface Props {
  midi: ParsedMidi | null
  instrument: InstrumentId
  getTime: () => number
}

const LOOKAHEAD = 1.9 // seconds of notes visible on the highway
const HIT_WINDOW = 0.13 // seconds either side of the strike line
const P_FAR = 0.22 // perspective scale at the far end of the road
const Z_NEAR = -0.16 // road continues a bit below the strike line
const SUSTAIN_MIN = 0.28 // notes longer than this get a trail
const KEYS: Record<string, number> = { a: 0, s: 1, d: 2, f: 3, g: 4, '1': 0, '2': 1, '3': 2, '4': 3, '5': 4 }

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  size: number
  hue: number
}
interface Flash {
  lane: number
  life: number
}

function firstVisible(notes: MidiNote[], t: number) {
  let lo = 0
  let hi = notes.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (notes[mid].time < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function NoteHighway({ midi, instrument, getTime }: Props) {
  const lanes = LANES[instrument]
  const notes = useMemo(() => midi?.notes ?? [], [midi])
  // Longest note, so trails that started before the visible window are still drawn.
  const maxDur = useMemo(() => notes.reduce((m, n) => Math.max(m, n.duration), 0), [notes])

  const hits = useRef(new Set<number>())
  const pressed = useRef([false, false, false, false, false])
  const holding = useRef<(number | null)[]>([null, null, null, null, null])
  const particles = useRef<Particle[]>([])
  const flashes = useRef<Flash[]>([])
  const lastTime = useRef(0)
  const geom = useRef({ cx: 0, halfW: 0, receptorY: 0, vy: 0 })

  // New chart -> reset judgement state.
  useEffect(() => {
    hits.current.clear()
    holding.current = [null, null, null, null, null]
    particles.current = []
  }, [notes])

  const project = (u: number, z: number) => {
    const { cx, halfW, receptorY, vy } = geom.current
    const p = 1 / (1 + z * (1 / P_FAR - 1))
    return { x: cx + u * 2 * halfW * p, y: vy + (receptorY - vy) * p, p }
  }
  const laneU = (lane: number) => (lane + 0.5) / 5 - 0.5

  const burst = (lane: number, strength: number) => {
    const { x, y } = project(laneU(lane), 0)
    const laneW = (geom.current.halfW * 2) / 5
    for (let i = 0; i < 36 * strength; i++) {
      particles.current.push({
        x: x + (Math.random() - 0.5) * laneW * 0.5,
        y: y - Math.random() * 6,
        vx: (Math.random() - 0.5) * 90,
        vy: -(120 + Math.random() * 260) * strength,
        life: 0,
        max: 0.35 + Math.random() * 0.35,
        size: laneW * (0.12 + Math.random() * 0.16),
        hue: 20 + Math.random() * 35,
      })
    }
    for (let i = 0; i < 10 * strength; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4
      const sp = 200 + Math.random() * 320
      particles.current.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 0.3, size: 2.2, hue: 50 })
    }
  }

  // Keyboard: A S D F G or 1-5.
  useEffect(() => {
    const isTyping = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement
    const down = (e: KeyboardEvent) => {
      const lane = KEYS[e.key.toLowerCase()]
      if (lane === undefined || isTyping(e) || e.repeat) return
      pressed.current[lane] = true
      const now = getTime()
      let best = -1
      let bestDist = HIT_WINDOW
      for (let i = firstVisible(notes, now - HIT_WINDOW); i < notes.length && notes[i].time <= now + HIT_WINDOW; i++) {
        const d = Math.abs(notes[i].time - now)
        if (notes[i].lane === lane && !hits.current.has(i) && d <= bestDist) {
          best = i
          bestDist = d
        }
      }
      if (best >= 0) {
        hits.current.add(best)
        flashes.current.push({ lane, life: 0 })
        burst(lane, 1)
        if (notes[best].duration >= SUSTAIN_MIN) holding.current[lane] = best
      }
    }
    const up = (e: KeyboardEvent) => {
      const lane = KEYS[e.key.toLowerCase()]
      if (lane === undefined) return
      pressed.current[lane] = false
      holding.current[lane] = null
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [notes, getTime])

  const canvasRef = useCanvas((ctx, w, h, dt) => {
    const now = getTime()
    // Seeking backwards re-arms the notes ahead of the new position.
    if (now < lastTime.current - 0.25) {
      for (const i of [...hits.current]) if (notes[i].time > now - HIT_WINDOW) hits.current.delete(i)
    }
    lastTime.current = now

    const receptorY = h * 0.85
    const topY = h * 0.04
    const halfW = Math.min(w * 0.36, h * 0.5)
    geom.current = { cx: w / 2, halfW, receptorY, vy: (topY - P_FAR * receptorY) / (1 - P_FAR) }
    const laneW = (halfW * 2) / 5
    ctx.clearRect(0, 0, w, h)

    // Road surface
    const nearL = project(-0.5, Z_NEAR)
    const nearR = project(0.5, Z_NEAR)
    const farL = project(-0.5, 1)
    const farR = project(0.5, 1)
    const surface = ctx.createLinearGradient(0, farL.y, 0, nearL.y)
    surface.addColorStop(0, 'rgba(10,14,24,0.15)')
    surface.addColorStop(0.25, 'rgba(10,14,26,0.82)')
    surface.addColorStop(1, 'rgba(6,9,16,0.94)')
    ctx.fillStyle = surface
    polygon(ctx, [nearL, nearR, farR, farL])
    ctx.fill()

    // Beat & bar lines
    if (midi) {
      for (const bt of midi.beatTimes) {
        const z = (bt - now) / LOOKAHEAD
        if (z < Z_NEAR || z > 1) continue
        const isBar = midi.measureTimes.includes(bt)
        const l = project(-0.5, z)
        const r = project(0.5, z)
        ctx.strokeStyle = isBar ? `rgba(220,230,245,${0.55 * (1 - z * 0.6)})` : `rgba(160,175,200,${0.22 * (1 - z * 0.6)})`
        ctx.lineWidth = (isBar ? 2.4 : 1.2) * l.p
        line(ctx, l.x, l.y, r.x, r.y)
      }
    }

    // Lane strings
    for (let lane = 0; lane < 5; lane++) {
      const a = project(laneU(lane), 1)
      const b = project(laneU(lane), Z_NEAR)
      const grad = ctx.createLinearGradient(0, a.y, 0, b.y)
      grad.addColorStop(0, hexA(lanes[lane].color, 0.15))
      grad.addColorStop(1, hexA(lanes[lane].color, 0.95))
      ctx.strokeStyle = grad
      ctx.lineWidth = 2.6
      line(ctx, a.x, a.y, b.x, b.y)
    }

    // Side rails
    for (const side of [-0.5, 0.5]) {
      const a = project(side, 1)
      const b = project(side, Z_NEAR)
      const grad = ctx.createLinearGradient(0, a.y, 0, b.y)
      grad.addColorStop(0, 'rgba(150,170,200,0.2)')
      grad.addColorStop(1, 'rgba(210,225,245,0.95)')
      ctx.strokeStyle = grad
      ctx.lineWidth = 6
      line(ctx, a.x + side * 4, a.y, b.x + side * 10, b.y)
    }

    // Strike line
    const sl = project(-0.5, 0)
    const sr = project(0.5, 0)
    ctx.strokeStyle = 'rgba(220,240,255,0.5)'
    ctx.lineWidth = 2
    line(ctx, sl.x, sl.y, sr.x, sr.y)

    // Receptors
    for (let lane = 0; lane < 5; lane++) {
      const { x, y } = project(laneU(lane), 0)
      const rx = laneW * 0.4
      const ry = rx * 0.42
      const on = pressed.current[lane]
      const c = lanes[lane].color
      ctx.save()
      ctx.shadowColor = c
      ctx.shadowBlur = on ? 28 : 12
      ellipse(ctx, x, y + ry * 0.25, rx * 1.08, ry * 1.12)
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fill()
      ellipse(ctx, x, y, rx, ry)
      ctx.lineWidth = rx * 0.17
      ctx.strokeStyle = c
      ctx.stroke()
      ctx.restore()
      ellipse(ctx, x, y, rx * 0.72, ry * 0.72)
      const metal = ctx.createLinearGradient(0, y - ry, 0, y + ry)
      metal.addColorStop(0, on ? lanes[lane].glow : '#9aa6b5')
      metal.addColorStop(1, on ? c : '#2b313b')
      ctx.fillStyle = metal
      ctx.fill()
      ellipse(ctx, x, y, rx * 0.36, ry * 0.36)
      ctx.fillStyle = on ? '#fff' : '#1a1e25'
      ctx.fill()
      ctx.fillStyle = 'rgba(200,220,240,0.7)'
      ctx.font = `600 ${Math.max(10, laneW * 0.16)}px Rajdhani, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(instrument === 'drums' ? `${lanes[lane].label} · ${'ASDFG'[lane]}` : lanes[lane].label, x, y + ry + 8)
    }

    // Notes: trails first, then gems far -> near
    const start = firstVisible(notes, now - maxDur - 0.5)
    const end = firstVisible(notes, now + LOOKAHEAD)
    for (let i = start; i < end; i++) {
      const n = notes[i]
      if (n.duration < SUSTAIN_MIN || n.time + n.duration < now) continue
      const hit = hits.current.has(i)
      const z0 = Math.max(hit ? 0 : Z_NEAR, (n.time - now) / LOOKAHEAD)
      const z1 = Math.min(1, (n.time + n.duration - now) / LOOKAHEAD)
      if (z1 <= z0) continue
      const u = laneU(n.lane)
      const tw = laneW * 0.11
      const a0 = project(u - tw / (2 * halfW), z0)
      const a1 = project(u + tw / (2 * halfW), z0)
      const b1 = project(u + tw / (2 * halfW), z1)
      const b0 = project(u - tw / (2 * halfW), z1)
      const missed = !hit && n.time < now - HIT_WINDOW
      const col = lanes[n.lane]
      ctx.save()
      if (hit) {
        ctx.shadowColor = col.glow
        ctx.shadowBlur = 18
      }
      ctx.fillStyle = missed ? 'rgba(120,120,130,0.35)' : hexA(hit ? col.glow : col.color, hit ? 0.95 : 0.75)
      polygon(ctx, [a0, a1, b1, b0])
      ctx.fill()
      ctx.restore()
      if (hit && holding.current[n.lane] === i && Math.random() < 0.6) burst(n.lane, 0.25)
    }

    for (let i = end - 1; i >= start; i--) {
      const n = notes[i]
      if (hits.current.has(i)) continue
      const z = (n.time - now) / LOOKAHEAD
      if (z < Z_NEAR || z > 1) continue
      const { x, y, p } = project(laneU(n.lane), z)
      const missed = n.time < now - HIT_WINDOW
      drawGem(ctx, x, y, laneW * 0.38 * p, missed ? '#5c626c' : lanes[n.lane].color, missed ? '#80868f' : lanes[n.lane].glow, missed)
    }

    // Hit flashes (expanding rings)
    flashes.current = flashes.current.filter((f) => (f.life += dt) < 0.3)
    for (const f of flashes.current) {
      const { x, y } = project(laneU(f.lane), 0)
      const k = f.life / 0.3
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ellipse(ctx, x, y, laneW * (0.45 + k * 0.5), laneW * (0.19 + k * 0.2))
      ctx.strokeStyle = `rgba(255,230,160,${1 - k})`
      ctx.lineWidth = 4 * (1 - k) + 1
      ctx.stroke()
      ctx.restore()
    }

    // Fire particles
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    particles.current = particles.current.filter((pt) => (pt.life += dt) < pt.max)
    for (const pt of particles.current) {
      pt.x += pt.vx * dt
      pt.y += pt.vy * dt
      pt.vy += 260 * dt
      const k = pt.life / pt.max
      const r = pt.size * (1 - k * 0.6)
      const grad = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, r)
      grad.addColorStop(0, `hsla(${pt.hue + 20},100%,85%,${1 - k})`)
      grad.addColorStop(0.4, `hsla(${pt.hue},100%,55%,${0.8 * (1 - k)})`)
      grad.addColorStop(1, `hsla(${pt.hue - 15},100%,40%,0)`)
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  })

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <StageBackdrop />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {!midi && (
        <div className="absolute inset-x-0 top-1/3 text-center text-sm text-slate-300/80">
          No hay notas que mostrar para este instrumento.
        </div>
      )}
      <div className="pointer-events-none absolute bottom-2 left-3 text-[11px] tracking-wide text-slate-400/80">
        Teclas A S D F G · 1-5 · Espacio = Play/Pausa
      </div>
    </div>
  )
}

type Pt = { x: number; y: number }

function polygon(ctx: CanvasRenderingContext2D, pts: Pt[]) {
  ctx.beginPath()
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
  ctx.closePath()
}

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x1, y1)
  ctx.stroke()
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) {
  ctx.beginPath()
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2)
}

function hexA(hex: string, alpha: number) {
  const v = parseInt(hex.slice(1), 16)
  return `rgba(${v >> 16},${(v >> 8) & 255},${v & 255},${alpha})`
}

/** A Guitar-Hero style gem: dark base, coloured body, white/silver cap. */
function drawGem(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, color: string, glow: string, dim: boolean) {
  const ry = rx * 0.42
  const depth = ry * 0.7
  ellipse(ctx, x, y + depth * 0.6, rx * 1.02, ry)
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fill()
  // body side
  ctx.beginPath()
  ctx.ellipse(x, y + depth * 0.3, rx, ry, 0, 0, Math.PI)
  ctx.lineTo(x - rx, y - depth * 0.2)
  ctx.ellipse(x, y - depth * 0.2, rx, ry, 0, Math.PI, 0, true)
  ctx.closePath()
  const side = ctx.createLinearGradient(x - rx, 0, x + rx, 0)
  side.addColorStop(0, shade(color, -0.45))
  side.addColorStop(0.45, color)
  side.addColorStop(1, shade(color, -0.55))
  ctx.fillStyle = side
  ctx.fill()
  // top face
  ellipse(ctx, x, y - depth * 0.2, rx, ry)
  const top = ctx.createRadialGradient(x - rx * 0.2, y - depth * 0.2 - ry * 0.4, rx * 0.1, x, y - depth * 0.2, rx)
  top.addColorStop(0, glow)
  top.addColorStop(1, color)
  ctx.fillStyle = top
  ctx.fill()
  // silver cap
  ellipse(ctx, x, y - depth * 0.45, rx * 0.5, ry * 0.5)
  const cap = ctx.createLinearGradient(0, y - depth * 0.45 - ry * 0.5, 0, y - depth * 0.45 + ry * 0.5)
  cap.addColorStop(0, dim ? '#9a9a9a' : '#ffffff')
  cap.addColorStop(1, dim ? '#5a5a5a' : '#a9b4c2')
  ctx.fillStyle = cap
  ctx.fill()
}

function shade(hex: string, amount: number) {
  const v = parseInt(hex.slice(1), 16)
  const f = (c: number) => Math.round(Math.max(0, Math.min(255, c + c * amount)))
  return `rgb(${f(v >> 16)},${f((v >> 8) & 255)},${f(v & 255)})`
}
