import type { MidiNote } from '../types'

const STANDARD_LABELS = ['E', 'A', 'D', 'G', 'B', 'e']
export const STRING_COLORS = ['#e0503a', '#f0b429', '#3f8fd2', '#e8843a', '#4fb286', '#d65aa0']
export const STRING_KEYS = ['A', 'S', 'D', 'F', 'G', 'H']
export const MAX_FRET = 22
export const INLAY_FRETS = new Set([3, 5, 7, 9, 12, 15, 17, 19, 21])

export interface FretNote extends MidiNote {
  id: number
  string: number
  fret: number
  muted: boolean
  chord: number
}

export interface Chord {
  time: number
  minFret: number
  maxFret: number
  minString: number
  maxString: number
  name?: string | null
}

export interface Section {
  start: number
  end: number
}

export interface FretboardTab {
  notes: FretNote[]
  chords: Chord[]
  solos: Section[]
  labels: string[]
}

export const EMPTY_TAB: FretboardTab = { notes: [], chords: [], solos: [], labels: STANDARD_LABELS }

interface DrumLane {
  label: string
  color: string
  key: string
}

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
  lane: number
}

export function drumLaneOf(midi: number): number {
  if (midi === 35 || midi === 36) return KICK_LANE
  if (midi >= 37 && midi <= 40) return 1
  if (midi === 42 || midi === 44 || midi === 46) return 0
  if (midi === 47 || midi === 48 || midi === 50) return 2
  if (midi === 41 || midi === 43 || midi === 45) return 3
  if ([49, 51, 52, 53, 55, 57, 59].includes(midi)) return 4
  return -1
}

export function midiToDrumLanes(notes: MidiNote[]): DrumNote[] {
  const mapped = notes.map((n) => ({ ...n, lane: drumLaneOf(n.midi) }))
  let result = mapped.filter((n) => n.lane >= 0)
  if (result.length < notes.length * 0.5) {
    const pitches = [...new Set(notes.map((n) => n.midi))].sort((a, b) => a - b)
    const order = [KICK_LANE, 1, 3, 2, 0, 4]
    result = notes.map((n) => ({
      ...n,
      lane: order[Math.min(5, Math.floor((pitches.indexOf(n.midi) / Math.max(1, pitches.length)) * 6))],
    }))
  }
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
