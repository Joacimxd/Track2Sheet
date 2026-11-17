# Track2Sheet

Download a song from YouTube and split it into 6 stems (vocals, drums, bass, guitar, piano,
other) with **BS-RoFormer SW**, all from one Jupyter notebook running in Docker.

## Project layout

```
.env.example            settings template (copy to .env)
Dockerfile              Python 3.12 + ffmpeg + yt-dlp + audio-separator + JupyterLab
docker-compose.yml      runs JupyterLab on http://localhost:8888
docker-compose.gpu.yml  optional NVIDIA GPU override
requirements.txt
notebooks/
  track2stems.ipynb     1. download  2. separate into stems
docs/process.txt        research notes
models/                 separation model cache (downloaded on first run, ~700 MB)
output/
  downloads/<song>.wav
  stems/<song>/<stem>.wav
```

## Run

```bash
cp .env.example .env          # then edit it (set JUPYTER_TOKEN, HOST_UID/HOST_GID = `id -u` / `id -g`)
docker compose up --build
```

Open `http://localhost:8888/?token=<JUPYTER_TOKEN>`. The notebook opens automatically.

## GPU (NVIDIA)

Separation is much faster on a GPU. Docker needs the
[NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
on the host. Then set this in `.env`:

```
COMPOSE_FILE=docker-compose.yml:docker-compose.gpu.yml
```

The notebook's setup cell prints which device it is using. Without a GPU it runs on the CPU.

## Settings (`.env`)

| Variable | Meaning |
|---|---|
| `YOUTUBE_URL` | default song (can also be changed in the notebook) |
| `OUTPUT_DIR`, `MODEL_DIR` | data folders, relative to the project root |
| `SEPARATION_MODEL` | audio-separator model file, default `BS-Roformer-SW.ckpt` |
| `STEM_FORMAT` | `WAV`, `FLAC` or `MP3` |
| `YTDLP_COOKIES` | optional cookies file for yt-dlp, if YouTube asks you to sign in |
| `JUPYTER_PORT`, `JUPYTER_TOKEN` | where JupyterLab listens and its login token |
| `HOST_UID`, `HOST_GID` | your user/group id, so files in `output/` belong to you |
| `COMPOSE_FILE` | add `docker-compose.gpu.yml` to use the GPU |
