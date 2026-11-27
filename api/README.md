# Track2Sheet API (native macOS)

FastAPI service that runs the whole pipeline from a YouTube link, without Docker:

```
POST /jobs {url}
  └─ yt-dlp ─► output/downloads/<song>.wav
                ├─ BS-RoFormer SW (audio-separator, MPS) ─► output/stems/<song>/{bass,drums,guitar,other,piano,vocals}.wav
                └─ MuScriptor large (NeuralNote v2's model, muscriptor.cpp + Metal) on the full mix,
                   pass 1: guitar only, pass 2: piano only, pass 3: drums + bass
                     ─► output/midi/<song>/{guitar,drums,bass,piano,all}.mid + notes.json
```

Separation and transcription run **in parallel**. MuScriptor gets **one pass per instrument**: run
once over everything (as NeuralNote does) it labels a whole song as one instrument — Sign of the
Times came out as 2295 piano notes, 33 drum hits and no guitar or bass. Told which instrument to
look for, it finds each one.

- A pass whose stem is **silent** (the song has no piano, say) is skipped and no .mid is written
  for it. The first pass usually starts before the stems are ready, so it always runs; its .mid is
  still left out if the stem turns out silent.
- **Guitar ↔ piano bleed:** asked for guitar only, MuScriptor hears the piano as guitar (and the
  other way round). When the .mid files are written, guitar notes the piano stem explains much
  better are dropped, and vice versa. `notes.json` keeps the raw passes.
- Only a `notes.json` of the current version (`passes-v3`) is reused; anything older is
  transcribed again from scratch.

Songs already in `output/` can be redone without the API:

```bash
.venv/bin/python -m api.retranscribe                 # every song in output/midi/ not up to date
.venv/bin/python -m api.retranscribe "<song folder>" # that song, even if it is up to date
```

It uses `output/downloads/<song>.wav` or, when there is none, the sum of the song's stems. The old
MIDI files and `notes.json` are moved to `output/midi/<song>/backup/`.

## Setup (once)

```bash
brew install cmake ninja ffmpeg
engine/build.sh                                   # builds engine/bin/t2s_transcribe (~2 min)
uv venv --python 3.12 .venv
uv pip install --python .venv -r api/requirements.txt
```

The MuScriptor weights are the ones NeuralNote downloads
(`~/Library/NeuralNote/models/muscriptor-large-f16.gguf`). Override with `MUSCRIPTOR_MODEL` in
`.env` (e.g. the `medium` file is about 3x faster). The BS-RoFormer model (~700 MB) downloads to
`models/` on the first job.

## Run

```bash
.venv/bin/uvicorn api.main:app --host 127.0.0.1 --port 8765
```

and in `interfaz/.env.local`:

```
VITE_PIPELINE_URL=http://127.0.0.1:8765
```

then `npm run dev` in `interfaz/` and paste a YouTube link.

## Endpoints

| Method | Path | |
|---|---|---|
| `POST` | `/piano` | `{"notes": [...], "song": "<folder>"?}` → piano notes with a hand each (see below) |
| `POST` | `/jobs` | `{"url": "...", "force": false}` → job. Same video already running → that job. |
| `GET` | `/jobs/{id}` | `status` (queued, running, done, error, cancelled), `step` (0 download, 1 stems, 2 MIDI, 3 preparing), `progress` 0–1, `result` when done |
| `DELETE` | `/jobs/{id}` | cancel (stops the transcription; separation finishes its current file) |
| `GET` | `/files/<path>` | files in `output/` (`result.stems` / `result.midi` paths are relative to this) |
| `GET` | `/health` | engine and model found? |

Songs already processed are reused (`force: true` redoes stems and transcription).

## Guitar tablature (`api/tab/`, `POST /tab`)

The interface sends the guitar notes of the song (from its .mid, each with the MIDI `program` of its
track) and gets the tab back, ready to draw.

| Step | Module | What it does |
|---|---|---|
| sung notes | `cleanup.py` | notes the vocals stem explains much better than the guitar stem are dropped |
| loudness, tuning | `cleanup.py` | MuScriptor has no velocity: measured on the guitar stem; E standard, Eb, drop D or D from the lowest notes |
| **cleaner** | `guitar_cleaner.py` | see below |
| fingering | `fingering.py` | one global Viterbi over (fingering, hand position) for the single notes; chords keep their standard shape |
| chords | `chords.py` | names (deterministic per pitch set) and the chord-chart shapes |

