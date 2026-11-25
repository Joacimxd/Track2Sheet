import type { FileRef, InstrumentId, LoadedSong, LoadedStem, ParsedMidi, SongSource, StemId } from '../types'
import { STEM_IDS } from '../types'
import { parseMidi } from './midiParser'

interface ApiFile {
  name: string
  path: string
}
interface ApiSong {
  id: string
  title: string
  stems: Partial<Record<StemId, ApiFile>>
  midi: Partial<Record<InstrumentId, ApiFile>>
}

const apiRef = (f: ApiFile): FileRef => ({ name: f.name, url: `/api/file?p=${encodeURIComponent(f.path)}` })

/** Songs found in `output/` by the dev-server API. Returns [] when the app runs without it. */
export async function fetchServerSongs(): Promise<SongSource[]> {
  try {
    const res = await fetch('/api/songs')
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return []
    const { songs } = (await res.json()) as { songs: ApiSong[] }
    return songs.map((s) => ({
      id: `server:${s.id}`,
      title: s.title,
      origin: 'server',
      stems: Object.fromEntries(Object.entries(s.stems).map(([k, f]) => [k, apiRef(f!)])),
      midi: Object.fromEntries(Object.entries(s.midi).map(([k, f]) => [k, apiRef(f!)])),
    }))
  } catch {
    return []
  }
}

export const isMidiFile = (f: File) => /\.midi?$/i.test(f.name)
export const isAudioFile = (f: File) => !isMidiFile(f) && (f.type.startsWith('audio/') || /\.(wav|mp3|flac|ogg|m4a|aac)$/i.test(f.name))

/** Stem a file belongs to, from its name (English model names + Spanish), or null. */
export function stemFromName(name: string): StemId | null {
  const n = name.toLowerCase()
  if (/guitar|guitarra/.test(n)) return 'guitar'
  if (/drum|bater[ií]a|percus/.test(n)) return 'drums'
  if (/bass|bajo/.test(n)) return 'bass'
  if (/piano|keys|teclado/.test(n)) return 'piano'
  if (/vocal|voice|voz|voces/.test(n)) return 'vocals'
  if (/other|otros/.test(n)) return 'other'
  return null
}

export const isInstrument = (id: StemId | null): id is InstrumentId => id === 'guitar' || id === 'drums'

/**
 * Route user files into a song source. Audio goes to the stem named in the file (or `target`, or
 * `other`); a .mid goes to the instrument named in the file (or `target` / `fallbackInstrument`).
 */
export function assignFiles(base: SongSource, files: File[], target: StemId | null, fallbackInstrument: InstrumentId): SongSource {
  const next: SongSource = { ...base, stems: { ...base.stems }, midi: { ...base.midi } }
  for (const file of files) {
    const named = stemFromName(file.name)
    if (isMidiFile(file)) {
      const inst = isInstrument(named) ? named : isInstrument(target) ? target : fallbackInstrument
      next.midi[inst] = { name: file.name, file }
    } else if (isAudioFile(file)) {
      const stem = files.length === 1 && target ? target : (named ?? target ?? 'other')
      next.stems[stem] = { name: file.name, file }
    }
  }
  return next
}

async function readRef(ref: FileRef): Promise<ArrayBuffer> {
  if (ref.data) return ref.data
  if (ref.file) return ref.file.arrayBuffer()
  if (ref.url) {
    const res = await fetch(ref.url)
    if (!res.ok) throw new Error(`No se pudo leer ${ref.name} (${res.status})`)
    return res.arrayBuffer()
  }
  throw new Error(`Archivo sin origen: ${ref.name}`)
}

export async function loadSong(
  source: SongSource,
  decode: (data: ArrayBuffer) => Promise<AudioBuffer>,
  onProgress: (message: string) => void,
): Promise<LoadedSong> {
  const midi: Partial<Record<InstrumentId, ParsedMidi>> = {}
  for (const [inst, ref] of Object.entries(source.midi) as [InstrumentId, FileRef][]) {
    onProgress(`Leyendo ${ref.name}…`)
    midi[inst] = parseMidi(await readRef(ref), ref.name, inst === 'drums')
  }

  const stems: Partial<Record<StemId, LoadedStem>> = {}
  for (const id of STEM_IDS) {
    const audio = source.stems[id]
    if (audio) {
      onProgress(`Decodificando ${audio.name}…`)
      try {
        const buffer = await decode(await readRef(audio))
        stems[id] = { name: audio.name, kind: 'audio', duration: buffer.duration, buffer }
        continue
      } catch (e) {
        throw new Error(`No se pudo decodificar ${audio.name}: ${e instanceof Error ? e.message : e}`)
      }
    }
    const synthRef = source.synth?.[id]
    if (synthRef) {
      const parsed = parseMidi(await readRef(synthRef), synthRef.name, id === 'drums')
      stems[id] = { name: `${id}.wav`, kind: 'synth', duration: parsed.duration + 0.5, synth: parsed }
    }
  }

  const duration = Math.max(1, ...Object.values(stems).map((s) => s!.duration), ...Object.values(midi).map((m) => m!.duration + 0.5))
  return { source, stems, midi, duration }
}
