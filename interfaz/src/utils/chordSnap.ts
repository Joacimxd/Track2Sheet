import type { MidiNote } from '../types'

/**
 * Chord snapping: recognise the chord a strum is trying to be and replace the transcribed
 * cluster with a standard guitar voicing (power chord, open chord, E/A/D-shape barre).
 *
 * The recogniser works on pitch classes weighted by velocity × length, plus a little of what is
 * still ringing from earlier strums, and is biased towards chords of the song's key.
 */

export type Quality = '5' | '' | 'm' | '7' | 'm7' | 'sus2' | 'sus4'

export interface ChordLabel {
  root: number
  quality: Quality
  /** e.g. "E5", "Am", "G7". */
  name: string
}

export interface Position {
  string: number
  fret: number
}

export interface Key {
  tonic: number
  minor: boolean
}

const PC_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']

const TEMPLATES: Record<Quality, number[]> = {
  '5': [0, 7],
  '': [0, 4, 7],
  m: [0, 3, 7],
  '7': [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
}
/** Small bias towards the common chords so ambiguous clusters resolve to the simple reading. */
const QUALITY_BIAS: Record<Quality, number> = { '5': 0, '': 0.02, m: 0.02, '7': -0.03, m7: -0.03, sus2: -0.05, sus4: -0.05 }

/** Pitch classes below this share of the loudest one count as noise (e.g. distortion thirds). */
const PRESENT = 0.15
/** Minimum share of the weight the chord must explain to be snapped at all. */
const MIN_FIT = 0.75
/** Notes still ringing from an earlier strum count this much. */
const RINGING_WEIGHT = 0.4

// ───────────────────────────── Key ─────────────────────────────

const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

function correlate(a: number[], b: number[]): number {
  const ma = a.reduce((s, x) => s + x, 0) / a.length
  const mb = b.reduce((s, x) => s + x, 0) / b.length
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb)
    da += (a[i] - ma) ** 2
    db += (b[i] - mb) ** 2
  }
  return da && db ? num / Math.sqrt(da * db) : 0
}

/** Krumhansl–Schmuckler key estimate over the whole part. */
export function detectKey(notes: MidiNote[]): Key {
  const hist = new Array(12).fill(0)
  for (const n of notes) hist[n.midi % 12] += Math.min(n.duration, 2) * n.velocity
  let best: Key = { tonic: 4, minor: true }
  let bestR = -Infinity
  for (let t = 0; t < 12; t++) {
    const rotated = hist.map((_, i) => hist[(i + t) % 12])
    for (const minor of [false, true]) {
      const r = correlate(rotated, minor ? KS_MINOR : KS_MAJOR)
      if (r > bestR) {
        bestR = r
        best = { tonic: t, minor }
      }
    }
  }
  return best
}

/** Scale plus the borrowed tone rock/pop uses constantly (♭VII in major, V in minor). */
function keyPitchClasses(key: Key): Set<number> {
  const steps = key.minor ? [0, 2, 3, 5, 7, 8, 10, 11] : [0, 2, 4, 5, 7, 9, 10, 11]
  return new Set(steps.map((s) => (key.tonic + s) % 12))
}

// ───────────────────────────── Recognition ─────────────────────────────

export class ChordRecognizer {
  private readonly scale: Set<number>
  private prev: ChordLabel | null = null

  constructor(key: Key) {
    this.scale = keyPitchClasses(key)
  }

