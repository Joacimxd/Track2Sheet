import { useRef } from 'react'
import { ChevronDown, Pause, Play, SkipBack } from 'lucide-react'
import type { InstrumentId, SongSource } from '../types'
import { INSTRUMENT_IDS, INSTRUMENT_LABEL, STEM_GEL } from '../types'
import { formatTime } from '../utils/format'

interface Props {
  songs: SongSource[]
  currentId: string
  onSelectSong: (id: string) => void
  instrument: InstrumentId
  onSelectInstrument: (id: InstrumentId) => void
  hasMidi: Record<InstrumentId, boolean>
  time: number
  duration: number
  onSeek: (t: number) => void
  playing: boolean
  disabled: boolean
  onTogglePlay: () => void
  onRestart: () => void
}

const ORIGIN_LABEL: Record<SongSource['origin'], string> = { demo: 'Demo', server: 'Procesada', local: 'Local', youtube: 'YouTube' }

/** Top bar: song, instrument to practise, transport and the single song position. */
export function PlayerBar(p: Props) {
  const barRef = useRef<HTMLDivElement>(null)
  const progress = p.duration > 0 ? Math.min(1, p.time / p.duration) : 0
  const gel = STEM_GEL[p.instrument]

  const seekFromPointer = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect()
    if (!rect || !p.duration) return
    p.onSeek(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * p.duration)
  }

  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-rule bg-panel px-5 py-3">
      {/* Transport */}
      <div className="flex items-center gap-2">
        <button
          onClick={p.onRestart}
          disabled={p.disabled}
          aria-label="Reiniciar"
          title="Volver a 00:00"
          className="flex h-10 w-10 items-center justify-center rounded-md text-ink-2 transition hover:bg-control hover:text-ink active:scale-95 disabled:opacity-40"
        >
          <SkipBack className="h-5 w-5 fill-current" />
        </button>
        <button
          onClick={p.onTogglePlay}
          disabled={p.disabled}
          aria-label={p.playing ? 'Pausa' : 'Play'}
          title={p.playing ? 'Pausa (Espacio)' : 'Play (Espacio)'}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-ink text-stage transition hover:bg-white active:scale-95 disabled:opacity-40"
        >
          {p.playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="ml-0.5 h-5 w-5 fill-current" />}
        </button>
      </div>

      {/* Position */}
      <div className="flex min-w-[260px] flex-1 items-center gap-3">
        <span className="w-12 text-right font-cond text-xl font-semibold text-ink">{formatTime(p.time)}</span>
        <div
          ref={barRef}
          role="slider"
          tabIndex={0}
          aria-label="Posición de la canción"
          aria-valuemin={0}
          aria-valuemax={Math.round(p.duration)}
          aria-valuenow={Math.round(p.time)}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            seekFromPointer(e.clientX)
          }}
          onPointerMove={(e) => e.buttons === 1 && seekFromPointer(e.clientX)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') p.onSeek(p.time + 5)
            if (e.key === 'ArrowLeft') p.onSeek(p.time - 5)
          }}
          className="group relative flex h-5 flex-1 cursor-pointer items-center outline-none"
        >
          <div className="h-1.5 w-full rounded-full bg-control">
            <div className="h-full rounded-full transition-[background-color] duration-200" style={{ width: `${progress * 100}%`, backgroundColor: gel }} />
          </div>
          <div
            className="absolute h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-ink shadow-[0_1px_4px_rgba(0,0,0,0.6)] opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100"
            style={{ left: `${progress * 100}%` }}
          />
        </div>
        <span className="w-12 font-cond text-xl font-semibold text-ink-3">{formatTime(p.duration)}</span>
      </div>

      {/* Song */}
      <label className="relative flex min-w-0 items-center gap-2">
        <span className="text-sm font-medium text-ink-3">Canción</span>
        <select
          value={p.currentId}
          onChange={(e) => p.onSelectSong(e.target.value)}
          className="h-9 max-w-[260px] min-w-0 cursor-pointer appearance-none rounded-md border border-rule bg-control pr-8 pl-2.5 text-sm font-medium text-ink transition hover:border-ink-3"
        >
          {p.songs.map((s) => (
            <option key={s.id} value={s.id}>
              {ORIGIN_LABEL[s.origin]} · {s.title}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden className="pointer-events-none absolute right-2.5 h-4 w-4 text-ink-3" />
      </label>

      {/* Instrument to practise */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-ink-3">Toco</span>
        <div className="flex rounded-md bg-control p-0.5" role="radiogroup" aria-label="Instrumento a practicar">
          {INSTRUMENT_IDS.map((id) => {
            const selected = id === p.instrument
            return (
              <button
                key={id}
                role="radio"
                aria-checked={selected}
                onClick={() => p.onSelectInstrument(id)}
                title={p.hasMidi[id] ? `Practicar ${INSTRUMENT_LABEL[id].toLowerCase()} (su pista se silencia)` : `${INSTRUMENT_LABEL[id]}: sin .mid cargado`}
                style={selected ? { backgroundColor: STEM_GEL[id] } : undefined}
                className={`h-8 rounded px-3.5 text-sm font-semibold transition-colors duration-200 ${
                  selected ? 'text-[#111214]' : 'text-ink-2 hover:text-ink'
                } ${p.hasMidi[id] ? '' : 'opacity-60'}`}
              >
                {INSTRUMENT_LABEL[id]}
              </button>
            )
          })}
        </div>
      </div>
    </header>
  )
}
