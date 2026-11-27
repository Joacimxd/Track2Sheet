import type { MidiNote } from '../types'
import { API_URL, songFolder } from './tabApi'

/**
 * Piano notes from the Python API (api/piano.py, `POST /piano`): drops what the guitar / vocals
 * stems explain better (MuScriptor bleed), merges chopped notes, measures loudness on the piano
 * stem and gives every note a hand. The interface only draws the result.
 */

export interface PianoNote extends MidiNote {
  id: number
  /** 0 = left hand, 1 = right hand. */
  hand: 0 | 1
}

export interface PianoResponse {
  notes: PianoNote[]
  /** Lowest and highest MIDI pitch played. */
  range: [number, number]
  removed: { bleed: number; fragments: number }
}

const MIDDLE_C = 60

/** Without the API: the raw notes, split at middle C. */
export function localPiano(notes: MidiNote[]): PianoNote[] {
  return notes.map((n, id) => ({ ...n, id, hand: n.midi < MIDDLE_C ? 0 : 1 }))
}

export async function fetchPiano(notes: MidiNote[], songId: string, signal?: AbortSignal): Promise<PianoResponse> {
  let res: Response
  try {
    res = await fetch(`${API_URL}/piano`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notes: notes.map(({ time, duration, midi, velocity }) => ({ time, duration, midi, velocity })),
        song: songFolder(songId),
      }),
      signal,
    })
  } catch (e) {
    if (signal?.aborted) throw e
    throw new Error(`No se pudo conectar con la API (${API_URL}) para limpiar el piano: se muestran las notas sin procesar.`)
  }
  if (!res.ok) throw new Error(`La API de piano respondió ${res.status}: se muestran las notas sin procesar.`)
  return (await res.json()) as PianoResponse
}