**The cleaner** (`guitar_cleaner.py`). MuScriptor writes on a beat grid (everything struck together
has exactly the same onset) and often hears two guitars at once, labelled as different programs.
So:

1. **Each guitar (program) is cleaned on its own**: mixed, a strum plus a line on top looked like a
   7–16 note "chord".
2. **Chord or notes, per strike:** 3+ pitch classes that name a chord, or root + fifth with an octave
   doubled → chord; one note → notes; a third / sixth → double stop (notes); root + fifth alone →
   leans chord. A Viterbi pass over each guitar decides the doubtful ones by context (a dyad inside a
   strummed section is a chord, inside a riff it is notes), with switching free after a rest.
3. **Chords → standard:** a fragment takes the name of the full chord around it (a C strum heard as
   root + fifth is a C, not a C5); extensions go (maj7 / add9 → major, sus → power chord unless it
   keeps coming back) and every chord gets its chord-chart shape (open chord, or a barre as low as
   possible, bass on the bass that was heard) — one shape per chord for the whole song.
4. **Single notes are left exactly as heard.**
5. **Parts:** `rhythm` = every chord + the notes that don't clash with one; `auto` = the same, but
   where a line is played over chords (`solos`) the line replaces them.

Response: `tuning`, `solos`, `parts.auto` / `parts.rhythm` (`notes` with time, midi, string, fret…,
and `chords` with their names), and `stats` (guitars found, chord / note strikes, chord names).

**Measuring changes:** `.venv/bin/python -m api.tab.evaluate` scores every song in `output/midi/`
(position shifts and frets travelled per minute, stretches, ringing-string conflicts, consistency
of repeated chords, solos found, chord names). `notebooks/guitar_cleanup.ipynb` shows the MIDI
before / after as a piano roll and plays it with a synthesized electric guitar.
`.venv/bin/python -m pytest api/tests` runs the unit tests.

## Piano (`api/piano.py`, `POST /piano`)

The interface sends the piano notes of the song (from its `piano.mid`) and draws what comes back:

| Step | What it does |
|---|---|
| bleed | notes the guitar or vocals stem explains much better than the piano stem are dropped (not the bass stem: the left hand doubles the bass) |
| held notes | MuScriptor re-emits a held note on every grid step: back-to-back notes of one key are joined unless the piano stem shows a new attack there |
| ghosts | notes with almost nothing at their pitch in the piano stem (30 dB below the loudest key) go |
| overtones | a note 12 / 19 / 24 semitones above a key struck with it, much weaker and ending with it, goes |
| fingers | two hands, five fingers each, one hand reaching at most a ninth (14 semitones): of notes struck together that no pair of hands could play (more than ten, more than five within a hand's reach, three clusters far apart), the loudest playable set stays (bass and top note weigh a bit more). Held notes don't count: the pedal holds them |
| strays | short notes more than an octave from everything else for a second each side, and blips under 40 ms, go |
| loudness | measured on the piano stem |
| hands | `hand` 0 (left) / 1 (right): notes struck together that span more than an octave or are more than five are cut at their widest gap that leaves each hand at most five notes within its reach; otherwise they go to the hand whose recent position is closest |

Without `song` (no stems) only fingers, strays, blips and touching fragments are handled (fingers then keep the longest notes).

Response: `notes` (`id`, `time`, `duration`, `midi`, `velocity`, `hand`), `range` (lowest / highest
pitch) and `removed` (how many notes each rule removed).

## Notes

- **Speed:** a MuScriptor large pass takes about 1.5–2.7× the song's length on an M2: a 4-minute
  song takes ~18–30 min with the three passes (~12–20 without piano).
  The first run after building or a macOS update spends an extra ~20 s compiling the Metal shaders.
- **No tempo or velocity:** the model doesn't predict them, so the MIDI uses 120 BPM and velocity 100.
  Note times are in real seconds either way.
- **License:** the MuScriptor weights are CC BY-NC 4.0 (non-commercial use only).
- `.env` settings: `MUSCRIPTOR_MODEL`, `MUSCRIPTOR_BIN`, `PIPELINE_PARALLEL=0` (run separation then
  transcription, less memory), `API_CORS_ORIGIN_REGEX`, plus the existing `OUTPUT_DIR`, `MODEL_DIR`,
  `SEPARATION_MODEL`, `STEM_FORMAT`, `YTDLP_COOKIES`.
