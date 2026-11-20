import { useRef, type ReactNode } from 'react'
import { Clock, FolderOpen, Music2, Pause, Play, SkipBack, Upload } from 'lucide-react'
import type { ParsedMidi, SongSource } from '../types'
import { formatTime } from '../utils/format'

interface Props {
  time: number
  duration: number
  songs: SongSource[]
  currentId: string
  onSelectSong: (id: string) => void
  onLoadFiles: (files: File[]) => void
  midi: ParsedMidi | null
  playing: boolean
  disabled: boolean
  onPlay: () => void
  onPause: () => void
  onRestart: () => void
}

const ORIGIN_LABEL: Record<SongSource['origin'], string> = { demo: 'Demo', server: 'output/', local: 'Local' }

export function RightPanel(p: Props) {
  const fileInput = useRef<HTMLInputElement>(null)
  const current = p.songs.find((s) => s.id === p.currentId)
  const progress = p.duration > 0 ? Math.min(1, p.time / p.duration) : 0
  const R = 70
  const C = 2 * Math.PI * R

  return (
    <aside className="flex min-h-0 flex-col gap-3">
      {/* Time */}
      <section className="panel flex flex-col items-center justify-center px-3 py-4">
        <div className="relative aspect-square w-full max-w-[210px]">
          <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
            <circle cx="80" cy="80" r={R} fill="none" stroke="rgba(100,116,139,0.35)" strokeWidth="8" />
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
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
            <Clock className="h-8 w-8 text-slate-100" strokeWidth={2.2} />
            <span className="font-mono text-xl font-semibold tabular-nums text-slate-100">
              {formatTime(p.time)} / {formatTime(p.duration - p.time)}
            </span>
            <span className="text-sm text-slate-300">Restante</span>
          </div>
        </div>
        <span className="mt-1 text-xs text-slate-400">Duración total {formatTime(p.duration)}</span>
      </section>

      {/* File */}
      <section className="panel flex flex-col items-center justify-center gap-2 px-3 py-4 text-center">
        <span className="text-xl font-bold tracking-wider text-slate-100">ARCHIVO:</span>
        <span className="max-w-full truncate text-lg text-slate-100" title={p.midi?.fileName}>
          {p.midi?.fileName ?? '— sin .mid —'}
        </span>
        <span className="flex max-w-full items-center gap-1 text-xs text-cyan-300/80" title={current?.title}>
          <Music2 className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{current?.title}</span>
        </span>
        <label className="mt-1 w-full">
          <span className="sr-only">Cambiar de canción</span>
          <select
            value={p.currentId}
            onChange={(e) => p.onSelectSong(e.target.value)}
            className="w-full rounded-md border border-cyan-400/40 bg-slate-950/80 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-cyan-300"
          >
            {p.songs.map((s) => (
              <option key={s.id} value={s.id}>
                [{ORIGIN_LABEL[s.origin]}] {s.title}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => fileInput.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-cyan-400/40 bg-cyan-500/10 px-2 py-1.5 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-500/20"
        >
          <Upload className="h-4 w-4" /> Cargar .mid / stems
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept=".mid,.midi,audio/*"
          className="hidden"
          onChange={(e) => {
            p.onLoadFiles([...(e.target.files ?? [])])
            e.target.value = ''
          }}
        />
        <p className="flex items-start gap-1 text-left text-[10px] leading-tight text-slate-500">
          <FolderOpen className="mt-px h-3 w-3 shrink-0" />
          Nombres con guitar/guitarra o drums/batería se asignan solos; también puedes arrastrar archivos a la ventana.
        </p>
      </section>

      {/* Transport */}
      <section className="panel flex flex-1 flex-col justify-center gap-3 px-4 py-4">
        <ControlButton label="Play" onClick={p.onPlay} active={p.playing} disabled={p.disabled}>
          <Play className="h-11 w-11 fill-current" />
        </ControlButton>
        <ControlButton label="Pausa" onClick={p.onPause} active={!p.playing && p.time > 0} disabled={p.disabled}>
          <Pause className="h-11 w-11 fill-current" />
        </ControlButton>
        <ControlButton label="Reiniciar" onClick={p.onRestart} disabled={p.disabled}>
          <SkipBack className="h-11 w-11 fill-current" />
        </ControlButton>
      </section>
    </aside>
  )
}

function ControlButton(props: { label: string; onClick: () => void; active?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={props.label}
      title={props.label}
      className={`flex h-[clamp(56px,10vh,96px)] items-center justify-center rounded-xl border-2 bg-gradient-to-b from-[#123a55] to-[#0b2236] text-cyan-300 transition active:scale-[0.97] disabled:opacity-40 ${
        props.active
          ? 'border-cyan-300 shadow-[0_0_22px_rgba(56,214,255,0.75),inset_0_0_18px_rgba(56,214,255,0.35)]'
          : 'border-cyan-500/60 shadow-[0_0_10px_rgba(56,214,255,0.3),inset_0_0_12px_rgba(56,214,255,0.15)] hover:border-cyan-300 hover:shadow-[0_0_18px_rgba(56,214,255,0.6)]'
      }`}
    >
      {props.children}
    </button>
  )
}
