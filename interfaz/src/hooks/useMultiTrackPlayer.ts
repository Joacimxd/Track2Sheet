import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { InstrumentId, LoadedSong, MidiNote, SongSource, StemId } from '../types'
import { STEM_IDS } from '../types'
import { AudioEngine } from '../utils/audioEngine'
import { createDemoSong } from '../utils/demoSong'
import { EMPTY_TAB, midiToDrumLanes, type FretboardTab } from '../utils/midiToFretboard'
import { fetchTab, type GuitarPart, type TabResponse } from '../utils/tabApi'
import { fetchPiano, localPiano, type PianoNote } from '../utils/pianoApi'
import { processYoutube, type PipelineStep } from '../utils/pipelineApi'
import { assignFiles, fetchServerSongs, isAudioFile, isMidiFile, loadSong } from '../utils/songLoader'

const UI_TICK_MS = 100
const allStems = <T>(value: T) => Object.fromEntries(STEM_IDS.map((id) => [id, value])) as Record<StemId, T>

export interface YoutubeState {
  status: 'idle' | 'processing' | 'done' | 'error'
  step?: PipelineStep
  message?: string
}

/**
 * Multi-track player: 6 stems on one master clock (the Tone.js transport, read every animation
 * frame), the instrument being practised, per-stem mute / solo / volume,
 * song library (demo, `output/`, local files, YouTube) and the .mid → highway mapping.
 */
