import type { MidiNote } from '../types'
import type { Chord, FretNote, Section } from './midiToFretboard'

/**
 * Guitar tablature from the Python API (api/tab/, `POST /tab`): tuning detection, cleanup,
 * lead/rhythm split and the global fingering all run there. The interface only draws the result.
 */

export type GuitarPart = 'auto' | 'rhythm'

export interface TabResponse {
  tuning: { id: string; name: string; strings: number[]; labels: string[] }
  solos: Section[]
  parts: Record<GuitarPart, { notes: FretNote[]; chords: Chord[] }>
}

export const API_URL = ((import.meta.env.VITE_PIPELINE_URL as string | undefined) ?? 'http://127.0.0.1:8765').replace(/\/$/, '')

/** Song folder in output/ for songs that came from there, so the API can use the guitar stem. */
export function songFolder(songId: string): string | undefined {
  const m = /^(?:server|youtube):(.+)$/.exec(songId)
  return m?.[1]
}

export async function fetchTab(notes: MidiNote[], songId: string, signal?: AbortSignal): Promise<TabResponse> {
  let res: Response
  try {
    res = await fetch(`${API_URL}/tab`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notes: notes.map(({ time, duration, midi, velocity, program }) => ({ time, duration, midi, velocity, program })),
        song: songFolder(songId),
      }),
      signal,
    })
  } catch (e) {
    if (signal?.aborted) throw e
    throw new Error(`No se pudo conectar con la API de tablatura (${API_URL}). Arráncala con ./dev.sh`)
  }
  if (!res.ok) throw new Error(`La API de tablatura respondió ${res.status}`)
  return (await res.json()) as TabResponse
}
