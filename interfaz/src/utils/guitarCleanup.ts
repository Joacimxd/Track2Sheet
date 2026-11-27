import type { MidiNote } from '../types'

/**
 * Clean a raw audio→MIDI guitar transcription before it is mapped to the fretboard.
 *
 * Transcribers (basic-pitch & co.) report what they hear, not what a guitarist plays: overtones
 * of distorted chords show up as extra notes, sustained notes get chopped into fragments, bass
 * bleed sits below the guitar's range and chord notes land a few ms apart. Every step here is
 * conservative so a clean MIDI passes through almost unchanged.
 */

/** Lowest note of a standard-tuned guitar (E2). Anything below is bass / kick bleed. */
const LOWEST = 40
/** Fragments shorter than this are transcription noise, not picked notes. */
const MIN_DURATION = 0.06
/** Same pitch restarting within this gap may be one sustained note split in two… */
const MERGE_GAP = 0.03
/** …but only when one piece is a sliver or the restart is a quiet dip, so real repeated picks
 *  (palm-muted chugs) are kept. */
const RETRIGGER_RATIO = 0.6
/** Onsets closer than this are one strum. */
const ONSET_CLUSTER = 0.05
/** Intervals above a louder note at which overtones show up (octave, 12th, 2 octaves, 17th, 19th). */
const OVERTONES = new Set([12, 19, 24, 28, 31])
/** An overtone ghost is at most this loud relative to its fundamental. */
const GHOST_RATIO = 0.8
/** …and does not ring on after it by more than this. */
const GHOST_TAIL = 0.05

export function cleanGuitarNotes(input: MidiNote[]): MidiNote[] {
  let notes = input
    .filter((n) => n.midi >= LOWEST)
    .map((n) => ({ ...n }))
    .sort((a, b) => a.time - b.time || a.midi - b.midi)

  notes = mergeFragments(notes)
  notes = notes.filter((n) => n.duration >= MIN_DURATION)
  clusterOnsets(notes)
  notes = removeOvertones(notes)
  return notes.sort((a, b) => a.time - b.time || a.midi - b.midi)
}

/** Join a sustained note that the transcriber chopped into pieces. */
function mergeFragments(notes: MidiNote[]): MidiNote[] {
  const out: MidiNote[] = []
  const lastByPitch = new Map<number, MidiNote>()
  for (const n of notes) {
    const prev = lastByPitch.get(n.midi)
    const fragment =
      prev &&
      n.time - (prev.time + prev.duration) <= MERGE_GAP &&
      (n.duration < MIN_DURATION || prev.duration < MIN_DURATION || n.velocity < prev.velocity * RETRIGGER_RATIO)
    if (prev && fragment) {
      prev.duration = Math.max(prev.duration, n.time + n.duration - prev.time)
      prev.velocity = Math.max(prev.velocity, n.velocity)
      continue
    }
    out.push(n)
    lastByPitch.set(n.midi, n)
  }
  return out
}

/** Snap notes of one strum to a shared onset (the first one), keeping their end times. */
function clusterOnsets(notes: MidiNote[]): void {
  let start = 0
  for (let i = 1; i <= notes.length; i++) {
    if (i < notes.length && notes[i].time - notes[start].time < ONSET_CLUSTER) continue
    const t = notes[start].time
    for (let k = start + 1; k < i; k++) {
      notes[k].duration += notes[k].time - t
      notes[k].time = t
    }
    start = i
  }
}

/** Drop quiet notes at an overtone interval above a louder note of the same strum that die with it. */
function removeOvertones(notes: MidiNote[]): MidiNote[] {
  const drop = new Set<MidiNote>()
  for (let i = 0; i < notes.length; ) {
    let j = i
    while (j < notes.length && notes[j].time === notes[i].time) j++
    const group = notes.slice(i, j)
    if (group.length > 1) {
      for (const hi of group) {
        // A ghost starts and dies with its fundamental; a lead note held past it is real.
        const isGhost = group.some(
          (lo) =>
            lo !== hi &&
            !drop.has(lo) &&
            OVERTONES.has(hi.midi - lo.midi) &&
            hi.velocity <= lo.velocity * GHOST_RATIO &&
            hi.time + hi.duration <= lo.time + lo.duration + GHOST_TAIL,
        )
        if (isGhost) drop.add(hi)
      }
    }
    i = j
  }
  return notes.filter((n) => !drop.has(n))
}
