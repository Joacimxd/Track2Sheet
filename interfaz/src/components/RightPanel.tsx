import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Clock, EllipsisVertical, FileMusic, FolderOpen, Headphones, Pause, Play, SkipBack, Upload, Volume1, Volume2, VolumeX } from 'lucide-react'
import type { InstrumentId, LoadedSong, SongSource, StemId } from '../types'
import { STEM_IDS, STEM_LABEL } from '../types'
import { formatShort, formatTime } from '../utils/format'

interface Props {
  time: number
  duration: number
  song: LoadedSong | null
  songs: SongSource[]
  currentId: string
  onSelectSong: (id: string) => void
  onLoadFiles: (files: File[], target?: StemId | null) => void
  instrument: InstrumentId
  muted: Record<StemId, boolean>
  userMuted: Record<StemId, boolean>
  solo: StemId | null
  volume: Record<StemId, number>
  onToggleMute: (id: StemId) => void
  onToggleSolo: (id: StemId) => void
  onVolume: (id: StemId, v: number) => void
  onSeek: (t: number) => void
  playing: boolean
  disabled: boolean
  onPlay: () => void
  onPause: () => void
  onRestart: () => void
}

const ORIGIN_LABEL: Record<SongSource['origin'], string> = { demo: 'Demo', server: 'output/', local: 'Local', youtube: 'YouTube' }

export function RightPanel(p: Props) {
  const fileInput = useRef<HTMLInputElement>(null)
  const progress = p.duration > 0 ? Math.min(1, p.time / p.duration) : 0
  const R = 70
  const C = 2 * Math.PI * R

  return (
    <aside className="flex min-h-0 flex-col gap-3">
      {/* Time */}
      <section className="panel flex shrink-0 flex-col items-center justify-center px-3 py-3">
        <div className="relative aspect-square w-[clamp(130px,21vh,210px)]">
          <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
            <circle cx="80" cy="80" r={R} fill="none" stroke="rgba(100,116,139,0.3)" strokeWidth="8" />
            <circle
              cx="80"
              cy="80"
              r={R}
              fill="none"
              stroke="#38d6ff"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - progress)}
              className="drop-shadow-[0_0_6px_#38d6ff] transition-[stroke-dashoffset] duration-100"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
            <Clock className="h-[18%] w-[18%] text-slate-100" strokeWidth={2.2} />
            <span className="font-mono text-[clamp(14px,2.4vh,22px)] font-semibold tabular-nums text-slate-100">
              {formatTime(p.time)} / {formatTime(p.duration - p.time)}
            </span>
            <span className="text-sm text-slate-300">Restante</span>
          </div>
        </div>
        <span className="mt-1 text-xs text-slate-400">Duración total {formatTime(p.duration)}</span>
      </section>

      {/* Stems */}
      <section className="panel flex min-h-0 shrink flex-col gap-1.5 overflow-hidden px-2.5 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-lg font-bold tracking-wider text-slate-100">ARCHIVOS</span>
          <button
            onClick={() => fileInput.current?.click()}
            title="Cargar los 6 stems (.wav/.mp3) y los .mid de guitarra / batería"
            className="flex items-center gap-1 rounded-md border border-cyan-400/40 bg-cyan-500/10 px-2 py-1 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-500/20"
          >
            <Upload className="h-3.5 w-3.5" /> Cargar
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
        <label className="block">
          <span className="sr-only">Canción</span>
          <select
            value={p.currentId}
            onChange={(e) => p.onSelectSong(e.target.value)}
            className="w-full rounded-md border border-cyan-400/30 bg-slate-950/80 px-2 py-1 text-xs text-slate-100 outline-none focus:border-cyan-300"
          >
            {p.songs.map((s) => (
              <option key={s.id} value={s.id}>
                [{ORIGIN_LABEL[s.origin]}] {s.title}
              </option>
            ))}
          </select>
        </label>
        <div className="flex min-h-0 flex-col gap-1 overflow-y-auto pr-0.5">
          {STEM_IDS.map((id) => (
            <StemRow
              key={id}
              id={id}
              stem={p.song?.stems[id]}
              practiceMidi={id === 'guitar' || id === 'drums' ? p.song?.midi[id]?.fileName : undefined}
              time={p.time}
              practising={id === p.instrument}
              muted={p.muted[id]}
              userMuted={p.userMuted[id]}
              soloed={p.solo === id}
              volume={p.volume[id]}
              playing={p.playing}
              onToggleMute={() => p.onToggleMute(id)}
              onToggleSolo={() => p.onToggleSolo(id)}
              onVolume={(v) => p.onVolume(id, v)}
              onSeek={p.onSeek}
              onLoad={(files) => p.onLoadFiles(files, id)}
            />
          ))}
        </div>
        <p className="flex items-start gap-1 text-[10px] leading-tight text-slate-500">
          <FolderOpen className="mt-px h-3 w-3 shrink-0" />
          También puedes arrastrar los stems y .mid a la ventana; se asignan por nombre (bass, drums, guitar…).
        </p>
      </section>

      {/* Transport */}
      <section className="panel flex min-h-[200px] flex-1 flex-col justify-center gap-[clamp(8px,1.4vh,14px)] px-4 py-3">
        <ControlButton label="Play" onClick={p.onPlay} active={p.playing} disabled={p.disabled}>
          <Play className="h-[55%] w-auto fill-current" />
        </ControlButton>
        <ControlButton label="Pausa" onClick={p.onPause} active={!p.playing && p.time > 0} disabled={p.disabled}>
          <Pause className="h-[55%] w-auto fill-current" />
        </ControlButton>
        <ControlButton label="Reiniciar" onClick={p.onRestart} disabled={p.disabled}>
          <SkipBack className="h-[55%] w-auto fill-current" />
        </ControlButton>
      </section>
    </aside>
  )
}

