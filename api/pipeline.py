"""Track2Sheet pipeline: YouTube URL -> mix WAV -> (6 stems || MuScriptor MIDI).

Stems (BS-RoFormer via audio-separator) are only for playback. The transcription runs on the full
mix with MuScriptor large, the model inside NeuralNote v2, through the native engine
engine/bin/t2s_transcribe (muscriptor.cpp + Metal). MuScriptor labels every note with its
instrument, so the mix doesn't need splitting first. Both branches run at the same time.

Output layout (the same one the notebooks and the Vite `/api/songs` listing use):
  output/downloads/<song>.wav
  output/stems/<song>/{bass,drums,guitar,other,piano,vocals}.wav
  output/midi/<song>/{guitar,drums,bass,piano,...}.mid, all.mid, notes.json
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import mido
import numpy as np
import soundfile as sf
import soxr
import yt_dlp
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

OUTPUT_DIR = ROOT / os.getenv("OUTPUT_DIR", "output")
MODEL_DIR = ROOT / os.getenv("MODEL_DIR", "models")
SEPARATION_MODEL = os.getenv("SEPARATION_MODEL", "BS-Roformer-SW.ckpt")
STEM_FORMAT = os.getenv("STEM_FORMAT", "WAV")
COOKIES = os.getenv("YTDLP_COOKIES") or None
MUSCRIPTOR_BIN = ROOT / os.getenv("MUSCRIPTOR_BIN", "engine/bin/t2s_transcribe")
MUSCRIPTOR_MODEL = Path(os.path.expanduser(
    os.getenv("MUSCRIPTOR_MODEL", "~/Library/NeuralNote/models/muscriptor-large-f16.gguf")))
# Run separation and transcription at the same time (both use the GPU; needs ~8 GB free RAM)
PARALLEL = os.getenv("PIPELINE_PARALLEL", "1") != "0"

STEMS = ("bass", "drums", "guitar", "other", "piano", "vocals")
SAMPLE_RATE = 16000  # MuScriptor's only input rate

log = logging.getLogger("track2sheet")


class Cancelled(Exception):
    pass


@dataclass
class Progress:
    """Shared, thread-safe progress of one job, read by GET /jobs/{id}."""

    step: int = 0                 # index in the UI's PIPELINE_STEPS
    download: float = 0.0
    stems: float = 0.0            # 0 = running/pending, 1 = done (audio-separator has no callback)
    transcribe: float = 0.0
    message: str = ""
    device: str = ""
    cancel: threading.Event = field(default_factory=threading.Event)

    @property
    def overall(self) -> float:
        # Download is quick; transcription (large model ~2.7x real time on an M2) dominates.
        return min(1.0, 0.08 * self.download + 0.22 * self.stems + 0.65 * self.transcribe
                   + (0.05 if self.step >= 3 else 0.0))

    def check(self) -> None:
        if self.cancel.is_set():
            raise Cancelled()


# --- 1. download --------------------------------------------------------------------------


def youtube_id(url: str) -> str | None:
    m = re.search(r"(?:youtube\.com/(?:watch\?(?:.*&)?v=|embed/|shorts/|live/)|youtu\.be/)([\w-]{11})", url)
    return m.group(1) if m else None


def find_song(video_id: str) -> str | None:
    """Folder name of an already downloaded song with this video id."""
    for wav in (OUTPUT_DIR / "downloads").glob(f"*[[]{video_id}[]].wav"):
        return wav.stem
    return None


def download(url: str, progress: Progress) -> Path:
    out_dir = OUTPUT_DIR / "downloads"
    out_dir.mkdir(parents=True, exist_ok=True)

    def hook(d: dict) -> None:
        progress.check()
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            if total:
                progress.download = 0.95 * d.get("downloaded_bytes", 0) / total

    opts = {
        "format": "bestaudio/best",
        "outtmpl": str(out_dir / "%(title)s [%(id)s].%(ext)s"),
        "restrictfilenames": True,
        "noplaylist": True,
        "quiet": True,
        "noprogress": True,
        "progress_hooks": [hook],
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "wav"}],
    }
    if COOKIES:
        opts["cookiefile"] = str(ROOT / COOKIES)
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
        wav = Path(ydl.prepare_filename(info)).with_suffix(".wav")
        if not wav.exists():
            info = ydl.process_ie_result(info, download=True)
            wav = Path(info["requested_downloads"][0]["filepath"])
    progress.download = 1.0
    return wav


# --- 2a. stems ----------------------------------------------------------------------------


def stems_done(out_dir: Path) -> bool:
    return all(any(out_dir.glob(f"{s}.*")) for s in STEMS)


def separate(mix: Path, out_dir: Path, progress: Progress) -> None:
    if stems_done(out_dir):
        progress.stems = 1.0
        return
    from audio_separator.separator import Separator  # slow import (torch)

    out_dir.mkdir(parents=True, exist_ok=True)
    separator = Separator(output_dir=str(out_dir), output_format=STEM_FORMAT,
                          model_file_dir=str(MODEL_DIR), log_level=logging.WARNING)
    separator.load_model(model_filename=SEPARATION_MODEL)
    progress.check()
    outputs = separator.separate(str(mix))
    # "<song>_(Vocals)_BS-Roformer-SW.wav" -> "vocals.wav"
    for f in outputs:
        src = Path(f) if Path(f).is_absolute() else out_dir / f
        names = re.findall(r"_\(([^)]+)\)", src.stem)
        shutil.move(src, out_dir / f"{(names[-1] if names else src.stem).lower()}{src.suffix}")
    del separator
    progress.stems = 1.0


# --- 2b. transcription --------------------------------------------------------------------


def to_16k_mono(mix: Path, dst: Path) -> None:
    """Downmix and resample with soxr (VHQ): MuScriptor is sensitive to the resampling filter."""
    audio, sr = sf.read(str(mix), dtype="float32", always_2d=True)
    mono = audio.mean(axis=1)
    if sr != SAMPLE_RATE:
        mono = soxr.resample(mono, sr, SAMPLE_RATE, quality="VHQ")
    np.ascontiguousarray(mono, dtype="<f4").tofile(dst)


def transcribe(mix: Path, notes_json: Path, progress: Progress) -> dict:
    if notes_json.exists():
        progress.transcribe = 1.0
        return json.loads(notes_json.read_text())
    if not MUSCRIPTOR_BIN.exists():
        raise RuntimeError(f"{MUSCRIPTOR_BIN} not found: run engine/build.sh")
    if not MUSCRIPTOR_MODEL.exists():
        raise RuntimeError(f"MuScriptor model not found at {MUSCRIPTOR_MODEL} (set MUSCRIPTOR_MODEL)")

    notes_json.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "mix.f32"
        to_16k_mono(mix, raw)
        progress.check()
        part = Path(tmp) / "notes.json"
        proc = subprocess.Popen(
            [str(MUSCRIPTOR_BIN), "--model", str(MUSCRIPTOR_MODEL), "--audio", str(raw), "--out", str(part)],
            stderr=subprocess.PIPE, stdout=subprocess.DEVNULL, text=True)
        error = ""
        watcher = threading.Thread(target=lambda: (progress.cancel.wait(), proc.poll() is None and proc.kill()),
                                   daemon=True)
        watcher.start()
        assert proc.stderr
        for line in proc.stderr:
            kind, _, value = line.strip().partition(" ")
            if kind == "progress":
                progress.transcribe = 0.98 * float(value)
            elif kind == "load":
                progress.message = "Cargando MuScriptor large"
            elif kind == "device":
                progress.device = value
            elif kind == "error":
                error = value
        code = proc.wait()
        progress.check()
        if code != 0:
            raise RuntimeError(f"MuScriptor failed ({code}): {error or 'see logs'}")
        shutil.move(part, notes_json)
    progress.transcribe = 1.0
    return json.loads(notes_json.read_text())


# --- 3. MIDI ------------------------------------------------------------------------------

# One .mid per practice instrument, by General MIDI program family. Every note also goes to all.mid.
FAMILIES: dict[str, Callable[[dict], bool]] = {
    "guitar": lambda n: not n["is_drum"] and 24 <= n["program"] <= 31,
    "drums": lambda n: n["is_drum"],
    "bass": lambda n: not n["is_drum"] and 32 <= n["program"] <= 39,
    "piano": lambda n: not n["is_drum"] and 0 <= n["program"] <= 7,
}
PPQ, BPM, VELOCITY = 480, 120, 100   # the model has no tempo or velocity


def write_midi(notes: list[dict], path: Path) -> None:
    """One track per decoded instrument; drums on channel 10."""
    mid = mido.MidiFile(ticks_per_beat=PPQ)
    meta = mido.MidiTrack([mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(BPM), time=0),
                           mido.MetaMessage("time_signature", numerator=4, denominator=4, time=0)])
    mid.tracks.append(meta)
    to_ticks = lambda s: round(s * PPQ * BPM / 60)

    by_inst: dict[tuple[str, int, bool], list[dict]] = {}
    for n in notes:
        by_inst.setdefault((n["instrument"], n["program"], n["is_drum"]), []).append(n)

    channels = iter(c for c in range(16) if c != 9)
    for (name, program, is_drum), group in sorted(by_inst.items(), key=lambda kv: (kv[0][2], kv[0][1])):
        ch = 9 if is_drum else next(channels, 0)
        events = []
        for n in group:
            events.append((to_ticks(n["onset"]), 1, n["pitch"]))
            events.append((max(to_ticks(n["offset"]), to_ticks(n["onset"]) + 1), 0, n["pitch"]))
        events.sort(key=lambda e: (e[0], e[1]))  # note-offs before note-ons at the same tick
        track = mido.MidiTrack([mido.MetaMessage("track_name", name=name, time=0)])
        if not is_drum:
            track.append(mido.Message("program_change", channel=ch, program=program, time=0))
        now = 0
        for tick, on, pitch in events:
            track.append(mido.Message("note_on" if on else "note_off", channel=ch, note=pitch,
                                      velocity=VELOCITY if on else 0, time=tick - now))
            now = tick
        mid.tracks.append(track)
    mid.save(str(path))


def write_midis(data: dict, midi_dir: Path) -> dict[str, Path]:
    notes = data["notes"]
    out = {}
    for name, keep in FAMILIES.items():
        selected = [n for n in notes if keep(n)]
        if selected:
            write_midi(selected, midi_dir / f"{name}.mid")
            out[name] = midi_dir / f"{name}.mid"
    if notes:
        write_midi(notes, midi_dir / "all.mid")
        out["all"] = midi_dir / "all.mid"
    return out


# --- whole pipeline -----------------------------------------------------------------------


def pretty_title(song: str) -> str:
    return re.sub(r"\s*\[[^\]]+\]\s*$", "", song).replace("_", " ").strip()


def run(url: str, progress: Progress, force: bool = False) -> dict:
    progress.step, progress.message = 0, "Descargando audio de YouTube"
    mix = download(url, progress)
    song = mix.stem
    stems_dir, midi_dir = OUTPUT_DIR / "stems" / song, OUTPUT_DIR / "midi" / song
    if force:
        shutil.rmtree(stems_dir, ignore_errors=True)
        (midi_dir / "notes.json").unlink(missing_ok=True)
    progress.check()

    progress.step, progress.message = 1, "Separando stems y transcribiendo con MuScriptor"
    errors: list[BaseException] = []

    def stems_branch() -> None:
        try:
            separate(mix, stems_dir, progress)
            if progress.transcribe < 1:
                progress.step = 2
        except BaseException as e:  # noqa: BLE001 - re-raised below
            errors.append(e)
            progress.cancel.set()  # stop the other branch

    if PARALLEL:
        t = threading.Thread(target=stems_branch, daemon=True)
        t.start()
        try:
            data = transcribe(mix, midi_dir / "notes.json", progress)
        except BaseException:
            progress.cancel.set()
            t.join()  # separation can't be interrupted; wait so the GPU is free for the next job
            if errors:
                raise errors[0]  # the separation error is the real cause, not our Cancelled
            raise
        t.join()
    else:
        stems_branch()
        if not errors:
            progress.step = 2
            data = transcribe(mix, midi_dir / "notes.json", progress)
    if errors:
        raise errors[0]
    progress.check()

    progress.step, progress.message = 3, "Preparando pistas"
    midis = write_midis(data, midi_dir)
    stems = {s: p for s in STEMS for p in sorted(stems_dir.glob(f"{s}.*"))[:1]}
    return {
        "id": song,
        "title": pretty_title(song),
        "device": data.get("device", progress.device),
        "notes": len(data["notes"]),
        "stems": {k: p.relative_to(OUTPUT_DIR).as_posix() for k, p in stems.items()},
        "midi": {k: p.relative_to(OUTPUT_DIR).as_posix() for k, p in midis.items()},
    }
