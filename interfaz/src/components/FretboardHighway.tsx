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
  type DrumNote,
  type FretboardTab,
  type FretNote,
} from '../utils/midiToFretboard'
import type { PianoNote } from '../utils/pianoApi'

/** Seconds of music visible ahead of the impact line. */
const LOOK_AHEAD = 2.8
/** Perspective strength: an object at the far end is drawn 1 / (1 + DEPTH) times smaller. */
const DEPTH = 3.6
/** ± seconds to count a key press as a hit. */
const HIT_WINDOW = 0.12
const MIN_VISIBLE_FRETS = 7

// ───────── piano keyboard geometry (x measured in white keys) ─────────
const WHITE_OF_PC = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6]
const BLACK_PC = new Set([1, 3, 6, 8, 10])
const isBlack = (m: number) => BLACK_PC.has(m % 12)
/** Index of the white key at (or just below) a MIDI pitch. */
const whiteIndex = (m: number) => Math.floor(m / 12) * 7 + WHITE_OF_PC[m % 12]
const PIANO_LO = 21 // A0
const PIANO_HI = 108 // C8
/** At least two octaves visible. */
const MIN_VISIBLE_WHITES = 15
/** Left hand / right hand. */
const HAND_COLORS = ['#3f8fd2', '#4fb286'] as const
const HAND_LABELS = ['Mano izq.', 'Mano der.'] as const

interface Props {
  instrument: InstrumentId
  tab: FretboardTab
  drumNotes: DrumNote[]
  pianoNotes: PianoNote[]
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
  points: number
}

interface Popup {
  x: number
  y: number
  text: string
  color: string
  size: number
  life: number
  max: number
}

/** ± seconds for a "PERFECTO" (otherwise "BIEN"). */
const PERFECT_WINDOW = 0.05
const EMPTY_SCORE: Score = { hits: 0, misses: 0, streak: 0, points: 0 }

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

