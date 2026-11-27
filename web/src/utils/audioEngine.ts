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

const BASE_BPM = 120
const PPQ = 960

export const MIN_RATE = 0.5
export const MAX_RATE = 1.5

interface AudioStem {
  player: Tone.Player
  grain: Tone.GrainPlayer
}

export class AudioEngine {
  readonly channels: Record<StemId, Tone.Channel>
  readonly analysers: Record<StemId, Tone.Analyser>
  private disposables: { dispose(): unknown }[] = []
  private audio: AudioStem[] = []
  private _rate = 1

  constructor() {
    Tone.getContext().lookAhead = 0.05
    this.transport.PPQ = PPQ
    this.transport.bpm.value = BASE_BPM
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

  get rate() {
    return this._rate
  }

  decode = (data: ArrayBuffer) => Tone.getContext().decodeAudioData(data)

  load(song: LoadedSong) {
    this.stop()
    this.disposables.forEach((d) => d.dispose())
    this.disposables = []
    this.audio = []
    this.transport.bpm.cancelScheduledValues(0)
    this.transport.bpm.value = BASE_BPM
    for (const id of STEM_IDS) {
      const stem = song.stems[id]
      if (stem?.buffer) {
        const buffer = new Tone.ToneAudioBuffer(stem.buffer)
        const player = new Tone.Player(buffer).connect(this.channels[id])
        const grain = new Tone.GrainPlayer({ url: buffer, grainSize: 0.08, overlap: 0.04 }).connect(this.channels[id])
        this.audio.push({ player, grain })
        this.disposables.push(player, grain)
      } else if (stem?.synth?.notes.length) {
        const voice = VOICES[id](this.channels[id])
        const part = new Tone.Part<MidiNote>(
          (time, note) => voice.play(this._rate === 1 ? note : { ...note, duration: note.duration / this._rate }, time),
          stem.synth.notes,
        )
        part.start(0)
        this.disposables.push(part, voice)
      }
    }
    this.transport.bpm.value = BASE_BPM * this._rate
  }

  setMix(id: StemId, muted: boolean, volume: number) {
    this.channels[id].volume.value = muted || volume <= 0.001 ? -Infinity : Tone.gainToDb(volume)
  }

  private songSeconds(ticks: number) {
    return (ticks / PPQ) * (60 / BASE_BPM)
  }

  getTime(): number {
    const t = this.transport
    const ticks = t.state === 'started' ? t.getTicksAtTime(Tone.getContext().currentTime) : t.ticks
    return Math.max(0, this.songSeconds(ticks))
  }

  get playing() {
    return this.transport.state === 'started'
  }

  private startAudio(time: number, offset = this.songSeconds(this.transport.getTicksAtTime(time))) {
    for (const a of this.audio) {
      if (offset >= a.player.buffer.duration) continue
      if (this._rate === 1) {
        a.player.start(time, offset)
      } else {
        a.grain.playbackRate = this._rate
        a.grain.start(time, offset / this._rate)
      }
    }
  }

  private stopAudio(time: number) {
    for (const a of this.audio) {
      a.player.stop(time)
      a.grain.stop(time)
    }
  }

  async play() {
    await Tone.start()
    const t = Tone.now()
    this.transport.start(t)
    this.startAudio(t)
  }

  pause() {
    const t = Tone.now()
    this.transport.pause(t)
    this.stopAudio(t)
  }

  stop() {
    this.transport.stop()
    this.stopAudio(Tone.now())
    this.transport.ticks = 0
  }

  seek(seconds: number) {
    const s = Math.max(0, seconds)
    this.transport.ticks = Math.round((s * BASE_BPM * PPQ) / 60)
    if (this.playing) {
      const t = Tone.now()
      this.stopAudio(t)
      this.startAudio(t, s)
    }
  }

  setRate(rate: number) {
    const r = Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(rate * 100) / 100))
    if (r === this._rate) return
    const t = Tone.now()
    const at = this.songSeconds(this.transport.getTicksAtTime(t))
    if (this.playing) this.stopAudio(t)
    this._rate = r
    this.transport.bpm.setValueAtTime(BASE_BPM * r, t)
    if (this.playing) this.startAudio(t, at)
  }
}