interface RowProps {
  id: StemId
  stem: LoadedSong['stems'][StemId]
  practiceMidi?: string
  time: number
  practising: boolean
  muted: boolean
  userMuted: boolean
  soloed: boolean
  volume: number
  playing: boolean
  onToggleMute: () => void
  onToggleSolo: () => void
  onVolume: (v: number) => void
  onSeek: (t: number) => void
  onLoad: (files: File[]) => void
}

function StemRow(r: RowProps) {
  const [menu, setMenu] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  const audioInput = useRef<HTMLInputElement>(null)
  const midiInput = useRef<HTMLInputElement>(null)
  const isInstrument = r.id === 'guitar' || r.id === 'drums'
  const dur = r.stem?.duration ?? 0
  const t = Math.min(r.time, dur)
  const audible = !r.muted && !!r.stem

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => !rowRef.current?.contains(e.target as Node) && setMenu(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])

  const VolIcon = r.muted ? VolumeX : r.volume < 0.5 ? Volume1 : Volume2
  const muteTitle = r.practising && !r.soloed ? `${STEM_LABEL[r.id]}: silenciada porque la tocas tú` : r.userMuted ? 'Activar pista' : 'Silenciar pista'

  return (
    <div ref={rowRef} className="relative flex items-center gap-1.5">
      <span
        className={`w-11 shrink-0 truncate text-[11px] font-semibold ${r.practising ? 'text-amber-300' : audible ? 'text-slate-300' : 'text-slate-500'}`}
        title={r.stem ? `${r.stem.name}${r.practiceMidi ? ` · ${r.practiceMidi}` : ''}` : 'Sin archivo'}
      >
        {r.id}
      </span>
      <div
        className={`flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-full border px-1.5 transition ${
          r.soloed
            ? 'border-cyan-300 bg-slate-100 shadow-[0_0_10px_rgba(56,214,255,0.6)]'
            : r.practising
              ? 'border-amber-400/70 bg-slate-200'
              : 'border-transparent bg-slate-100'
        } ${r.stem ? '' : 'opacity-55'}`}
      >
        <button
          onClick={r.onToggleSolo}
          disabled={!r.stem}
          aria-pressed={r.soloed}
          title={r.soloed ? 'Quitar solo' : 'Escuchar solo esta pista (sincronizada)'}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition ${r.soloed ? 'bg-cyan-500 text-white' : 'text-slate-800 hover:bg-slate-300'}`}
        >
          {r.soloed && r.playing ? <Pause className="h-3 w-3 fill-current" /> : <Play className="h-3 w-3 fill-current" />}
        </button>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-slate-700">
          {formatShort(t)} / {formatShort(dur)}
        </span>
        <div
          role="slider"
          aria-label={`Posición de ${r.id}`}
          aria-valuemin={0}
          aria-valuemax={Math.round(dur)}
          aria-valuenow={Math.round(t)}
          tabIndex={-1}
          onClick={(e) => {
            if (!dur) return
            const rect = e.currentTarget.getBoundingClientRect()
            r.onSeek(((e.clientX - rect.left) / rect.width) * dur)
          }}
          className="relative h-1 min-w-4 flex-1 cursor-pointer rounded-full bg-slate-300"
        >
          <div className={`absolute inset-y-0 left-0 rounded-full ${audible ? 'bg-cyan-600' : 'bg-slate-500'}`} style={{ width: `${dur ? (t / dur) * 100 : 0}%` }} />
        </div>
        <button
          onClick={r.onToggleMute}
          disabled={r.practising}
          title={muteTitle}
          aria-pressed={r.muted}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition ${r.muted ? 'text-red-500' : 'text-slate-700 hover:bg-slate-300'} disabled:cursor-not-allowed`}
        >
          <VolIcon className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => setMenu((m) => !m)} title="Volumen y cargar archivos" aria-expanded={menu} className="flex h-6 w-4 shrink-0 items-center justify-center rounded text-slate-700 hover:bg-slate-300">
          <EllipsisVertical className="h-3.5 w-3.5" />
        </button>
      </div>

      {menu && (
        <div className="absolute top-full right-0 z-40 mt-1 w-56 rounded-lg border border-cyan-400/40 bg-[#0b1626] p-2 text-xs shadow-[0_8px_24px_rgba(0,0,0,0.6),0_0_14px_rgba(56,214,255,0.25)]">
          <label className="flex items-center gap-2 text-slate-300">
            <Volume2 className="h-3.5 w-3.5 shrink-0" />
            <input type="range" min={0} max={1} step={0.01} value={r.volume} onChange={(e) => r.onVolume(Number(e.target.value))} className="w-full accent-cyan-400" aria-label={`Volumen de ${r.id}`} />
            <span className="w-8 text-right tabular-nums">{Math.round(r.volume * 100)}%</span>
          </label>
          <button onClick={() => audioInput.current?.click()} className="mt-2 flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-cyan-200 hover:bg-cyan-500/10">
            <Upload className="h-3.5 w-3.5" /> Cargar audio de {r.id} (.wav/.mp3)
          </button>
          {isInstrument && (
            <button onClick={() => midiInput.current?.click()} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-amber-200 hover:bg-amber-500/10">
              <FileMusic className="h-3.5 w-3.5" /> Cargar .mid de {r.id}
            </button>
          )}
          <button onClick={r.onToggleSolo} disabled={!r.stem} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-slate-300 hover:bg-slate-500/10 disabled:opacity-40">
            <Headphones className="h-3.5 w-3.5" /> {r.soloed ? 'Quitar solo' : 'Solo (escuchar solo esta pista)'}
          </button>
          <p className="mt-1 truncate border-t border-slate-700 pt-1 text-[10px] text-slate-500" title={r.stem?.name}>
            {r.stem ? `${r.stem.kind === 'synth' ? 'Sintetizado · ' : ''}${r.stem.name}` : 'Sin archivo'}
            {r.practiceMidi && ` · ${r.practiceMidi}`}
          </p>
          <input
            ref={audioInput}
            type="file"
            accept="audio/*,.wav,.mp3,.flac,.ogg,.m4a"
            className="hidden"
            onChange={(e) => {
              r.onLoad([...(e.target.files ?? [])])
              e.target.value = ''
              setMenu(false)
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
              setMenu(false)
            }}
          />
        </div>
      )}
    </div>
  )
}

function ControlButton(props: { label: string; onClick: () => void; active?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={props.label}
      title={props.label}
      className={`flex max-h-28 min-h-12 flex-1 items-center justify-center rounded-xl border-2 bg-gradient-to-b from-[#123a55] to-[#0b2236] text-cyan-300 transition active:scale-[0.97] disabled:opacity-40 ${
        props.active
          ? 'border-cyan-300 shadow-[0_0_22px_rgba(56,214,255,0.75),inset_0_0_18px_rgba(56,214,255,0.35)]'
          : 'border-cyan-500/60 shadow-[0_0_10px_rgba(56,214,255,0.3),inset_0_0_12px_rgba(56,214,255,0.15)] hover:border-cyan-300 hover:shadow-[0_0_18px_rgba(56,214,255,0.6)]'
      }`}
    >
      {props.children}
    </button>
  )
}
