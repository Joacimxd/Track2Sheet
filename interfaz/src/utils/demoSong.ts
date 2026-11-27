import { Midi } from '@tonejs/midi'
import type { SongSource, StemId } from '../types'
import { DRUM_LOOP } from './drumLoop'

// A short rock tune (Em – C – G – D at 112 BPM, ~56 s) written as real .mid bytes, one file per
// stem, so the demo goes through exactly the same parser / mapper / synth path as a real song.

const BPM = 112
const PPQ = 480
const BAR = PPQ * 4

type Chord = { root: number; third: number; fifth: number }
const PROGRESSION: Chord[] = [
  { root: 52, third: 55, fifth: 59 }, // Em
  { root: 48, third: 52, fifth: 55 }, // C
  { root: 55, third: 59, fifth: 62 }, // G
  { root: 50, third: 54, fifth: 57 }, // D
]

type Section = 'intro' | 'verse' | 'chorus' | 'outro'
const FORM: Section[] = [
  ...Array<Section>(4).fill('intro'),
  ...Array<Section>(8).fill('verse'),
  ...Array<Section>(8).fill('chorus'),
  ...Array<Section>(4).fill('verse'),
  ...Array<Section>(2).fill('outro'),
]

const beat = (b: number) => Math.round(b * PPQ)

function newTrack(name: string, channel = 0, program = 0) {
  const midi = new Midi()
  midi.header.setTempo(BPM)
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4] })
  midi.header.update()
  const track = midi.addTrack()
  track.name = name
  track.channel = channel
  track.instrument.number = program
  const add = (n: number, bar: number, at: number, len: number, velocity = 0.8) =>
    track.addNote({ midi: n, ticks: bar * BAR + beat(at), durationTicks: beat(len), velocity })
  return { midi, add }
}

/** E minor pentatonic licks around the 12th–17th fret for the chorus. */
const LEAD: number[][] = [
  [76, 79, 81, 79, 76, 74],
  [72, 74, 76, 79, 76],
  [79, 81, 83, 81, 79, 76],
  [74, 76, 78, 74, 81],
]

function guitar() {
  const { midi, add } = newTrack('Guitarra', 0, 29)
  FORM.forEach((section, bar) => {
    const c = PROGRESSION[bar % 4]
    if (section === 'intro') {
      // Power chords (root + fifth + octave).
      for (const n of [c.root, c.root + 7, c.root + 12]) add(n, bar, 0, 1.8, 0.85)
      for (const n of [c.root, c.root + 7]) add(n, bar, 2, 1.8, 0.85)
    } else if (section === 'verse') {
      // Palm-muted riff with dead notes (velocity < 0.3 → X on the highway).
      const riff = [c.root, c.root, c.fifth, c.root, c.third + 12, c.root, c.fifth, c.root + 12]
      riff.forEach((n, i) => add(n, bar, i * 0.5, 0.4, i === 1 || i === 5 ? 0.22 : 0.8))
    } else if (section === 'chorus') {
      const lick = LEAD[bar % 4]
      const step = 4 / lick.length
      lick.forEach((n, i) => add(n, bar, i * step, i === lick.length - 1 ? step + 0.4 : step * 0.9, 0.9))
    } else {
      for (const n of [c.root, c.fifth, c.root + 12, c.third + 12]) add(n, bar, 0, 3.8, 0.8)
    }
  })
  return midi
}

/**
 * Drums: an Ableton Live Core Library loop ("Backbeat Busy", converted by scripts/alc_to_mid.py),
 * played at the song's tempo and repeated up to the outro, which ends on kick + crash.
 */
function drums() {
  const { midi, add } = newTrack('Batería', 9)
  const outro = FORM.indexOf('outro')
  const loopEnd = outro * 4
  for (let r = 0; r * DRUM_LOOP.beats < loopEnd; r++)
    for (const [at, key, len, velocity] of DRUM_LOOP.notes) {
      const t = r * DRUM_LOOP.beats + at
      if (t < loopEnd) add(key, 0, t, len, velocity)
    }
  for (let bar = outro; bar < FORM.length; bar++) {
    add(36, bar, 0, 0.25, 0.85)
    add(49, bar, 0, 0.25, 1)
  }
  return midi
}

function bass() {
  const { midi, add } = newTrack('Bajo', 1, 33)
  FORM.forEach((section, bar) => {
    const root = PROGRESSION[bar % 4].root - 12
    if (section === 'intro' || section === 'outro') add(root, bar, 0, 4)
    else for (let e = 0; e < 8; e++) add(e === 7 ? root + 7 : root, bar, e * 0.5, 0.45)
  })
  return midi
}

function piano() {
  const { midi, add } = newTrack('Piano', 2, 0)
  FORM.forEach((section, bar) => {
    const c = PROGRESSION[bar % 4]
    const notes = [c.root + 12, c.third + 12, c.fifth + 12]
    if (section === 'verse') for (const at of [1, 3]) notes.forEach((n) => add(n, bar, at, 0.5, 0.55))
    else if (section === 'chorus') [...notes, c.root + 24, ...[...notes].reverse(), c.root].forEach((n, i) => add(n, bar, i * 0.5, 0.5, 0.5))
    else notes.forEach((n) => add(n, bar, 0, 4, 0.45))
  })
  return midi
}

function vocals() {
  const { midi, add } = newTrack('Voz', 3, 52)
  FORM.forEach((section, bar) => {
    const c = PROGRESSION[bar % 4]
    if (section === 'verse') {
      add(c.fifth + 12, bar, 0.5, 1, 0.6)
      add(c.third + 12, bar, 1.5, 0.5, 0.6)
      add(c.root + 12, bar, 2, 1.5, 0.6)
    } else if (section === 'chorus') {
      const line = bar % 2 ? [c.fifth + 12, c.third + 12, c.root + 12] : [c.third + 24, c.fifth + 12, c.third + 12]
      add(line[0], bar, 0, 1.5, 0.65)
      add(line[1], bar, 1.5, 1, 0.65)
      add(line[2], bar, 2.5, 1.5, 0.65)
    }
  })
  return midi
}

function other() {
  const { midi, add } = newTrack('Pad', 4, 89)
  FORM.forEach((_, bar) => {
    const c = PROGRESSION[bar % 4]
    for (const n of [c.root, c.third, c.fifth]) add(n + 12, bar, 0, 3.9, 0.35)
  })
  return midi
}

const toRef = (name: string, midi: Midi) => ({ name, data: midi.toArray().slice().buffer as ArrayBuffer })

export function createDemoSong(id = 'demo', title = 'Neon Highway'): SongSource {
  const synth: Record<StemId, { name: string; data: ArrayBuffer }> = {
    bass: toRef('bass.mid', bass()),
    drums: toRef('drums.mid', drums()),
    guitar: toRef('guitar.mid', guitar()),
    other: toRef('other.mid', other()),
    piano: toRef('piano.mid', piano()),
    vocals: toRef('vocals.mid', vocals()),
  }
  return {
    id,
    title,
    origin: id === 'demo' ? 'demo' : 'youtube',
    stems: {},
    synth,
    midi: { guitar: synth.guitar, drums: synth.drums, piano: synth.piano },
  }
}
