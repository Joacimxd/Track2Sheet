import { useEffect, useRef, useState } from 'react'
import { Keyboard } from 'lucide-react'
import { useCanvas } from '../hooks/useCanvas'
import type { InstrumentId, ParsedMidi } from '../types'
import { INSTRUMENT_LABEL } from '../types'
import {
  DRUM_LANES,
  INLAY_FRETS,
  KICK,
  KICK_LANE,
  MAX_FRET,
  STRING_COLORS,
  STRING_KEYS,
  STRING_NAMES,
  type DrumNote,
  type FretboardTab,
  type FretNote,
} from '../utils/midiToFretboard'

/** Seconds of music visible ahead of the impact line. */
const LOOK_AHEAD = 2.8
/** Perspective strength: an object at the far end is drawn 1 / (1 + DEPTH) times smaller. */
const DEPTH = 3.6
/** ± seconds to count a key press as a hit. */
const HIT_WINDOW = 0.12
const MIN_VISIBLE_FRETS = 7

interface Props {
  instrument: InstrumentId
  tab: FretboardTab
  drumNotes: DrumNote[]
  midi: ParsedMidi | null
  getTime: () => number
  playing: boolean
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  color: string
}

interface Score {
  hits: number
  misses: number
  streak: number
}

// ───────── colour helpers ─────────
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [n >> 16, (n >> 8) & 255, n & 255]
}
const rgba = (hex: string, a: number) => `rgba(${rgb(hex).join(',')},${a})`
function shade(hex: string, f: number) {
  const t = f < 0 ? 0 : 255
  const p = Math.abs(f)
  return `rgb(${rgb(hex)
    .map((c) => Math.round(c + (t - c) * p))
    .join(',')})`
}

