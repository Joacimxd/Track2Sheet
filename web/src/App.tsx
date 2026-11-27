import { useEffect, useState } from 'react'
import { AlertTriangle, LoaderCircle, X } from 'lucide-react'
import { FretboardHighway } from './components/FretboardHighway'
import { PlayerBar } from './components/PlayerBar'
import { RightPanel } from './components/RightPanel'
import { useMultiTrackPlayer } from './hooks/useMultiTrackPlayer'
import type { InstrumentId } from './types'

export default function App() {
  const player = useMultiTrackPlayer()
  const [dragging, setDragging] = useState(false)
  const { togglePlay, loadFiles } = player

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
    piano: !!song?.midi.piano?.notes.length,
  }

  return (
    <div className="flex min-h-full flex-col lg:h-full lg:overflow-hidden">
      <PlayerBar
        songs={player.songs}
        currentId={player.currentId}
        onSelectSong={player.selectSong}
        instrument={player.instrument}
        onSelectInstrument={player.selectInstrument}
        hasMidi={hasMidi}
        time={player.time}
        duration={player.duration}
        onSeek={player.seek}
        playing={player.playing}
        disabled={!song || !!player.loading}
        onTogglePlay={togglePlay}
        onRestart={player.restart}
        rate={player.rate}
        onRate={player.setRate}
        tabLoading={player.tabLoading}
        pianoLoading={player.pianoLoading}
        tuningName={player.tuningName}
        hasSolos={player.guitarTab.solos.length > 0}
        guitarPart={player.guitarPart}
        onGuitarPart={player.setGuitarPart}
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(320px,24%)]">
        <main className="relative flex min-h-[560px] min-w-0 flex-col overflow-hidden lg:min-h-0">
          <FretboardHighway
            instrument={player.instrument}
            tab={player.guitarTab}
            drumNotes={player.drumNotes}
            pianoNotes={player.pianoNotes}
            midi={player.practiceMidi}
            getTime={player.getTime}
            playing={player.playing}
          />

          {player.loading && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-stage/85">
              <LoaderCircle className="h-10 w-10 animate-spin text-ink-2" />
              <p className="max-w-[80%] truncate text-center text-lg text-ink">{player.loading}</p>
            </div>
          )}
          {player.error && (
            <div className="absolute bottom-4 left-1/2 z-30 flex max-w-[90%] -translate-x-1/2 items-center gap-2 rounded-md border border-alert/60 bg-[#2a1512] px-3 py-2 text-sm text-ink shadow-[0_6px_20px_rgba(0,0,0,0.5)]">
              <AlertTriangle className="h-4 w-4 shrink-0 text-alert" />
              <span>{player.error}</span>
              <button aria-label="Cerrar" onClick={player.clearError} className="ml-1 text-ink-2 hover:text-ink">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </main>

        <RightPanel
          song={song}
          onLoadFiles={player.loadFiles}
          instrument={player.instrument}
          muted={player.muted}
          userMuted={player.userMuted}
          solo={player.solo}
          volume={player.volume}
          analysers={player.analysers}
          playing={player.playing}
          onToggleMute={player.toggleMute}
          onToggleSolo={player.toggleSolo}
          onVolume={player.setVolume}
          youtube={player.youtube}
          onYoutubeSubmit={player.handleYoutubeSubmit}
          onYoutubeCancel={player.cancelYoutube}
        />
      </div>

      {dragging && (
        <div className="pointer-events-none fixed inset-3 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-ink-2 bg-stage/80 font-cond text-3xl font-semibold text-ink">
          Suelta aquí los stems (.wav/.mp3) y los .mid
        </div>
      )}
    </div>
  )
}
