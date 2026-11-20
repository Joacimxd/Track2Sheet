import { useEffect, useMemo, useRef } from 'react'
import type { InstrumentId, MidiNote, ParsedMidi } from '../types'
import { drumLane } from '../utils/midiParser'
import { useCanvas } from '../hooks/useCanvas'

interface Props {
  midi: ParsedMidi | null
  instrument: InstrumentId
  getTime: () => number
  time: number
  duration: number
  onSeek: (seconds: number) => void
}

const PX_PER_SEC = 150
const PLAYHEAD = 0.46 // fraction of the width
const LETTER = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6] // C C# D D# E F F# G G# A A# B
const SHARP = [false, true, false, true, false, false, true, false, true, false, true, false]
const BOTTOM_LINE = 30 // diatonic step of E4 (bottom line of the treble staff)
const MIDDLE_LINE = 34 // B4

interface Glyph {
  step: number
  sharp: boolean
  cross: boolean
}
interface Chord {
  time: number
  end: number
  beats: number
  glyphs: Glyph[]
}

/** Diatonic staff position of a drum hit (standard drum-set notation). */
function drumGlyph(midi: number): Glyph {
  switch (drumLane(midi)) {
    case 0:
      return { step: 31, sharp: false, cross: false } // kick: F4
    case 1:
      return { step: 35, sharp: false, cross: false } // snare: C5
    case 2:
      return { step: 39, sharp: false, cross: true } // hi-hat: G5
    case 3:
      return { step: midi >= 48 ? 37 : midi >= 45 ? 36 : 33, sharp: false, cross: false } // toms
    default:
      return { step: 40, sharp: false, cross: true } // cymbals: A5
  }
}

/** Guitar is written an octave above sounding pitch (treble clef with an 8 below). */
function pitchGlyph(midi: number): Glyph {
  const written = midi + 12
  const pc = written % 12
  return { step: (Math.floor(written / 12) - 1) * 7 + LETTER[pc], sharp: SHARP[pc], cross: false }
}

function buildChords(midi: ParsedMidi, percussion: boolean): Chord[] {
  const chords: Chord[] = []
  const notes: MidiNote[] = [...midi.notes].sort((a, b) => a.time - b.time)
  for (const n of notes) {
    const glyph = percussion ? drumGlyph(n.midi) : pitchGlyph(n.midi)
    const last = chords[chords.length - 1]
    if (last && Math.abs(last.time - n.time) < 0.03) {
      if (!last.glyphs.some((g) => g.step === glyph.step)) last.glyphs.push(glyph)
      last.beats = Math.min(last.beats, n.durationTicks / midi.ppq)
      last.end = Math.max(last.end, n.time + n.duration)
    } else {
      chords.push({ time: n.time, end: n.time + n.duration, beats: n.durationTicks / midi.ppq, glyphs: [glyph] })
    }
  }
  if (percussion) for (const c of chords) c.beats = Math.min(c.beats, 0.5)
  return chords
}

/** Note value from length in beats: 4 whole, 2 half, 1 quarter, 0.5 eighth, 0.25 sixteenth. */
function noteValue(beats: number): 4 | 2 | 1 | 0.5 | 0.25 {
  if (beats >= 3.5) return 4
  if (beats >= 1.75) return 2
  if (beats >= 0.875) return 1
  if (beats >= 0.4375) return 0.5
  return 0.25
}

