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

export const STEM_GEL: Record<StemId, string> = {
  bass: '#3f8fd2',
  drums: '#e0503a',
  guitar: '#f0b429',
  other: '#9a9fb0',
  piano: '#4fb286',
  vocals: '#d65aa0',
}

export const STEM_SHORT: Record<StemId, string> = {
  bass: 'BAJ',
  drums: 'BAT',
  guitar: 'GTR',
  other: 'OTR',
  piano: 'PNO',
  vocals: 'VOZ',
}

export type InstrumentId = 'guitar' | 'drums' | 'piano'

export const INSTRUMENT_IDS: InstrumentId[] = ['guitar', 'drums', 'piano']

export const INSTRUMENT_LABEL: Record<InstrumentId, string> = {
  guitar: 'Guitarra',
  drums: 'Batería',
  piano: 'Piano',
}

export const isInstrument = (id: string | null): id is InstrumentId => (INSTRUMENT_IDS as (string | null)[]).includes(id)

export interface MidiNote {
  time: number
  duration: number
  midi: number
  velocity: number
  program?: number
}

export interface ParsedMidi {
  fileName: string
  bpm: number
  timeSignature: [number, number]
  duration: number
  notes: MidiNote[]
  beatTimes: number[]
  measureTimes: number[]
}

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
  stems: Partial<Record<StemId, FileRef>>
  midi: Partial<Record<InstrumentId, FileRef>>
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
