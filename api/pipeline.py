"""Track2Sheet pipeline: YouTube URL -> mix WAV -> (6 stems || MuScriptor MIDI).

Stems (BS-RoFormer via audio-separator) are only for playback. The transcription runs on the full
mix with MuScriptor large, the model inside NeuralNote v2, through the native engine
engine/bin/t2s_transcribe (muscriptor.cpp + Metal). Both branches run at the same time.

MuScriptor runs in passes, each one told to look for only some instruments (TRANSCRIPTION_PASSES):
guitar, piano, then drums + bass. Run unconditionally (every instrument at once, as NeuralNote does)
it labels whole songs as a single instrument (e.g. a piano ballad comes out as piano and a handful of
drum hits), so every instrument gets a pass of its own. A pass whose stem is silent is skipped (the
song has no such instrument), and a "guitar only" pass hears the piano as guitar and vice versa, so
notes the other instrument's stem explains much better are dropped when the .mid files are written.

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

#: (name, MuScriptor instrument groups, practice instruments it is the source of).
TRANSCRIPTION_PASSES: list[tuple[str, tuple[str, ...], tuple[str, ...]]] = [
    ("guitar", ("acoustic_guitar", "clean_electric_guitar", "distorted_electric_guitar"), ("guitar",)),
    ("piano", ("acoustic_piano", "electric_piano"), ("piano",)),
    ("others", ("drums", "acoustic_bass", "electric_bass"), ("drums", "bass")),
]
#: Only a notes.json of this version is reused; anything else is transcribed again from scratch.
TRANSCRIPTION_VERSION = "passes-v3"
#: A stem quieter than this (dB RMS below the mix) is silent: the song has no such instrument.
SILENT_DB = -30.0
#: A guitar note is the piano's (and vice versa) when the other stem is this many times louder at
#: its pitch and onset.
BLEED_RATIO = 2.5
#: Stems that can steal a family's notes.
RIVALS = {"guitar": ("piano",), "piano": ("guitar",)}
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


def run_muscriptor(raw: Path, out: Path, groups: tuple[str, ...], progress: Progress,
                   on_progress: Callable[[float], None]) -> dict:
    """One MuScriptor pass over 16 kHz mono float32 audio, restricted to `groups` (empty = all)."""
    cmd = [str(MUSCRIPTOR_BIN), "--model", str(MUSCRIPTOR_MODEL), "--audio", str(raw), "--out", str(out)]
    if groups:
        cmd += ["--instruments", ",".join(groups)]
    proc = subprocess.Popen(cmd, stderr=subprocess.PIPE, stdout=subprocess.DEVNULL, text=True)
    error = ""
    watcher = threading.Thread(target=lambda: (progress.cancel.wait(), proc.poll() is None and proc.kill()),
                               daemon=True)
    watcher.start()
    assert proc.stderr
    for line in proc.stderr:
        kind, _, value = line.strip().partition(" ")
        if kind == "progress":
            on_progress(float(value))
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
    return json.loads(out.read_text())


def family(note: dict) -> str:
    """Practice instrument of a MuScriptor note, by General MIDI program family."""
    if note["is_drum"]:
        return "drums"
    p = note["program"]
    return "guitar" if 24 <= p <= 31 else "bass" if 32 <= p <= 39 else "piano" if 0 <= p <= 7 else "other"


def stem_of(stems_dir: Path, name: str) -> Path | None:
    return next(iter(sorted(stems_dir.glob(f"{name}.*"))), None)


def _rms_db(path: Path) -> float:
    audio, _ = sf.read(str(path), dtype="float32", always_2d=True)
    return float(10 * np.log10(np.mean(audio.mean(axis=1) ** 2) + 1e-12))


def silent_stems(stems_dir: Path, mix: Path) -> set[str]:
    """Practice instruments whose stem is (nearly) silent next to the mix. Missing stems: not silent."""
    ref = _rms_db(mix)
    return {name for name in ("guitar", "piano", "drums", "bass")
            if (stem := stem_of(stems_dir, name)) and _rms_db(stem) - ref < SILENT_DB}


def transcribe(mix: Path, notes_json: Path, progress: Progress,
               skip: Callable[[str], bool] | None = None) -> dict:
    """One MuScriptor pass per entry of TRANSCRIPTION_PASSES; each keeps only its own instruments.
    `skip(name)` is asked before each pass (silent stem). A notes.json of this version is reused."""
    if notes_json.exists():
        data = json.loads(notes_json.read_text())
        if data.get("version") == TRANSCRIPTION_VERSION:
            progress.transcribe = 1.0
            return data
    if not MUSCRIPTOR_BIN.exists():
        raise RuntimeError(f"{MUSCRIPTOR_BIN} not found: run engine/build.sh")
    if not MUSCRIPTOR_MODEL.exists():
        raise RuntimeError(f"MuScriptor model not found at {MUSCRIPTOR_MODEL} (set MUSCRIPTOR_MODEL)")

    notes_json.parent.mkdir(parents=True, exist_ok=True)
    data: dict = {"version": TRANSCRIPTION_VERSION, "passes": [], "skipped": [], "notes": []}
    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "mix.f32"
        to_16k_mono(mix, raw)
        progress.check()
        for i, (name, groups, families) in enumerate(TRANSCRIPTION_PASSES):
            if skip and skip(name):
                log.info("pass %s skipped (silent stem)", name)
                data["skipped"].append(name)
                continue

            def on_progress(p: float, i: int = i) -> None:
                progress.transcribe = 0.98 * (i + p) / len(TRANSCRIPTION_PASSES)
            result = run_muscriptor(raw, Path(tmp) / f"{name}.json", groups, progress, on_progress)
            data["notes"] += [n for n in result["notes"] if family(n) in families]
            data["passes"].append(name)
            data["device"], data["duration"] = result.get("device"), result.get("duration")
    data["notes"].sort(key=lambda n: (n["onset"], n["pitch"]))
    notes_json.write_text(json.dumps(data))
    progress.transcribe = 1.0
    return data


def remove_bleed(notes: list[dict], own: Path, rivals: list[Path]) -> list[dict]:
    """Drop the notes a rival stem explains much better than the instrument's own stem."""
    from .tab.cleanup import CQT_FPS, CQT_LOWEST, _pitch_energy

    if not rivals:
        return notes
    mine = _pitch_energy(str(own), own.stat().st_mtime)
    others = [_pitch_energy(str(r), r.stat().st_mtime) for r in rivals]
    frames = min(mine.shape[1], *(o.shape[1] for o in others))
    keep = []
    for n in notes:
        k = n["pitch"] - CQT_LOWEST
        a = int(n["onset"] * CQT_FPS) + 1
        b = max(a + 1, int(min(n["offset"], n["onset"] + 0.3) * CQT_FPS))
        if not 0 <= k < mine.shape[0] or a >= frames:
            keep.append(n)
        elif max(o[k, a:b].mean() for o in others) <= BLEED_RATIO * mine[k, a:b].mean():
            keep.append(n)
    return keep


