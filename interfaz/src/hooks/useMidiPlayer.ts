import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { InstrumentId, LoadedSong, SongSource, TrackId } from '../types'
import { TRACK_IDS } from '../types'
import { AudioEngine } from '../utils/audioEngine'
import { createDemoSong } from '../utils/demoSong'
import { buildLocalSong, fetchServerSongs, isAudioFile, isMidiFile, loadSong } from '../utils/songLoader'

const UI_TICK_MS = 100

/**
 * Central player state: song library, loading, the selected instrument (always muted so the
 * user can play it), manual mutes for the accompaniment tracks, and the transport clock.
 * Canvas components read `getTime()` every animation frame; React state `time` updates ~10×/s.
 */
export function useMidiPlayer() {
  const [engine] = useState(() => new AudioEngine())

  const [songs, setSongs] = useState<SongSource[]>(() => [createDemoSong()])
  const [currentId, setCurrentId] = useState('demo')
  const [song, setSong] = useState<LoadedSong | null>(null)
  const [loading, setLoading] = useState<string | null>('Preparando demo…')
  const [error, setError] = useState<string | null>(null)
  const [instrument, setInstrument] = useState<InstrumentId>('guitar')
  const [manualMute, setManualMute] = useState<Record<TrackId, boolean>>({ guitar: false, drums: false, other: false })
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const loadToken = useRef(0)

  const duration = song?.duration ?? 0
  const durationRef = useRef(0)
  useEffect(() => {
    durationRef.current = duration
  }, [duration])

  // Discover songs processed by the pipeline (only available through the Vite dev/preview server).
  useEffect(() => {
    fetchServerSongs().then((found) => {
      if (found.length) setSongs((prev) => [...prev.filter((s) => s.origin !== 'server'), ...found])
    })
  }, [])

  const currentSource = songs.find((s) => s.id === currentId)

  // (Re)load whenever the selected source changes.
  useEffect(() => {
    if (!currentSource) return
    const token = ++loadToken.current
    engine.stop()
    setPlaying(false)
    setTime(0)
    setError(null)
    setLoading(`Cargando ${currentSource.title}…`)
    loadSong(currentSource, engine.decode, (msg) => token === loadToken.current && setLoading(msg))
      .then((loaded) => {
        if (token !== loadToken.current) return
        engine.load(loaded)
        setSong(loaded)
        setLoading(null)
      })
      .catch((e: unknown) => {
        if (token !== loadToken.current) return
        setError(e instanceof Error ? e.message : String(e))
        setLoading(null)
      })
  }, [currentSource, engine])

  // Audio routing rule: the practised instrument is always muted, the rest follow manual mutes.
  const muted = useMemo(() => {
    const m = {} as Record<TrackId, boolean>
    for (const id of TRACK_IDS) m[id] = id === instrument || manualMute[id]
    return m
  }, [instrument, manualMute])

  useEffect(() => {
    for (const id of TRACK_IDS) engine.setMuted(id, muted[id])
  }, [engine, muted, song])

  // Master clock -> React state (throttled) + end-of-song detection.
  useEffect(() => {
    let raf = 0
    let last = 0
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const t = engine.getTime()
      if (engine.playing && durationRef.current > 0 && t >= durationRef.current) {
        engine.pause()
        engine.seek(durationRef.current)
        setPlaying(false)
      }
      if (now - last >= UI_TICK_MS) {
        last = now
        setTime(Math.min(t, durationRef.current || t))
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [engine])

  const play = useCallback(async () => {
    if (!song || loading) return
    if (engine.getTime() >= durationRef.current - 0.05) engine.seek(0)
    await engine.play()
    setPlaying(true)
  }, [engine, song, loading])

  const pause = useCallback(() => {
    engine.pause()
    setPlaying(false)
  }, [engine])

  const togglePlay = useCallback(() => (engine.playing ? pause() : void play()), [engine, play, pause])

  const restart = useCallback(() => {
    engine.seek(0)
    setTime(0)
  }, [engine])

  const seek = useCallback(
    (seconds: number) => {
      engine.seek(Math.min(Math.max(0, seconds), durationRef.current))
      setTime(engine.getTime())
    },
    [engine],
  )

  const toggleTrackMute = useCallback((id: TrackId) => setManualMute((m) => ({ ...m, [id]: !m[id] })), [])

  const selectInstrument = useCallback((id: InstrumentId) => {
    setInstrument(id)
    // The instrument that was being practised returns to the mix as an active track.
    setManualMute((m) => ({ ...m, [id]: false }))
  }, [])

  /**
   * Load user files. Only MIDI -> attach to the current song (replacing that instrument's .mid);
   * any audio -> a new local song built from all the files.
   */
  const loadFiles = useCallback(
    (files: File[]) => {
      const usable = files.filter((f) => isMidiFile(f) || isAudioFile(f))
      if (!usable.length) {
        setError('Formato no reconocido: usa archivos .mid y audio (wav, mp3, flac…).')
        return
      }
      if (!usable.some(isAudioFile) && currentSource) {
        const extra = buildLocalSong(usable, instrument)
        const updated: SongSource = { ...currentSource, midi: { ...currentSource.midi, ...extra.midi } }
        setSongs((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
        return
      }
      const local = buildLocalSong(usable, instrument)
      setSongs((prev) => [...prev, local])
      setCurrentId(local.id)
    },
    [currentSource, instrument],
  )

  return {
    songs,
    currentId,
    selectSong: setCurrentId,
    song,
    loading,
    error,
    instrument,
    selectInstrument,
    activeMidi: song?.midi[instrument] ?? null,
    muted,
    toggleTrackMute,
    playing,
    time,
    duration,
    getTime: useCallback(() => engine.getTime(), [engine]),
    analysers: engine.analysers,
    play,
    pause,
    togglePlay,
    restart,
    seek,
    loadFiles,
  }
}

export type MidiPlayer = ReturnType<typeof useMidiPlayer>
