"""Track2Sheet REST API (native macOS, see api/README.md).

    POST   /jobs              {"url": "<youtube link>", "force": false}  -> job
    GET    /jobs/{id}         -> job (poll it; `result` is set when status == "done")
    DELETE /jobs/{id}         -> cancel
    GET    /files/<path>      -> files in output/ (stems, MIDI)
    POST   /tab               {"notes": [...], "song": "<folder>"?} -> guitar tablature
    POST   /piano             {"notes": [...], "song": "<folder>"?} -> piano notes with hands
    GET    /health

Jobs run one at a time (they share the GPU). Inside a job, stem separation and MuScriptor
transcription run in parallel. A song that was already processed is answered from output/.
"""

from __future__ import annotations

import hashlib
import logging
import os
import threading
import traceback
import uuid
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import pipeline
from .piano import build_piano
from .tab import build_tab, notes_from_json

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("track2sheet")

app = FastAPI(title="Track2Sheet pipeline")
app.add_middleware(
    CORSMiddleware,
    # The interface on any local port (Vite moves to 5174… when 5173 is taken)
    allow_origin_regex=os.getenv("API_CORS_ORIGIN_REGEX", r"http://(localhost|127\.0\.0\.1)(:\d+)?"),
    allow_methods=["*"],
    allow_headers=["*"],
)
pipeline.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/files", StaticFiles(directory=pipeline.OUTPUT_DIR), name="files")

executor = ThreadPoolExecutor(max_workers=1)  # one job at a time on the GPU
jobs: dict[str, dict] = {}
lock = threading.Lock()


class JobRequest(BaseModel):
    url: str
    force: bool = False


def view(job: dict) -> dict:
    p: pipeline.Progress = job["progress"]
    return {
        "id": job["id"],
        "url": job["url"],
        "status": job["status"],          # queued | running | done | error | cancelled
        "step": p.step,
        "message": p.message,
        "progress": round(1.0 if job["status"] == "done" else p.overall, 3),
        "parts": {"download": round(p.download, 3), "stems": round(p.stems, 3),
                  "transcribe": round(p.transcribe, 3)},
        "device": p.device,
        "error": job["error"],
        "result": job["result"],
    }


def work(job: dict) -> None:
    p: pipeline.Progress = job["progress"]
    if p.cancel.is_set():
        return
    job["status"] = "running"
    try:
        job["result"] = pipeline.run(job["url"], p, force=job["force"])
        job["status"] = "done"
        log.info("job %s done: %s", job["id"], job["result"]["title"])
    except pipeline.Cancelled:
        job["status"] = "cancelled"
    except Exception as e:  # noqa: BLE001 - reported to the client
        traceback.print_exc()
        job["status"], job["error"] = "error", str(e) or type(e).__name__


@app.post("/jobs", status_code=202)
def create_job(req: JobRequest) -> dict:
    if not pipeline.youtube_id(req.url):
        raise HTTPException(422, "Not a YouTube link (youtube.com/watch?v=… or youtu.be/…)")
    with lock:
        # Same video already queued or running: reuse that job
        for job in jobs.values():
            if job["status"] in ("queued", "running") and pipeline.youtube_id(job["url"]) == pipeline.youtube_id(req.url):
                return view(job)
        job = {"id": uuid.uuid4().hex[:12], "url": req.url, "force": req.force, "status": "queued",
               "error": None, "result": None, "progress": pipeline.Progress()}
        jobs[job["id"]] = job
    executor.submit(work, job)
    return view(job)


@app.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Unknown job")
    return view(job)


@app.delete("/jobs/{job_id}")
def cancel_job(job_id: str) -> dict:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Unknown job")
    job["progress"].cancel.set()
    if job["status"] == "queued":
        job["status"] = "cancelled"
    return view(job)


class TabNote(BaseModel):
    time: float
    duration: float
    midi: int
    velocity: float = 0.8
    #: MIDI program of the note's track: which guitar of the song it is (two guitars at once are
    #: cleaned apart). Optional.
    program: int | None = None


class TabRequest(BaseModel):
    notes: list[TabNote]
    #: Song folder in output/ (optional): its guitar stem gives the notes a loudness.
    song: str | None = None


_cache: OrderedDict[str, dict] = OrderedDict()


def _cached(kind: str, req: BaseModel, compute) -> dict:
    key = kind + hashlib.sha1(req.model_dump_json().encode()).hexdigest()
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key]
    result = _cache[key] = compute()
    while len(_cache) > 16:
        _cache.popitem(last=False)
    return result


def _stems(song: str | None, *names: str) -> list:
    """Stem file of each name for a song folder in output/stems/ (None when missing)."""
    if not song:
        return [None] * len(names)
    song_dir = (pipeline.OUTPUT_DIR / "stems" / song).resolve()
    if song_dir.parent != (pipeline.OUTPUT_DIR / "stems").resolve():
        raise HTTPException(422, "Invalid song")
    return [next(iter(sorted(song_dir.glob(f"{name}.*"))), None) for name in names]


@app.post("/tab")
def tab(req: TabRequest) -> dict:
    """Guitar notes (from a .mid) → playable tab: tuning, solos and two parts, `auto` (rhythm,
    lead line in solos) and `rhythm`. See api/tab/."""
    stem, drums, vocals = _stems(req.song, "guitar", "drums", "vocals")
    return _cached("tab", req, lambda: build_tab(
        notes_from_json([n.model_dump() for n in req.notes]), stem, drums, vocals))


@app.post("/piano")
def piano(req: TabRequest) -> dict:
    """Piano notes (from a .mid) → cleaned notes with a hand each (0 left, 1 right) and their
    range. With `song`, every noise rule is checked against the stems (bleed from guitar / vocals, held notes chopped in pieces, ghosts, overtones). See api/piano.py."""
    # Not the bass stem: the piano's left hand doubles the bass, and would be taken for bleed.
    stem, guitar, vocals = _stems(req.song, "piano", "guitar", "vocals")
    rivals = [p for p in (guitar, vocals) if p] if stem else []
    return _cached("piano", req, lambda: build_piano(
        notes_from_json([n.model_dump() for n in req.notes]), stem, rivals))


@app.get("/health")
def health() -> dict:
    return {
        "engine": pipeline.MUSCRIPTOR_BIN.exists(),
        "model": str(pipeline.MUSCRIPTOR_MODEL),
        "model_found": pipeline.MUSCRIPTOR_MODEL.exists(),
        "separation_model": pipeline.SEPARATION_MODEL,
        "parallel": pipeline.PARALLEL,
        "transcription": pipeline.TRANSCRIPTION_VERSION,
        "passes": [name for name, _, _ in pipeline.TRANSCRIPTION_PASSES],
    }
