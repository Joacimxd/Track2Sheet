import type { MidiNote } from '../types'
import { cleanGuitarNotes } from './guitarCleanup'
import { ChordRecognizer, chooseVoicing, detectKey } from './chordSnap'
import { keepLeadInSolos, type Section } from './leadSplit'

// ───────────────────────────── Guitar ─────────────────────────────

/** Standard tuning, string 0 = low E (6th string) … string 5 = high e. */
export const TUNING = [40, 45, 50, 55, 59, 64]
export const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e']
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
  /** Chord name when the strum was snapped to a standard voicing (e.g. "E5", "Am"). */
  name?: string
}

export interface FretboardTab {
  notes: FretNote[]
  chords: Chord[]
  /** Stretches where the lead line is shown instead of the rhythm part. */
  solos: Section[]
}

const CHORD_WINDOW = 0.03
const MAX_SPAN = 4

function foldIntoRange(midi: number): number {
  let m = midi
  while (m < TUNING[0]) m += 12
  while (m > TUNING[5] + MAX_FRET) m -= 12
  return m
}

function candidates(midi: number): { string: number; fret: number }[] {
  const out: { string: number; fret: number }[] = []
  TUNING.forEach((open, string) => {
    const fret = midi - open
    if (fret >= 0 && fret <= MAX_FRET) out.push({ string, fret })
  })
  return out
}

/** Cost of playing a position with the fretting hand centred on `hand`. */
function positionCost(fret: number, hand: number): number {
  if (fret === 0) return hand > 7 ? 4 : 0.8
  return Math.abs(fret - hand) + (fret > 15 ? (fret - 15) * 0.4 : 0)
}

/** Best (string, fret) for every pitch of a chord: distinct strings, playable span, close to the hand. */
function assignChord(pitches: number[], hand: number): { string: number; fret: number }[] | null {
  const options = pitches.map(candidates)
  let best: { string: number; fret: number }[] | null = null
  let bestCost = Infinity
  const current: { string: number; fret: number }[] = []
  const used = new Set<number>()

  const search = (i: number, cost: number) => {
    if (cost >= bestCost) return
    if (i === pitches.length) {
      const fretted = current.filter((p) => p.fret > 0).map((p) => p.fret)
      const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0
      const total = cost + (span > MAX_SPAN ? (span - MAX_SPAN) * 6 : 0)
      if (total < bestCost) {
        bestCost = total
        best = current.map((p) => ({ ...p }))
      }
      return
    }
    for (const opt of options[i]) {
      if (used.has(opt.string)) continue
      used.add(opt.string)
      current.push(opt)
      search(i + 1, cost + positionCost(opt.fret, hand))
      current.pop()
      used.delete(opt.string)
    }
  }
  search(0, 0)
  return best
}

export interface FretboardOptions {
  /** Remove transcription noise (bass bleed, fragments, overtone ghosts) first. Default true. */
  clean?: boolean
  /** Replace recognised chord clusters with standard voicings. Default true. */
  snapChords?: boolean
  /** In solo stretches show the lead line instead of the accompaniment. Default true (needs `clean`). */
  detectSolos?: boolean
}

/**
 * Map the notes of a guitar .mid to tablature positions (string, fret).
 * Notes that start together form a chord. Clusters recognised as a chord are replaced with a
 * standard voicing (see chordSnap.ts); everything else is solved with a small search that keeps
 * the fretting hand close to where it was, so the result reads like a real fingering.
 */
export function midiToFretboard(input: MidiNote[], options: FretboardOptions = {}): FretboardTab {
  const { clean = true, snapChords = true, detectSolos = true } = options
  const cleaned = clean ? cleanGuitarNotes(input) : input
  const { notes: source, solos } = clean && detectSolos ? keepLeadInSolos(cleaned) : { notes: cleaned, solos: [] }
  const inSolo = (t: number) => solos.some((s) => s.start <= t && t <= s.end)
  const sorted = [...source].sort((a, b) => a.time - b.time || a.midi - b.midi)
  const recognizer = snapChords && sorted.length ? new ChordRecognizer(detectKey(sorted)) : null
  const out: FretNote[] = []
  const chords: Chord[] = []
  let hand = 5
  let lastVoicing: string | null = null
  let ringing: MidiNote[] = []

  for (let i = 0; i < sorted.length; ) {
    let j = i + 1
    while (j < sorted.length && sorted[j].time - sorted[i].time < CHORD_WINDOW) j++
    const strum = sorted.slice(i, j)
    const time = strum[0].time
    ringing = ringing.filter((n) => n.time + n.duration > time + 0.02)

    let placed: { midi: number; note: MidiNote; string: number; fret: number }[] | null = null
    let name: string | undefined

    // Double stops in a solo stay as played; only accompaniment gets snapped.
    const label = inSolo(time) ? null : (recognizer?.recognize(strum, ringing) ?? null)
    if (label) {
      const voicing = chooseVoicing(label, strum.map((n) => n.midi), hand, lastVoicing, TUNING, MAX_FRET)
      if (voicing) {
        const note: MidiNote = {
          time,
          duration: Math.max(...strum.map((n) => n.duration)),
          midi: 0,
          velocity: Math.max(...strum.map((n) => n.velocity)),
        }
        placed = voicing.positions.map((p) => ({ midi: TUNING[p.string] + p.fret, note, ...p }))
        name = label.name
        lastVoicing = voicing.id
      }
    }

    if (!placed) {
      // Unique pitches, at most 6 (one per string); drop inner voices first.
      let group = [...new Map(strum.map((n) => [foldIntoRange(n.midi), n])).entries()]
      while (group.length > 6) group.splice(Math.floor(group.length / 2), 1)

      let assignment = assignChord(
        group.map(([m]) => m),
        hand,
      )
      while (!assignment && group.length > 1) {
        group = group.filter((_, k) => k !== Math.floor(group.length / 2))
        assignment = assignChord(
          group.map(([m]) => m),
          hand,
        )
      }
      if (assignment) placed = assignment.map((pos, k) => ({ midi: group[k][0], note: group[k][1], ...pos }))
      if (group.length > 1) lastVoicing = null
    }

    if (placed) {
      const chordIndex = placed.length > 1 ? chords.length : -1
      for (const p of placed) {
        out.push({
          ...p.note,
          midi: p.midi,
          id: out.length,
          string: p.string,
          fret: p.fret,
          muted: p.note.velocity < 0.3,
          chord: chordIndex,
        })
      }
      if (chordIndex >= 0) {
        const frets = placed.map((p) => p.fret)
        const strings = placed.map((p) => p.string)
        chords.push({
          time,
          minFret: Math.min(...frets),
          maxFret: Math.max(...frets),
          minString: Math.min(...strings),
          maxString: Math.max(...strings),
          name,
        })
      }
      const fretted = placed.filter((p) => p.fret > 0).map((p) => p.fret)
      if (fretted.length) hand = hand * 0.5 + (fretted.reduce((a, b) => a + b, 0) / fretted.length) * 0.5
    }
    ringing.push(...strum)
    i = j
  }
  return { notes: out, chords, solos }
}

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
