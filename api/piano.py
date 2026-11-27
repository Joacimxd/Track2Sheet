from pathlib import Path

import numpy as np

from .audio import FPS, LOWEST_MIDI, estimate_velocity, pitch_energy, remove_bleed
from .guitar.core import Note, group_events

MIN_DURATION = 0.04
MERGE_GAP = 0.02
TOUCH_GAP = 0.03
BLEED_RATIO = 2.5
RESTRIKE_RATIO = 1.3
GHOST_DB = -30.0
OVERTONES = (12, 19, 24)
OVERTONE_RATIO = 0.3
STRAY_SEMITONES = 12
STRAY_WINDOW = 1.0
STRAY_MAX_DURATION = 0.3
HAND_SPAN = 12
FINGERS = 5
REACH = 14
HAND_FOLLOW = 0.35
MIDDLE_C = 60


class Stem:
    def __init__(self, path: Path):
        self.e = pitch_energy(path)
        self.db = 20 * np.log10(self.e + 1e-6)

    def _range(self, midi: int, t: float) -> tuple[int, int] | None:
        k, a = midi - LOWEST_MIDI, int(t * FPS)
        return (k, a) if 0 <= k < self.e.shape[0] and 0 <= a < self.e.shape[1] else None

    def attack(self, midi: int, t: float) -> float:
        r = self._range(midi, t)
        if r is None or r[1] < 3:
            return np.inf
        k, a = r
        return float(self.e[k, a + 1:a + 4].mean() / (self.e[k, a - 3:a].mean() + 1e-9))

    def level(self, midi: int, t: float) -> float:
        r = self._range(midi, t)
        if r is None:
            return np.inf
        k, a = r
        return float(self.e[k, a + 1:a + 1 + max(2, int(0.15 * FPS))].mean())

    def support_db(self, midi: int, t: float) -> float:
        r = self._range(midi, t)
        if r is None:
            return 0.0
        k, a = r
        b = a + 1 + max(2, int(0.15 * FPS))
        return float(self.db[k, a + 1:b].mean() - self.db[:, a + 1:b].max())


def merge_held(notes: list[Note], stem: Stem | None) -> list[Note]:
    out: list[Note] = []
    last: dict[int, Note] = {}
    for n in sorted(notes, key=lambda n: (n.time, n.midi)):
        prev = last.get(n.midi)
        if prev is not None:
            gap = n.time - prev.end
            held = (gap <= TOUCH_GAP and stem.attack(n.midi, n.time) < RESTRIKE_RATIO) if stem else gap <= MERGE_GAP
            if held:
                prev.duration = max(prev.end, n.end) - prev.time
                continue
        copy = Note(n.time, n.duration, n.midi, n.velocity)
        out.append(copy)
        last[n.midi] = copy
    return out


def remove_ghosts(notes: list[Note], stem: Stem) -> list[Note]:
    return [n for n in notes if stem.support_db(n.midi, n.time) >= GHOST_DB]


def remove_overtones(notes: list[Note], stem: Stem) -> list[Note]:
    drop: set[int] = set()
    for event in group_events(notes):
        for hi in event.notes:
            for lo in event.notes:
                if hi.midi - lo.midi in OVERTONES and hi.end <= lo.end + 0.05 \
                        and stem.level(hi.midi, hi.time) < OVERTONE_RATIO * stem.level(lo.midi, lo.time):
                    drop.add(id(hi))
                    break
    return [n for n in notes if id(n) not in drop]


def _one_hand(pitches: list[int], weight: list[float]) -> tuple[float, list[int]]:
    best: tuple[float, list[int]] = (0.0, [])
    for i in range(len(pitches)):
        j = i
        while j < len(pitches) and pitches[j] - pitches[i] <= REACH:
            j += 1
        top = sorted(range(i, j), key=lambda k: -weight[k])[:FINGERS]
        total = sum(weight[k] for k in top)
        if total > best[0]:
            best = (total, sorted(top))
    return best


def playable(pitches: list[int], weight: list[float]) -> list[int]:
    best: tuple[float, list[int]] = (-1.0, [])
    for cut in range(len(pitches) + 1):
        lw, left = _one_hand(pitches[:cut], weight[:cut])
        rw, right = _one_hand(pitches[cut:], weight[cut:])
        if lw + rw > best[0]:
            best = (lw + rw, left + [cut + k for k in right])
    return best[1]


