import type { SongSource } from '../types'
import { createDemoSong } from './demoSong'

/**
 * Bridge to the Track2Sheet pipeline (YouTube → 6 stems → .mid of guitar / drums).
 *
 * If `VITE_PIPELINE_URL` is set, the URL is POSTed to `${VITE_PIPELINE_URL}/process` and the
 * backend must answer with:
 *
 *   { "id": "...", "title": "...",
 *     "stems": { "bass": "<url>", "drums": "<url>", "guitar": "<url>", "other": "<url>", "piano": "<url>", "vocals": "<url>" },
 *     "midi":  { "guitar": "<url>", "drums": "<url>" } }
 *
 * Without it the steps are simulated and the demo song is loaded, so the whole UI can be tested.
 */

export interface PipelineStep {
  label: string
  /** 0…1 overall progress. */
  progress: number
}

export const PIPELINE_STEPS = ['Descargando audio de YouTube', 'Separando en 6 stems', 'Transcribiendo .mid (guitarra y batería)', 'Preparando pistas']

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

interface BackendSong {
  id: string
  title: string
  stems: Record<string, string>
  midi: Record<string, string>
}

const nameOf = (url: string, fallback: string) => decodeURIComponent(url.split('/').pop()?.split('?')[0] || fallback)

async function processWithBackend(base: string, url: string, onStep: (s: PipelineStep) => void, signal?: AbortSignal): Promise<SongSource> {
  onStep({ label: PIPELINE_STEPS[0], progress: 0.05 })
  const res = await fetch(`${base.replace(/\/$/, '')}/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    signal,
  })
  if (!res.ok) throw new Error(`El pipeline respondió ${res.status}`)
  const song = (await res.json()) as BackendSong
  onStep({ label: PIPELINE_STEPS[3], progress: 0.95 })
  return {
    id: `youtube:${song.id}`,
    title: song.title,
    origin: 'youtube',
    stems: Object.fromEntries(Object.entries(song.stems).map(([k, u]) => [k, { name: nameOf(u, `${k}.wav`), url: u }])),
    midi: Object.fromEntries(Object.entries(song.midi).map(([k, u]) => [k, { name: nameOf(u, `${k}.mid`), url: u }])),
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
  return createDemoSong(`youtube:${videoId}`, `YouTube · ${videoId} (simulado)`)
}

export async function processYoutube(url: string, onStep: (s: PipelineStep) => void, signal?: AbortSignal): Promise<SongSource> {
  const videoId = parseYoutubeId(url)
  if (!videoId) throw new Error('El enlace no parece de YouTube (youtube.com/watch?v=… o youtu.be/…).')
  const backend = import.meta.env.VITE_PIPELINE_URL as string | undefined
  return backend ? processWithBackend(backend, url, onStep, signal) : simulate(videoId, onStep, signal)
}
