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

import mido
import numpy as np
import soundfile as sf
import soxr
import yt_dlp

from .audio import remove_bleed

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = ROOT / "output"
MODEL_DIR = ROOT / "models"
SEPARATION_MODEL = "BS-Roformer-SW.ckpt"
MUSCRIPTOR_BIN = Path(os.getenv("MUSCRIPTOR_BIN", ROOT / "engine/bin/t2s_transcribe"))
MUSCRIPTOR_MODEL = Path(os.getenv("MUSCRIPTOR_MODEL", MODEL_DIR / "muscriptor-large-f16.gguf"))

STEMS = ("bass", "drums", "guitar", "other", "piano", "vocals")
INSTRUMENTS = ("guitar", "drums", "bass", "piano")
PASSES = [
    ("guitar", ("acoustic_guitar", "clean_electric_guitar", "distorted_electric_guitar"), ("guitar",)),
    ("piano", ("acoustic_piano", "electric_piano"), ("piano",)),
    ("others", ("drums", "acoustic_bass", "electric_bass"), ("drums", "bass")),
]
RIVALS = {"guitar": "piano", "piano": "guitar"}
SILENT_DB = -30.0
BLEED_RATIO = 2.5
SAMPLE_RATE = 16000
PPQ, BPM, VELOCITY = 480, 120, 100


class Cancelled(Exception):
    pass


@dataclass
class Progress:
    step: int = 0
    download: float = 0.0
    stems: float = 0.0
    transcribe: float = 0.0
    cancel: threading.Event = field(default_factory=threading.Event)

    @property
    def overall(self) -> float:
        return min(1.0, 0.08 * self.download + 0.22 * self.stems + 0.65 * self.transcribe
                   + (0.05 if self.step >= 3 else 0.0))

    def check(self) -> None:
        if self.cancel.is_set():
            raise Cancelled()


def youtube_id(url: str) -> str | None:
    m = re.search(r"(?:youtube\.com/(?:watch\?(?:.*&)?v=|embed/|shorts/|live/)|youtu\.be/)([\w-]{11})", url)
    return m.group(1) if m else None


def download(url: str, progress: Progress) -> Path:
    out_dir = OUTPUT_DIR / "downloads"
    out_dir.mkdir(parents=True, exist_ok=True)

    def hook(d: dict) -> None:
        progress.check()
        total = d.get("total_bytes") or d.get("total_bytes_estimate")
        if d.get("status") == "downloading" and total:
            progress.download = 0.95 * d.get("downloaded_bytes", 0) / total

    options = {
        "format": "bestaudio/best",
        "outtmpl": str(out_dir / "%(title)s [%(id)s].%(ext)s"),
        "restrictfilenames": True,
        "noplaylist": True,
        "quiet": True,
        "noprogress": True,
        "progress_hooks": [hook],
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "wav"}],
    }
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=False)
        wav = Path(ydl.prepare_filename(info)).with_suffix(".wav")
        if not wav.exists():
            info = ydl.process_ie_result(info, download=True)
            wav = Path(info["requested_downloads"][0]["filepath"])
    progress.download = 1.0
    return wav


def stem_of(stems_dir: Path, name: str) -> Path | None:
    return next(iter(sorted(stems_dir.glob(f"{name}.*"))), None)


def separate(mix: Path, out_dir: Path, progress: Progress) -> None:
    if all(stem_of(out_dir, s) for s in STEMS):
        progress.stems = 1.0
        return
    from audio_separator.separator import Separator

    out_dir.mkdir(parents=True, exist_ok=True)
    separator = Separator(output_dir=str(out_dir), output_format="WAV", model_file_dir=str(MODEL_DIR),
                          log_level=logging.WARNING)
    separator.load_model(model_filename=SEPARATION_MODEL)
    progress.check()
    for f in separator.separate(str(mix)):
        src = Path(f) if Path(f).is_absolute() else out_dir / f
        names = re.findall(r"_\(([^)]+)\)", src.stem)
        shutil.move(src, out_dir / f"{(names[-1] if names else src.stem).lower()}{src.suffix}")
    progress.stems = 1.0