def limit_fingers(notes: list[Note], stem: Stem | None) -> list[Note]:
    keep: list[Note] = []
    for event in group_events(notes):
        group = event.notes
        if len(group) <= 2:
            keep.extend(group)
            continue
        if stem:
            weight = [stem.level(n.midi, n.time) for n in group]
            finite = [w for w in weight if np.isfinite(w)] or [1.0]
            weight = [w if np.isfinite(w) else max(finite) for w in weight]
        else:
            weight = [n.duration for n in group]
        top = max(weight) or 1.0
        weight = [w / top + 0.01 for w in weight]
        weight[0] += 0.25
        weight[-1] += 0.25
        keep.extend(group[k] for k in playable([n.midi for n in group], weight))
    return keep


def _fits(pitches: list[int]) -> bool:
    return len(pitches) <= FINGERS and (not pitches or pitches[-1] - pitches[0] <= REACH)


def remove_strays(notes: list[Note]) -> list[Note]:
    times = np.array([n.time for n in notes])
    keep = []
    for i, n in enumerate(notes):
        if n.duration < MIN_DURATION:
            continue
        if n.duration <= STRAY_MAX_DURATION:
            a, b = np.searchsorted(times, [n.time - STRAY_WINDOW, n.time + STRAY_WINDOW])
            if not any(j != i and abs(notes[j].midi - n.midi) <= STRAY_SEMITONES for j in range(a, b)):
                continue
        keep.append(n)
    return keep


def clean(notes: list[Note], piano: Path | None = None) -> list[Note]:
    stem = Stem(piano) if piano else None
    notes = merge_held(notes, stem)
    if stem:
        notes = remove_overtones(remove_ghosts(notes, stem), stem)
    notes = limit_fingers(notes, stem)
    notes.sort(key=lambda n: (n.time, n.midi))
    return remove_strays(notes)


def split_hands(notes: list[Note]) -> list[int]:
    hands = [1] * len(notes)
    index = {id(n): i for i, n in enumerate(notes)}
    pos = [MIDDLE_C - 12.0, MIDDLE_C + 7.0]
    for event in group_events(notes):
        group = sorted(event.notes, key=lambda n: n.midi)
        pitches = [n.midi for n in group]
        if pitches[-1] - pitches[0] > HAND_SPAN or len(pitches) > FINGERS:
            mid = (pos[0] + pos[1]) / 2
            cuts = [i for i in range(1, len(pitches)) if _fits(pitches[:i]) and _fits(pitches[i:])]
            cut = max(cuts or range(1, len(pitches)),
                      key=lambda i: (pitches[i] - pitches[i - 1], -abs((pitches[i] + pitches[i - 1]) / 2 - mid)))
            parts = [(0, group[:cut]), (1, group[cut:])]
        else:
            centre = (pitches[0] + pitches[-1]) / 2
            hand = 0 if abs(centre - pos[0]) < abs(centre - pos[1]) else 1
            if hand == 0 and pitches[0] > pos[1] + 2:
                hand = 1
            elif hand == 1 and pitches[-1] < pos[0] - 2:
                hand = 0
            parts = [(hand, group)]
        for hand, part in parts:
            centre = sum(n.midi for n in part) / len(part)
            pos[hand] += HAND_FOLLOW * (centre - pos[hand])
            for n in part:
                hands[index[id(n)]] = hand
        if pos[0] > pos[1] - 5:
            m = (pos[0] + pos[1]) / 2
            pos[0], pos[1] = m - 2.5, m + 2.5
    return hands


def build_piano(notes: list[Note], piano: Path | None = None, rivals: list[Path] | None = None) -> dict:
    if piano and rivals:
        notes = remove_bleed(notes, piano, rivals, BLEED_RATIO, lambda n: (n.midi, n.time, n.end))
    notes = clean(notes, piano)
    if piano:
        estimate_velocity(notes, piano)
    hands = split_hands(notes)
    return {"notes": [{"id": i, "time": round(n.time, 4), "duration": round(n.duration, 4), "midi": n.midi,
                       "velocity": round(n.velocity, 3), "hand": h} for i, (n, h) in enumerate(zip(notes, hands))]}
