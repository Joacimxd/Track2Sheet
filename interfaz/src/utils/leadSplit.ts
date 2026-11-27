import type { MidiNote } from '../types'

/**
 * Solo detection. A guitar stem often holds a rhythm part and a lead part at once, but the
 * highway shows one player. Outside solos the rhythm part is what you play; inside a solo it is
 * the lead line. This finds the solo stretches and, inside them, keeps only the melody.
 *
 * Expects cleaned notes (see guitarCleanup.ts): notes of one strum share the exact same `time`.
 */

/** Lowest pitch that counts as a lead note outside a chord (C4). */
const LEAD_MIN = 60
/** A strum's top note this far above the next one is a melody note riding on a chord. */
const LEAD_GAP = 5
/** Inside a solo, melody notes can dip this low (E3) before they're treated as accompaniment. */
const SOLO_FLOOR = 52
/** Window (s) and lead-note count that make a stretch a solo. */
const WINDOW = 4
const MIN_LEAD_NOTES = 7
/** Solo stretches separated by less than this are one solo; shorter ones are dropped. */
const JOIN_GAP = 1.5
const MIN_SOLO = 2.5
const PAD = 0.3

export interface Section {
  start: number
  end: number
}

function strums(notes: MidiNote[]): MidiNote[][] {
  const out: MidiNote[][] = []
  for (const n of notes) {
    const last = out[out.length - 1]
    if (last && last[0].time === n.time) last.push(n)
    else out.push([n])
  }
  return out.map((g) => g.sort((a, b) => a.midi - b.midi))
}

/** The melody note of a strum, if it has one: a high single note, or a top note well above the rest. */
function melodyOf(strum: MidiNote[], floor: number): MidiNote | null {
  const top = strum[strum.length - 1]
  if (top.midi < floor) return null
  if (strum.length === 1) return top
  const below = strum[strum.length - 2]
  if (top.midi - below.midi >= LEAD_GAP) return top
  // Two-note double stops are common in solos; a full chord with no gap is accompaniment.
  return strum.length === 2 ? top : null
}

export function findSolos(notes: MidiNote[]): Section[] {
  const leadTimes = strums(notes)
    .filter((s) => melodyOf(s, LEAD_MIN) && (s.length === 1 || s[s.length - 1].midi - s[s.length - 2].midi >= LEAD_GAP))
    .map((s) => s[0].time)

  const sections: Section[] = []
  for (let i = 0, lo = 0, hi = 0; i < leadTimes.length; i++) {
    const t = leadTimes[i]
    while (leadTimes[lo] < t - WINDOW / 2) lo++
    while (hi < leadTimes.length && leadTimes[hi] <= t + WINDOW / 2) hi++
    if (hi - lo < MIN_LEAD_NOTES) continue
    const last = sections[sections.length - 1]
    if (last && t - PAD - last.end <= JOIN_GAP) last.end = t + PAD
    else sections.push({ start: t - PAD, end: t + PAD })
  }
  return sections.filter((s) => s.end - s.start >= MIN_SOLO)
}

/**
 * Inside solo sections keep only the melody note of each strum; outside them leave everything.
 * Returns the filtered notes and the sections found.
 */
export function keepLeadInSolos(notes: MidiNote[]): { notes: MidiNote[]; solos: Section[] } {
  const solos = findSolos(notes)
  if (!solos.length) return { notes, solos }
  const out: MidiNote[] = []
  let k = 0
  for (const s of strums(notes)) {
    const t = s[0].time
    while (k < solos.length && solos[k].end < t) k++
    const inSolo = k < solos.length && solos[k].start <= t
    if (!inSolo) out.push(...s)
    else {
      const m = melodyOf(s, SOLO_FLOOR)
      if (m) out.push(m)
    }
  }
  return { notes: out, solos }
}
