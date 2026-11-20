/** Instruments the user can practise (each one has its own transcribed .mid). */
export type InstrumentId = 'guitar' | 'drums'

/** Audio tracks of a song: the two instruments plus everything else (vocals, bass, keys…). */
export type TrackId = InstrumentId | 'other'

export const TRACK_IDS: TrackId[] = ['guitar', 'drums', 'other']

export const TRACK_LABEL: Record<TrackId, string> = {
  guitar: 'Guitarra',
  drums: 'Batería',
  other: 'Voces / Otros',
}

export interface MidiNote {
  /** Onset in seconds. */
  time: number
  /** Length in seconds. */
  duration: number
  ticks: number
  durationTicks: number
  midi: number
  velocity: number
  /** Highway lane 0-4. */
  lane: number
}

export interface ParsedMidi {
  fileName: string
  trackName: string
  bpm: number
  ppq: number
  timeSignature: [number, number]
  duration: number
  isPercussion: boolean
  notes: MidiNote[]
  beatTimes: number[]
  measureTimes: number[]
}

/** A file the app can fetch: from the dev-server API, a local File, or bytes in memory. */
export interface FileRef {
  name: string
  url?: string
  file?: File
  data?: ArrayBuffer
}

export interface SongSource {
  id: string
  title: string
  origin: 'demo' | 'server' | 'local'
  midi: Partial<Record<TrackId, FileRef>>
  audio: Partial<Record<TrackId, FileRef[]>>
}

export interface LoadedSong {
  source: SongSource
  midi: Partial<Record<TrackId, ParsedMidi>>
  /** Decoded stems; several files of a track (e.g. vocals + bass + piano) are mixed into one buffer. */
  audio: Partial<Record<TrackId, AudioBuffer>>
  duration: number
}