def to_16k_mono(mix: Path, dst: Path) -> None:
    audio, sr = sf.read(str(mix), dtype="float32", always_2d=True)
    mono = audio.mean(axis=1)
    if sr != SAMPLE_RATE:
        mono = soxr.resample(mono, sr, SAMPLE_RATE, quality="VHQ")
    np.ascontiguousarray(mono, dtype="<f4").tofile(dst)


def run_muscriptor(raw: Path, out: Path, groups: tuple[str, ...], progress: Progress, on_progress) -> dict:
    cmd = [str(MUSCRIPTOR_BIN), "--model", str(MUSCRIPTOR_MODEL), "--audio", str(raw), "--out", str(out),
           "--instruments", ",".join(groups)]
    proc = subprocess.Popen(cmd, stderr=subprocess.PIPE, stdout=subprocess.DEVNULL, text=True)
    threading.Thread(target=lambda: (progress.cancel.wait(), proc.poll() is None and proc.kill()),
                     daemon=True).start()
    error = ""
    for line in proc.stderr:
        kind, _, value = line.strip().partition(" ")
        if kind == "progress":
            on_progress(float(value))
        elif kind == "error":
            error = value
    code = proc.wait()
    progress.check()
    if code != 0:
        raise RuntimeError(f"MuScriptor failed ({code}): {error or 'see logs'}")
    return json.loads(out.read_text())


def family(note: dict) -> str:
    if note["is_drum"]:
        return "drums"
    p = note["program"]
    return "guitar" if 24 <= p <= 31 else "bass" if 32 <= p <= 39 else "piano" if 0 <= p <= 7 else "other"


def loudness_db(path: Path) -> float:
    audio, _ = sf.read(str(path), dtype="float32", always_2d=True)
    return float(10 * np.log10(np.mean(audio.mean(axis=1) ** 2) + 1e-12))


def silent_stems(stems_dir: Path, mix: Path) -> set[str]:
    mix_db = loudness_db(mix)
    return {name for name in INSTRUMENTS
            if (stem := stem_of(stems_dir, name)) and loudness_db(stem) - mix_db < SILENT_DB}


def transcribe(mix: Path, notes_json: Path, progress: Progress, skip=lambda name: False) -> dict:
    if notes_json.exists():
        progress.transcribe = 1.0
        return json.loads(notes_json.read_text())
    if not MUSCRIPTOR_BIN.exists():
        raise RuntimeError(f"{MUSCRIPTOR_BIN} not found")
    if not MUSCRIPTOR_MODEL.exists():
        raise RuntimeError(f"MuScriptor model not found at {MUSCRIPTOR_MODEL}")

    notes_json.parent.mkdir(parents=True, exist_ok=True)
    notes = []
    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "mix.f32"
        to_16k_mono(mix, raw)
        progress.check()
        for i, (name, groups, families) in enumerate(PASSES):
            if skip(name):
                continue

            def on_progress(p: float, i: int = i) -> None:
                progress.transcribe = 0.98 * (i + p) / len(PASSES)

            result = run_muscriptor(raw, Path(tmp) / f"{name}.json", groups, progress, on_progress)
            notes += [n for n in result["notes"] if family(n) in families]
    data = {"notes": sorted(notes, key=lambda n: (n["onset"], n["pitch"]))}
    notes_json.write_text(json.dumps(data))
    progress.transcribe = 1.0
    return data


