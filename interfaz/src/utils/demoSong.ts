import { Midi } from '@tonejs/midi'
import type { SongSource } from '../types'

// A short rock tune (Em – C – G – D at 112 BPM) generated as real .mid bytes so the demo goes
// through exactly the same parser / synth path as a transcribed song.

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

function newMidi(): Midi {
  const midi = new Midi()
  midi.header.setTempo(BPM)
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4] })
  midi.header.update()
  return midi
}

const beat = (b: number) => Math.round(b * PPQ)

function guitarMidi(): Midi {
  const midi = newMidi()
  const track = midi.addTrack()
  track.name = 'Guitarra'
  track.instrument.number = 29 // overdriven guitar
  const add = (midiNote: number, bar: number, at: number, len: number, velocity = 0.85) =>
    track.addNote({ midi: midiNote, ticks: bar * BAR + beat(at), durationTicks: beat(len), velocity })

  FORM.forEach((section, bar) => {
    const c = PROGRESSION[bar % 4]
    const oct = c.root + 12
    if (section === 'intro') {
      add(c.root, bar, 0, 2)
      add(c.fifth, bar, 2, 2)
    } else if (section === 'verse') {
      const riff = [c.root, c.fifth, oct, c.fifth, c.third + 12, c.fifth, oct, c.fifth]
      riff.forEach((n, i) => add(n, bar, i * 0.5, 0.45, i % 2 ? 0.7 : 0.9))
    } else if (section === 'chorus') {
      add(oct, bar, 0, 1.5)
      add(c.third + 12, bar, 1.5, 0.5)
      add(c.fifth + 12, bar, 2, 1)
      add(bar % 2 ? oct + 2 : c.fifth, bar, 3, 0.5)
      add(c.third + 12, bar, 3.5, 0.5)
    } else {
      add(c.root, bar, 0, 4)
    }
  })
  return midi
}

function drumsMidi(): Midi {
  const midi = newMidi()
  const track = midi.addTrack()
  track.name = 'Batería'
  track.channel = 9
  const hit = (n: number, bar: number, at: number, velocity = 0.85) =>
    track.addNote({ midi: n, ticks: bar * BAR + beat(at), durationTicks: beat(0.25), velocity })

  FORM.forEach((section, bar) => {
    const sectionStart = bar === 0 || FORM[bar - 1] !== section
    const fill = FORM[bar + 1] !== undefined && FORM[bar + 1] !== section
    if (sectionStart && section !== 'intro') hit(49, bar, 0, 1)

    if (section === 'intro') {
      for (let b = 0; b < 4; b++) hit(42, bar, b, 0.6)
      hit(36, bar, 0)
      if (bar % 2 === 1) hit(38, bar, 3, 0.6)
    } else if (section === 'outro') {
      hit(36, bar, 0)
      hit(49, bar, 0, 1)
    } else {
      const hats = section === 'chorus' ? 51 : 42
      for (let e = 0; e < 8; e++) if (!(fill && e >= 4)) hit(hats, bar, e * 0.5, e % 2 ? 0.55 : 0.75)
      hit(36, bar, 0)
      hit(36, bar, 2.5)
      if (section === 'chorus') hit(36, bar, 2)
      hit(38, bar, 1)
      if (fill) {
        ;[48, 48, 47, 47, 45, 45, 43, 43].forEach((t, i) => hit(t, bar, 2 + i * 0.25, 0.8))
      } else {
        hit(38, bar, 3)
      }
    }
  })
  return midi
}

function backingMidi(): Midi {
  const midi = newMidi()
  const bass = midi.addTrack()
  bass.name = 'Bajo'
  bass.instrument.number = 33
  const pad = midi.addTrack()
  pad.name = 'Pad'
  pad.channel = 1
  pad.instrument.number = 89
  const voice = midi.addTrack()
  voice.name = 'Voz'
  voice.channel = 2
  voice.instrument.number = 52

  FORM.forEach((section, bar) => {
    const c = PROGRESSION[bar % 4]
    const t0 = bar * BAR
    const root = c.root - 12
    if (section === 'intro' || section === 'outro') {
      bass.addNote({ midi: root, ticks: t0, durationTicks: BAR, velocity: 0.8 })
    } else {
      for (let e = 0; e < 8; e++)
        bass.addNote({ midi: e === 7 ? root + 7 : root, ticks: t0 + beat(e * 0.5), durationTicks: beat(0.45), velocity: 0.8 })
    }
    for (const n of [c.root + 12, c.third + 12, c.fifth + 12])
      pad.addNote({ midi: n, ticks: t0, durationTicks: BAR - beat(0.1), velocity: 0.35 })

    if (section === 'chorus') {
      const line = bar % 2 ? [c.fifth + 12, c.third + 12, c.root + 12] : [c.third + 24, c.fifth + 12, c.third + 12]
      voice.addNote({ midi: line[0], ticks: t0, durationTicks: beat(1.5), velocity: 0.6 })
      voice.addNote({ midi: line[1], ticks: t0 + beat(1.5), durationTicks: beat(1), velocity: 0.6 })
      voice.addNote({ midi: line[2], ticks: t0 + beat(2.5), durationTicks: beat(1.5), velocity: 0.6 })
    }
  })
  return midi
}

const toBuffer = (midi: Midi): ArrayBuffer => midi.toArray().slice().buffer

export function createDemoSong(): SongSource {
  return {
    id: 'demo',
    title: 'Demo — Neon Highway',
    origin: 'demo',
    midi: {
      guitar: { name: 'Demo_Guitarra.mid', data: toBuffer(guitarMidi()) },
      drums: { name: 'Demo_Bateria.mid', data: toBuffer(drumsMidi()) },
      other: { name: 'Demo_Acompanamiento.mid', data: toBuffer(backingMidi()) },
    },
    audio: {},
  }
}
