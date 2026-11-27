/** The 6 stems produced by the separation model (BS-RoFormer SW). */
export type StemId = 'bass' | 'drums' | 'guitar' | 'other' | 'piano' | 'vocals'

export const STEM_IDS: StemId[] = ['bass', 'drums', 'guitar', 'other', 'piano', 'vocals']

export const STEM_LABEL: Record<StemId, string> = {
  bass: 'Bajo',
  drums: 'Batería',
  guitar: 'Guitarra',
  other: 'Otros',
  piano: 'Piano',
  vocals: 'Voces',
}

/** Lighting-gel colour of each stem (matches the --color-gel-* tokens in index.css). */
export const STEM_GEL: Record<StemId, string> = {
  bass: '#3f8fd2',
  drums: '#e0503a',
  guitar: '#f0b429',
  other: '#9a9fb0',
  piano: '#4fb286',
  vocals: '#d65aa0',
}

/** Short label printed on each gel swatch. */
export const STEM_SHORT: Record<StemId, string> = {
  bass: 'BAJ',
  drums: 'BAT',
  guitar: 'GTR',
  other: 'OTR',
  piano: 'PNO',
  vocals: 'VOZ',
}

/** Instruments the user can practise; each one has its own transcribed .mid. */
export type InstrumentId = 'guitar' | 'drums' | 'piano'

export const INSTRUMENT_IDS: InstrumentId[] = ['guitar', 'drums', 'piano']

export const INSTRUMENT_LABEL: Record<InstrumentId, string> = {
  guitar: 'Guitarra',
  drums: 'Batería',
  piano: 'Piano',
}

export const isInstrument = (id: string | null): id is InstrumentId => (INSTRUMENT_IDS as (string | null)[]).includes(id)

export interface MidiNote {
  /** Onset in seconds. */
  time: number
  /** Length in seconds. */
  duration: number
  midi: number
  velocity: number
  /** MIDI program of the note's track (which guitar / instrument of the song it comes from). */
  program?: number
}

export interface ParsedMidi {
  fileName: string
  trackName: string
  bpm: number
  timeSignature: [number, number]
  duration: number
  isPercussion: boolean
  notes: MidiNote[]
  beatTimes: number[]
  measureTimes: number[]
}

/** A file the app can read: from the dev-server API, a local File, or bytes in memory. */
export interface FileRef {
  name: string
  url?: string
  file?: File
  data?: ArrayBuffer
}

export interface SongSource {
  id: string
  title: string
  origin: 'demo' | 'server' | 'local' | 'youtube'
  /** Separated audio, one file per stem. */
  stems: Partial<Record<StemId, FileRef>>
  /** Transcription of the instrument to practise. */
  midi: Partial<Record<InstrumentId, FileRef>>
  /** MIDI rendered with a synth when a stem has no audio (used by the demo). */
  synth?: Partial<Record<StemId, FileRef>>
}

export interface LoadedStem {
  name: string
  kind: 'audio' | 'synth'
  duration: number
  buffer?: AudioBuffer
  synth?: ParsedMidi
}

export interface LoadedSong {
  source: SongSource
  stems: Partial<Record<StemId, LoadedStem>>
  midi: Partial<Record<InstrumentId, ParsedMidi>>
  duration: number
}
