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

/** Reference tempo of the transport at 1x; the speed control scales it. */
const BASE_BPM = 120
/** Fine tick resolution so the song position (derived from ticks) moves smoothly. */
const PPQ = 960

export const MIN_RATE = 0.5
export const MAX_RATE = 1.5

/** A decoded stem: a Player for 1x (full quality) and a GrainPlayer for other speeds (keeps pitch). */
interface AudioStem {
  player: Tone.Player
  grain: Tone.GrainPlayer
}

/**
 * Plays the 6 stems of a song against the Tone.js transport, which is the single master clock for
 * audio *and* the canvas. Synth stems are Parts on the transport; decoded stems are started and
 * stopped together with it. Every stem goes through its own Channel (mute + volume) with an
 * analyser for the meters.
 *
 * Speed: the song position is derived from transport *ticks* at BASE_BPM, so scaling the
 * transport tempo slows the clock, the synths and the highway together, while decoded audio
 * switches to a pitch-preserving GrainPlayer at the same rate.
 */
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
    // Part times (seconds) are converted to ticks at the current tempo: build them at 1x.
    this.transport.bpm.cancelScheduledValues(0)
    this.transport.bpm.value = BASE_BPM
    for (const id of STEM_IDS) {
      const stem = song.stems[id]
      if (stem?.buffer) {
        const buffer = new Tone.ToneAudioBuffer(stem.buffer)
        const player = new Tone.Player(buffer).connect(this.channels[id])
        // Short grains keep slowed audio within ~0.1 s of the highway at 50% (~0.03 s at 75%);
        // Tone's default 0.2 s grains let sounds arrive up to 0.3 s early.
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

  /** `volume` is linear 0…1. */
  setMix(id: StemId, muted: boolean, volume: number) {
    // Tone's `mute` works by setting the volume to -Infinity, so writing the volume afterwards
    // silently un-muted the channel. Drive the gain directly instead.
    this.channels[id].volume.value = muted || volume <= 0.001 ? -Infinity : Tone.gainToDb(volume)
  }

  private songSeconds(ticks: number) {
    return (ticks / PPQ) * (60 / BASE_BPM)
  }

  /** Audible song position in seconds (independent of the speed). */
  getTime(): number {
    const t = this.transport
    const ticks = t.state === 'started' ? t.getTicksAtTime(Tone.getContext().currentTime) : t.ticks
    return Math.max(0, this.songSeconds(ticks))
  }

  get playing() {
    return this.transport.state === 'started'
  }

  /**
   * Start the decoded stems at context time `time` from song position `offset` (default: where the
   * transport is at `time`). Callers that just moved the transport must pass `offset` explicitly:
   * Tone applies a position change a fraction of a tick later, so asking the transport right away
   * returns the *old* position and the audio would keep playing from there.
   */
  private startAudio(time: number, offset = this.songSeconds(this.transport.getTicksAtTime(time))) {
    for (const a of this.audio) {
      if (offset >= a.player.buffer.duration) continue
      if (this._rate === 1) {
        a.player.start(time, offset)
      } else {
        a.grain.playbackRate = this._rate
        // Tone 15's GrainPlayer starts at `offset × playbackRate` (its clock runs at
        // rate / grainSize but start() converts the offset with grainSize alone), so pre-divide.
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

  /** Playback speed for every track (1 = original). Pitch is kept. */
  setRate(rate: number) {
    const r = Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(rate * 100) / 100))
    if (r === this._rate) return
    const t = Tone.now()
    const at = this.songSeconds(this.transport.getTicksAtTime(t)) // before the tempo changes
    if (this.playing) this.stopAudio(t)
    this._rate = r
    this.transport.bpm.setValueAtTime(BASE_BPM * r, t)
    if (this.playing) this.startAudio(t, at)
  }
}
