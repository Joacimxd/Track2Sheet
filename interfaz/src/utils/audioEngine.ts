import * as Tone from 'tone'
import type { LoadedSong, MidiNote, StemId } from '../types'
import { STEM_IDS } from '../types'
import { drumLaneOf, KICK_LANE } from './midiToFretboard'

interface Voice {
  play(note: MidiNote, time: number): void
  dispose(): void
}

const freq = (midi: number) => Tone.Frequency(midi, 'midi').toFrequency()

function polyVoice(synth: Tone.PolySynth, extra: { dispose(): unknown }[] = []): Voice {
  return {
    play: (n, time) => synth.triggerAttackRelease(freq(n.midi), n.duration, time, n.velocity),
    dispose: () => [synth, ...extra].forEach((x) => x.dispose()),
  }
}

function guitarVoice(out: Tone.InputNode): Voice {
  const filter = new Tone.Filter(3200, 'lowpass').connect(out)
  const dist = new Tone.Distortion(0.45).connect(filter)
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 3, spread: 18 },
    envelope: { attack: 0.004, decay: 0.25, sustain: 0.45, release: 0.25 },
    volume: -17,
  }).connect(dist)
  synth.maxPolyphony = 24
  return polyVoice(synth, [dist, filter])
}

function bassVoice(out: Tone.InputNode): Voice {
  const filter = new Tone.Filter(700, 'lowpass').connect(out)
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fmsquare', modulationIndex: 1.2 },
    envelope: { attack: 0.005, decay: 0.2, sustain: 0.6, release: 0.12 },
    volume: -10,
  }).connect(filter)
  return polyVoice(synth, [filter])
}

function pianoVoice(out: Tone.InputNode): Voice {
  const synth = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 2,
    modulationIndex: 3,
    envelope: { attack: 0.002, decay: 0.9, sustain: 0.08, release: 0.6 },
    modulationEnvelope: { attack: 0.002, decay: 0.3, sustain: 0, release: 0.2 },
    volume: -19,
  }).connect(out)
  synth.maxPolyphony = 24
  return polyVoice(synth)
}

function vocalVoice(out: Tone.InputNode): Voice {
  const formant = new Tone.Filter({ type: 'bandpass', frequency: 1100, Q: 1.2 }).connect(out)
  const vibrato = new Tone.Vibrato(5.5, 0.12).connect(formant)
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 2, spread: 10 },
    envelope: { attack: 0.06, decay: 0.2, sustain: 0.8, release: 0.3 },
    volume: -12,
  }).connect(vibrato)
  return polyVoice(synth, [vibrato, formant])
}

function padVoice(out: Tone.InputNode): Voice {
  const filter = new Tone.Filter(1800, 'lowpass').connect(out)
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fattriangle', count: 3, spread: 30 },
    envelope: { attack: 0.35, decay: 0.4, sustain: 0.7, release: 0.8 },
    volume: -20,
  }).connect(filter)
  return polyVoice(synth, [filter])
}

function drumVoice(out: Tone.InputNode): Voice {
  const kick = new Tone.MembraneSynth({ pitchDecay: 0.04, octaves: 6, volume: -4 }).connect(out)
  const tom = new Tone.MembraneSynth({ pitchDecay: 0.08, octaves: 3, volume: -8 }).connect(out)
  const snare = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.16, sustain: 0 }, volume: -10 }).connect(out)
  const hat = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.05, release: 0.01 }, harmonicity: 5.1, resonance: 5000, volume: -26 }).connect(out)
  const crash = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 1.1, release: 0.4 }, harmonicity: 5.1, resonance: 3800, volume: -24 }).connect(out)
  return {
    play: (n, time) => {
      const v = n.velocity
      const lane = drumLaneOf(n.midi)
      if (lane === KICK_LANE) return kick.triggerAttackRelease('C1', 0.2, time, v)
      if (lane === 1) return snare.triggerAttackRelease(0.12, time, v)
      if (lane === 0) return hat.triggerAttackRelease(300, 0.04, time, v)
      if (lane === 2 || lane === 3) return tom.triggerAttackRelease(freq(n.midi - 12), 0.3, time, v)
      return crash.triggerAttackRelease(250, 0.8, time, v)
    },
    dispose: () => [kick, tom, snare, hat, crash].forEach((x) => x.dispose()),
  }
}

const VOICES: Record<StemId, (out: Tone.InputNode) => Voice> = {
  bass: bassVoice,
  drums: drumVoice,
  guitar: guitarVoice,
  other: padVoice,
  piano: pianoVoice,
  vocals: vocalVoice,
}

/**
 * Plays the 6 stems of a song on the Tone.js transport, which is the single master clock for
 * audio *and* the canvas. Every stem is a Player (decoded audio) or a synth (MIDI) synced to the
 * transport and routed through its own Channel (mute + volume) with an analyser for the meters,
 * so all stems start, pause and seek sample-accurately together.
 */
export class AudioEngine {
  readonly channels: Record<StemId, Tone.Channel>
  readonly analysers: Record<StemId, Tone.Analyser>
  private disposables: { dispose(): unknown }[] = []

  constructor() {
    Tone.getContext().lookAhead = 0.05
    this.channels = {} as Record<StemId, Tone.Channel>
    this.analysers = {} as Record<StemId, Tone.Analyser>
    for (const id of STEM_IDS) {
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
    this.disposables.forEach((d) => d.dispose())
    this.disposables = []
    for (const id of STEM_IDS) {
      const stem = song.stems[id]
      if (stem?.buffer) {
        const player = new Tone.Player(new Tone.ToneAudioBuffer(stem.buffer)).connect(this.channels[id])
        player.sync().start(0)
        this.disposables.push(player)
      } else if (stem?.synth?.notes.length) {
        const voice = VOICES[id](this.channels[id])
        const part = new Tone.Part<MidiNote>((time, note) => voice.play(note, time), stem.synth.notes)
        part.start(0)
        this.disposables.push(part, voice)
      }
    }
  }

  /** `volume` is linear 0…1. */
  setMix(id: StemId, muted: boolean, volume: number) {
    const ch = this.channels[id]
    ch.mute = muted
    ch.volume.value = volume <= 0.001 ? -Infinity : Tone.gainToDb(volume)
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
}
