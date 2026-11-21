import { useEffect, useState } from 'react'
import { AlertTriangle, LoaderCircle, X } from 'lucide-react'
import { FretboardHighway } from './components/FretboardHighway'
import { LeftPanel } from './components/LeftPanel'
import { RightPanel } from './components/RightPanel'
import { YoutubeUrlBar } from './components/YoutubeUrlBar'
import { useMultiTrackPlayer } from './hooks/useMultiTrackPlayer'
import type { InstrumentId, StemId } from './types'
import { STEM_IDS } from './types'

export default function App() {
  const player = useMultiTrackPlayer()
  const [dragging, setDragging] = useState(false)
  const { togglePlay, loadFiles } = player

  // Space = play / pause (unless a form control has focus).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      const t = e.target
      if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement || t instanceof HTMLButtonElement) return
      e.preventDefault()
      togglePlay()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay])

  // Drag & drop stems / .mid anywhere on the window.
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault()
      setDragging(true)
    }
    const leave = (e: DragEvent) => e.relatedTarget === null && setDragging(false)
    const drop = (e: DragEvent) => {
      e.preventDefault()
      setDragging(false)
      if (e.dataTransfer?.files.length) loadFiles([...e.dataTransfer.files])
    }
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [loadFiles])

  const song = player.song
  const hasMidi: Record<InstrumentId, boolean> = {
    guitar: !!song?.midi.guitar?.notes.length,
    drums: !!song?.midi.drums?.notes.length,
  }
  const loaded = Object.fromEntries(STEM_IDS.map((id) => [id, !!song?.stems[id]])) as Record<StemId, boolean>

  return (
    <div className="grid h-full gap-3 overflow-auto p-3 lg:grid-cols-[minmax(230px,18.5%)_1fr_minmax(250px,19.5%)] lg:overflow-hidden">
      <LeftPanel
        instrument={player.instrument}
        onSelectInstrument={player.selectInstrument}
        muted={player.muted}
        onSetMuted={player.setMutedMany}
        analysers={player.analysers}
        playing={player.playing}
        hasMidi={hasMidi}
        loaded={loaded}
      />

      <main className="panel relative flex min-h-[640px] flex-col gap-1 overflow-hidden p-2.5 lg:min-h-0">
        <YoutubeUrlBar state={player.youtube} onSubmit={player.handleYoutubeSubmit} onCancel={player.cancelYoutube} />
        <FretboardHighway
          instrument={player.instrument}
          tab={player.guitarTab}
          drumNotes={player.drumNotes}
          midi={player.practiceMidi}
          getTime={player.getTime}
          playing={player.playing}
        />

        {player.loading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[#050912]/80 backdrop-blur-sm">
            <LoaderCircle className="h-10 w-10 animate-spin text-cyan-300" />
            <p className="max-w-[80%] truncate text-center text-lg text-slate-200">{player.loading}</p>
          </div>
        )}
        {player.error && (
          <div className="absolute bottom-4 left-1/2 z-30 flex max-w-[90%] -translate-x-1/2 items-center gap-2 rounded-lg border border-red-400/60 bg-red-950/90 px-3 py-2 text-sm text-red-100 shadow-lg">
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-300" />
            <span>{player.error}</span>
            <button aria-label="Cerrar" onClick={player.clearError} className="ml-1 text-red-300 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </main>

      <RightPanel
        time={player.time}
        duration={player.duration}
        song={song}
        songs={player.songs}
        currentId={player.currentId}
        onSelectSong={player.selectSong}
        onLoadFiles={player.loadFiles}
        instrument={player.instrument}
        muted={player.muted}
        userMuted={player.userMuted}
        solo={player.solo}
        volume={player.volume}
        onToggleMute={player.toggleMute}
        onToggleSolo={player.toggleSolo}
        onVolume={player.setVolume}
        onSeek={player.seek}
        playing={player.playing}
        disabled={!song || !!player.loading}
        onPlay={() => void player.play()}
        onPause={player.pause}
        onRestart={player.restart}
      />

      {dragging && (
        <div className="pointer-events-none fixed inset-3 z-50 flex items-center justify-center rounded-2xl border-4 border-dashed border-cyan-300/80 bg-cyan-500/10 text-2xl font-bold tracking-wide text-cyan-100">
          Suelta aquí los stems (.wav/.mp3) y los .mid
        </div>
      )}
    </div>
  )
}