  /**
   * Label a strum. `group` are the notes starting together, `ringing` the notes from earlier
   * strums still sounding at that moment. Returns null when no chord explains it well.
   */
  recognize(group: MidiNote[], ringing: MidiNote[]): ChordLabel | null {
    const pitches = [...new Set(group.map((n) => n.midi))]
    if (pitches.length < 2) return null

    const w = new Array(12).fill(0)
    for (const n of group) w[n.midi % 12] += n.velocity * Math.min(n.duration, 1.5)
    for (const n of ringing) w[n.midi % 12] += RINGING_WEIGHT * n.velocity * Math.min(n.duration, 1.5)
    const max = Math.max(...w)
    const total = w.reduce((s, x) => s + x, 0)
    if (!max) return null
    const present = (pc: number) => w[pc] >= PRESENT * max
    const bass = Math.min(...pitches) % 12

    // Two-note strums only snap when they are a power-chord fragment (fifth or inverted fifth).
    if (pitches.length === 2) {
      const [lo, hi] = [...pitches].sort((a, b) => a - b)
      const iv = (hi - lo) % 12
      if (iv === 7) return label(lo % 12, '5')
      if (iv === 5) return label(hi % 12, '5')
      return null
    }

    let best: ChordLabel | null = null
    let bestScore = -Infinity
    let prevScore = -Infinity
    for (let root = 0; root < 12; root++) {
      if (!present(root)) continue
      for (const quality of Object.keys(TEMPLATES) as Quality[]) {
        const tones = TEMPLATES[quality].map((iv) => (root + iv) % 12)
        if (!tones.every(present)) continue
        // Noise-level pitch classes (e.g. a distortion "third" on a power chord) are forgiven;
        // only clearly present non-chord tones count against the fit.
        const explained = tones.reduce((s, pc) => s + w[pc], 0)
        const noise = w.reduce((s, x, pc) => (tones.includes(pc) || present(pc) ? s : s + x), 0)
        const fit = (explained + noise) / total
        if (fit < MIN_FIT) continue
        let score = fit + QUALITY_BIAS[quality]
        if (root === bass) score += 0.1
        if (tones.every((pc) => this.scale.has(pc))) score += 0.08
        if (score > bestScore) {
          bestScore = score
          best = label(root, quality)
        }
        if (this.prev && this.prev.root === root && this.prev.quality === quality) prevScore = score
      }
    }
    // Hysteresis: keep the previous chord unless the new reading is clearly better.
    if (this.prev && best && prevScore >= bestScore - 0.05) best = this.prev
    if (best) this.prev = best
    return best
  }
}

function label(root: number, quality: Quality): ChordLabel {
  return { root, quality, name: PC_NAMES[root] + quality }
}

// ───────────────────────────── Voicings ─────────────────────────────

interface Shape {
  id: string
  quality: Quality
  /** String the root sits on (0 = low E); for fixed shapes, the root pitch class instead. */
  rootString?: number
  rootPc?: number
  /** Fret per string (null = not played), relative to the root fret for movable shapes. */
  frets: (number | null)[]
  /** Extra cost for awkward shapes. */
  penalty: number
}

const x = null
const MOVABLE: Shape[] = [
  // Power chords: root, fifth, octave.
  { id: 'E5', quality: '5', rootString: 0, frets: [0, 2, 2, x, x, x], penalty: 0 },
  { id: 'A5', quality: '5', rootString: 1, frets: [x, 0, 2, 2, x, x], penalty: 0 },
  { id: 'D5', quality: '5', rootString: 2, frets: [x, x, 0, 2, 3, x], penalty: 0.4 },
  // E shape (root on 6th string).
  { id: 'E', quality: '', rootString: 0, frets: [0, 2, 2, 1, 0, 0], penalty: 0.5 },
  { id: 'Em', quality: 'm', rootString: 0, frets: [0, 2, 2, 0, 0, 0], penalty: 0.5 },
  { id: 'E7', quality: '7', rootString: 0, frets: [0, 2, 0, 1, 0, 0], penalty: 0.5 },
  { id: 'Em7', quality: 'm7', rootString: 0, frets: [0, 2, 0, 0, 0, 0], penalty: 0.5 },
  { id: 'Esus4', quality: 'sus4', rootString: 0, frets: [0, 2, 2, 2, 0, 0], penalty: 0.5 },
  // A shape (root on 5th string).
  { id: 'A', quality: '', rootString: 1, frets: [x, 0, 2, 2, 2, 0], penalty: 0.3 },
  { id: 'Am', quality: 'm', rootString: 1, frets: [x, 0, 2, 2, 1, 0], penalty: 0.3 },
  { id: 'A7', quality: '7', rootString: 1, frets: [x, 0, 2, 0, 2, 0], penalty: 0.3 },
  { id: 'Am7', quality: 'm7', rootString: 1, frets: [x, 0, 2, 0, 1, 0], penalty: 0.3 },
  { id: 'Asus2', quality: 'sus2', rootString: 1, frets: [x, 0, 2, 2, 0, 0], penalty: 0.3 },
  { id: 'Asus4', quality: 'sus4', rootString: 1, frets: [x, 0, 2, 2, 3, 0], penalty: 0.3 },
  // D shape (root on 4th string) — easy open, awkward when moved up.
  { id: 'D', quality: '', rootString: 2, frets: [x, x, 0, 2, 3, 2], penalty: 0.2 },
  { id: 'Dm', quality: 'm', rootString: 2, frets: [x, x, 0, 2, 3, 1], penalty: 0.2 },
  { id: 'D7', quality: '7', rootString: 2, frets: [x, x, 0, 2, 1, 2], penalty: 0.2 },
  { id: 'Dm7', quality: 'm7', rootString: 2, frets: [x, x, 0, 2, 1, 1], penalty: 0.2 },
  { id: 'Dsus2', quality: 'sus2', rootString: 2, frets: [x, x, 0, 2, 3, 0], penalty: 0.2 },
  { id: 'Dsus4', quality: 'sus4', rootString: 2, frets: [x, x, 0, 2, 3, 3], penalty: 0.2 },
]
/** Open-position chords that have no movable equivalent above. */
const OPEN_ONLY: Shape[] = [
  { id: 'C', quality: '', rootPc: 0, frets: [x, 3, 2, 0, 1, 0], penalty: 0 },
  { id: 'C7', quality: '7', rootPc: 0, frets: [x, 3, 2, 3, 1, 0], penalty: 0.2 },
  { id: 'G', quality: '', rootPc: 7, frets: [3, 2, 0, 0, 0, 3], penalty: 0 },
  { id: 'G7', quality: '7', rootPc: 7, frets: [3, 2, 0, 0, 0, 1], penalty: 0.2 },
]