# --- 3. MIDI ------------------------------------------------------------------------------

# One .mid per practice instrument, by General MIDI program family. Every note also goes to all.mid.
FAMILIES = ("guitar", "drums", "bass", "piano")
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


def write_midis(data: dict, midi_dir: Path, stems_dir: Path | None = None,
                silent: set[str] = frozenset()) -> dict[str, Path]:
    """One .mid per practice instrument (+ all.mid). With the stems: no .mid for an instrument whose
    stem is silent, and guitar / piano notes the other one's stem explains better are dropped."""
    notes = [n for n in data["notes"] if family(n) not in silent]
    if stems_dir is not None:
        for name, rivals in RIVALS.items():
            own = stem_of(stems_dir, name)
            others = [p for r in rivals if (p := stem_of(stems_dir, r))]
            if own and others:
                mine = [n for n in notes if family(n) == name]
                kept = {id(n) for n in remove_bleed(mine, own, others)}
                log.info("%s: %d of %d notes were bleed", name, len(mine) - len(kept), len(mine))
                notes = [n for n in notes if family(n) != name or id(n) in kept]
    out = {}
    for name in FAMILIES:
        selected = [n for n in notes if family(n) == name]
        (midi_dir / f"{name}.mid").unlink(missing_ok=True)  # a family with no notes left: no stale .mid
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

    def skip(name: str) -> bool:
        # The first pass usually starts before the stems are ready (it runs whatever the stems say).
        if progress.stems < 1:
            return False
        families = next(f for n, _, f in TRANSCRIPTION_PASSES if n == name)
        return set(families) <= silent_stems(stems_dir, mix)

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
            data = transcribe(mix, midi_dir / "notes.json", progress, skip)
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
            data = transcribe(mix, midi_dir / "notes.json", progress, skip)
    if errors:
        raise errors[0]
    progress.check()

    progress.step, progress.message = 3, "Preparando pistas"
    midis = write_midis(data, midi_dir, stems_dir, silent_stems(stems_dir, mix))
    stems = {s: p for s in STEMS for p in sorted(stems_dir.glob(f"{s}.*"))[:1]}
    return {
        "id": song,
        "title": pretty_title(song),
        "device": data.get("device", progress.device),
        "notes": len(data["notes"]),
        "stems": {k: p.relative_to(OUTPUT_DIR).as_posix() for k, p in stems.items()},
        "midi": {k: p.relative_to(OUTPUT_DIR).as_posix() for k, p in midis.items()},
    }