/** First index whose time is >= t (arrays are sorted by time). */
function lowerBound(arr: readonly ({ time: number } | number)[], t: number) {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const v = arr[mid]
    if ((typeof v === 'number' ? v : v.time) < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function FretboardHighway({ instrument, tab, drumNotes, midi, getTime, playing }: Props) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [practice, setPractice] = useState(false)
  const [score, setScore] = useState<Score>({ hits: 0, misses: 0, streak: 0 })

  // Mutable animation state (never triggers React renders).
  const fx = useRef({
    cam: { f0: 0, f1: 12 },
    snapCam: true,
    glow: [0, 0, 0, 0, 0, 0], // per string / drum lane (5 = kick)
    keyFlash: [0, 0, 0, 0, 0, 0],
    judged: new Map<number, 'hit' | 'miss'>(),
    particles: [] as Particle[],
    misses: [] as { x: number; y: number; life: number }[],
    pendingHits: [] as number[],
    lastNow: 0,
    score: { hits: 0, misses: 0, streak: 0 } as Score,
  })

  const practiceRef = useRef(practice)
  useEffect(() => {
    practiceRef.current = practice
  }, [practice])

  const resetScore = () => {
    fx.current.judged.clear()
    fx.current.score = { hits: 0, misses: 0, streak: 0 }
    setScore(fx.current.score)
  }

  // New notes / mode → forget judgements.
  useEffect(() => {
    fx.current.judged.clear()
    fx.current.score = { hits: 0, misses: 0, streak: 0 }
    fx.current.snapCam = true
  }, [tab, drumNotes, instrument])

  const judge = (id: number, result: 'hit' | 'miss') => {
    const f = fx.current
    f.judged.set(id, result)
    const s = f.score
    f.score = result === 'hit' ? { hits: s.hits + 1, misses: s.misses, streak: s.streak + 1 } : { hits: s.hits, misses: s.misses + 1, streak: 0 }
    setScore(f.score)
  }

  // Keyboard: A S D F G H = strings (low E → high e); drums A S D F G = pads, J = kick.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target
      if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return
      const key = e.key.toUpperCase()
      const idx = instrument === 'guitar' ? STRING_KEYS.indexOf(key) : key === KICK.key ? KICK_LANE : DRUM_LANES.findIndex((l) => l.key === key)
      if (idx < 0) return
      const f = fx.current
      f.keyFlash[idx] = 1
      if (!practiceRef.current) return
      const now = getTime()
      const list: { id: number; time: number; lane: number }[] =
        instrument === 'guitar' ? tab.notes.map((n) => ({ id: n.id, time: n.time, lane: n.string })) : drumNotes.map((n) => ({ id: n.id, time: n.time, lane: n.lane }))
      let best: { id: number; dt: number } | null = null
      for (let i = lowerBound(list, now - HIT_WINDOW); i < list.length && list[i].time <= now + HIT_WINDOW; i++) {
        const n = list[i]
        if (n.lane !== idx || f.judged.has(n.id)) continue
        const dt = Math.abs(n.time - now)
        if (!best || dt < best.dt) best = { id: n.id, dt }
      }
      if (best) {
        judge(best.id, 'hit')
        f.pendingHits.push(best.id)
        f.glow[idx] = 1
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // judge only touches refs + a state setter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instrument, tab, drumNotes, getTime])

  const canvasRef = useCanvas((ctx, w, h, dt) => {
    const f = fx.current
    const now = getTime()
    if (now < f.lastNow - 0.05) {
      // Seek / restart backwards: notes can be played again.
      f.judged.clear()
      f.particles = []
      f.misses = []
    }
    const prevNow = f.lastNow
    f.lastNow = now
    if (Math.abs(now - prevNow) > 0.3) f.snapCam = true
    ctx.clearRect(0, 0, w, h)

    // Squirrel "breathes" on the beat.
    if (imgRef.current) {
      let pulse = 0
      const beats = midi?.beatTimes
      if (beats?.length && playing) {
        const i = lowerBound(beats, now + 0.001) - 1
        if (i >= 0) pulse = Math.exp(-(now - beats[i]) * 7) * (i % (midi?.timeSignature[0] ?? 4) === 0 ? 1 : 0.55)
      }
      imgRef.current.style.scale = String(1 + pulse * 0.014)
    }

    const vx = w / 2
    const vy = h * 0.07
    const left = w * 0.045
    const right = w * 0.955
    const proj = (x: number, y: number, d: number) => {
      const p = 1 / (1 + Math.max(d, -0.15) * DEPTH)
      return { x: vx + (x - vx) * p, y: vy + (y - vy) * p, p }
    }
    const depthOf = (t: number) => (t - now) / LOOK_AHEAD

    // Readability: darken the lower part where the strings / pads are.
    const shadeGrad = ctx.createLinearGradient(0, h * 0.45, 0, h)
    shadeGrad.addColorStop(0, 'rgba(4,8,16,0)')
    shadeGrad.addColorStop(0.55, 'rgba(4,8,16,0.55)')
    shadeGrad.addColorStop(1, 'rgba(4,8,16,0.9)')
    ctx.fillStyle = shadeGrad
    ctx.fillRect(0, h * 0.45, w, h * 0.55)

    const floorQuad = (x0: number, x1: number, y: number, d0: number, d1: number) => {
      const a = proj(x0, y, d0)
      const b = proj(x1, y, d0)
      const c = proj(x1, y, d1)
      const e = proj(x0, y, d1)
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.lineTo(c.x, c.y)
      ctx.lineTo(e.x, e.y)
      ctx.closePath()
    }
    const line = (ax: number, ay: number, bx: number, by: number) => {
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(bx, by)
      ctx.stroke()
    }
    const beatLines = (x0: number, x1: number, y: number) => {
      if (!midi) return
      const measures = new Set(midi.measureTimes.map((t) => Math.round(t * 1000)))
      for (let i = lowerBound(midi.beatTimes, now); i < midi.beatTimes.length; i++) {
        const t = midi.beatTimes[i]
        const d = depthOf(t)
        if (d > 1.05) break
        const a = proj(x0, y, d)
        const b = proj(x1, y, d)
        const bar = measures.has(Math.round(t * 1000))
        ctx.strokeStyle = bar ? 'rgba(160,220,255,0.38)' : 'rgba(160,220,255,0.13)'
        ctx.lineWidth = bar ? 2 * a.p + 0.5 : 1
        line(a.x, a.y, b.x, b.y)
      }
    }
    const spark = (x: number, y: number, color: string, n = 14) => {
      for (let i = 0; i < n; i++)
        f.particles.push({ x, y, vx: (Math.random() - 0.5) * 320, vy: -80 - Math.random() * 260, life: 0.45 + Math.random() * 0.3, color })
    }
    const block = (x: number, y: number, bw: number, bh: number, color: string, opts: { label?: string; alpha?: number; glow?: boolean; muted?: boolean }) => {
      ctx.save()
      ctx.globalAlpha = opts.alpha ?? 1
      const r = Math.min(bh * 0.25, 6)
      // Extruded underside → 3D block.
      ctx.fillStyle = opts.muted ? '#1a0b0e' : shade(color, -0.55)
      ctx.beginPath()
      ctx.roundRect(x - bw / 2, y - bh / 2 + bh * 0.32, bw, bh, r)
      ctx.fill()
      if (opts.glow) {
        ctx.shadowColor = color
        ctx.shadowBlur = 26
      }
      const g = ctx.createLinearGradient(0, y - bh / 2, 0, y + bh / 2)
      if (opts.muted) {
        g.addColorStop(0, '#3a1d22')
        g.addColorStop(1, '#22100f')
      } else {
        g.addColorStop(0, shade(color, 0.35))
        g.addColorStop(1, color)
      }
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.roundRect(x - bw / 2, y - bh / 2, bw, bh, r)
      ctx.fill()
      ctx.shadowBlur = 0
      ctx.strokeStyle = opts.muted ? color : 'rgba(255,255,255,0.75)'
      ctx.lineWidth = Math.max(1, bh * 0.07)
      ctx.stroke()
      if (opts.muted) {
        ctx.strokeStyle = '#ff3b46'
        ctx.lineWidth = Math.max(1.5, bh * 0.14)
        const s = bh * 0.32
        line(x - s, y - s, x + s, y + s)
        line(x + s, y - s, x - s, y + s)
      } else if (opts.label && bh >= 8) {
        ctx.fillStyle = '#fff'
        ctx.font = `700 ${Math.round(bh * 0.78)}px Rajdhani, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.shadowColor = 'rgba(0,0,0,0.8)'
        ctx.shadowBlur = 3
        ctx.fillText(opts.label, x, y + bh * 0.04)
      }
      ctx.restore()
    }

    // Practice mode: notes that went past the window unplayed are misses.
    const missCheck = <T extends { id: number; time: number }>(notes: T[], where: (n: T) => { x: number; y: number }) => {
      if (!practiceRef.current) return
      for (let i = lowerBound(notes, now - HIT_WINDOW - 0.5); i < notes.length && notes[i].time < now - HIT_WINDOW; i++) {
        const n = notes[i]
        if (f.judged.has(n.id)) continue
        judge(n.id, 'miss')
        f.misses.push({ ...where(n), life: 0.6 })
      }
    }
    // Auto mode: light up whatever crosses the impact line.
    const crossed = <T extends { time: number }>(notes: T[], fire: (n: T) => void) => {
      if (practiceRef.current || !playing || now <= prevNow || now - prevNow > 0.25) return
      for (let i = lowerBound(notes, prevNow); i < notes.length && notes[i].time <= now; i++) fire(notes[i])
    }

    if (instrument === 'guitar') {
      // ───────────────────────── Guitar: 3D fretboard ─────────────────────────
      const notes = tab.notes
      const stringTop = h * 0.7
      const stringBottom = h * 0.875
      const gap = (stringBottom - stringTop) / 5
      const floorY = h * 0.915
      const stringY = (s: number) => stringTop + s * gap

      // Camera follows the frets coming up next (like Rocksmith's zoom).
      let lo = Infinity
      let hi = -Infinity
      for (let i = lowerBound(notes, now); i < notes.length && notes[i].time < now + LOOK_AHEAD * 0.75; i++) {
        if (notes[i].fret === 0) continue
        lo = Math.min(lo, notes[i].fret)
        hi = Math.max(hi, notes[i].fret)
      }
      if (lo !== Infinity) {
        let t0 = lo - 2
        let t1 = hi + 1
        if (t1 - t0 < MIN_VISIBLE_FRETS) {
          const extra = (MIN_VISIBLE_FRETS - (t1 - t0)) / 2
          t0 -= extra
          t1 += extra
        }
        if (t0 < 0) [t0, t1] = [0, t1 - t0]
        if (t1 > MAX_FRET + 1) [t0, t1] = [t0 - (t1 - MAX_FRET - 1), MAX_FRET + 1]
        // Smooth pan/zoom; jump straight there after a seek.
        const k = f.snapCam ? 1 : Math.min(1, dt * 2.2)
        f.snapCam = false
        f.cam.f0 += (t0 - f.cam.f0) * k
        f.cam.f1 += (t1 - f.cam.f1) * k
      }
      const { f0, f1 } = f.cam
      const wireX = (n: number) => left + ((n - f0) / (f1 - f0)) * (right - left)
      const fretCenter = (n: number) => (n === 0 ? (left + right) / 2 : (wireX(n - 1) + wireX(n)) / 2)
      const fretW = wireX(1) - wireX(0)
      const firstWire = Math.max(0, Math.ceil(f0 - 0.001))
      const lastWire = Math.min(MAX_FRET + 1, Math.floor(f1 + 0.001))

      // Frets used in the next ~1.4 s: highlighted lanes, wires and numbers.
      const active = new Set<number>()
      for (let i = lowerBound(notes, now - 0.05); i < notes.length && notes[i].time < now + 1.4; i++) if (notes[i].fret > 0) active.add(notes[i].fret)

      // Floor: lanes receding to the vanishing point.
      floorQuad(wireX(firstWire), wireX(lastWire), floorY, 0, 1.05)
      ctx.fillStyle = 'rgba(6,14,28,0.28)'
      ctx.fill()
      for (const n of active) {
        floorQuad(wireX(n - 1), wireX(n), floorY, 0, 1.05)
        const g = ctx.createLinearGradient(0, floorY, 0, vy + (floorY - vy) / (1 + DEPTH))
        g.addColorStop(0, 'rgba(56,214,255,0.16)')
        g.addColorStop(1, 'rgba(56,214,255,0)')
        ctx.fillStyle = g
        ctx.fill()
      }
      for (let n = firstWire; n <= lastWire; n++) {
        const a = proj(wireX(n), floorY, 0)
        const b = proj(wireX(n), floorY, 1.05)
        ctx.strokeStyle = active.has(n) || active.has(n + 1) ? 'rgba(120,230,255,0.45)' : 'rgba(190,215,255,0.2)'
        ctx.lineWidth = 1.2
        line(a.x, a.y, b.x, b.y)
      }
      beatLines(wireX(firstWire), wireX(lastWire), floorY)
      // Fret numbers far away (where the notes come from).
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      for (let n = Math.max(1, firstWire); n <= lastWire; n++) {
        if (!INLAY_FRETS.has(n) && !active.has(n)) continue
        const p = proj(fretCenter(n), floorY, 1)
        ctx.fillStyle = active.has(n) ? 'rgba(255,190,70,0.95)' : 'rgba(230,240,255,0.6)'
        ctx.font = `700 ${Math.max(10, 30 * p.p)}px Rajdhani, sans-serif`
        ctx.fillText(String(n), p.x, p.y - 2)
      }

      // Neck at the impact plane.
      const neckTop = stringTop - gap * 0.75
      const neckBottom = stringBottom + gap * 0.75
      const neck = ctx.createLinearGradient(0, neckTop, 0, neckBottom)
      neck.addColorStop(0, 'rgba(20,14,10,0.55)')
      neck.addColorStop(1, 'rgba(10,8,6,0.75)')
      ctx.fillStyle = neck
      ctx.fillRect(wireX(firstWire), neckTop, wireX(lastWire) - wireX(firstWire), neckBottom - neckTop)
      // Inlays.
      ctx.fillStyle = 'rgba(230,240,255,0.18)'
      for (let n = Math.max(1, firstWire); n <= lastWire; n++) {
        if (!INLAY_FRETS.has(n)) continue
        const cx = fretCenter(n)
        const ys = n === 12 ? [stringY(1.5), stringY(3.5)] : [(stringTop + stringBottom) / 2]
        for (const cy of ys) {
          ctx.beginPath()
          ctx.arc(cx, cy, gap * 0.28, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      // Fret wires (anchor wires glow cyan).
      const anchorLo = active.size ? Math.min(...active) - 1 : -1
      const anchorHi = active.size ? Math.max(...active) : -1
      for (let n = firstWire; n <= lastWire; n++) {
        const x = wireX(n)
        const anchor = n === anchorLo || n === anchorHi
        ctx.strokeStyle = n === 0 ? '#e8e2d0' : anchor ? '#7ff3ff' : 'rgba(210,220,232,0.7)'
        ctx.lineWidth = n === 0 ? 6 : anchor ? 3.5 : 2
        ctx.shadowColor = '#38d6ff'
        ctx.shadowBlur = anchor ? 16 : 0
        line(x, neckTop, x, neckBottom)
      }
      ctx.shadowBlur = 0

      // Strings (vibrate after being hit).
      for (let s = 0; s < 6; s++) {
        const y = stringY(s)
        const color = STRING_COLORS[s]
        const g = Math.max(f.glow[s], f.keyFlash[s] * 0.6)
        ctx.strokeStyle = g > 0.05 ? shade(color, 0.35 * g) : color
        ctx.lineWidth = 3.6 - s * 0.4 + g * 1.5
        ctx.shadowColor = color
        ctx.shadowBlur = 6 + g * 22
        ctx.beginPath()
        if (f.glow[s] > 0.03) {
          const amp = f.glow[s] * gap * 0.16
          for (let x = 0; x <= w; x += 10) {
            const yy = y + Math.sin(x * 0.06 + now * 70 + s) * amp * Math.sin((x / w) * Math.PI)
            if (x === 0) ctx.moveTo(x, yy)
            else ctx.lineTo(x, yy)
          }
        } else {
          ctx.moveTo(0, y)
          ctx.lineTo(w, y)
        }
        ctx.stroke()
      }
      ctx.shadowBlur = 0

      // Chord frames.
      ctx.lineWidth = 1.5
      for (let i = lowerBound(tab.chords, now - 0.1); i < tab.chords.length && depthOf(tab.chords[i].time) < 1.05; i++) {
        const c = tab.chords[i]
        const d = Math.max(0, depthOf(c.time))
        const x0 = c.minFret === 0 ? wireX(firstWire) : wireX(c.minFret - 1)
        const x1 = wireX(Math.max(c.maxFret, 1))
        const a = proj(x0 - 4, stringY(c.minString) - gap * 0.55, d)
        const b = proj(x1 + 4, stringY(c.maxString) + gap * 0.55, d)
        ctx.strokeStyle = `rgba(255,255,255,${0.45 * (1 - d * 0.5)})`
        ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y)
      }

      // Notes, far → near.
      const start = lowerBound(notes, now - 6)
      const end = lowerBound(notes, now + LOOK_AHEAD * 1.05)
      for (let i = end - 1; i >= start; i--) {
        const n = notes[i]
        const endT = n.time + n.duration
        const sustain = n.duration > 0.3 && !n.muted
        const past = n.time < now
        if (past && !(sustain && endT > now) && now - n.time > 0.12) continue
        if (practiceRef.current && f.judged.get(n.id) === 'miss') continue
        const color = STRING_COLORS[n.string]
        const d = Math.max(0, depthOf(n.time))
        const x = fretCenter(n.fret)
        const y = stringY(n.string)
        const p = proj(x, y, d)

        // Sustain trail.
        if (sustain && endT > now) {
          const d1 = Math.min(1.05, depthOf(endT))
          const halfW = n.fret === 0 ? (right - left) * 0.42 : fretW * 0.09
          const a0 = proj(x - halfW, y, d)
          const a1 = proj(x + halfW, y, d)
          const b1 = proj(x + halfW, y, d1)
          const b0 = proj(x - halfW, y, d1)
          ctx.beginPath()
          ctx.moveTo(a0.x, a0.y)
          ctx.lineTo(a1.x, a1.y)
          ctx.lineTo(b1.x, b1.y)
          ctx.lineTo(b0.x, b0.y)
          ctx.closePath()
          ctx.fillStyle = rgba(color, (n.fret === 0 ? 0.16 : 0.45) + (past ? 0.2 : 0))
          ctx.fill()
        }
        // Stem down to the floor (shows depth).
        if (!past) {
          const fl = proj(x, floorY, d)
          ctx.strokeStyle = 'rgba(255,255,255,0.32)'
          ctx.lineWidth = Math.max(1, 2 * p.p)
          line(p.x, p.y + gap * 0.4 * p.p, fl.x, fl.y)
          ctx.fillStyle = rgba(color, 0.35)
          ctx.beginPath()
          ctx.ellipse(fl.x, fl.y, fretW * 0.25 * p.p, 3 * p.p + 1, 0, 0, Math.PI * 2)
          ctx.fill()
        }
        const near = Math.abs(n.time - now) < 0.07
        const alpha = past && !(sustain && endT > now) ? Math.max(0, 1 - (now - n.time) / 0.12) : 1
        if (n.fret === 0) {
          // Open string: a bar across the whole visible neck.
          const a = proj(wireX(firstWire) + 6, y, d)
          const b = proj(wireX(lastWire) - 6, y, d)
          block((a.x + b.x) / 2, a.y, b.x - a.x, gap * 0.5 * p.p, color, { label: '0', alpha, glow: near, muted: n.muted })
        } else {
          block(p.x, p.y, Math.min(fretW * 0.66, 90) * p.p, gap * 0.82 * p.p, color, { label: String(n.fret), alpha, glow: near || (past && sustain), muted: n.muted })
        }
      }

      // String names / keys on the left.
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.font = `700 ${Math.max(11, gap * 0.62)}px Rajdhani, sans-serif`
      for (let s = 0; s < 6; s++) {
        ctx.fillStyle = 'rgba(4,8,16,0.75)'
        ctx.fillRect(0, stringY(s) - gap * 0.42, practiceRef.current ? gap * 1.9 : gap * 0.95, gap * 0.84)
        ctx.fillStyle = STRING_COLORS[s]
        ctx.fillText(practiceRef.current ? `${STRING_NAMES[s]} ${STRING_KEYS[s]}` : STRING_NAMES[s], 5, stringY(s) + 1)
      }

      // Fret numbers under the neck.
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (let n = Math.max(1, firstWire + 1); n <= lastWire; n++) {
        const on = active.has(n)
        const inlay = INLAY_FRETS.has(n)
        const size = on ? Math.min(34, h * 0.05) : inlay ? Math.min(26, h * 0.04) : Math.min(20, h * 0.032)
        ctx.font = `700 ${size}px Rajdhani, sans-serif`
        ctx.fillStyle = on ? '#ffc04a' : inlay ? 'rgba(226,232,240,0.85)' : 'rgba(148,163,184,0.55)'
        ctx.shadowColor = on ? '#ff9a2e' : 'transparent'
        ctx.shadowBlur = on ? 12 : 0
        ctx.fillText(String(n), fretCenter(n), h * 0.958)
      }
      ctx.shadowBlur = 0

      // Impact events.
      const at = (n: FretNote) => ({ x: n.fret === 0 ? (left + right) / 2 : fretCenter(n.fret), y: stringY(n.string) })
      crossed(notes, (n) => {
        f.glow[n.string] = 1
        if (!n.muted) spark(at(n).x, at(n).y, STRING_COLORS[n.string], 10)
      })
      missCheck(notes, at)
      for (const id of f.pendingHits.splice(0)) {
        const n = notes[id]
        if (n) spark(at(n).x, at(n).y, STRING_COLORS[n.string], 18)
      }
    } else {
      // ───────────────────────── Drums: 5 pads + kick bar ─────────────────────────
      const notes = drumNotes
      const padY = h * 0.84
      const laneW = (right - left) / DRUM_LANES.length
      const laneX = (i: number) => left + (i + 0.5) * laneW

      floorQuad(left, right, padY, 0, 1.05)
      ctx.fillStyle = 'rgba(6,14,28,0.3)'
      ctx.fill()
      DRUM_LANES.forEach((lane, i) => {
        floorQuad(left + i * laneW, left + (i + 1) * laneW, padY, 0, 1.05)
        ctx.fillStyle = rgba(lane.color, 0.05 + f.glow[i] * 0.12)
        ctx.fill()
      })
      for (let i = 0; i <= DRUM_LANES.length; i++) {
        const a = proj(left + i * laneW, padY, 0)
        const b = proj(left + i * laneW, padY, 1.05)
        ctx.strokeStyle = 'rgba(190,215,255,0.25)'
        ctx.lineWidth = 1.2
        line(a.x, a.y, b.x, b.y)
      }
      beatLines(left, right, padY)

      const start = lowerBound(notes, now - 0.2)
      const end = lowerBound(notes, now + LOOK_AHEAD * 1.05)
      for (let i = end - 1; i >= start; i--) {
        const n = notes[i]
        if (n.time < now - 0.1) continue
        if (practiceRef.current && f.judged.get(n.id) === 'miss') continue
        const d = Math.max(0, depthOf(n.time))
        const alpha = n.time < now ? Math.max(0, 1 - (now - n.time) / 0.1) : 1
        const near = Math.abs(n.time - now) < 0.06
        if (n.lane === KICK_LANE) {
          const a = proj(left + 6, padY, d)
          const b = proj(right - 6, padY, d)
          block((a.x + b.x) / 2, a.y, b.x - a.x, laneW * 0.09 * a.p, KICK.color, { alpha, glow: near })
        } else {
          const lane = DRUM_LANES[n.lane]
          const p = proj(laneX(n.lane), padY, d)
          block(p.x, p.y - laneW * 0.06 * p.p, laneW * 0.7 * p.p, laneW * 0.2 * p.p, lane.color, { alpha, glow: near })
        }
      }

      // Kick line + pads at the impact plane.
      ctx.strokeStyle = KICK.color
      ctx.lineWidth = 4 + f.glow[KICK_LANE] * 4
      ctx.shadowColor = KICK.color
      ctx.shadowBlur = 8 + f.glow[KICK_LANE] * 24
      line(left, padY + laneW * 0.11, right, padY + laneW * 0.11)
      DRUM_LANES.forEach((lane, i) => {
        const g = Math.max(f.glow[i], f.keyFlash[i] * 0.6)
        ctx.shadowColor = lane.color
        ctx.shadowBlur = 8 + g * 26
        ctx.lineWidth = 3 + g * 2
        ctx.strokeStyle = g > 0.05 ? shade(lane.color, 0.4 * g) : lane.color
        ctx.fillStyle = rgba(lane.color, 0.12 + g * 0.35)
        ctx.beginPath()
        ctx.ellipse(laneX(i), padY, laneW * 0.38, laneW * 0.1, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      })
      ctx.shadowBlur = 0

      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      DRUM_LANES.forEach((lane, i) => {
        ctx.font = `700 ${Math.min(22, h * 0.035)}px Rajdhani, sans-serif`
        ctx.fillStyle = lane.color
        ctx.fillText(practiceRef.current ? `${lane.label.toUpperCase()} · ${lane.key}` : lane.label.toUpperCase(), laneX(i), h * 0.925)
      })
      ctx.font = `700 ${Math.min(18, h * 0.03)}px Rajdhani, sans-serif`
      ctx.fillStyle = KICK.color
      ctx.fillText(practiceRef.current ? `BOMBO · ${KICK.key}` : 'BOMBO', w / 2, h * 0.972)

      const at = (n: DrumNote) => ({ x: n.lane === KICK_LANE ? w / 2 : laneX(n.lane), y: padY })
      crossed(notes, (n) => {
        f.glow[n.lane] = 1
        spark(at(n).x, at(n).y, n.lane === KICK_LANE ? KICK.color : DRUM_LANES[n.lane].color, n.lane === KICK_LANE ? 6 : 12)
      })
      missCheck(notes, at)
      for (const id of f.pendingHits.splice(0)) {
        const n = notes[id]
        if (n) spark(at(n).x, at(n).y, n.lane === KICK_LANE ? KICK.color : DRUM_LANES[n.lane].color, 18)
      }
    }

    // Particles.
    f.particles = f.particles.filter((pt) => (pt.life -= dt) > 0)
    for (const pt of f.particles) {
      pt.vy += 620 * dt
      pt.x += pt.vx * dt
      pt.y += pt.vy * dt
      ctx.globalAlpha = Math.min(1, pt.life * 2.5)
      ctx.fillStyle = pt.color
      ctx.shadowColor = pt.color
      ctx.shadowBlur = 8
      ctx.fillRect(pt.x - 1.5, pt.y - 1.5, 3, 3)
    }
    ctx.globalAlpha = 1
    ctx.shadowBlur = 0
    // Missed notes: red X.
    f.misses = f.misses.filter((m) => (m.life -= dt) > 0)
    ctx.strokeStyle = '#ff3b46'
    ctx.lineCap = 'round'
    for (const m of f.misses) {
      const s = 10 + (0.6 - m.life) * 22
      ctx.globalAlpha = Math.min(1, m.life * 2)
      ctx.lineWidth = 4
      line(m.x - s, m.y - s, m.x + s, m.y + s)
      line(m.x + s, m.y - s, m.x - s, m.y + s)
    }
    ctx.globalAlpha = 1
    ctx.lineCap = 'butt'

    // Decay glows.
    const decay = Math.exp(-dt * 5)
    for (let i = 0; i < 6; i++) {
      f.glow[i] *= decay
      f.keyFlash[i] *= Math.exp(-dt * 8)
    }
  })

  const total = score.hits + score.misses
  const hasNotes = instrument === 'guitar' ? tab.notes.length > 0 : drumNotes.length > 0

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-cyan-400/20 bg-[#0b1626]">
      {/* Stage: haze + squirrel, blended into the dark UI */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_38%,rgba(40,96,150,0.55),transparent_62%),radial-gradient(ellipse_at_50%_100%,rgba(56,214,255,0.12),transparent_55%)]" />
      <img
        ref={imgRef}
        src={`${import.meta.env.BASE_URL}ardilla-stage.webp`}
        alt=""
        draggable={false}
        className="pointer-events-none absolute top-[1%] left-1/2 h-[98%] max-w-none -translate-x-1/2 origin-bottom select-none"
        style={{ filter: 'brightness(0.62) saturate(0.9) contrast(1.05) drop-shadow(0 0 28px rgba(56,214,255,0.28))', opacity: 0.88 }}
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_45%,transparent_45%,rgba(5,9,18,0.85)_100%)]" />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* HUD */}
      <div className="pointer-events-none absolute top-2 left-3 flex items-center gap-2 text-xs font-semibold tracking-wider">
        <span className="rounded-md border border-amber-400/50 bg-[#050912]/75 px-2 py-1 text-amber-300">
          MODO {INSTRUMENT_LABEL[instrument].toUpperCase()}
        </span>
        {midi && (
          <span className="rounded-md border border-cyan-400/30 bg-[#050912]/75 px-2 py-1 text-cyan-200">
            {Math.round(midi.bpm)} BPM · {midi.timeSignature.join('/')}
          </span>
        )}
      </div>
      <div className="absolute top-2 right-3 flex items-center gap-2 text-xs font-semibold">
        {practice && (
          <span className="rounded-md border border-green-400/40 bg-[#050912]/80 px-2 py-1 tabular-nums text-green-300">
            {score.hits}/{total} · racha {score.streak}
          </span>
        )}
        <button
          onClick={() => {
            setPractice((p) => !p)
            resetScore()
          }}
          aria-pressed={practice}
          title={instrument === 'guitar' ? 'Toca las cuerdas con A S D F G H' : 'Pads con A S D F G, bombo con J'}
          className={`flex items-center gap-1 rounded-md border px-2 py-1 transition ${
            practice ? 'border-green-400/70 bg-green-500/20 text-green-200' : 'border-cyan-400/40 bg-[#050912]/75 text-cyan-200 hover:border-cyan-300'
          }`}
        >
          <Keyboard className="h-4 w-4" /> {practice ? 'Teclado activo' : 'Tocar con teclado'}
        </button>
      </div>

      {!hasNotes && (
        <div className="pointer-events-none absolute inset-x-0 top-[30%] flex justify-center">
          <p className="rounded-lg border border-amber-400/40 bg-[#050912]/80 px-4 py-2 text-center text-sm text-amber-200">
            Sin notas para {INSTRUMENT_LABEL[instrument].toLowerCase()}: carga su archivo <b>.mid</b> en ARCHIVOS → {instrument}.
          </p>
        </div>
      )}
    </div>
  )
}