interface Voicing {
  id: string
  positions: Position[]
  /** Root fret; 0 = open position. */
  baseFret: number
  penalty: number
}

const MAX_BASE_FRET = 14

/** Every playable voicing of a chord on the given tuning. */
export function voicingsFor(chord: ChordLabel, tuning: number[], maxFret: number): Voicing[] {
  const out: Voicing[] = []
  for (const shape of MOVABLE) {
    if (shape.quality !== chord.quality) continue
    const open = tuning[shape.rootString!] % 12
    for (let base = (chord.root - open + 12) % 12; base <= MAX_BASE_FRET; base += 12) {
      const positions = shape.frets.flatMap((f, string) => (f === null ? [] : [{ string, fret: f + base }]))
      if (positions.some((p) => p.fret > maxFret)) continue
      // Moving a shape up turns its open strings into a barre: harder the more strings it covers.
      const barre = base > 0 ? positions.length * 0.08 : 0
      const awkward = base > 0 && shape.rootString === 2 ? 1.2 : 0
      out.push({ id: `${shape.id}@${base}`, positions, baseFret: base, penalty: shape.penalty + barre + awkward })
    }
  }
  for (const shape of OPEN_ONLY) {
    if (shape.quality !== chord.quality || shape.rootPc !== chord.root) continue
    const positions = shape.frets.flatMap((f, string) => (f === null ? [] : [{ string, fret: f }]))
    out.push({ id: shape.id, positions, baseFret: 0, penalty: shape.penalty })
  }
  return out
}

/**
 * Pick the voicing closest to where the hand is and to the register of what was transcribed,
 * preferring to repeat the last voicing so a strummed passage doesn't jump around.
 */
export function chooseVoicing(
  chord: ChordLabel,
  original: number[],
  hand: number,
  lastId: string | null,
  tuning: number[],
  maxFret: number,
): Voicing | null {
  const lowOrig = Math.min(...original)
  const highOrig = Math.max(...original)
  let best: Voicing | null = null
  let bestCost = Infinity
  for (const v of voicingsFor(chord, tuning, maxFret)) {
    const pitches = v.positions.map((p) => tuning[p.string] + p.fret)
    const fretted = v.positions.filter((p) => p.fret > 0).map((p) => p.fret)
    const centre = fretted.length ? fretted.reduce((s, f) => s + f, 0) / fretted.length : 0
    let cost = v.penalty
    cost += v.baseFret === 0 ? (hand > 7 ? 2 : 0) : Math.abs(centre - hand) * 0.6
    cost += Math.abs(Math.min(...pitches) - lowOrig) * 0.3
    cost += Math.abs(Math.max(...pitches) - highOrig) * 0.08
    if (v.baseFret > 12) cost += (v.baseFret - 12) * 0.5
    if (v.id === lastId) cost -= 1.5
    if (cost < bestCost) {
      bestCost = cost
      best = v
    }
  }
  return best
}
