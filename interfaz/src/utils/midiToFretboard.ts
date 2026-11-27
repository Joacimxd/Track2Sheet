import type { MidiNote } from '../types'

// ───────────────────────────── Guitar ─────────────────────────────
//
// The tablature itself (tuning, cleanup, lead/rhythm split, fingering) is computed by the Python
// API (api/tab/, POST /tab); see tabApi.ts. Only the types and drawing constants live here.

/** String labels for standard tuning, string 0 = low E (6th string) … string 5 = high e. */
export const STANDARD_LABELS = ['E', 'A', 'D', 'G', 'B', 'e']
/** Rocksmith colour code: red, yellow, blue, orange, green, purple. */
export const STRING_COLORS = ['#e0503a', '#f0b429', '#3f8fd2', '#e8843a', '#4fb286', '#d65aa0']
/** Keyboard keys for strings 0-5 (low E … high e). */
export const STRING_KEYS = ['A', 'S', 'D', 'F', 'G', 'H']
export const MAX_FRET = 22
export const INLAY_FRETS = new Set([3, 5, 7, 9, 12, 15, 17, 19, 21])

export interface FretNote extends MidiNote {
  id: number
  string: number
  fret: number
  /** Dead / ghost note (very low velocity) drawn with a red X. */
  muted: boolean
  /** Index into `chords` when the note is part of a chord, else -1. */
  chord: number
}

export interface Chord {
  time: number
  minFret: number
  maxFret: number
  minString: number
  maxString: number
  /** Chord name (e.g. "E5", "Am") when the pitches form a known chord. */
  name?: string | null
}

export interface Section {
  start: number
  end: number
}

export interface FretboardTab {
  notes: FretNote[]
  chords: Chord[]
  /** Stretches where the `auto` part shows the lead line instead of the rhythm part. */
  solos: Section[]
  /** Label of each string, low to high (depends on the detected tuning). */
  labels: string[]
}

export const EMPTY_TAB: FretboardTab = { notes: [], chords: [], solos: [], labels: STANDARD_LABELS }

// ───────────────────────────── Drums ─────────────────────────────

export interface DrumLane {
  label: string
  color: string
  key: string
}

/** Pads left→right as seen from the drum throne. The kick is a full-width bar (lane `KICK_LANE`). */
export const DRUM_LANES: DrumLane[] = [
  { label: 'Hi-Hat', color: '#f0b429', key: 'A' },
  { label: 'Tarola', color: '#e0503a', key: 'S' },
  { label: 'Tom alto', color: '#3f8fd2', key: 'D' },
  { label: 'Tom piso', color: '#4fb286', key: 'F' },
  { label: 'Platillos', color: '#d65aa0', key: 'G' },
]
export const KICK_LANE = 5
export const KICK = { label: 'Bombo', color: '#e8843a', key: 'J' }

export interface DrumNote extends MidiNote {
  id: number
  /** 0-4 = pads of DRUM_LANES, 5 = kick. */
  lane: number
}

/** General MIDI percussion key → lane (-1 = unknown). */
export function drumLaneOf(midi: number): number {
  if (midi === 35 || midi === 36) return KICK_LANE
  if (midi >= 37 && midi <= 40) return 1
  if (midi === 42 || midi === 44 || midi === 46) return 0
  if (midi === 47 || midi === 48 || midi === 50) return 2
  if (midi === 41 || midi === 43 || midi === 45) return 3
  if ([49, 51, 52, 53, 55, 57, 59].includes(midi)) return 4
  return -1
}

/** Map a drum .mid to highway lanes (GM mapping, or spread by pitch for non-GM transcriptions). */
export function midiToDrumLanes(notes: MidiNote[]): DrumNote[] {
  const mapped = notes.map((n) => ({ ...n, lane: drumLaneOf(n.midi) }))
  let result = mapped.filter((n) => n.lane >= 0)
  if (result.length < notes.length * 0.5) {
    const pitches = [...new Set(notes.map((n) => n.midi))].sort((a, b) => a - b)
    const order = [KICK_LANE, 1, 3, 2, 0, 4] // low pitches → kick, high → cymbals
    result = notes.map((n) => ({
      ...n,
      lane: order[Math.min(5, Math.floor((pitches.indexOf(n.midi) / Math.max(1, pitches.length)) * 6))],
    }))
  }
  // One hit per lane per instant.
  const seen = new Set<string>()
  return result
    .filter((n) => {
      const key = `${n.lane}:${Math.round(n.time * 50)}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((n, id) => ({ ...n, id }))
}
