import { useRef, useState, type CSSProperties } from 'react'
import type * as Tone from 'tone'
import { ChevronDown, FileMusic, Headphones, Upload, Volume2, VolumeX } from 'lucide-react'
import type { YoutubeState } from '../hooks/useMultiTrackPlayer'
import type { InstrumentId, LoadedSong, StemId } from '../types'
import { STEM_GEL, STEM_LABEL, STEM_SHORT } from '../types'
import { LevelMeter } from './LevelMeter'
import { YoutubeUrlBar } from './YoutubeUrlBar'

/** Mixer order: the band as you'd read it, front to back. */
const MIXER_ORDER: StemId[] = ['vocals', 'guitar', 'bass', 'drums', 'piano', 'other']

interface Props {
  song: LoadedSong | null
  onLoadFiles: (files: File[], target?: StemId | null) => void
  instrument: InstrumentId
  muted: Record<StemId, boolean>
  userMuted: Record<StemId, boolean>
  solo: StemId | null
  volume: Record<StemId, number>
  analysers: Record<StemId, Tone.Analyser>
  playing: boolean
  onToggleMute: (id: StemId) => void
  onToggleSolo: (id: StemId) => void
  onVolume: (id: StemId, v: number) => void
  youtube: YoutubeState
  onYoutubeSubmit: (url: string) => void
  onYoutubeCancel: () => void
}

/** Right column: YouTube link, file loading and the mixer (one lighting gel per stem). */
export function RightPanel(p: Props) {
  const fileInput = useRef<HTMLInputElement>(null)

  return (
    <aside className="flex min-h-0 flex-col border-t border-rule bg-panel lg:border-t-0 lg:border-l">
      <section className="shrink-0 border-b border-rule p-4">
        <YoutubeUrlBar state={p.youtube} onSubmit={p.onYoutubeSubmit} onCancel={p.onYoutubeCancel} />
      </section>

      <section className="flex min-h-0 flex-1 flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-cond text-lg font-semibold tracking-wide text-ink">Pistas</h2>
          <button
            onClick={() => fileInput.current?.click()}
            title="Cargar stems (.wav/.mp3) y .mid de guitarra o batería. También puedes arrastrarlos a la ventana."
            className="flex h-8 items-center gap-1.5 rounded-md bg-control px-2.5 text-xs font-semibold text-ink-2 transition hover:bg-[#2e3037] hover:text-ink active:scale-[0.97]"
          >
            <Upload className="h-3.5 w-3.5" /> Cargar archivos
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".mid,.midi,audio/*,.wav,.mp3,.flac,.ogg,.m4a"
            className="hidden"
            onChange={(e) => {
              p.onLoadFiles([...(e.target.files ?? [])])
              e.target.value = ''
            }}
          />
        </div>

        <ul className="-mx-2 flex min-h-0 flex-col divide-y divide-rule overflow-y-auto">
          {MIXER_ORDER.map((id) => (
            <TrackRow
              key={id}
              id={id}
              stem={p.song?.stems[id]}
              practiceMidi={id === 'guitar' || id === 'drums' ? p.song?.midi[id]?.fileName : undefined}
              practising={id === p.instrument}
              muted={p.muted[id]}
              userMuted={p.userMuted[id]}
              soloed={p.solo === id}
              volume={p.volume[id]}
              analyser={p.analysers[id]}
              playing={p.playing}
              onToggleMute={() => p.onToggleMute(id)}
              onToggleSolo={() => p.onToggleSolo(id)}
              onVolume={(v) => p.onVolume(id, v)}
              onLoad={(files) => p.onLoadFiles(files, id)}
            />
          ))}
        </ul>
      </section>
    </aside>
  )
}

interface RowProps {
  id: StemId
  stem: LoadedSong['stems'][StemId]
  practiceMidi?: string
  practising: boolean
  muted: boolean
  userMuted: boolean
  soloed: boolean
  volume: number
  analyser: Tone.Analyser
  playing: boolean
  onToggleMute: () => void
  onToggleSolo: () => void
  onVolume: (v: number) => void
  onLoad: (files: File[]) => void
}

