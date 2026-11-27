import { useState } from 'react'
import { ArrowRight, CircleCheckBig, LoaderCircle, TriangleAlert, X } from 'lucide-react'
import type { YoutubeState } from '../hooks/useMultiTrackPlayer'
import { parseYoutubeId, PIPELINE_STEPS } from '../utils/api'

interface Props {
  state: YoutubeState
  onSubmit: (url: string) => void
  onCancel: () => void
}

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
        className={`relative flex h-11 items-center gap-2 overflow-hidden rounded-md border bg-control pr-1 pl-2.5 transition ${
          invalid ? 'border-alert' : 'border-rule focus-within:border-ink-3'
        }`}
      >
        <VideoLinkIcon />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => setTouched(true)}
          disabled={processing}
          placeholder="Pega un link de YouTube"
          aria-label="Link de YouTube"
          aria-invalid={invalid}
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3 disabled:opacity-60"
        />
        {processing ? (
          <button type="button" onClick={onCancel} title="Cancelar" className="flex h-8 shrink-0 items-center gap-1 rounded px-2 text-xs font-semibold text-ink-2 hover:bg-[#2e3037] hover:text-ink">
            <X className="h-4 w-4" /> Cancelar
          </button>
        ) : (
          <button
            type="submit"
            disabled={!url.trim()}
            title="Separar en stems y generar .mid"
            className="flex h-8 shrink-0 items-center gap-1 rounded bg-ink px-2.5 text-xs font-semibold text-stage transition hover:bg-white active:scale-95 disabled:opacity-40"
          >
            Procesar <ArrowRight className="h-4 w-4" />
          </button>
        )}
        {processing && state.step && (
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-rule">
            <div className="h-full bg-ink transition-[width] duration-150" style={{ width: `${state.step.progress * 100}%` }} />
          </div>
        )}
      </form>

      <div className="flex items-center gap-2 px-0.5 pt-1.5 text-xs empty:hidden" aria-live="polite">
        {invalid && (
          <span className="flex items-center gap-1 text-alert">
            <TriangleAlert className="h-3.5 w-3.5" /> Usa un enlace de YouTube (youtube.com/watch?v=… o youtu.be/…)
          </span>
        )}
        {processing && (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-ink-3">
            {PIPELINE_STEPS.map((label, i) => (
              <span key={label} className={`flex items-center gap-1 ${i < stepIndex ? 'text-gel-piano' : i === stepIndex ? 'text-ink' : ''}`}>
                {i < stepIndex ? <CircleCheckBig className="h-3.5 w-3.5" /> : i === stepIndex ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <span className="h-1.5 w-1.5 rounded-full bg-ink-3" />}
                {label}
              </span>
            ))}
            <span className="text-ink">{Math.round((state.step?.progress ?? 0) * 100)}%</span>
          </span>
        )}
        {!invalid && state.status === 'done' && (
          <span className="flex items-center gap-1 text-gel-piano">
            <CircleCheckBig className="h-3.5 w-3.5" /> {state.message}
          </span>
        )}
        {!invalid && state.status === 'error' && (
          <span className="flex items-center gap-1 text-alert">
            <TriangleAlert className="h-3.5 w-3.5" /> {state.message}
          </span>
        )}
      </div>
    </div>
  )
}

function VideoLinkIcon() {
  return (
    <svg viewBox="0 0 40 28" className="h-4 w-6 shrink-0" aria-hidden>
      <rect x="0" y="0" width="40" height="28" rx="8" fill="#e11d2e" />
      <path d="M16 8l11 6-11 6z" fill="#fff" />
    </svg>
  )
}
