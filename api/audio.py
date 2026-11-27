from functools import lru_cache
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

LOWEST_MIDI = 28
BINS = 72
SAMPLE_RATE = 22050
HOP = 512
FPS = SAMPLE_RATE / HOP


@lru_cache(maxsize=8)
def _energy(path: str, modified: float) -> np.ndarray:
    y, _ = librosa.load(path, sr=SAMPLE_RATE, mono=True)
    cqt = librosa.cqt(y, sr=SAMPLE_RATE, hop_length=HOP, fmin=librosa.midi_to_hz(LOWEST_MIDI), n_bins=BINS)
    return np.abs(cqt).astype(np.float32)


def pitch_energy(path: Path) -> np.ndarray:
    return _energy(str(path), path.stat().st_mtime)


def remove_bleed(notes: list, own: Path, rivals: list[Path], ratio: float, pitch_and_time) -> list:
    if not rivals:
        return notes
    mine = pitch_energy(own)
    others = [pitch_energy(r) for r in rivals]
    frames = min(mine.shape[1], *(o.shape[1] for o in others))
    kept = []
    for n in notes:
        midi, start, end = pitch_and_time(n)
        k = midi - LOWEST_MIDI
        a = int(start * FPS) + 1
        b = max(a + 1, int(min(end, start + 0.3) * FPS))
        if not 0 <= k < mine.shape[0] or a >= frames:
            kept.append(n)
        elif max(o[k, a:b].mean() for o in others) <= ratio * mine[k, a:b].mean():
            kept.append(n)
    return kept


def estimate_velocity(notes: list, stem: Path) -> None:
    audio, sr = sf.read(str(stem), dtype="float32", always_2d=True)
    mono = audio.mean(axis=1)
    hop = int(sr * 0.01)
    n_frames = len(mono) // hop
    if n_frames == 0:
        return
    frames = mono[: n_frames * hop].reshape(n_frames, hop)
    db = 20 * np.log10(np.sqrt((frames**2).mean(axis=1)) + 1e-6)
    loudest = np.percentile(db, 95)
    for n in notes:
        a = int(n.time / 0.01)
        peak = db[a : a + 6].max() if a < n_frames else -120.0
        n.velocity = float(np.clip((peak - loudest + 30) / 30, 0.05, 1.0))
