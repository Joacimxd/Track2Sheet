# Track2Sheet API (native macOS)

FastAPI service that runs the whole pipeline from a YouTube link, without Docker:

```
POST /jobs {url}
  └─ yt-dlp ─► output/downloads/<song>.wav
                ├─ BS-RoFormer SW (audio-separator, MPS) ─► output/stems/<song>/{bass,drums,guitar,other,piano,vocals}.wav
                └─ MuScriptor large (NeuralNote v2's model, muscriptor.cpp + Metal) on the full mix
                     ─► output/midi/<song>/{guitar,drums,bass,piano,all}.mid + notes.json
```

Separation and transcription run **in parallel**. MuScriptor labels each note with its instrument,
so the mix is transcribed directly (no stem needed). Stems are only used for playback.

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
| `POST` | `/jobs` | `{"url": "...", "force": false}` → job. Same video already running → that job. |
| `GET` | `/jobs/{id}` | `status` (queued, running, done, error, cancelled), `step` (0 download, 1 stems, 2 MIDI, 3 preparing), `progress` 0–1, `result` when done |
| `DELETE` | `/jobs/{id}` | cancel (stops the transcription; separation finishes its current file) |
| `GET` | `/files/<path>` | files in `output/` (`result.stems` / `result.midi` paths are relative to this) |
| `GET` | `/health` | engine and model found? |

Songs already processed are reused (`force: true` redoes stems and transcription).

## Notes

- **Speed:** MuScriptor large runs at about 2.7× real time on an M2 (a 4-minute song takes ~11 min).
  The first run after building or a macOS update spends an extra ~20 s compiling the Metal shaders.
- **No tempo or velocity:** the model doesn't predict them, so the MIDI uses 120 BPM and velocity 100.
  Note times are in real seconds either way.
- **License:** the MuScriptor weights are CC BY-NC 4.0 (non-commercial use only).
- `.env` settings: `MUSCRIPTOR_MODEL`, `MUSCRIPTOR_BIN`, `PIPELINE_PARALLEL=0` (run separation then
  transcription, less memory), `API_CORS_ORIGIN_REGEX`, plus the existing `OUTPUT_DIR`, `MODEL_DIR`,
  `SEPARATION_MODEL`, `STEM_FORMAT`, `YTDLP_COOKIES`.
