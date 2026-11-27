import { INSTRUMENT_IDS, type SongSource } from '../types'
import { createDemoSong } from './demoSong'

/**
 * Bridge to the Track2Sheet pipeline (YouTube → 6 stems → .mid of guitar / drums / piano).
 *
 * If `VITE_PIPELINE_URL` is set (e.g. http://127.0.0.1:8000, the FastAPI service in api/), the URL
 * is POSTed to `/jobs`, the job is polled at `/jobs/{id}` until it is done, and the stems and .mid
 * files are loaded from `/files/...`. Aborting cancels the job on the server.
 *
 * Without it the steps are simulated and the demo song is loaded, so the whole UI can be tested.
 */

export interface PipelineStep {
  label: string
  /** 0…1 overall progress. */
  progress: number
}

export const PIPELINE_STEPS = ['Descargando audio de YouTube', 'Separando en 6 stems', 'Transcribiendo .mid (guitarra, piano y batería)', 'Preparando pistas']

const YT_ID = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/

/** Video id of a YouTube link, or null if it is not one. */
export function parseYoutubeId(url: string): string | null {
  return YT_ID.exec(url.trim())?.[1] ?? null
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new DOMException('Cancelado', 'AbortError'))
    })
  })

/** Job as returned by the FastAPI service (api/main.py). File paths are relative to /files. */
interface BackendJob {
  id: string
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
  step: number
  progress: number
  error: string | null
  result: { id: string; title: string; stems: Record<string, string>; midi: Record<string, string> } | null
}

const POLL_MS = 1500
const nameOf = (path: string, fallback: string) => path.split('/').pop() || fallback

async function processWithBackend(base: string, url: string, onStep: (s: PipelineStep) => void, signal?: AbortSignal): Promise<SongSource> {
  const api = base.replace(/\/$/, '')
  const call = async (path: string, init?: RequestInit) => {
    const res = await fetch(`${api}${path}`, { ...init, signal })
    if (!res.ok) throw new Error(`El pipeline respondió ${res.status}: ${(await res.text()).slice(0, 200)}`)
    return (await res.json()) as BackendJob
  }

  onStep({ label: PIPELINE_STEPS[0], progress: 0 })
  let job = await call('/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })
  // Cancelling in the UI also stops the job on the server (keepalive: the page may be closing)
  const cancel = () => void fetch(`${api}/jobs/${job.id}`, { method: 'DELETE', keepalive: true }).catch(() => {})
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    while (job.status === 'queued' || job.status === 'running') {
      onStep({ label: PIPELINE_STEPS[Math.min(job.step, PIPELINE_STEPS.length - 1)], progress: job.progress })
      await sleep(POLL_MS, signal)
      job = await call(`/jobs/${job.id}`)
    }
  } finally {
    signal?.removeEventListener('abort', cancel)
  }
  if (job.status !== 'done' || !job.result) throw new Error(job.error ?? 'El pipeline se canceló')

  onStep({ label: PIPELINE_STEPS[3], progress: 1 })
  const song = job.result
  const file = (path: string) => `${api}/files/${path.split('/').map(encodeURIComponent).join('/')}`
  const midi = Object.entries(song.midi).filter(([k]) => (INSTRUMENT_IDS as string[]).includes(k))
  return {
    id: `youtube:${song.id}`,
    title: song.title,
    origin: 'youtube',
    stems: Object.fromEntries(Object.entries(song.stems).map(([k, p]) => [k, { name: nameOf(p, `${k}.wav`), url: file(p) }])),
    midi: Object.fromEntries(midi.map(([k, p]) => [k, { name: nameOf(p, `${k}.mid`), url: file(p) }])),
  }
}

async function simulate(videoId: string, onStep: (s: PipelineStep) => void, signal?: AbortSignal): Promise<SongSource> {
  const durations = [900, 1600, 1300, 500]
  const total = durations.reduce((a, b) => a + b, 0)
  let done = 0
  for (let i = 0; i < durations.length; i++) {
    const slices = 10
    for (let k = 0; k < slices; k++) {
      await sleep(durations[i] / slices, signal)
      done += durations[i] / slices
      onStep({ label: PIPELINE_STEPS[i], progress: done / total })
    }
  }
  return createDemoSong(`youtube:${videoId}`, `${videoId} (simulado)`)
}

export async function processYoutube(url: string, onStep: (s: PipelineStep) => void, signal?: AbortSignal): Promise<SongSource> {
  const videoId = parseYoutubeId(url)
  if (!videoId) throw new Error('El enlace no parece de YouTube (youtube.com/watch?v=… o youtu.be/…).')
  const backend = import.meta.env.VITE_PIPELINE_URL as string | undefined
  return backend ? processWithBackend(backend, url, onStep, signal) : simulate(videoId, onStep, signal)
}