function lowerBound(chords: Chord[], t: number) {
  let lo = 0
  let hi = chords.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (chords[mid].end < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function SheetMusic({ midi, instrument, getTime, time, duration, onSeek }: Props) {
  const percussion = instrument === 'drums'
  const chords = useMemo(() => (midi ? buildChords(midi, percussion) : []), [midi, percussion])

  const canvasRef = useCanvas((ctx, w, h) => {
    const now = getTime()
    ctx.clearRect(0, 0, w, h)
    const g = Math.max(7, Math.min(11, h / 11)) // staff line gap
    const top = h / 2 - 2 * g
    const bottom = top + 4 * g
    const stepY = (step: number) => bottom - (step - BOTTOM_LINE) * (g / 2)
    const px = w * PLAYHEAD
    const xOf = (t: number) => px + (t - now) * PX_PER_SEC
    const clefW = g * 7.5

    // Staff lines
    ctx.strokeStyle = 'rgba(214,232,255,0.78)'
    ctx.lineWidth = 1.2
    for (let i = 0; i < 5; i++) {
      const y = top + i * g
      ctx.beginPath()
      ctx.moveTo(g * 0.5, y)
      ctx.lineTo(w - g * 0.5, y)
      ctx.stroke()
    }

    const tStart = now - (px - clefW) / PX_PER_SEC
    const tEnd = now + (w - px) / PX_PER_SEC

    // Bar lines
    if (midi) {
      ctx.strokeStyle = 'rgba(214,232,255,0.55)'
      for (const m of midi.measureTimes) {
        if (m < tStart || m > tEnd) continue
        const x = xOf(m) - g
        ctx.beginPath()
        ctx.moveTo(x, top)
        ctx.lineTo(x, bottom)
        ctx.stroke()
      }
    }

    // Notes
    for (let i = lowerBound(chords, tStart); i < chords.length; i++) {
      const c = chords[i]
      if (c.time > tEnd) break
      const x = xOf(c.time)
      if (x < clefW + g) continue
      const active = now >= c.time && now <= Math.max(c.end, c.time + 0.12)
      const past = c.end < now
      const color = active ? '#e6fbff' : past ? 'rgba(95,180,230,0.55)' : '#7fd3ff'
      ctx.fillStyle = color
      ctx.strokeStyle = color
      if (active) {
        ctx.shadowColor = '#38d6ff'
        ctx.shadowBlur = 14
      }

      const value = noteValue(c.beats)
      const hollow = value >= 2 && !percussion
      const steps = c.glyphs.map((gl) => gl.step)
      const minStep = Math.min(...steps)
      const maxStep = Math.max(...steps)
      const stemUp = percussion || (minStep + maxStep) / 2 < MIDDLE_LINE

      // Ledger lines
      ctx.lineWidth = 1.2
      for (let s = BOTTOM_LINE - 2; s >= minStep; s -= 2) line(ctx, x - g * 0.95, x + g * 0.95, stepY(s))
      for (let s = BOTTOM_LINE + 10; s <= maxStep; s += 2) line(ctx, x - g * 0.95, x + g * 0.95, stepY(s))

      for (const gl of c.glyphs) {
        const y = stepY(gl.step)
        if (gl.cross) {
          ctx.lineWidth = 1.6
          line(ctx, x - g * 0.45, x + g * 0.45, y - g * 0.4, y + g * 0.4)
          line(ctx, x - g * 0.45, x + g * 0.45, y + g * 0.4, y - g * 0.4)
        } else {
          ctx.beginPath()
          ctx.ellipse(x, y, g * 0.6, g * 0.42, -0.35, 0, Math.PI * 2)
          ctx.lineWidth = 1.6
          if (hollow) ctx.stroke()
          else ctx.fill()
        }
        if (gl.sharp) {
          ctx.font = `${g * 1.6}px "Noto Music", serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText('♯', x - g * 1.5, y)
        }
      }

      if (value < 4) {
        const sx = stemUp ? x + g * 0.55 : x - g * 0.55
        const y0 = stepY(stemUp ? minStep : maxStep)
        const y1 = stepY(stemUp ? maxStep : minStep) + (stemUp ? -3.4 * g : 3.4 * g)
        ctx.lineWidth = 1.3
        line(ctx, sx, sx, y0, y1)
        const flags = value === 0.5 ? 1 : value === 0.25 ? 2 : 0
        const dir = stemUp ? 1 : -1
        ctx.lineWidth = 1.8
        for (let f = 0; f < flags; f++) {
          const fy = y1 + dir * f * g * 0.8
          ctx.beginPath()
          ctx.moveTo(sx, fy)
          ctx.quadraticCurveTo(sx + g * 1.1, fy + dir * g * 0.9, sx + g * 0.8, fy + dir * g * 2)
          ctx.stroke()
        }
      }
      ctx.shadowBlur = 0
    }

    // Clef block (fades the notes that scroll underneath it)
    const fade = ctx.createLinearGradient(0, 0, clefW + g * 2, 0)
    fade.addColorStop(0, 'rgba(10,20,36,1)')
    fade.addColorStop(0.75, 'rgba(10,20,36,0.95)')
    fade.addColorStop(1, 'rgba(10,20,36,0)')
    ctx.fillStyle = fade
    ctx.fillRect(0, 0, clefW + g * 2, h)
    ctx.strokeStyle = 'rgba(214,232,255,0.78)'
    ctx.lineWidth = 1.2
    for (let i = 0; i < 5; i++) line(ctx, g * 0.5, clefW, top + i * g)

    ctx.fillStyle = '#dce9f7'
    ctx.textAlign = 'center'
    if (percussion) {
      ctx.fillRect(g * 1.6, top + g, g * 0.45, g * 2)
      ctx.fillRect(g * 2.5, top + g, g * 0.45, g * 2)
    } else {
      ctx.font = `${g * 6.4}px "Noto Music", serif`
      ctx.textBaseline = 'alphabetic'
      ctx.fillText('\u{1D11E}', g * 2.4, top + 3 * g + g * 0.05)
      ctx.font = `bold ${g * 1.1}px Rajdhani, sans-serif`
      ctx.fillText('8', g * 2.4, bottom + g * 2.3)
    }
    if (midi) {
      ctx.font = `bold ${g * 2.2}px Rajdhani, sans-serif`
      ctx.textBaseline = 'middle'
      ctx.fillText(String(midi.timeSignature[0]), g * 5.4, top + g)
      ctx.fillText(String(midi.timeSignature[1]), g * 5.4, top + 3 * g)
    }

    // Playhead
    ctx.shadowColor = '#38d6ff'
    ctx.shadowBlur = 10
    ctx.strokeStyle = '#38d6ff'
    ctx.lineWidth = 2
    line(ctx, px, px, 0, h)
    ctx.shadowBlur = 0
  })

  return (
    <div className="relative z-10 flex flex-col border-b border-cyan-400/30 bg-[#0a1424]/92 px-3 pt-2 pb-3 shadow-[0_8px_30px_rgba(0,0,0,0.6)]">
      <div className="flex items-center justify-center gap-3 text-lg font-semibold tracking-wide text-slate-100">
        Partitura MIDI
        {midi && (
          <span className="text-xs font-medium text-cyan-300/70">
            {Math.round(midi.bpm)} BPM · {midi.timeSignature.join('/')}
          </span>
        )}
      </div>
      <div className="relative h-[clamp(96px,15vh,140px)]">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        {!midi && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="rounded-md border border-slate-600/50 bg-[#0a1424] px-3 py-1 text-sm text-slate-300">
              Sin archivo .mid para este instrumento — cárgalo desde el panel derecho
            </span>
          </div>
        )}
      </div>
      <ProgressBar time={time} duration={duration} onSeek={onSeek} />
    </div>
  )
}

function line(ctx: CanvasRenderingContext2D, x0: number, x1: number, y0: number, y1 = y0) {
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x1, y1)
  ctx.stroke()
}

function ProgressBar({ time, duration, onSeek }: { time: number; duration: number; onSeek: (s: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const pct = duration > 0 ? Math.min(100, (time / duration) * 100) : 0

  const seekFromEvent = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect || duration <= 0) return
    onSeek(((clientX - rect.left) / rect.width) * duration)
  }

  useEffect(() => {
    const up = () => (dragging.current = false)
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [])

  return (
    <div
      ref={ref}
      role="slider"
      aria-label="Posición"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(time)}
      className="group relative mt-1 h-4 cursor-pointer"
      onPointerDown={(e) => {
        dragging.current = true
        seekFromEvent(e.clientX)
      }}
      onPointerMove={(e) => dragging.current && seekFromEvent(e.clientX)}
    >
      <div className="absolute top-1/2 h-1.5 w-full -translate-y-1/2 rounded-full bg-slate-600/60" />
      <div
        className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-cyan-400 shadow-[0_0_10px_#38d6ff]"
        style={{ width: `${pct}%` }}
      />
      <div
        className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_10px_#38d6ff] transition-transform group-hover:scale-125"
        style={{ left: `${pct}%` }}
      />
    </div>
  )
}
