import type { FileRef, LoadedSong, ParsedMidi, SongSource, TrackId } from '../types'
import { parseMidi } from './midiParser'

interface ApiFile {
  name: string
  path: string
}
interface ApiSong {
  id: string
  title: string
  audio: Partial<Record<TrackId, ApiFile[]>>
  midi: Partial<Record<TrackId, ApiFile>>
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
      midi: Object.fromEntries(Object.entries(s.midi).map(([k, f]) => [k, apiRef(f!)])),
      audio: Object.fromEntries(Object.entries(s.audio).map(([k, fs]) => [k, fs!.map(apiRef)])),
    }))
  } catch {
    return []
  }
}

export function classifyFile(name: string): TrackId {
  const n = name.toLowerCase()
  if (/guitar|guitarra/.test(n)) return 'guitar'
  if (/drum|bater[ií]a|percus/.test(n)) return 'drums'
  return 'other'
}

export const isMidiFile = (f: File) => /\.midi?$/i.test(f.name)
export const isAudioFile = (f: File) => f.type.startsWith('audio/') && !isMidiFile(f)

/**
 * Turn files picked by the user into a song. Files are routed by name
 * (guitar/guitarra, drums/batería, anything else -> Voces / Otros); a MIDI with an
 * unrecognised name goes to `fallbackInstrument`.
 */
export function buildLocalSong(files: File[], fallbackInstrument: TrackId): SongSource {
  const song: SongSource = { id: `local:${Date.now()}`, title: '', origin: 'local', midi: {}, audio: {} }
  for (const file of files) {
    const track = classifyFile(file.name)
    if (isMidiFile(file)) song.midi[track === 'other' ? fallbackInstrument : track] = { name: file.name, file }
    else if (isAudioFile(file)) (song.audio[track] ??= []).push({ name: file.name, file })
  }
  const first = files[0]?.name.replace(/\.[^.]+$/, '') ?? 'Canción local'
  song.title = files.length > 1 ? `${first} (+${files.length - 1})` : first
  return song
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

/** Sum several decoded stems into one buffer (stems of a separation add up to the mix). */
function mixBuffers(buffers: AudioBuffer[]): AudioBuffer {
  if (buffers.length === 1) return buffers[0]
  const length = Math.max(...buffers.map((b) => b.length))
  const channels = Math.max(...buffers.map((b) => b.numberOfChannels))
  const out = new AudioBuffer({ numberOfChannels: channels, length, sampleRate: buffers[0].sampleRate })
  for (let ch = 0; ch < channels; ch++) {
    const dst = out.getChannelData(ch)
    for (const b of buffers) {
      const src = b.getChannelData(Math.min(ch, b.numberOfChannels - 1))
      for (let i = 0; i < src.length; i++) dst[i] += src[i]
    }
  }
  return out
}

export async function loadSong(
  source: SongSource,
  decode: (data: ArrayBuffer) => Promise<AudioBuffer>,
  onProgress: (message: string) => void,
): Promise<LoadedSong> {
  const midi: Partial<Record<TrackId, ParsedMidi>> = {}
  for (const [track, ref] of Object.entries(source.midi) as [TrackId, FileRef][]) {
    onProgress(`Leyendo ${ref.name}…`)
    midi[track] = parseMidi(await readRef(ref), ref.name, track)
  }

  const audio: Partial<Record<TrackId, AudioBuffer>> = {}
  for (const [track, refs] of Object.entries(source.audio) as [TrackId, FileRef[]][]) {
    const decoded: AudioBuffer[] = []
    for (const ref of refs) {
      onProgress(`Decodificando ${ref.name}…`)
      decoded.push(await decode(await readRef(ref)))
    }
    if (decoded.length) {
      if (decoded.length > 1) onProgress('Mezclando pistas de acompañamiento…')
      audio[track] = mixBuffers(decoded)
    }
  }

  const duration = Math.max(
    1,
    ...Object.values(audio).map((b) => b!.duration),
    ...Object.values(midi).map((m) => m!.duration + 0.5),
  )
  return { source, midi, audio, duration }
}
