"""Guitar helpers used before the cleaner (guitar_cleaner.py): tuning detection, loudness from the
guitar stem, and dropping sung notes the transcriber labelled as guitar.

MuScriptor predicts no velocity (every note arrives with the same value); `estimate_velocity`
measures it on the guitar stem when the song's audio is available.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import numpy as np

from .core import TUNINGS, Note, Tuning


#: How unlikely each tuning is a priori, in "percent of notes that would be lost" units: a song is
#: only read as Eb / drop D when more than ~1 % of its notes fall below standard tuning's low E.
TUNING_PRIOR = {"standard": 0.0, "eb": 1.0, "drop_d": 1.2, "d": 1.5}


def has_velocity(notes: list[Note]) -> bool:
    return len(notes) > 1 and float(np.std([n.velocity for n in notes])) > 0.03


def detect_tuning(notes: list[Note]) -> Tuning:
    """The tuning that keeps the most notes playable, biased towards standard."""
    if not notes:
        return TUNINGS["standard"]
    pitches = np.array([n.midi for n in notes])
    best, best_cost = TUNINGS["standard"], float("inf")
    for tid, tuning in TUNINGS.items():
        lost = 100.0 * float(np.mean(pitches < tuning.lowest))
        cost = lost + TUNING_PRIOR[tid]
        # Drop D only when its low D is actually used; otherwise Eb explains notes at 39 better.
        if tid == "drop_d" and not np.any(pitches == 38):
            cost += 1.0
        if cost < best_cost:
            best, best_cost = tuning, cost
    return best


def estimate_velocity(notes: list[Note], stem: Path) -> None:
    """Set each note's velocity from the guitar stem's loudness at its onset (in place).

    Not per pitch, but enough to tell picked notes from ghost/dead notes and to weigh chords.
    """
    import soundfile as sf

    audio, sr = sf.read(str(stem), dtype="float32", always_2d=True)
    mono = audio.mean(axis=1)
    hop = int(sr * 0.01)
    n_frames = len(mono) // hop
    if n_frames == 0:
        return
    frames = mono[: n_frames * hop].reshape(n_frames, hop)
    db = 20 * np.log10(np.sqrt((frames**2).mean(axis=1)) + 1e-6)
    ref = np.percentile(db, 95)
    for n in notes:
        a = int(n.time / 0.01)
        peak = db[a : a + 6].max() if a < n_frames else -120.0
        n.velocity = float(np.clip((peak - ref + 30) / 30, 0.05, 1.0))


#: A note is the singer's, not the guitar's, when the vocals stem is this many times louder than the
#: guitar stem at that pitch and moment (MuScriptor asked for guitar only can't label it as voice).
VOCAL_RATIO = 2.0


def remove_vocal_notes(notes: list[Note], guitar: Path, vocals: Path) -> list[Note]:
    """Drop the notes that the vocals stem explains much better than the guitar stem."""
    g = _pitch_energy(str(guitar), guitar.stat().st_mtime)
    v = _pitch_energy(str(vocals), vocals.stat().st_mtime)
    frames = min(g.shape[1], v.shape[1])
    keep = []
    for n in notes:
        k = n.midi - CQT_LOWEST
        a = int(n.time * CQT_FPS) + 1
        b = max(a + 1, int(min(n.end, n.time + 0.3) * CQT_FPS))
        if not 0 <= k < g.shape[0] or a >= frames:
            keep.append(n)
            continue
        if v[k, a:b].mean() <= VOCAL_RATIO * g[k, a:b].mean():
            keep.append(n)
    return keep


CQT_LOWEST, CQT_BINS, CQT_SR, CQT_HOP = 28, 72, 22050, 512
CQT_FPS = CQT_SR / CQT_HOP


@lru_cache(maxsize=8)
def _pitch_energy(path: str, _mtime: float) -> np.ndarray:
    """Magnitude per semitone (MIDI CQT_LOWEST…) and frame of an audio file."""
    import librosa

    y, _ = librosa.load(path, sr=CQT_SR, mono=True)
    return np.abs(librosa.cqt(y, sr=CQT_SR, hop_length=CQT_HOP, fmin=librosa.midi_to_hz(CQT_LOWEST),
                              n_bins=CQT_BINS)).astype(np.float32)
