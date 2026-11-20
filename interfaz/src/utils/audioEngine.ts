import * as Tone from 'tone'
import type { LoadedSong, MidiNote, TrackId } from '../types'
import { TRACK_IDS } from '../types'
import { drumLane } from './midiParser'

interface Voice {
  play(note: MidiNote, time: number): void
  dispose(): void
}

function guitarVoice(out: Tone.InputNode): Voice {
  const filter = new Tone.Filter(3200, 'lowpass').connect(out)
  const dist = new Tone.Distortion(0.45).connect(filter)
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 3, spread: 18 },
    envelope: { attack: 0.004, decay: 0.25, sustain: 0.45, release: 0.25 },
    volume: -16,
  }).connect(dist)
  synth.maxPolyphony = 24
  return {
    play: (n, time) => synth.triggerAttackRelease(Tone.Frequency(n.midi, 'midi').toFrequency(), n.duration, time, n.velocity),
    dispose: () => [synth, dist, filter].forEach((x) => x.dispose()),
  }
}

function backingVoice(out: Tone.InputNode): Voice {
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.02, decay: 0.3, sustain: 0.5, release: 0.4 },
    volume: -14,
  }).connect(out)
  synth.maxPolyphony = 32
  return {
    play: (n, time) => synth.triggerAttackRelease(Tone.Frequency(n.midi, 'midi').toFrequency(), n.duration, time, n.velocity),
    dispose: () => synth.dispose(),
  }
}

function drumVoice(out: Tone.InputNode): Voice {
  const kick = new Tone.MembraneSynth({ pitchDecay: 0.04, octaves: 6, volume: -4 }).connect(out)
  const tom = new Tone.MembraneSynth({ pitchDecay: 0.08, octaves: 3, volume: -8 }).connect(out)
  const snare = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.16, sustain: 0 },
    volume: -10,
  }).connect(out)
  const hat = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.05, release: 0.01 },
    harmonicity: 5.1,
    resonance: 5000,
    volume: -26,
  }).connect(out)
  const crash = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 1.1, release: 0.4 },
    harmonicity: 5.1,
    resonance: 3800,
    volume: -24,
  }).connect(out)
  return {
    play: (n, time) => {
      const v = n.velocity
      switch (drumLane(n.midi)) {
        case 0:
          return kick.triggerAttackRelease('C1', 0.2, time, v)
        case 1:
          return snare.triggerAttackRelease(0.12, time, v)
        case 2:
          return hat.triggerAttackRelease(300, 0.04, time, v)
        case 3:
          return tom.triggerAttackRelease(Tone.Frequency(n.midi - 12, 'midi').toFrequency(), 0.3, time, v)
        default:
          return crash.triggerAttackRelease(250, 0.8, time, v)
      }
    },
    dispose: () => [kick, tom, snare, hat, crash].forEach((x) => x.dispose()),
  }
}

/**
 * Plays a loaded song on the Tone.js transport. Every track goes through its own Channel so it
 * can be muted independently; tracks with a decoded stem play the audio, tracks with only a MIDI
 * file are rendered by a synth. The transport is the master clock for the whole UI.
 */
export class AudioEngine {
  readonly channels: Record<TrackId, Tone.Channel>
  readonly analysers: Record<TrackId, Tone.Analyser>
  private disposables: { dispose(): unknown }[] = []

  constructor() {
    Tone.getContext().lookAhead = 0.05
    this.channels = {} as Record<TrackId, Tone.Channel>
    this.analysers = {} as Record<TrackId, Tone.Analyser>
    for (const id of TRACK_IDS) {
      const analyser = new Tone.Analyser('fft', 32)
      this.channels[id] = new Tone.Channel().toDestination()
      this.channels[id].connect(analyser)
      this.analysers[id] = analyser
    }
  }

  get transport() {
    return Tone.getTransport()
  }

  decode = (data: ArrayBuffer) => Tone.getContext().decodeAudioData(data)

  load(song: LoadedSong) {
    this.stop()
    this.clear()
    for (const id of TRACK_IDS) {
      const buffer = song.audio[id]
      if (buffer) {
        const player = new Tone.Player(new Tone.ToneAudioBuffer(buffer)).connect(this.channels[id])
        player.sync().start(0)
        this.disposables.push(player)
        continue
      }
      const midi = song.midi[id]
      if (!midi?.notes.length) continue
      const voice = id === 'guitar' ? guitarVoice(this.channels[id]) : id === 'drums' ? drumVoice(this.channels[id]) : backingVoice(this.channels[id])
      const part = new Tone.Part<MidiNote>((time, note) => voice.play(note, time), midi.notes)
      part.start(0)
      this.disposables.push(part, voice)
    }
  }

  setMuted(id: TrackId, muted: boolean) {
    this.channels[id].mute = muted
  }

  /** Audible position in seconds (transport time minus the scheduling look-ahead). */
  getTime(): number {
    const t = this.transport
    if (t.state !== 'started') return t.seconds
    return Math.max(0, t.seconds - Tone.getContext().lookAhead)
  }

  get playing() {
    return this.transport.state === 'started'
  }

  async play() {
    await Tone.start()
    this.transport.start()
  }

  pause() {
    this.transport.pause()
  }

  stop() {
    this.transport.stop()
    this.transport.seconds = 0
  }

  seek(seconds: number) {
    this.transport.seconds = Math.max(0, seconds)
  }

  private clear() {
    this.disposables.forEach((d) => d.dispose())
    this.disposables = []
  }
}
