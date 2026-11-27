import json
import threading
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import pipeline
from .guitar.build import build_tab, notes_from_json
from .piano import build_piano

app = FastAPI(title="Track2Sheet")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["*"],
    allow_headers=["*"],
)
pipeline.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/files", StaticFiles(directory=pipeline.OUTPUT_DIR), name="files")

executor = ThreadPoolExecutor(max_workers=1)
jobs: dict[str, dict] = {}
lock = threading.Lock()


class JobRequest(BaseModel):
    url: str


class Note(BaseModel):
    time: float
    duration: float
    midi: int
    velocity: float = 0.8
    program: int | None = None


class NotesRequest(BaseModel):
    notes: list[Note]
    song: str | None = None


def view(job: dict) -> dict:
    progress = job["progress"]
    return {
        "id": job["id"],
        "status": job["status"],
        "step": progress.step,
        "progress": round(1.0 if job["status"] == "done" else progress.overall, 3),
        "error": job["error"],
        "result": job["result"],
    }


def work(job: dict) -> None:
    if job["progress"].cancel.is_set():
        return
    job["status"] = "running"
    try:
        job["result"] = pipeline.run(job["url"], job["progress"])
        job["status"] = "done"
    except pipeline.Cancelled:
        job["status"] = "cancelled"
    except Exception as e:
        traceback.print_exc()
        job["status"], job["error"] = "error", str(e) or type(e).__name__


def find_job(job_id: str) -> dict:
    if job_id not in jobs:
        raise HTTPException(404, "Unknown job")
    return jobs[job_id]


@app.post("/jobs", status_code=202)
def create_job(req: JobRequest) -> dict:
    video = pipeline.youtube_id(req.url)
    if not video:
        raise HTTPException(422, "Not a YouTube link (youtube.com/watch?v=… or youtu.be/…)")
    with lock:
        for job in jobs.values():
            if job["status"] in ("queued", "running") and pipeline.youtube_id(job["url"]) == video:
                return view(job)
        job = {"id": uuid.uuid4().hex[:12], "url": req.url, "status": "queued", "error": None,
               "result": None, "progress": pipeline.Progress()}
        jobs[job["id"]] = job
    executor.submit(work, job)
    return view(job)


@app.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    return view(find_job(job_id))


@app.delete("/jobs/{job_id}")
def cancel_job(job_id: str) -> dict:
    job = find_job(job_id)
    job["progress"].cancel.set()
    if job["status"] == "queued":
        job["status"] = "cancelled"
    return view(job)


def song_stems(song: str | None, *names: str) -> list:
    if not song:
        return [None] * len(names)
    stems_dir = (pipeline.OUTPUT_DIR / "stems").resolve()
    song_dir = (stems_dir / song).resolve()
    if song_dir.parent != stems_dir:
        raise HTTPException(422, "Invalid song")
    return [pipeline.stem_of(song_dir, name) for name in names]


@lru_cache(maxsize=16)
def cached_tab(body: str) -> dict:
    req = json.loads(body)
    stem, vocals = song_stems(req["song"], "guitar", "vocals")
    return build_tab(notes_from_json(req["notes"]), stem, vocals)


@lru_cache(maxsize=16)
def cached_piano(body: str) -> dict:
    req = json.loads(body)
    stem, guitar, vocals = song_stems(req["song"], "piano", "guitar", "vocals")
    rivals = [p for p in (guitar, vocals) if p] if stem else []
    return build_piano(notes_from_json(req["notes"]), stem, rivals)


@app.post("/tab")
def tab(req: NotesRequest) -> dict:
    return cached_tab(req.model_dump_json())


@app.post("/piano")
def piano(req: NotesRequest) -> dict:
    return cached_piano(req.model_dump_json())
