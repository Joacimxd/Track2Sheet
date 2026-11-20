import { Midi } from '@tonejs/midi'
import type { InstrumentId, MidiNote, ParsedMidi, TrackId } from '../types'

export interface LaneDef {
  color: string
  glow: string
  label: string
}

/** Five lanes per instrument. Guitar uses the classic GH colours; drums map kit pieces to lanes. */
export const LANES: Record<InstrumentId, LaneDef[]> = {
  guitar: [
    { color: '#22e05a', glow: '#7dff9f', label: 'A' },
    { color: '#ff2d3d', glow: '#ff8a93', label: 'S' },
    { color: '#ffd800', glow: '#fff07a', label: 'D' },
    { color: '#1f8fff', glow: '#86c4ff', label: 'F' },
    { color: '#ff8a00', glow: '#ffc06e', label: 'G' },
  ],
  drums: [
    { color: '#ff8a00', glow: '#ffc06e', label: 'Bombo' },
    { color: '#ff2d3d', glow: '#ff8a93', label: 'Caja' },
    { color: '#ffd800', glow: '#fff07a', label: 'Hi-Hat' },
    { color: '#1f8fff', glow: '#86c4ff', label: 'Toms' },
    { color: '#22e05a', glow: '#7dff9f', label: 'Platillos' },
  ],
}

/** General MIDI percussion key -> drum lane. */
export function drumLane(midi: number): number {
  if (midi === 35 || midi === 36) return 0
  if (midi >= 37 && midi <= 40) return 1
  if (midi === 42 || midi === 44 || midi === 46) return 2
  if ([41, 43, 45, 47, 48, 50].includes(midi)) return 3
  if ([49, 51, 52, 53, 55, 57, 59].includes(midi)) return 4
  return -1
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}

/** Spread pitched notes over 5 lanes by splitting the core pitch range (5th–95th pct) evenly. */
function assignPitchedLanes(notes: MidiNote[]) {
  const pitches = notes.map((n) => n.midi).sort((a, b) => a - b)
  const lo = percentile(pitches, 0.05)
  const hi = Math.max(lo + 5, percentile(pitches, 0.95))
  for (const n of notes) {
    const t = (n.midi - lo) / (hi - lo)
    n.lane = Math.max(0, Math.min(4, Math.floor(t * 5)))
  }
}

/** Drop notes that fall on the same lane at (almost) the same instant. */
function dedupeLanes(notes: MidiNote[]): MidiNote[] {
  const seen = new Set<string>()
  return notes.filter((n) => {
    const key = `${n.lane}:${Math.round(n.time * 50)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Parse a .mid file into the note list used by the highway, the sheet and the synths.
 * For `drums` percussion tracks are preferred; for anything else the pitched tracks are merged.
 */
export function parseMidi(data: ArrayBuffer | Uint8Array, fileName: string, role: TrackId): ParsedMidi {
  const midi = new Midi(data)
  const header = midi.header
  const withNotes = midi.tracks.filter((t) => t.notes.length > 0)
  const percussion = withNotes.filter((t) => t.channel === 9 || t.instrument.percussion)
  const pitched = withNotes.filter((t) => !percussion.includes(t))

  let chosen = withNotes
  if (role === 'drums' && percussion.length) chosen = percussion
  else if (role !== 'drums' && pitched.length) chosen = pitched

  const isPercussion = role === 'drums' || (chosen.length > 0 && chosen.every((t) => percussion.includes(t)))

  let notes: MidiNote[] = chosen
    .flatMap((t) => t.notes)
    .map((n) => ({
      time: n.time,
      duration: n.duration,
      ticks: n.ticks,
      durationTicks: n.durationTicks,
      midi: n.midi,
      velocity: n.velocity,
      lane: 0,
    }))
    .sort((a, b) => a.time - b.time || a.midi - b.midi)

  if (isPercussion) {
    const mapped = notes.map((n) => ({ ...n, lane: drumLane(n.midi) }))
    // Non-GM drum transcriptions: fall back to spreading by pitch.
    if (mapped.filter((n) => n.lane >= 0).length >= notes.length * 0.5) notes = mapped.filter((n) => n.lane >= 0)
    else assignPitchedLanes(notes)
  } else {
    assignPitchedLanes(notes)
  }
  notes = dedupeLanes(notes)

  const bpm = header.tempos[0]?.bpm ?? 120
  const ts = header.timeSignatures[0]?.timeSignature ?? [4, 4]
  const timeSignature: [number, number] = [ts[0] ?? 4, ts[1] ?? 4]
  const duration = Math.max(midi.duration, ...notes.map((n) => n.time + n.duration), 0)

  // Beat / bar grid from ticks so that tempo changes are respected.
  const ppq = header.ppq
  const beatTicks = (ppq * 4) / timeSignature[1]
  const beatTimes: number[] = []
  const measureTimes: number[] = []
  const endTicks = header.secondsToTicks(duration + 4)
  for (let tick = 0, beat = 0; tick <= endTicks; tick += beatTicks, beat++) {
    const t = header.ticksToSeconds(tick)
    beatTimes.push(t)
    if (beat % timeSignature[0] === 0) measureTimes.push(t)
  }

  return {
    fileName,
    trackName: chosen[0]?.name || chosen[0]?.instrument.name || '',
    bpm,
    ppq,
    timeSignature,
    duration,
    isPercussion,
    notes,
    beatTimes,
    measureTimes,
  }
}
