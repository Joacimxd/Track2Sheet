import type * as Tone from 'tone'
import { Drum, Mic2, Volume2, VolumeX } from 'lucide-react'
import type { InstrumentId, TrackId } from '../types'
import { TRACK_IDS, TRACK_LABEL } from '../types'
import { DrumKitArt, GuitarArt } from './InstrumentArt'
import { WaveVisualizer } from './WaveVisualizer'

interface Props {
  instrument: InstrumentId
  onSelectInstrument: (id: InstrumentId) => void
  muted: Record<TrackId, boolean>
  onToggleMute: (id: TrackId) => void
  analysers: Record<TrackId, Tone.Analyser>
  playing: boolean
  /** Tracks with a .mid file / with something audible (stem or MIDI to synthesize). */
  hasMidi: Partial<Record<TrackId, boolean>>
  hasSound: Partial<Record<TrackId, boolean>>
}

const INSTRUMENTS: InstrumentId[] = ['guitar', 'drums']

function Art({ id, className }: { id: InstrumentId; className?: string }) {
  return id === 'guitar' ? <GuitarArt className={className} /> : <DrumKitArt className={className} />
}

export function LeftPanel({ instrument, onSelectInstrument, muted, onToggleMute, analysers, playing, hasMidi, hasSound }: Props) {
  const other = INSTRUMENTS.find((i) => i !== instrument)!
  const accompaniment = TRACK_IDS.filter((t) => t !== instrument)

  return (
    <aside className="flex min-h-0 flex-col gap-3">
      {/* Selected instrument */}
      <section className="panel flex flex-col items-center gap-2 px-3 py-4">
        <div className="relative">
          <div className="absolute inset-2 rounded-full bg-cyan-400/10 blur-xl" />
          <Art id={instrument} className="relative h-28 w-28 drop-shadow-[0_0_12px_rgba(56,214,255,0.35)] xl:h-32 xl:w-32" />
          <span className="absolute -right-3 bottom-2 flex h-9 w-9 items-center justify-center rounded-full border border-red-400/60 bg-red-950/80 shadow-[0_0_14px_rgba(255,70,70,0.6)]">
            <VolumeX className="h-5 w-5 text-red-300" />
          </span>
        </div>
        <h2 className="text-2xl font-bold tracking-wider text-slate-100">{TRACK_LABEL[instrument].toUpperCase()}</h2>
        <p className="text-sm font-semibold tracking-wide text-amber-400 drop-shadow-[0_0_6px_rgba(251,146,60,0.6)]">
          (SELECCIONADO - <span className="text-red-400">MUTED</span>)
        </p>

        <div className="mt-1 grid w-full grid-cols-2 gap-2" role="radiogroup" aria-label="Instrumento a practicar">
          {INSTRUMENTS.map((id) => {
            const selected = id === instrument
            return (
              <button
                key={id}
                role="radio"
                aria-checked={selected}
                onClick={() => onSelectInstrument(id)}
                className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-xs font-semibold tracking-wide transition ${
                  selected
                    ? 'border-amber-400/70 bg-amber-500/10 text-amber-300 shadow-[0_0_12px_rgba(251,146,60,0.35)]'
                    : 'border-cyan-400/25 bg-slate-900/60 text-slate-300 hover:border-cyan-300/70 hover:text-cyan-200'
                }`}
              >
                <Art id={id} className={`h-10 w-14 ${selected ? '' : 'opacity-70 grayscale-[40%]'}`} />
                {TRACK_LABEL[id]}
                {!hasMidi[id] && <span className="text-[10px] font-normal text-slate-500">sin .mid</span>}
              </button>
            )
          })}
        </div>
        <p className="text-center text-[11px] text-slate-400">
          Cambia a <button className="text-cyan-300 underline-offset-2 hover:underline" onClick={() => onSelectInstrument(other)}>{TRACK_LABEL[other]}</button> para practicarla
        </p>
      </section>

      {/* Accompaniment */}
      <section className="panel flex min-h-0 flex-1 flex-col gap-3 px-3 py-4">
        <h3 className="flex items-center justify-center gap-2 text-xl font-bold tracking-wider text-slate-100">
          PISTAS ACTIVAS <Volume2 className="h-5 w-5 text-green-400 drop-shadow-[0_0_6px_#22c55e]" />
        </h3>
        <div className="flex min-h-0 flex-1 flex-col justify-around gap-3">
          {accompaniment.map((id) => {
            const on = !muted[id]
            const Icon = id === 'drums' ? Drum : id === 'guitar' ? null : Mic2
            return (
              <div key={id} className={`rounded-lg border px-2 py-2 transition ${on ? 'border-green-400/30 bg-green-500/5' : 'border-slate-600/40 bg-slate-900/40'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-base font-semibold tracking-wide ${on ? 'text-slate-100' : 'text-slate-500 line-through'}`}>
                    {TRACK_LABEL[id].toUpperCase()}
                  </span>
                  <button
                    onClick={() => onToggleMute(id)}
                    title={on ? 'Silenciar pista' : 'Activar pista'}
                    aria-pressed={!on}
                    className={`flex h-8 w-8 items-center justify-center rounded-full border transition ${
                      on
                        ? 'border-green-400/60 bg-green-500/15 text-green-300 shadow-[0_0_10px_rgba(34,197,94,0.5)] hover:bg-green-500/25'
                        : 'border-red-400/50 bg-red-950/50 text-red-300 hover:bg-red-900/50'
                    }`}
                  >
                    {on ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                  </button>
                </div>
                <div className="mt-1 flex h-14 items-center gap-2">
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border ${on ? 'border-green-400/50 text-green-300 shadow-[0_0_10px_rgba(34,197,94,0.45)]' : 'border-slate-600 text-slate-500'}`}>
                    {Icon ? <Icon className="h-5 w-5" /> : <GuitarArt className="h-8 w-8" />}
                  </span>
                  <div className="h-full min-w-0 flex-1">
                    <WaveVisualizer analyser={analysers[id]} active={on} playing={playing} />
                  </div>
                </div>
                {!hasSound[id] && <p className="text-[10px] text-slate-500">Sin audio ni MIDI para esta pista</p>}
              </div>
            )
          })}
        </div>
      </section>
    </aside>
  )
}
