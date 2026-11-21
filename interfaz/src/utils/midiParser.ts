import { Midi } from '@tonejs/midi'
import type { MidiNote, ParsedMidi } from '../types'

/**
 * Parse a .mid file with @tonejs/midi. With `percussion = true` drum tracks (channel 10) are
 * preferred; otherwise the pitched tracks are merged. Also builds a beat / bar grid from ticks so
 * tempo changes are respected.
 */
export function parseMidi(data: ArrayBuffer | Uint8Array, fileName: string, percussion: boolean): ParsedMidi {
  const midi = new Midi(data)
  const header = midi.header
  const withNotes = midi.tracks.filter((t) => t.notes.length > 0)
  const drumTracks = withNotes.filter((t) => t.channel === 9 || t.instrument.percussion)
  const pitched = withNotes.filter((t) => !drumTracks.includes(t))

  let chosen = withNotes
  if (percussion && drumTracks.length) chosen = drumTracks
  else if (!percussion && pitched.length) chosen = pitched

  const notes: MidiNote[] = chosen
    .flatMap((t) => t.notes)
    .map((n) => ({ time: n.time, duration: n.duration, midi: n.midi, velocity: n.velocity }))
    .sort((a, b) => a.time - b.time || a.midi - b.midi)

  const bpm = header.tempos[0]?.bpm ?? 120
  const ts = header.timeSignatures[0]?.timeSignature ?? [4, 4]
  const timeSignature: [number, number] = [ts[0] ?? 4, ts[1] ?? 4]
  const duration = Math.max(midi.duration, ...notes.map((n) => n.time + n.duration), 0)

  const beatTicks = (header.ppq * 4) / timeSignature[1]
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
    timeSignature,
    duration,
    isPercussion: percussion || (chosen.length > 0 && chosen.every((t) => drumTracks.includes(t))),
    notes,
    beatTimes,
    measureTimes,
  }
}
