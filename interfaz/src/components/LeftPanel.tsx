import type { ReactNode } from 'react'
import type * as Tone from 'tone'
import { Drum, MicVocal, Volume2, VolumeX } from 'lucide-react'
import type { InstrumentId, StemId } from '../types'
import { BACKING_STEMS, INSTRUMENT_IDS, INSTRUMENT_LABEL, STEM_LABEL } from '../types'
import { DrumKitArt, GuitarArt } from './InstrumentArt'
import { WaveVisualizer } from './WaveVisualizer'

interface Props {
  instrument: InstrumentId
  onSelectInstrument: (id: InstrumentId) => void
  /** Effective mute of every stem (after the practice rule and solo). */
  muted: Record<StemId, boolean>
  onSetMuted: (ids: StemId[], muted: boolean) => void
  analysers: Record<StemId, Tone.Analyser>
  playing: boolean
  hasMidi: Record<InstrumentId, boolean>
  /** Stems that have audio or a synth part. */
  loaded: Record<StemId, boolean>
}

function Art({ id, className }: { id: InstrumentId; className?: string }) {
  return id === 'guitar' ? <GuitarArt className={className} /> : <DrumKitArt className={className} />
}

export function LeftPanel({ instrument, onSelectInstrument, muted, onSetMuted, analysers, playing, hasMidi, loaded }: Props) {
  const other = INSTRUMENT_IDS.find((i) => i !== instrument)!

  const groups: { key: string; label: string; stems: StemId[]; icon: ReactNode }[] = [
    {
      key: other,
      label: INSTRUMENT_LABEL[other].toUpperCase(),
      stems: [other],
      icon: other === 'drums' ? <Drum className="h-5 w-5" /> : <GuitarArt className="h-8 w-8" />,
    },
    { key: 'backing', label: 'VOCES / OTROS', stems: BACKING_STEMS, icon: <MicVocal className="h-5 w-5" /> },
  ]

  return (
    <aside className="flex min-h-0 flex-col gap-3">
      {/* Instrument to practise */}
      <section className="panel flex flex-col items-center gap-1.5 px-3 py-3">
        <div className="relative">
          <div className="absolute inset-2 rounded-full bg-amber-400/15 blur-xl" />
          <Art id={instrument} className="relative h-[clamp(72px,12vh,128px)] w-[clamp(72px,12vh,128px)] drop-shadow-[0_0_14px_rgba(251,176,60,0.45)]" />
          <span className="absolute -right-3 bottom-1 flex h-9 w-9 items-center justify-center rounded-full border border-red-400/60 bg-red-950/85 shadow-[0_0_14px_rgba(255,70,70,0.6)]" title={`${INSTRUMENT_LABEL[instrument]} silenciada: la tocas tú`}>
            <VolumeX className="h-5 w-5 text-red-300" />
          </span>
        </div>
        <h2 className="text-2xl font-bold tracking-wider text-slate-100">{INSTRUMENT_LABEL[instrument].toUpperCase()}</h2>
        <p className="text-sm font-semibold tracking-wide text-amber-400 drop-shadow-[0_0_6px_rgba(251,146,60,0.6)]">
          (SELECCIONADO - <span className="text-red-400">MUTED</span>)
        </p>

        <div className="mt-1 grid w-full grid-cols-2 gap-2" role="radiogroup" aria-label="Instrumento a practicar">
          {INSTRUMENT_IDS.map((id) => {
            const selected = id === instrument
            return (
              <button
                key={id}
                role="radio"
                aria-checked={selected}
                onClick={() => onSelectInstrument(id)}
                className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-xs font-semibold tracking-wide transition ${
                  selected
                    ? 'border-amber-400/80 bg-amber-500/10 text-amber-300 shadow-[0_0_14px_rgba(251,146,60,0.4)]'
                    : 'border-cyan-400/25 bg-slate-900/60 text-slate-300 hover:border-cyan-300/70 hover:text-cyan-200'
                }`}
              >
                <Art id={id} className={`h-10 w-14 ${selected ? '' : 'opacity-75 grayscale-[35%]'}`} />
                {INSTRUMENT_LABEL[id]}
                {!hasMidi[id] && <span className="text-[10px] font-normal text-slate-500">sin .mid</span>}
              </button>
            )
          })}
        </div>
        <p className="text-center text-xs text-slate-400">
          Cambia a{' '}
          <button className="text-cyan-300 underline-offset-2 hover:underline" onClick={() => onSelectInstrument(other)}>
            {INSTRUMENT_LABEL[other]}
          </button>{' '}
          para practicarla
        </p>
      </section>

      {/* Accompaniment that is sounding */}
      <section className="panel flex min-h-0 flex-1 flex-col gap-3 px-3 py-3">
        <h3 className="flex items-center justify-center gap-2 text-xl font-bold tracking-wider text-slate-100">
          PISTAS ACTIVAS <Volume2 className="h-5 w-5 text-green-400 drop-shadow-[0_0_6px_#22c55e]" />
        </h3>
        <div className="flex min-h-0 flex-1 flex-col justify-around gap-3">
          {groups.map((g) => {
            const audible = g.stems.filter((s) => !muted[s] && loaded[s])
            const on = audible.length > 0
            return (
              <div key={g.key} className={`rounded-xl border px-3 py-2 transition ${on ? 'border-green-400/35 bg-green-500/5 shadow-[inset_0_0_18px_rgba(34,197,94,0.06)]' : 'border-slate-600/40 bg-slate-900/40'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-base font-semibold tracking-wide ${on ? 'text-slate-100' : 'text-slate-500'}`}>{g.label}</span>
                  <button
                    onClick={() => onSetMuted(g.stems, on)}
                    title={on ? 'Silenciar' : 'Activar'}
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
                <div className="mt-1 flex h-12 items-center gap-2">
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border ${on ? 'border-green-400/50 text-green-300 shadow-[0_0_10px_rgba(34,197,94,0.45)]' : 'border-slate-600 text-slate-500'}`}>
                    {g.icon}
                  </span>
                  <div className="h-full min-w-0 flex-1">
                    <WaveVisualizer analysers={g.stems.map((s) => analysers[s])} active={on} playing={playing} />
                  </div>
                </div>
                {g.stems.length > 1 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {g.stems.map((s) => {
                      const live = !muted[s] && loaded[s]
                      return (
                        <span key={s} className={`flex items-center gap-1 rounded-full px-1.5 text-[10px] ${live ? 'bg-green-500/10 text-green-300' : 'bg-slate-800/60 text-slate-500'}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-green-400 shadow-[0_0_4px_#4ade80]' : 'bg-slate-600'}`} />
                          {STEM_LABEL[s]}
                        </span>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </aside>
  )
}
