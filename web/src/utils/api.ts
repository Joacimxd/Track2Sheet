import { INSTRUMENT_IDS, type MidiNote, type SongSource } from '../types'
import type { Chord, FretNote, Section } from './midiToFretboard'

const API_URL = ((import.meta.env.VITE_PIPELINE_URL as string | undefined) ?? 'http://127.0.0.1:8765').replace(/\/$/, '')

export interface PipelineStep {
  label: string
  progress: number
}

export const PIPELINE_STEPS = ['Descargando audio de YouTube', 'Separando en 6 stems', 'Transcribiendo .mid (guitarra, piano y batería)', 'Preparando pistas']

export function parseYoutubeId(url: string): string | null {
  return /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/.exec(url.trim())?.[1] ?? null
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new DOMException('Cancelado', 'AbortError'))
    })
  })

interface Job {
  id: string
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
  step: number
  progress: number
  error: string | null
  result: { id: string; title: string; stems: Record<string, string>; midi: Record<string, string> } | null
}

export async function processYoutube(url: string, onStep: (s: PipelineStep) => void, signal?: AbortSignal): Promise<SongSource> {
  if (!parseYoutubeId(url)) throw new Error('El enlace no parece de YouTube (youtube.com/watch?v=… o youtu.be/…).')
  const call = async (path: string, init?: RequestInit) => {
    const res = await fetch(`${API_URL}${path}`, { ...init, signal })
    if (!res.ok) throw new Error(`El pipeline respondió ${res.status}: ${(await res.text()).slice(0, 200)}`)
    return (await res.json()) as Job
  }

  onStep({ label: PIPELINE_STEPS[0], progress: 0 })
  let job = await call('/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })
  const cancel = () => void fetch(`${API_URL}/jobs/${job.id}`, { method: 'DELETE', keepalive: true }).catch(() => {})
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    while (job.status === 'queued' || job.status === 'running') {
      onStep({ label: PIPELINE_STEPS[Math.min(job.step, PIPELINE_STEPS.length - 1)], progress: job.progress })
      await sleep(1500, signal)
      job = await call(`/jobs/${job.id}`)
    }
  } finally {
    signal?.removeEventListener('abort', cancel)
  }
  if (job.status !== 'done' || !job.result) throw new Error(job.error ?? 'El pipeline se canceló')

  onStep({ label: PIPELINE_STEPS[3], progress: 1 })
  const song = job.result
  const ref = (path: string, fallback: string) => ({
    name: path.split('/').pop() || fallback,
    url: `${API_URL}/files/${path.split('/').map(encodeURIComponent).join('/')}`,
  })
  const midi = Object.entries(song.midi).filter(([k]) => (INSTRUMENT_IDS as string[]).includes(k))
  return {
    id: `youtube:${song.id}`,
    title: song.title,
    origin: 'youtube',
    stems: Object.fromEntries(Object.entries(song.stems).map(([k, p]) => [k, ref(p, `${k}.wav`)])),
    midi: Object.fromEntries(midi.map(([k, p]) => [k, ref(p, `${k}.mid`)])),
  }
}

function songFolder(songId: string): string | undefined {
  return /^(?:server|youtube):(.+)$/.exec(songId)?.[1]
}

async function post<T>(path: string, body: object, signal: AbortSignal | undefined, offline: string, failed: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
  } catch (e) {
    if (signal?.aborted) throw e
    throw new Error(offline)
  }
  if (!res.ok) throw new Error(failed.replace('{status}', String(res.status)))
  return (await res.json()) as T
}

export type GuitarPart = 'auto' | 'rhythm'

export interface TabResponse {
  tuning: { id: string; name: string; strings: number[]; labels: string[] }
  solos: Section[]
  parts: Record<GuitarPart, { notes: FretNote[]; chords: Chord[] }>
}

export function fetchTab(notes: MidiNote[], songId: string, signal?: AbortSignal): Promise<TabResponse> {
  return post<TabResponse>(
    '/tab',
    { notes: notes.map(({ time, duration, midi, velocity, program }) => ({ time, duration, midi, velocity, program })), song: songFolder(songId) },
    signal,
    `No se pudo conectar con la API de tablatura (${API_URL}). Arranca todo con docker compose up`,
    'La API de tablatura respondió {status}',
  )
}

export interface PianoNote extends MidiNote {
  id: number
  hand: 0 | 1
}

export function localPiano(notes: MidiNote[]): PianoNote[] {
  return notes.map((n, id) => ({ ...n, id, hand: n.midi < 60 ? 0 : 1 }))
}

export function fetchPiano(notes: MidiNote[], songId: string, signal?: AbortSignal): Promise<{ notes: PianoNote[] }> {
  return post<{ notes: PianoNote[] }>(
    '/piano',
    { notes: notes.map(({ time, duration, midi, velocity }) => ({ time, duration, midi, velocity })), song: songFolder(songId) },
    signal,
    `No se pudo conectar con la API (${API_URL}) para limpiar el piano: se muestran las notas sin procesar.`,
    'La API de piano respondió {status}: se muestran las notas sin procesar.',
  )
}
