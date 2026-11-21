import { useState } from 'react'
import { ArrowRight, CircleCheckBig, LoaderCircle, TriangleAlert, X } from 'lucide-react'
import type { YoutubeState } from '../hooks/useMultiTrackPlayer'
import { parseYoutubeId, PIPELINE_STEPS } from '../utils/pipelineApi'

interface Props {
  state: YoutubeState
  onSubmit: (url: string) => void
  onCancel: () => void
}

/** "Ingresar link de youtube": validates the link and starts the pipeline (handleYoutubeSubmit). */
export function YoutubeUrlBar({ state, onSubmit, onCancel }: Props) {
  const [url, setUrl] = useState('')
  const [touched, setTouched] = useState(false)
  const processing = state.status === 'processing'
  const invalid = touched && url.trim() !== '' && !parseYoutubeId(url)
  const stepIndex = state.step ? PIPELINE_STEPS.indexOf(state.step.label) : -1

  const submit = () => {
    setTouched(true)
    if (!processing && parseYoutubeId(url)) onSubmit(url.trim())
  }

  return (
    <div className="shrink-0">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className={`relative flex h-[clamp(64px,10vh,96px)] items-center gap-3 overflow-hidden rounded-[22px] border-2 bg-gradient-to-b from-slate-200 to-slate-300 px-4 shadow-[0_0_18px_rgba(56,214,255,0.25),inset_0_2px_6px_rgba(255,255,255,0.7)] transition ${
          invalid ? 'border-red-400' : 'border-cyan-300/60 focus-within:border-cyan-400 focus-within:shadow-[0_0_26px_rgba(56,214,255,0.55)]'
        }`}
      >
        <VideoLinkIcon />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => setTouched(true)}
          disabled={processing}
          placeholder="Ingresar link de youtube"
          aria-label="Ingresar link de youtube"
          aria-invalid={invalid}
          className="h-full min-w-0 flex-1 bg-transparent text-center text-[clamp(18px,2.2vw,30px)] text-slate-800 outline-none placeholder:text-slate-600 disabled:opacity-60"
        />
        {processing ? (
          <button type="button" onClick={onCancel} title="Cancelar" className="flex h-11 shrink-0 items-center gap-1 rounded-full border border-slate-500/40 bg-slate-100 px-3 text-sm font-semibold text-slate-700 hover:bg-white">
            <X className="h-4 w-4" /> Cancelar
          </button>
        ) : (
          <button
            type="submit"
            disabled={!url.trim()}
            title="Separar en stems y generar .mid"
            className="flex h-11 shrink-0 items-center gap-1 rounded-full bg-gradient-to-b from-cyan-400 to-cyan-600 px-4 text-sm font-bold tracking-wide text-[#04121f] shadow-[0_0_14px_rgba(56,214,255,0.7)] transition hover:brightness-110 active:scale-95 disabled:opacity-40 disabled:shadow-none"
          >
            Procesar <ArrowRight className="h-4 w-4" />
          </button>
        )}
        {processing && state.step && (
          <div className="absolute inset-x-0 bottom-0 h-1.5 bg-slate-400/40">
            <div className="h-full bg-gradient-to-r from-cyan-400 to-cyan-300 shadow-[0_0_10px_#38d6ff] transition-[width] duration-150" style={{ width: `${state.step.progress * 100}%` }} />
          </div>
        )}
      </form>

      <div className="flex min-h-6 items-center justify-center gap-2 px-2 pt-1 text-xs" aria-live="polite">
        {invalid && (
          <span className="flex items-center gap-1 text-red-300">
            <TriangleAlert className="h-3.5 w-3.5" /> Usa un enlace de YouTube (youtube.com/watch?v=… o youtu.be/…)
          </span>
        )}
        {processing && (
          <span className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-slate-400">
            {PIPELINE_STEPS.map((label, i) => (
              <span key={label} className={`flex items-center gap-1 ${i < stepIndex ? 'text-green-400' : i === stepIndex ? 'text-cyan-200' : ''}`}>
                {i < stepIndex ? <CircleCheckBig className="h-3.5 w-3.5" /> : i === stepIndex ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />}
                {label}
              </span>
            ))}
            <span className="tabular-nums text-cyan-300">{Math.round((state.step?.progress ?? 0) * 100)}%</span>
          </span>
        )}
        {!invalid && state.status === 'done' && (
          <span className="flex items-center gap-1 text-green-400">
            <CircleCheckBig className="h-3.5 w-3.5" /> {state.message}
          </span>
        )}
        {!invalid && state.status === 'error' && (
          <span className="flex items-center gap-1 text-red-300">
            <TriangleAlert className="h-3.5 w-3.5" /> {state.message}
          </span>
        )}
      </div>
    </div>
  )
}

/** Red "video play" badge next to the input. */
function VideoLinkIcon() {
  return (
    <svg viewBox="0 0 40 28" className="h-7 w-10 shrink-0" aria-hidden>
      <rect x="0" y="0" width="40" height="28" rx="8" fill="#e11d2e" />
      <path d="M16 8l11 6-11 6z" fill="#fff" />
    </svg>
  )
}