def write_midi(notes: list[dict], path: Path) -> None:
    mid = mido.MidiFile(ticks_per_beat=PPQ)
    mid.tracks.append(mido.MidiTrack([mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(BPM), time=0),
                                      mido.MetaMessage("time_signature", numerator=4, denominator=4, time=0)]))

    def ticks(seconds: float) -> int:
        return round(seconds * PPQ * BPM / 60)

    by_instrument: dict[tuple[str, int, bool], list[dict]] = {}
    for n in notes:
        by_instrument.setdefault((n["instrument"], n["program"], n["is_drum"]), []).append(n)

    channels = iter(c for c in range(16) if c != 9)
    for (name, program, is_drum), group in sorted(by_instrument.items(), key=lambda kv: (kv[0][2], kv[0][1])):
        channel = 9 if is_drum else next(channels, 0)
        events = []
        for n in group:
            events.append((ticks(n["onset"]), 1, n["pitch"]))
            events.append((max(ticks(n["offset"]), ticks(n["onset"]) + 1), 0, n["pitch"]))
        events.sort(key=lambda e: (e[0], e[1]))
        track = mido.MidiTrack([mido.MetaMessage("track_name", name=name, time=0)])
        if not is_drum:
            track.append(mido.Message("program_change", channel=channel, program=program, time=0))
        now = 0
        for tick, on, pitch in events:
            track.append(mido.Message("note_on" if on else "note_off", channel=channel, note=pitch,
                                      velocity=VELOCITY if on else 0, time=tick - now))
            now = tick
        mid.tracks.append(track)
    mid.save(str(path))


def write_midis(data: dict, midi_dir: Path, stems_dir: Path | None = None, silent: set[str] = frozenset()) -> dict[str, Path]:
    notes = [n for n in data["notes"] if family(n) not in silent]
    if stems_dir is not None:
        for name, rival in RIVALS.items():
            own, other = stem_of(stems_dir, name), stem_of(stems_dir, rival)
            if own and other:
                mine = [n for n in notes if family(n) == name]
                kept = {id(n) for n in remove_bleed(mine, own, [other], BLEED_RATIO,
                                                    lambda n: (n["pitch"], n["onset"], n["offset"]))}
                notes = [n for n in notes if family(n) != name or id(n) in kept]
    out = {}
    for name in INSTRUMENTS:
        selected = [n for n in notes if family(n) == name]
        (midi_dir / f"{name}.mid").unlink(missing_ok=True)
        if selected:
            write_midi(selected, midi_dir / f"{name}.mid")
            out[name] = midi_dir / f"{name}.mid"
    if notes:
        write_midi(notes, midi_dir / "all.mid")
        out["all"] = midi_dir / "all.mid"
    return out


def run(url: str, progress: Progress) -> dict:
    progress.step = 0
    mix = download(url, progress)
    song = mix.stem
    stems_dir, midi_dir = OUTPUT_DIR / "stems" / song, OUTPUT_DIR / "midi" / song
    progress.check()

    progress.step = 1
    errors: list[BaseException] = []

    def skip(name: str) -> bool:
        if progress.stems < 1:
            return False
        families = next(f for n, _, f in PASSES if n == name)
        return set(families) <= silent_stems(stems_dir, mix)

    def separate_stems() -> None:
        try:
            separate(mix, stems_dir, progress)
            if progress.transcribe < 1:
                progress.step = 2
        except BaseException as e:
            errors.append(e)
            progress.cancel.set()

    separation = threading.Thread(target=separate_stems, daemon=True)
    separation.start()
    try:
        data = transcribe(mix, midi_dir / "notes.json", progress, skip)
    except BaseException:
        progress.cancel.set()
        separation.join()
        if errors:
            raise errors[0]
        raise
    separation.join()
    if errors:
        raise errors[0]
    progress.check()

    progress.step = 3
    midis = write_midis(data, midi_dir, stems_dir, silent_stems(stems_dir, mix))
    stems = {s: p for s in STEMS if (p := stem_of(stems_dir, s))}
    return {
        "id": song,
        "title": re.sub(r"\s*\[[^\]]+\]\s*$", "", song).replace("_", " ").strip(),
        "stems": {k: p.relative_to(OUTPUT_DIR).as_posix() for k, p in stems.items()},
        "midi": {k: p.relative_to(OUTPUT_DIR).as_posix() for k, p in midis.items()},
    }