function TrackRow(r: RowProps) {
  const [open, setOpen] = useState(false)
  const audioInput = useRef<HTMLInputElement>(null)
  const midiInput = useRef<HTMLInputElement>(null)
  const isInstrument = r.id === 'guitar' || r.id === 'drums'
  const gel = STEM_GEL[r.id]
  const lit = !r.muted && !!r.stem
  // The mute button shows the user's choice; the practised track is always muted (you play it).
  const muteOn = r.practising || r.userMuted

  const btn = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition active:scale-95 disabled:cursor-not-allowed disabled:active:scale-100'

  return (
    <li
      className={`rounded-md px-2 py-2.5 transition-colors ${r.soloed ? 'bg-ink/[0.06]' : ''} ${r.stem ? '' : 'opacity-50'}`}
      style={r.practising && !r.soloed ? { backgroundColor: `${gel}12` } : undefined}
    >
      <div className="flex items-center gap-2.5">
        {/* The gel: lit while the stem sounds, an unlit filter when muted. */}
        <span
          aria-hidden
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md font-cond text-sm font-semibold tracking-wide transition-[background-color,color] duration-200 ease-out"
          style={
            lit
              ? { backgroundColor: gel, color: '#111214' }
              : { backgroundColor: `${gel}1f`, color: gel }
          }
        >
          {STEM_SHORT[r.id]}
        </span>

        <div className="min-w-0 flex-1">
          <p className={`truncate text-[15px] leading-tight font-semibold ${lit ? 'text-ink' : 'text-ink-2'}`}>{STEM_LABEL[r.id]}</p>
          <p className="truncate text-xs leading-tight" style={{ color: r.practising ? gel : 'var(--color-ink-3)' }} title={r.stem?.name}>
            {r.practising ? 'La tocas tú' : r.stem ? `${r.stem.kind === 'synth' ? 'Sintetizado · ' : ''}${r.stem.name}` : 'Sin archivo'}
          </p>
        </div>

        <button
          onClick={r.onToggleMute}
          disabled={r.practising || !r.stem}
          aria-pressed={muteOn}
          aria-label={`Silenciar ${STEM_LABEL[r.id]}`}
          title={r.practising ? 'Silenciada: la tocas tú' : r.userMuted ? 'Activar pista' : 'Silenciar pista'}
          className={`${btn} ${muteOn ? 'bg-alert/20 text-alert' : 'bg-control text-ink-2 hover:bg-[#2e3037] hover:text-ink'}`}
        >
          {muteOn ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
        <button
          onClick={r.onToggleSolo}
          disabled={!r.stem}
          aria-pressed={r.soloed}
          aria-label={`Solo ${STEM_LABEL[r.id]}`}
          title={r.soloed ? 'Quitar solo' : 'Solo: escuchar solo esta pista'}
          className={`${btn} ${r.soloed ? 'bg-ink text-stage' : 'bg-control text-ink-2 hover:bg-[#2e3037] hover:text-ink'}`}
        >
          <Headphones className="h-4 w-4" />
        </button>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={`Archivos de ${STEM_LABEL[r.id]}`}
          title="Cargar archivos de esta pista"
          className={`${btn} w-6 text-ink-3 hover:text-ink`}
        >
          <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      <div className="mt-1.5 flex items-center gap-3 pl-[54px]">
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={r.volume}
          onChange={(e) => r.onVolume(Number(e.target.value))}
          aria-label={`Volumen de ${STEM_LABEL[r.id]}`}
          title={`Volumen ${Math.round(r.volume * 100)}%`}
          className="fader w-24 shrink-0"
          style={{ '--pct': `${r.volume * 100}%`, '--fill': 'var(--color-ink-2)' } as CSSProperties}
        />
        <div className="h-3 min-w-0 flex-1">
          <LevelMeter analyser={r.analyser} color={gel} active={lit} playing={r.playing} />
        </div>
      </div>

      {open && (
        <div className="mt-2 flex flex-wrap gap-1.5 border-t border-rule pt-2 pl-[54px]">
          <button onClick={() => audioInput.current?.click()} className="flex h-8 items-center gap-1.5 rounded-md bg-control px-2.5 text-xs font-semibold text-ink-2 transition hover:text-ink">
            <Upload className="h-3.5 w-3.5" /> Audio (.wav/.mp3)
          </button>
          {isInstrument && (
            <button onClick={() => midiInput.current?.click()} className="flex h-8 items-center gap-1.5 rounded-md bg-control px-2.5 text-xs font-semibold text-ink-2 transition hover:text-ink">
              <FileMusic className="h-3.5 w-3.5" /> Notas (.mid)
            </button>
          )}
          {r.practiceMidi && <p className="w-full truncate text-xs text-ink-3">Notas: {r.practiceMidi}</p>}
          <input
            ref={audioInput}
            type="file"
            accept="audio/*,.wav,.mp3,.flac,.ogg,.m4a"
            className="hidden"
            onChange={(e) => {
              r.onLoad([...(e.target.files ?? [])])
              e.target.value = ''
              setOpen(false)
            }}
          />
          <input
            ref={midiInput}
            type="file"
            accept=".mid,.midi"
            className="hidden"
            onChange={(e) => {
              r.onLoad([...(e.target.files ?? [])])
              e.target.value = ''
              setOpen(false)
            }}
          />
        </div>
      )}
    </li>
  )
}
