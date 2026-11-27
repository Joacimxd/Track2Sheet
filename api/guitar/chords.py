from dataclasses import dataclass
from functools import lru_cache

from .core import MAX_FRET, Tuning

PC_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]

TEMPLATES: dict[str, tuple[int, ...]] = {
    "5": (0, 7),
    "": (0, 4, 7),
    "m": (0, 3, 7),
    "7": (0, 4, 7, 10),
    "m7": (0, 3, 7, 10),
    "maj7": (0, 4, 7, 11),
    "sus2": (0, 2, 7),
    "sus4": (0, 5, 7),
    "add9": (0, 2, 4, 7),
}
BIAS = {"5": 0.0, "": 0.02, "m": 0.02, "7": -0.03, "m7": -0.03, "maj7": -0.05, "sus2": -0.05, "sus4": -0.05, "add9": -0.06}


@dataclass(frozen=True)
class ChordLabel:
    root: int
    quality: str

    @property
    def name(self) -> str:
        return PC_NAMES[self.root] + self.quality


@lru_cache(maxsize=4096)
def name_chord(pitches: tuple[int, ...]) -> ChordLabel | None:
    if len(pitches) < 2:
        return None
    pcs = {p % 12 for p in pitches}
    bass = min(pitches) % 12
    if len(pcs) == 1:
        return None
    best, best_score = None, -1e9
    for root in pcs:
        for quality, ivs in TEMPLATES.items():
            tones = {(root + i) % 12 for i in ivs}
            if not tones <= pcs:
                continue
            missing = len(pcs - tones)
            if missing > (1 if len(pitches) >= 4 else 0):
                continue
            score = len(tones) / len(pcs) + BIAS[quality] + (0.1 if root == bass else 0) - 0.3 * missing
            if score > best_score:
                best, best_score = ChordLabel(root, quality), score
    return best


x = None
MOVABLE = [
    ("E5", "5", 0, (0, 2, 2, x, x, x), 0.0),
    ("E5-2", "5", 0, (0, 2, x, x, x, x), 0.0),
    ("A5", "5", 1, (x, 0, 2, 2, x, x), 0.0),
    ("A5-2", "5", 1, (x, 0, 2, x, x, x), 0.0),
    ("D5", "5", 2, (x, x, 0, 2, 3, x), 0.4),
    ("E", "", 0, (0, 2, 2, 1, 0, 0), 0.5),
    ("Em", "m", 0, (0, 2, 2, 0, 0, 0), 0.5),
    ("E7", "7", 0, (0, 2, 0, 1, 0, 0), 0.5),
    ("Em7", "m7", 0, (0, 2, 0, 0, 0, 0), 0.5),
    ("Esus4", "sus4", 0, (0, 2, 2, 2, 0, 0), 0.5),
    ("A", "", 1, (x, 0, 2, 2, 2, 0), 0.3),
    ("Am", "m", 1, (x, 0, 2, 2, 1, 0), 0.3),
    ("A7", "7", 1, (x, 0, 2, 0, 2, 0), 0.3),
    ("Am7", "m7", 1, (x, 0, 2, 0, 1, 0), 0.3),
    ("Amaj7", "maj7", 1, (x, 0, 2, 1, 2, 0), 0.4),
    ("Asus2", "sus2", 1, (x, 0, 2, 2, 0, 0), 0.3),
    ("Asus4", "sus4", 1, (x, 0, 2, 2, 3, 0), 0.3),
    ("D", "", 2, (x, x, 0, 2, 3, 2), 0.2),
    ("Dm", "m", 2, (x, x, 0, 2, 3, 1), 0.2),
    ("D7", "7", 2, (x, x, 0, 2, 1, 2), 0.2),
    ("Dm7", "m7", 2, (x, x, 0, 2, 1, 1), 0.2),
    ("Dsus2", "sus2", 2, (x, x, 0, 2, 3, 0), 0.2),
    ("Dsus4", "sus4", 2, (x, x, 0, 2, 3, 3), 0.2),
    ("C", "", 1, (x, 3, 2, 0, 1, 0), 0.8),
]
OPEN_ONLY = [
    ("C", "", 0, (x, 3, 2, 0, 1, 0), 0.0),
    ("C7", "7", 0, (x, 3, 2, 3, 1, 0), 0.2),
    ("Cadd9", "add9", 0, (x, 3, 2, 0, 3, 0), 0.1),
    ("G", "", 7, (3, 2, 0, 0, 0, 3), 0.0),
    ("G7", "7", 7, (3, 2, 0, 0, 0, 1), 0.2),
]
MAX_BASE_FRET = 14


@dataclass(frozen=True)
class Voicing:
    id: str
    positions: tuple[tuple[int, int], ...]
    penalty: float


def _fits(frets: tuple, quality: str, root_string: int, tuning: Tuning) -> bool:
    root = tuning.strings[root_string] + frets[root_string]
    pcs = {(tuning.strings[s] + f - root) % 12 for s, f in enumerate(frets) if f is not None}
    return pcs == set(TEMPLATES[quality])


@lru_cache(maxsize=1024)
def voicings(label: ChordLabel, tuning: Tuning) -> tuple[Voicing, ...]:
    out: list[Voicing] = []
    for vid, quality, root_string, frets, penalty in MOVABLE:
        if quality != label.quality or not _fits(frets, quality, root_string, tuning):
            continue
        start = (label.root - tuning.strings[root_string] - frets[root_string]) % 12
        for base in range(start, MAX_BASE_FRET + 1, 12):
            pos = tuple((s, f + base) for s, f in enumerate(frets) if f is not None)
            if any(f > MAX_FRET for _, f in pos):
                continue
            barre = len(pos) * 0.08 if base > 0 else 0.0
            awkward = 1.2 if base > 0 and vid[0] == "D" else 0.0
            out.append(Voicing(f"{vid}@{base}", pos, penalty + barre + awkward))
    if tuning.id == "standard":
        for vid, quality, root_pc, frets, penalty in OPEN_ONLY:
            if quality == label.quality and root_pc == label.root:
                out.append(Voicing(vid, tuple((s, f) for s, f in enumerate(frets) if f is not None), penalty))
    return tuple(out)
