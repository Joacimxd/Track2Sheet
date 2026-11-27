"""Transcribe again the songs in output/ whose notes.json is not from the current version.

    .venv/bin/python -m api.retranscribe                 # every song in output/midi/ not up to date
    .venv/bin/python -m api.retranscribe "<song folder>" # that song, even if it is up to date

Every pass of pipeline.TRANSCRIPTION_PASSES runs (silent stems skipped); nothing old is reused.
Source audio: output/downloads/<song>.wav, or the sum of the song's stems when there is no download.
The previous MIDI files and notes.json go to output/midi/<song>/backup/ first (the interface only
looks at the files directly in the song folder, so backups don't show up there).
"""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import soxr

from . import pipeline
from .pipeline import OUTPUT_DIR, SAMPLE_RATE, TRANSCRIPTION_VERSION, Progress


def source_audio(song: str) -> np.ndarray | None:
    """16 kHz mono float32 of the whole song, or None when there is no audio for it."""
    download = OUTPUT_DIR / "downloads" / f"{song}.wav"
    files = [download] if download.exists() else sorted(
        f for f in (OUTPUT_DIR / "stems" / song).glob("*.*") if f.suffix.lower() in (".wav", ".mp3", ".flac"))
    mix = None
    for f in files:
        y, sr = sf.read(str(f), dtype="float32", always_2d=True)
        y = soxr.resample(y.mean(axis=1), sr, SAMPLE_RATE, quality="VHQ")
        mix = y if mix is None else mix[: len(y)] + y[: len(mix)]
    return mix


def is_current(song: str) -> bool:
    notes_json = OUTPUT_DIR / "midi" / song / "notes.json"
    return notes_json.exists() and json.loads(notes_json.read_text()).get("version") == TRANSCRIPTION_VERSION


def retranscribe(song: str) -> None:
    midi_dir = OUTPUT_DIR / "midi" / song
    audio = source_audio(song)
    if audio is None:
        print(f"· {song}: no download or stems, skipped")
        return
    print(f"· {song}: {len(audio) / SAMPLE_RATE:.0f} s of audio")
    started = time.time()

    backup = midi_dir / "backup"
    backup.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    for f in [*midi_dir.glob("*.mid"), midi_dir / "notes.json"]:
        if f.exists():
            shutil.move(str(f), backup / f"{stamp}-{f.name}")

    last = [-1]

    def report() -> None:
        if int(progress.transcribe * 10) != last[0]:
            last[0] = int(progress.transcribe * 10)
            print(f"  {progress.transcribe:4.0%}  ({time.time() - started:.0f} s)", flush=True)

    progress = Progress()
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "mix.wav"
        sf.write(str(wav), audio, SAMPLE_RATE)
        original = pipeline.run_muscriptor

        def run_with_report(*args, **kwargs):
            on_progress = args[4]
            return original(*args[:4], lambda p: (on_progress(p), report()))

        pipeline.run_muscriptor = run_with_report
        try:
            stems_dir = OUTPUT_DIR / "stems" / song
            silent = pipeline.silent_stems(stems_dir, wav)
            skip = lambda name: set(next(f for n, _, f in pipeline.TRANSCRIPTION_PASSES if n == name)) <= silent  # noqa: E731
            data = pipeline.transcribe(wav, midi_dir / "notes.json", progress, skip)
        finally:
            pipeline.run_muscriptor = original
    midis = pipeline.write_midis(data, midi_dir, stems_dir, silent)
    print(f"  passes {data['passes']} (skipped {data['skipped']}): {', '.join(sorted(midis))}"
          f"  ({time.time() - started:.0f} s; old files in backup/{stamp}-*)")


def main() -> None:
    if sys.argv[1:]:
        songs = sys.argv[1:]
    else:
        songs = [p.name for p in sorted((OUTPUT_DIR / "midi").iterdir()) if p.is_dir() and not is_current(p.name)]
    for song in songs:
        retranscribe(song)


if __name__ == "__main__":
    main()