export function useMultiTrackPlayer() {
  const [engine] = useState(() => new AudioEngine())

  const [songs, setSongs] = useState<SongSource[]>(() => [createDemoSong()])
  const [currentId, setCurrentId] = useState('demo')
  const [song, setSong] = useState<LoadedSong | null>(null)
  const [loading, setLoading] = useState<string | null>('Preparando demo…')
  const [error, setError] = useState<string | null>(null)
  const [instrument, setInstrument] = useState<InstrumentId>('guitar')
  // Every track sounds until the user mutes it (choosing an instrument doesn't mute it).
  const [userMuted, setUserMuted] = useState(() => allStems(false))
  const [volume, setVolumeState] = useState(() => allStems(0.85))
  // Per-track solo (DAW style): any number of tracks can be soloed together.
  const [solo, setSolo] = useState(() => allStems(false))
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [rate, setRateState] = useState(1)
  const [youtube, setYoutube] = useState<YoutubeState>({ status: 'idle' })
  const loadToken = useRef(0)
  const youtubeAbort = useRef<AbortController | null>(null)

  const duration = song?.duration ?? 0
  const durationRef = useRef(0)
  useEffect(() => {
    durationRef.current = duration
  }, [duration])

  // Songs already processed by the pipeline (only through the Vite dev/preview server).
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

  // Routing rule: each track follows its mute toggle; while any track is soloed, only the soloed
  // tracks sound (solo wins over mute, as in a DAW).
  const muted = useMemo(() => {
    const m = allStems(false)
    const anySolo = STEM_IDS.some((id) => solo[id])
    for (const id of STEM_IDS) m[id] = anySolo ? !solo[id] : userMuted[id]
    return m
  }, [userMuted, solo])

  useEffect(() => {
    for (const id of STEM_IDS) engine.setMix(id, muted[id], volume[id])
  }, [engine, muted, volume, song])

  // Master clock → React state (throttled) + end-of-song detection.
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

  /** Playback speed for all tracks (0.5–1.5, pitch kept). */
  const setRate = useCallback(
    (r: number) => {
      engine.setRate(r)
      setRateState(engine.rate)
    },
    [engine],
  )

  const togglePlay = useCallback(() => (engine.playing ? pause() : void play()), [engine, play, pause])

  /** Stop and rewind every stem and the .mid to 00:00. */
  const restart = useCallback(() => {
    engine.stop()
    setPlaying(false)
    setTime(0)
  }, [engine])

  const seek = useCallback(
    (seconds: number) => {
      engine.seek(Math.min(Math.max(0, seconds), durationRef.current))
      setTime(engine.getTime())
    },
    [engine],
  )

  const selectInstrument = useCallback((id: InstrumentId) => {
    setInstrument(id)
    setSolo(allStems(false))
  }, [])

  const toggleMute = useCallback((id: StemId) => setUserMuted((m) => ({ ...m, [id]: !m[id] })), [])

  const setVolume = useCallback((id: StemId, v: number) => setVolumeState((m) => ({ ...m, [id]: v })), [])

  /** Toggle a track's solo; several can be soloed together. Soloing starts playback if paused. */
  const toggleSolo = useCallback(
    (id: StemId) => {
      setSolo((s) => ({ ...s, [id]: !s[id] }))
      if (!solo[id] && !engine.playing) void play()
    },
    [solo, engine, play],
  )

  /**
   * Load files from disk. `target` = the stem row the user clicked (a single file goes there).
   * A .mid replaces the practice MIDI of the current song; audio starts (or extends) a local song
   * so real stems are never mixed with the demo synths.
   */
  const loadFiles = useCallback(
    (files: File[], target: StemId | null = null) => {
      const usable = files.filter((f) => isMidiFile(f) || isAudioFile(f))
      if (!usable.length) {
        setError('Formato no reconocido: usa audio (.wav, .mp3…) y archivos .mid.')
        return
      }
      if (!currentSource) return
      const hasAudio = usable.some(isAudioFile)
      if (!hasAudio || currentSource.origin === 'local') {
        const updated = assignFiles(currentSource, usable, target, instrument)
        setSongs((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
        return
      }
      const fresh: SongSource = { id: `local:${Date.now()}`, title: 'Canción local', origin: 'local', stems: {}, midi: {} }
      const local = assignFiles(fresh, usable, target, instrument)
      const first = usable.find(isAudioFile)?.name.replace(/\.[^.]+$/, '')
      if (first && usable.length === 1) local.title = `Local · ${first}`
      setSongs((prev) => [...prev, local])
      setCurrentId(local.id)
    },
    [currentSource, instrument],
  )

  /** Entry point for the YouTube link. Connect the real backend in utils/pipelineApi.ts. */
  const handleYoutubeSubmit = useCallback(async (url: string) => {
    youtubeAbort.current?.abort()
    const abort = new AbortController()
    youtubeAbort.current = abort
    setYoutube({ status: 'processing', step: { label: 'Validando enlace', progress: 0 } })
    try {
      const source = await processYoutube(url, (step) => setYoutube({ status: 'processing', step }), abort.signal)
      setSongs((prev) => [...prev.filter((s) => s.id !== source.id), source])
      setCurrentId(source.id)
      setYoutube({ status: 'done', message: `Listo: ${source.title}` })
    } catch (e) {
      if (abort.signal.aborted) return
      setYoutube({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }, [])

  const cancelYoutube = useCallback(() => {
    youtubeAbort.current?.abort()
    setYoutube({ status: 'idle' })
  }, [])

  // Guitar tab: computed by the Python API (api/tab/) whenever the song's guitar notes change.
  // The result remembers which notes it is for, so a stale one is never shown for another song.
  const guitarNotes = song?.midi.guitar?.notes
  const [tabResult, setTabResult] = useState<{ notes: MidiNote[]; tab: TabResponse | null } | null>(null)
  const [guitarPart, setGuitarPart] = useState<GuitarPart>('auto')
  useEffect(() => {
    if (!song || !guitarNotes?.length) return
    const abort = new AbortController()
    fetchTab(guitarNotes, song.source.id, abort.signal)
      .then((tab) => setTabResult({ notes: guitarNotes, tab }))
      .catch((e) => {
        if (abort.signal.aborted) return
        setTabResult({ notes: guitarNotes, tab: null })
        setError(e instanceof Error ? e.message : String(e))
      })
    return () => abort.abort()
  }, [song, guitarNotes])
  const current = tabResult && tabResult.notes === guitarNotes ? tabResult : null
  const tabResponse = current?.tab ?? null
  const tabStatus: 'idle' | 'loading' | 'error' = !guitarNotes?.length ? 'idle' : !current ? 'loading' : current.tab ? 'idle' : 'error'
  const guitarTab = useMemo<FretboardTab>(() => {
    if (!tabResponse) return EMPTY_TAB
    const part = tabResponse.parts[guitarPart]
    return { notes: part.notes, chords: part.chords, solos: tabResponse.solos, labels: tabResponse.tuning.labels }
  }, [tabResponse, guitarPart])
  const drumNotes = useMemo(() => midiToDrumLanes(song?.midi.drums?.notes ?? []), [song])

  // Piano: cleaned and split into hands by the Python API (api/piano.py); raw notes split at
  // middle C while it works or when it can't be reached.
  const pianoMidi = song?.midi.piano?.notes
  const [pianoResult, setPianoResult] = useState<{ notes: MidiNote[]; piano: PianoNote[] | null } | null>(null)
  useEffect(() => {
    if (!song || !pianoMidi?.length) return
    const abort = new AbortController()
    fetchPiano(pianoMidi, song.source.id, abort.signal)
      .then((res) => setPianoResult({ notes: pianoMidi, piano: res.notes }))
      .catch((e) => {
        if (abort.signal.aborted) return
        setPianoResult({ notes: pianoMidi, piano: null })
        setError(e instanceof Error ? e.message : String(e))
      })
    return () => abort.abort()
  }, [song, pianoMidi])
  const pianoCurrent = pianoResult && pianoResult.notes === pianoMidi ? pianoResult : null
  const pianoLoading = !!pianoMidi?.length && !pianoCurrent
  const pianoNotes = useMemo(() => pianoCurrent?.piano ?? localPiano(pianoMidi ?? []), [pianoCurrent, pianoMidi])

  return {
    songs,
    currentId,
    selectSong: setCurrentId,
    song,
    loading,
    error,
    clearError: useCallback(() => setError(null), []),
    instrument,
    selectInstrument,
    practiceMidi: song?.midi[instrument] ?? null,
    guitarTab,
    /** 'loading' while the API computes the tab. */
    tabStatus,
    tuningName: tabResponse?.tuning.name ?? null,
    /** In solos: play the lead line ('auto') or keep the rhythm part ('rhythm'). */
    guitarPart,
    setGuitarPart,
    drumNotes,
    pianoNotes,
    /** true while the API cleans the piano notes. */
    pianoLoading,
    muted,
    userMuted,
    solo,
    volume,
    toggleMute,
    setVolume,
    toggleSolo,
    playing,
    rate,
    setRate,
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
    youtube,
    handleYoutubeSubmit,
    cancelYoutube,
  }
}

export type MultiTrackPlayer = ReturnType<typeof useMultiTrackPlayer>