export function FretboardHighway({ instrument, tab, drumNotes, pianoNotes, midi, getTime, playing }: Props) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [practice, setPractice] = useState(false)
  const [score, setScore] = useState<Score>(EMPTY_SCORE)

  // Mutable animation state (never triggers React renders).
  const fx = useRef({
    cam: { f0: 0, f1: 12 },
    snapCam: true,
    glow: [0, 0, 0, 0, 0, 0], // per string / drum lane (5 = kick)
    keyFlash: [0, 0, 0, 0, 0, 0],
    judged: new Map<number, 'hit' | 'miss'>(),
    particles: [] as Particle[],
    misses: [] as { x: number; y: number; life: number }[],
    pendingHits: [] as { id: number; dt: number }[],
    popups: [] as Popup[],
    lastNow: 0,
    score: EMPTY_SCORE,
  })

  const practiceRef = useRef(practice)
  useEffect(() => {
    practiceRef.current = practice && instrument !== 'piano'
  }, [practice, instrument])

  const resetScore = () => {
    fx.current.judged.clear()
    fx.current.score = EMPTY_SCORE
    fx.current.popups = []
    setScore(fx.current.score)
  }

  // New notes / mode → forget judgements.
  useEffect(() => {
    fx.current.judged.clear()
    fx.current.score = EMPTY_SCORE
    fx.current.popups = []
    fx.current.snapCam = true
  }, [tab, drumNotes, pianoNotes, instrument])

  const judge = (id: number, result: 'hit' | 'miss', points = 0) => {
    const f = fx.current
    f.judged.set(id, result)
    const s = f.score
    f.score =
      result === 'hit'
        ? { hits: s.hits + 1, misses: s.misses, streak: s.streak + 1, points: s.points + points }
        : { hits: s.hits, misses: s.misses + 1, streak: 0, points: s.points }
    setScore(f.score)
  }

  // Keyboard: A S D F G H = strings (low E → high e); drums A S D F G = pads, J = kick.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target
      if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return
      if (instrument === 'piano') return // no keyboard practice for the piano (yet)
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
        judge(best.id, 'hit', best.dt <= PERFECT_WINDOW ? 150 : 100)
        f.pendingHits.push(best)
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
    const left = Math.max(w * 0.045, 34)
    const right = w - left
    const proj = (x: number, y: number, d: number) => {
      const p = 1 / (1 + Math.max(d, -0.15) * DEPTH)
      return { x: vx + (x - vx) * p, y: vy + (y - vy) * p, p }
    }
    const depthOf = (t: number) => (t - now) / LOOK_AHEAD

    // Readability: darken the lower part where the strings / pads are.
    const shadeGrad = ctx.createLinearGradient(0, h * 0.45, 0, h)
    shadeGrad.addColorStop(0, 'rgba(14,15,18,0)')
    shadeGrad.addColorStop(0.55, 'rgba(14,15,18,0.55)')
    shadeGrad.addColorStop(1, 'rgba(14,15,18,0.9)')
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
        ctx.strokeStyle = bar ? 'rgba(242,239,233,0.3)' : 'rgba(242,239,233,0.09)'
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
      // Flat gel fill; a note about to be played brightens instead of glowing.
      ctx.fillStyle = opts.muted ? '#2a1714' : opts.glow ? shade(color, 0.25) : color
      ctx.beginPath()
      ctx.roundRect(x - bw / 2, y - bh / 2, bw, bh, r)
      ctx.fill()
      if (opts.muted) {
        ctx.strokeStyle = color
        ctx.lineWidth = Math.max(1, bh * 0.07)
        ctx.stroke()
      }
      if (opts.muted) {
        ctx.strokeStyle = '#e0503a'
        ctx.lineWidth = Math.max(1.5, bh * 0.14)
        const s = bh * 0.32
        line(x - s, y - s, x + s, y + s)
        line(x + s, y - s, x - s, y + s)
      } else if (opts.label && bh >= 8) {
        ctx.fillStyle = '#111214'
        ctx.font = `600 ${Math.round(bh * 0.78)}px "Barlow Condensed", sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(opts.label, x, y + bh * 0.04)
      }
      ctx.restore()
    }

    // Practice mode: notes that went past the window unplayed are misses.
    const missCheck = <T extends { id: number; time: number }>(
      notes: T[],
      where: (n: T) => { x: number; y: number },
      onMiss?: (n: T, at: { x: number; y: number }) => void,
    ) => {
      if (!practiceRef.current) return
      for (let i = lowerBound(notes, now - HIT_WINDOW - 0.5); i < notes.length && notes[i].time < now - HIT_WINDOW; i++) {
        const n = notes[i]
        if (f.judged.has(n.id)) continue
        judge(n.id, 'miss')
        const at = where(n)
        f.misses.push({ ...at, life: 0.6 })
        onMiss?.(n, at)
      }
    }
    const popup = (x: number, y: number, text: string, color: string, size: number, life = 0.8) => f.popups.push({ x, y, text, color, size, life, max: life })
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
      ctx.fillStyle = 'rgba(14,15,18,0.28)'
      ctx.fill()
      for (const n of active) {
        floorQuad(wireX(n - 1), wireX(n), floorY, 0, 1.05)
        const g = ctx.createLinearGradient(0, floorY, 0, vy + (floorY - vy) / (1 + DEPTH))
        g.addColorStop(0, 'rgba(242,239,233,0.07)')
        g.addColorStop(1, 'rgba(242,239,233,0)')
        ctx.fillStyle = g
        ctx.fill()
      }
      for (let n = firstWire; n <= lastWire; n++) {
        const a = proj(wireX(n), floorY, 0)
        const b = proj(wireX(n), floorY, 1.05)
        ctx.strokeStyle = active.has(n) || active.has(n + 1) ? 'rgba(242,239,233,0.45)' : 'rgba(242,239,233,0.16)'
        ctx.lineWidth = 1.2
        line(a.x, a.y, b.x, b.y)
      }
      beatLines(wireX(firstWire), wireX(lastWire), floorY)
      // Fret numbers far away (where the notes come from).
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      // Active frets first, then inlays; a label that would touch one already drawn is skipped.
      const farFrets: number[] = []
      for (let n = Math.max(1, firstWire); n <= lastWire; n++) if (active.has(n)) farFrets.push(n)
      for (let n = Math.max(1, firstWire); n <= lastWire; n++) if (INLAY_FRETS.has(n) && !active.has(n)) farFrets.push(n)
      const drawnX: number[] = []
      for (const n of farFrets) {
        const p = proj(fretCenter(n), floorY, 1)
        const size = Math.max(15, 30 * p.p)
        if (drawnX.some((x) => Math.abs(x - p.x) < size * 1.1)) continue
        drawnX.push(p.x)
        ctx.fillStyle = active.has(n) ? 'rgba(240,180,41,0.95)' : 'rgba(242,239,233,0.55)'
        ctx.font = `600 ${size}px "Barlow Condensed", sans-serif`
        ctx.fillText(String(n), p.x, p.y - 6)
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
      ctx.fillStyle = 'rgba(242,239,233,0.14)'
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
      // Fret wires (anchor wires drawn in full ink).
      const anchorLo = active.size ? Math.min(...active) - 1 : -1
      const anchorHi = active.size ? Math.max(...active) : -1
      for (let n = firstWire; n <= lastWire; n++) {
        const x = wireX(n)
        const anchor = n === anchorLo || n === anchorHi
        ctx.strokeStyle = n === 0 ? '#e8e2d0' : anchor ? '#f2efe9' : 'rgba(242,239,233,0.5)'
        ctx.lineWidth = n === 0 ? 6 : anchor ? 3.5 : 2
        ctx.shadowBlur = 0
        line(x, neckTop, x, neckBottom)
      }
      ctx.shadowBlur = 0

      // Strings (vibrate after being hit).
      for (let s = 0; s < 6; s++) {
        const y = stringY(s)
        const color = STRING_COLORS[s]
        const g = Math.max(f.glow[s], f.keyFlash[s] * 0.6)
        ctx.strokeStyle = g > 0.05 ? shade(color, 0.35 * g) : color
        ctx.lineWidth = 3.6 - s * 0.4 + g * 2.5
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
        if (c.name) {
          ctx.fillStyle = `rgba(255,255,255,${0.8 * (1 - d * 0.6)})`
          ctx.font = `600 ${Math.max(10, Math.round(gap * 0.7 * (1 - d * 0.5)))}px "Barlow Condensed", sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'bottom'
          ctx.fillText(c.name, (a.x + b.x) / 2, Math.min(a.y, b.y) - 3)
        }
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
      ctx.font = `600 ${Math.max(11, gap * 0.62)}px "Barlow Condensed", sans-serif`
      for (let s = 0; s < 6; s++) {
        ctx.fillStyle = 'rgba(14,15,18,0.75)'
        ctx.fillRect(0, stringY(s) - gap * 0.42, practiceRef.current ? gap * 1.9 : gap * 0.95, gap * 0.84)
        ctx.fillStyle = STRING_COLORS[s]
        ctx.fillText(practiceRef.current ? `${tab.labels[s]} ${STRING_KEYS[s]}` : tab.labels[s], 12, stringY(s) + 1)
      }

      // Solo tag: the tab shows the lead line here, not the rhythm part.
      if (tab.solos.some((s) => s.start <= now && now <= s.end)) {
        ctx.textAlign = 'right'
        ctx.textBaseline = 'top'
        ctx.font = `700 ${Math.max(13, gap * 0.7)}px "Barlow Condensed", sans-serif`
        ctx.fillStyle = 'rgba(240,180,41,0.9)'
        ctx.fillText('SOLO', w - 16, 14)
      }

      // Fret numbers under the neck.
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (let n = Math.max(1, firstWire + 1); n <= lastWire; n++) {
        const on = active.has(n)
        const inlay = INLAY_FRETS.has(n)
        const size = on ? Math.min(34, h * 0.05) : inlay ? Math.min(26, h * 0.04) : Math.min(20, h * 0.032)
        ctx.font = `600 ${size}px "Barlow Condensed", sans-serif`
        ctx.fillStyle = on ? '#f0b429' : inlay ? 'rgba(242,239,233,0.85)' : 'rgba(160,156,148,0.6)'
        ctx.shadowBlur = 0
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
      for (const { id } of f.pendingHits.splice(0)) {
        const n = notes[id]
        if (n) spark(at(n).x, at(n).y, STRING_COLORS[n.string], 18)
      }
    } else if (instrument === 'piano') {
      // ───────────── Piano: notes ride the highway onto a keyboard ─────────────
      const notes = pianoNotes
      const hitY = h * 0.72
      const keysBottom = h * 0.975

      // Camera follows the keys coming up next (whole white keys, two octaves at least).
      let lo = Infinity
      let hi = -Infinity
      for (let i = lowerBound(notes, now - 4); i < notes.length && notes[i].time < now + LOOK_AHEAD * 0.75; i++) {
        if (notes[i].time + notes[i].duration < now) continue
        lo = Math.min(lo, notes[i].midi)
        hi = Math.max(hi, notes[i].midi)
      }
      const wLo = whiteIndex(PIANO_LO)
      const wHi = whiteIndex(PIANO_HI) + 1
      if (lo === Infinity && f.snapCam) {
        lo = 48
        hi = 72
      }
      if (lo !== Infinity) {
        let t0 = whiteIndex(lo) - 1
        let t1 = whiteIndex(hi) + 2
        if (t1 - t0 < MIN_VISIBLE_WHITES) {
          const extra = (MIN_VISIBLE_WHITES - (t1 - t0)) / 2
          t0 -= extra
          t1 += extra
        }
        if (t0 < wLo) [t0, t1] = [wLo, t1 + (wLo - t0)]
        if (t1 > wHi) [t0, t1] = [Math.max(wLo, t0 - (t1 - wHi)), wHi]
        const k = f.snapCam ? 1 : Math.min(1, dt * 1.6)
        f.snapCam = false
        f.cam.f0 += (t0 - f.cam.f0) * k
        f.cam.f1 += (t1 - f.cam.f1) * k
      }
      const { f0, f1 } = f.cam
      const kx = (wi: number) => left + ((wi - f0) / (f1 - f0)) * (right - left)
      const whiteW = kx(1) - kx(0)
      const keySpan = (m: number) => {
        if (!isBlack(m)) return { x0: kx(whiteIndex(m)), x1: kx(whiteIndex(m) + 1) }
        const c = kx(whiteIndex(m) + 1)
        return { x0: c - whiteW * 0.3, x1: c + whiteW * 0.3 }
      }
      const keyCenter = (m: number) => {
        const k = keySpan(m)
        return (k.x0 + k.x1) / 2
      }
      const mLo = Math.max(PIANO_LO, Math.floor(f0 / 7) * 12)
      const mHi = Math.min(PIANO_HI, Math.ceil(f1 / 7) * 12 + 11)

      // Keys sounding right now → hand (for the keyboard) and lanes lit just ahead.
      const down = new Map<number, number>()
      const active = new Set<number>()
      for (let i = lowerBound(notes, now - 8); i < notes.length && notes[i].time < now + 1.4; i++) {
        const n = notes[i]
        if (n.time + n.duration < now) continue
        if (n.time <= now + 0.02) down.set(n.midi, n.hand)
        active.add(n.midi)
      }

      // Everything on the highway is clipped to the visible keys.
      ctx.save()
      floorQuad(left, right, hitY, 0, 1.05)
      ctx.clip()
      floorQuad(left, right, hitY, 0, 1.05)
      ctx.fillStyle = 'rgba(14,15,18,0.32)'
      ctx.fill()
      for (let m = mLo; m <= mHi; m++) {
        if (!isBlack(m) && !active.has(m)) continue
        const k = keySpan(m)
        floorQuad(k.x0, k.x1, hitY, 0, 1.05)
        if (active.has(m)) {
          const g = ctx.createLinearGradient(0, hitY, 0, vy + (hitY - vy) / (1 + DEPTH))
          g.addColorStop(0, 'rgba(242,239,233,0.08)')
          g.addColorStop(1, 'rgba(242,239,233,0)')
          ctx.fillStyle = g
        } else ctx.fillStyle = 'rgba(0,0,0,0.16)'
        ctx.fill()
      }
      // Octave lines at every C, fainter ones at every F.
      for (let wi = Math.ceil(f0); wi <= Math.floor(f1); wi++) {
        const pc = wi % 7
        if (pc !== 0 && pc !== 3) continue
        const a = proj(kx(wi), hitY, 0)
        const b = proj(kx(wi), hitY, 1.05)
        ctx.strokeStyle = pc === 0 ? 'rgba(242,239,233,0.22)' : 'rgba(242,239,233,0.08)'
        ctx.lineWidth = 1.2
        line(a.x, a.y, b.x, b.y)
      }
      beatLines(left, right, hitY)

      // Notes, far → near: a bar on the floor as long as the note, its onset edge brighter.
      const start = lowerBound(notes, now - 8)
      const end = lowerBound(notes, now + LOOK_AHEAD * 1.05)
      for (let i = end - 1; i >= start; i--) {
        const n = notes[i]
        if (n.midi < mLo || n.midi > mHi) continue
        const d1 = Math.min(1.05, depthOf(n.time + n.duration))
        if (d1 <= 0) continue
        const d0 = Math.max(0, depthOf(n.time))
        const k = keySpan(n.midi)
        const inset = (k.x1 - k.x0) * 0.1
        const color = HAND_COLORS[n.hand]
        const base = isBlack(n.midi) ? shade(color, -0.3) : color
        const sounding = n.time <= now
        floorQuad(k.x0 + inset, k.x1 - inset, hitY, d0, Math.max(d0 + 0.004, d1))
        ctx.fillStyle = sounding ? shade(base, 0.2) : rgba(base, 0.88)
        ctx.fill()
        ctx.strokeStyle = shade(base, -0.45)
        ctx.lineWidth = 1
        ctx.stroke()
        const a = proj(k.x0 + inset, hitY, d0)
        const b = proj(k.x1 - inset, hitY, d0)
        ctx.strokeStyle = shade(base, 0.45)
        ctx.lineWidth = Math.max(1.5, 4 * a.p)
        line(a.x, a.y, b.x, b.y)
      }
      ctx.restore()

      // Keyboard under the impact line.
      const stage = ctx.createLinearGradient(0, hitY, 0, h)
      stage.addColorStop(0, 'rgba(14,15,18,0.85)')
      stage.addColorStop(1, 'rgba(14,15,18,0.96)')
      ctx.fillStyle = stage
      ctx.fillRect(0, hitY, w, h - hitY)
      ctx.save()
      ctx.beginPath()
      ctx.rect(left, hitY, right - left, h - hitY)
      ctx.clip()
      const keyTop = hitY + 3
      const whiteH = keysBottom - keyTop
      const labelSize = Math.min(15, whiteW * 0.48)
      for (let m = mLo; m <= mHi; m++) {
        if (isBlack(m)) continue
        const k = keySpan(m)
        const hand = down.get(m)
        ctx.fillStyle = hand === undefined ? '#e6e2d8' : shade(HAND_COLORS[hand], 0.15)
        ctx.beginPath()
        ctx.roundRect(k.x0 + 1, keyTop, k.x1 - k.x0 - 2, whiteH, [0, 0, 4, 4])
        ctx.fill()
        if (m % 12 === 0 && labelSize >= 8) {
          ctx.fillStyle = hand === undefined ? 'rgba(17,18,20,0.55)' : '#111214'
          ctx.font = `600 ${labelSize}px "Barlow Condensed", sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'bottom'
          ctx.fillText(`C${m / 12 - 1}`, (k.x0 + k.x1) / 2, keysBottom - 4)
        }
      }
      for (let m = mLo; m <= mHi; m++) {
        if (!isBlack(m)) continue
        const k = keySpan(m)
        const hand = down.get(m)
        ctx.fillStyle = hand === undefined ? '#17181c' : shade(HAND_COLORS[hand], -0.1)
        ctx.beginPath()
        ctx.roundRect(k.x0, keyTop, k.x1 - k.x0, whiteH * 0.62, [0, 0, 3, 3])
        ctx.fill()
        if (hand === undefined) {
          ctx.fillStyle = 'rgba(242,239,233,0.1)'
          ctx.fillRect(k.x0 + (k.x1 - k.x0) * 0.2, keyTop, (k.x1 - k.x0) * 0.6, whiteH * 0.55)
        }
      }
      ctx.restore()
      // Impact line, glowing above every key that sounds.
      ctx.strokeStyle = 'rgba(242,239,233,0.85)'
      ctx.lineWidth = 3
      line(left, hitY, right, hitY)
      for (const [m, hand] of down) {
        if (m < mLo || m > mHi) continue
        const k = keySpan(m)
        ctx.strokeStyle = shade(HAND_COLORS[hand], 0.35)
        ctx.lineWidth = 5
        line(k.x0 + 1, hitY, k.x1 - 1, hitY)
      }

      crossed(notes, (n) => {
        if (n.midi >= mLo && n.midi <= mHi) spark(keyCenter(n.midi), hitY, HAND_COLORS[n.hand], 6)
      })
    } else {
      // ───────────── Drums: lanes → hit line → drum kit ─────────────
      const notes = drumNotes
      const hitY = h * 0.6
      const laneW = (right - left) / DRUM_LANES.length
      const laneX = (i: number) => left + (i + 0.5) * laneW
      const laneColor = (lane: number) => (lane === KICK_LANE ? KICK.color : DRUM_LANES[lane].color)
      const kickGlow = Math.max(f.glow[KICK_LANE], f.keyFlash[KICK_LANE] * 0.6)

      // Same geometry as the guitar: notes ride a plane just above the floor,
      // with a stem + floor shadow showing depth.
      const noteH = h * 0.035 * 0.82
      const floorY = hitY + h * 0.04
      const noteW = Math.min(laneW * 0.66, 90)

      // Lanes used in the next ~1.4 s get the same highlight as active frets.
      const active = new Set<number>()
      for (let i = lowerBound(notes, now - 0.05); i < notes.length && notes[i].time < now + 1.4; i++) active.add(notes[i].lane)

      // Floor: lanes receding to the vanishing point.
      floorQuad(left, right, floorY, 0, 1.05)
      ctx.fillStyle = 'rgba(14,15,18,0.28)'
      ctx.fill()
      DRUM_LANES.forEach((_, i) => {
        if (!active.has(i)) return
        floorQuad(left + i * laneW, left + (i + 1) * laneW, floorY, 0, 1.05)
        const g = ctx.createLinearGradient(0, floorY, 0, vy + (floorY - vy) / (1 + DEPTH))
        g.addColorStop(0, 'rgba(242,239,233,0.07)')
        g.addColorStop(1, 'rgba(242,239,233,0)')
        ctx.fillStyle = g
        ctx.fill()
      })
      for (let i = 0; i <= DRUM_LANES.length; i++) {
        const a = proj(left + i * laneW, floorY, 0)
        const b = proj(left + i * laneW, floorY, 1.05)
        ctx.strokeStyle = active.has(i) || active.has(i - 1) ? 'rgba(242,239,233,0.45)' : 'rgba(242,239,233,0.16)'
        ctx.lineWidth = 1.2
        line(a.x, a.y, b.x, b.y)
      }
      beatLines(left, right, floorY)

      // Notes, far → near: same flat gel blocks, stems and floor shadows as the guitar.
      const start = lowerBound(notes, now - 0.2)
      const end = lowerBound(notes, now + LOOK_AHEAD * 1.05)
      for (let i = end - 1; i >= start; i--) {
        const n = notes[i]
        if (n.time < now - 0.12) continue
        if (practiceRef.current && f.judged.get(n.id) === 'miss') continue
        const d = Math.max(0, depthOf(n.time))
        const past = n.time < now
        const alpha = past ? Math.max(0, 1 - (now - n.time) / 0.12) : 1
        const near = Math.abs(n.time - now) < 0.07
        const color = laneColor(n.lane)
        if (n.lane === KICK_LANE) {
          // Kick: a bar across all lanes, like an open string.
          const a = proj(left + 6, hitY, d)
          const b = proj(right - 6, hitY, d)
          block((a.x + b.x) / 2, a.y, b.x - a.x, noteH * 0.6 * a.p, color, { alpha, glow: near })
          continue
        }
        const x = laneX(n.lane)
        const p = proj(x, hitY, d)
        if (!past) {
          const fl = proj(x, floorY, d)
          ctx.strokeStyle = 'rgba(255,255,255,0.32)'
          ctx.lineWidth = Math.max(1, 2 * p.p)
          line(p.x, p.y + noteH * 0.5 * p.p, fl.x, fl.y)
          ctx.fillStyle = rgba(color, 0.35)
          ctx.beginPath()
          ctx.ellipse(fl.x, fl.y, noteW * 0.38 * p.p, 3 * p.p + 1, 0, 0, Math.PI * 2)
          ctx.fill()
        }
        block(p.x, p.y, noteW * p.p, noteH * p.p, color, {
          label: practiceRef.current ? DRUM_LANES[n.lane].key : undefined,
          alpha,
          glow: near,
        })
      }

      // Hit line: ink rail (kick flashes it orange) with a gel target per lane.
      ctx.strokeStyle = kickGlow > 0.05 ? shade(KICK.color, 0.3 * kickGlow) : 'rgba(242,239,233,0.85)'
      ctx.lineWidth = 3 + kickGlow * 3
      line(left, hitY, right, hitY)
      DRUM_LANES.forEach((lane, i) => {
        const g = Math.max(f.glow[i], f.keyFlash[i] * 0.6)
        const tw = noteW * 1.1
        const th = noteH * 1.15
        ctx.strokeStyle = g > 0.05 ? shade(lane.color, 0.45 * g) : rgba(lane.color, 0.7)
        ctx.fillStyle = rgba(lane.color, 0.06 + g * 0.4)
        ctx.lineWidth = 2 + g * 2
        ctx.beginPath()
        ctx.roundRect(laneX(i) - tw / 2, hitY - th / 2, tw, th, Math.min(th * 0.35, 6))
        ctx.fill()
        ctx.stroke()
        ctx.lineWidth = 5 + g * 3
        ctx.strokeStyle = g > 0.05 ? shade(lane.color, 0.45 * g) : lane.color
        line(laneX(i) - tw / 2, hitY, laneX(i) + tw / 2, hitY)
      })

      // ── Drum kit under the hit line, on its own dark stage ──
      const stage = ctx.createLinearGradient(0, hitY, 0, h)
      stage.addColorStop(0, 'rgba(14,15,18,0.6)')
      stage.addColorStop(0.25, 'rgba(14,15,18,0.86)')
      stage.addColorStop(1, 'rgba(14,15,18,0.95)')
      ctx.fillStyle = stage
      ctx.fillRect(0, floorY, w, h - floorY)
      const labelSize = Math.min(20, h * 0.032)
      const label = (text: string, key: string, color: string, x: number, y: number) => {
        ctx.font = `600 ${labelSize}px "Barlow Condensed", sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.lineJoin = 'round'
        ctx.lineWidth = 4
        ctx.strokeStyle = 'rgba(14,15,18,0.9)'
        const t = practiceRef.current ? `${text.toUpperCase()} · ${key}` : text.toUpperCase()
        ctx.strokeText(t, x, y)
        ctx.fillStyle = color
        ctx.fillText(t, x, y)
        ctx.lineJoin = 'miter'
      }
      const BRASS = '#b8913f'
      const cymbal = (cx: number, cy: number, rx: number, color: string, g: number) => {
        const ry = rx * 0.3
        ctx.strokeStyle = 'rgba(138,135,127,0.7)'
        ctx.lineWidth = Math.max(2, rx * 0.04)
        line(cx, cy, cx, h)
        ctx.save()
        ctx.translate(cx, cy + g * rx * 0.04)
        ctx.rotate(Math.sin(now * 26) * g * 0.12)
        ctx.fillStyle = g > 0.05 ? shade(BRASS, 0.45 * g) : BRASS
        ctx.beginPath()
        ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = 'rgba(14,15,18,0.3)'
        ctx.lineWidth = 1
        for (const k of [0.38, 0.58, 0.78]) {
          ctx.beginPath()
          ctx.ellipse(0, 0, rx * k, ry * k, 0, 0, Math.PI * 2)
          ctx.stroke()
        }
        ctx.fillStyle = shade(BRASS, 0.35)
        ctx.beginPath()
        ctx.ellipse(0, -ry * 0.05, rx * 0.15, ry * 0.22, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = g > 0.05 ? shade(color, 0.4 * g) : color
        ctx.lineWidth = 2 + g * 3
        ctx.beginPath()
        ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
        return cy + ry
      }
      const drum = (cx: number, cy: number, rx: number, color: string, g: number) => {
        const ry = rx * 0.34
        const depth = rx * 0.45
        const y = cy + g * rx * 0.05
        // Shell: the gel darkened, like a note's extruded underside.
        ctx.fillStyle = shade(color, -0.55)
        ctx.beginPath()
        ctx.moveTo(cx - rx, y)
        ctx.lineTo(cx - rx, y + depth)
        ctx.ellipse(cx, y + depth, rx, ry, 0, Math.PI, 0, true)
        ctx.lineTo(cx + rx, y)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = 'rgba(242,239,233,0.55)'
        for (const k of [-0.7, -0.25, 0.25, 0.7]) ctx.fillRect(cx + k * rx - rx * 0.025, y + depth * 0.25 + Math.abs(k) * ry * 0.4, rx * 0.05, depth * 0.45)
        // Head: flat ink, tinted by the gel when struck.
        ctx.fillStyle = '#d9d5cc'
        ctx.beginPath()
        ctx.ellipse(cx, y, rx, ry, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = rgba(color, 0.12 + g * 0.55)
        ctx.fill()
        ctx.strokeStyle = '#8a877f'
        ctx.lineWidth = Math.max(2, rx * 0.05)
        ctx.stroke()
        ctx.strokeStyle = g > 0.05 ? shade(color, 0.45 * g) : color
        ctx.lineWidth = 2 + g * 3
        ctx.beginPath()
        ctx.ellipse(cx, y, rx * 0.9, ry * 0.9, 0, 0, Math.PI * 2)
        ctx.stroke()
        return y + depth + ry
      }

      const padR = Math.min(laneW * 0.4, h * 0.1)
      const rowHi = h * 0.72
      const rowLo = h * 0.84
      // Bass drum: front head, centred at the bottom, partly behind the toms.
      {
        const R = Math.min(laneW * 0.62, h * 0.17)
        const cx = w / 2
        const cy = h + R * 0.12
        const bump = kickGlow * R * 0.03
        ctx.fillStyle = shade(KICK.color, -0.55)
        ctx.beginPath()
        ctx.arc(cx, cy, R + bump, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#d9d5cc'
        ctx.beginPath()
        ctx.arc(cx, cy, R * 0.86 + bump, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = rgba(KICK.color, 0.1 + kickGlow * 0.5)
        ctx.fill()
        ctx.strokeStyle = '#8a877f'
        ctx.lineWidth = Math.max(2, R * 0.04)
        ctx.stroke()
        ctx.strokeStyle = kickGlow > 0.05 ? shade(KICK.color, 0.4 * kickGlow) : KICK.color
        ctx.lineWidth = 2 + kickGlow * 3
        ctx.beginPath()
        ctx.arc(cx, cy, R * 0.74 + bump, 0, Math.PI * 2)
        ctx.stroke()
        label(KICK.label, KICK.key, KICK.color, cx, cy - R * 0.5)
      }
      // Back row (hi-hat, tom alto, platillos) then front row (tarola, tom piso).
      const kit: { lane: number; kind: 'cymbal' | 'drum'; y: number; r: number }[] = [
        { lane: 0, kind: 'cymbal', y: rowHi, r: padR * 1.05 },
        { lane: 2, kind: 'drum', y: rowHi, r: padR * 0.85 },
        { lane: 4, kind: 'cymbal', y: rowHi - h * 0.01, r: padR * 1.2 },
        { lane: 1, kind: 'drum', y: rowLo, r: padR * 0.95 },
        { lane: 3, kind: 'drum', y: rowLo, r: padR * 1.05 },
      ]
      for (const pad of kit) {
        const lane = DRUM_LANES[pad.lane]
        const g = Math.max(f.glow[pad.lane], f.keyFlash[pad.lane] * 0.6)
        const x = laneX(pad.lane)
        const bottom = pad.kind === 'cymbal' ? cymbal(x, pad.y, pad.r, lane.color, g) : drum(x, pad.y, pad.r, lane.color, g)
        label(lane.label, lane.key, lane.color, x, Math.min(h - labelSize * 0.7, bottom + labelSize * 0.8))
      }

      // Impact events: sparks on the hit line, judgement popups in practice mode.
      const at = (n: DrumNote) => ({ x: n.lane === KICK_LANE ? w / 2 : laneX(n.lane), y: hitY })
      crossed(notes, (n) => {
        f.glow[n.lane] = 1
        spark(at(n).x, at(n).y, laneColor(n.lane), n.lane === KICK_LANE ? 6 : 12)
      })
      // One judgement banner at a time, above the hit line.
      const bannerY = hitY - h * 0.13
      const banner = (text: string, color: string) => {
        f.popups = f.popups.filter((p) => p.y !== bannerY)
        popup(w / 2, bannerY, text, color, Math.min(44, h * 0.065), 0.6)
      }
      missCheck(notes, at, () => banner('FALLO', '#e0503a'))
      for (const { id, dt: off } of f.pendingHits.splice(0)) {
        const n = notes[id]
        if (!n) continue
        const p = at(n)
        const perfect = off <= PERFECT_WINDOW
        spark(p.x, p.y, laneColor(n.lane), 18)
        popup(p.x, p.y - laneW * 0.12, perfect ? '+150' : '+100', '#f2efe9', Math.min(30, h * 0.045))
        banner(perfect ? '¡PERFECTO!' : '¡BIEN!', perfect ? '#f0b429' : '#f2efe9')
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
      ctx.fillRect(pt.x - 1.5, pt.y - 1.5, 3, 3)
    }
    ctx.globalAlpha = 1
    ctx.shadowBlur = 0
    // Missed notes: red X.
    f.misses = f.misses.filter((m) => (m.life -= dt) > 0)
    ctx.strokeStyle = '#e0503a'
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
    // Score / judgement popups: pop in, float up, fade out (flat ink, no halo).
    f.popups = f.popups.filter((pp) => (pp.life -= dt) > 0)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    for (const pp of f.popups) {
      const age = pp.max - pp.life
      const scale = 1 + Math.max(0, 0.12 - age) * 3
      ctx.globalAlpha = Math.min(1, pp.life * 3)
      ctx.font = `600 ${Math.round(pp.size * scale)}px "Barlow Condensed", sans-serif`
      const y = pp.y - age * 50
      ctx.lineWidth = 5
      ctx.strokeStyle = 'rgba(14,15,18,0.9)'
      ctx.strokeText(pp.text, pp.x, y)
      ctx.fillStyle = pp.color
      ctx.fillText(pp.text, pp.x, y)
    }
    ctx.globalAlpha = 1
    ctx.lineJoin = 'miter'

    // Decay glows.
    const decay = Math.exp(-dt * 5)
    for (let i = 0; i < 6; i++) {
      f.glow[i] *= decay
      f.keyFlash[i] *= Math.exp(-dt * 8)
    }
  })

  const total = score.hits + score.misses
  const hasNotes = instrument === 'guitar' ? tab.notes.length > 0 : instrument === 'piano' ? pianoNotes.length > 0 : drumNotes.length > 0

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-stage">
      {/* Squirrel per instrument, dimmed and vignetted into the stage */}
      {instrument !== 'piano' && (
        <img
          ref={imgRef}
          src={`${import.meta.env.BASE_URL}${instrument === 'guitar' ? 'ardilla-guitarra.webp' : 'ardilla-bateria.webp'}`}
          alt=""
          draggable={false}
          className="pointer-events-none absolute top-[1%] left-1/2 h-[98%] max-w-none -translate-x-1/2 origin-bottom select-none"
          style={{ filter: 'brightness(0.5) saturate(0.8)', opacity: 0.85 }}
        />
      )}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_45%,transparent_40%,var(--color-stage)_100%)]" />

      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {instrument === 'piano' && hasNotes && (
        <div className="pointer-events-none absolute top-2 left-3 flex items-center gap-3 rounded-md bg-stage/85 px-2.5 py-1.5 text-xs font-semibold text-ink-2">
          {HAND_LABELS.map((label, i) => (
            <span key={label} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: HAND_COLORS[i] }} /> {label}
            </span>
          ))}
        </div>
      )}

      <div className={`absolute top-2 right-3 flex items-center gap-2 text-xs font-semibold ${instrument === 'piano' ? 'hidden' : ''}`}>
        {practice && (
          <span className="rounded-md bg-stage/85 px-2.5 py-1.5 font-cond text-sm text-ink">
            {score.points} pts · {score.hits}/{total} · racha {score.streak}
          </span>
        )}
        <button
          onClick={() => {
            setPractice((p) => !p)
            resetScore()
          }}
          aria-pressed={practice}
          title={instrument === 'guitar' ? 'Toca las cuerdas con A S D F G H' : 'Pads con A S D F G, bombo con J'}
          className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 transition active:scale-[0.97] ${
            practice ? 'bg-ink text-stage' : 'bg-control/90 text-ink-2 hover:text-ink'
          }`}
        >
          <Keyboard className="h-4 w-4" /> {practice ? 'Teclado activo' : 'Tocar con teclado'}
        </button>
      </div>

      {!hasNotes && (
        <div className="pointer-events-none absolute inset-x-0 top-[30%] flex justify-center">
          <p className="rounded-lg bg-raised px-4 py-2.5 text-center text-sm text-ink-2">
            Sin notas para {INSTRUMENT_LABEL[instrument].toLowerCase()}: carga su <b>.mid</b> desde Pistas → {INSTRUMENT_LABEL[instrument]} → ▾.
          </p>
        </div>
      )}
    </div>
  )
}
