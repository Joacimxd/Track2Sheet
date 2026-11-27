"""Piano MIDI → notes ready to draw on the keyboard highway (POST /piano).

Steps, on the piano notes of MuScriptor's piano-only pass (see pipeline.TRANSCRIPTION_PASSES). Every
noise rule that can be checked against the piano stem is: the stem says what was really played.

1. **Bleed:** notes the guitar or vocals stem explains much better than the piano stem are another
   instrument heard as piano. (Not the bass stem: the left hand doubles the bass and would go.)
2. **Held notes chopped in pieces:** MuScriptor writes on a beat grid and often re-emits a held note
   on every step. Two notes of one key back to back are one note unless the stem shows a new attack
   at that key (energy rising) — then it was really struck again.
3. **Ghosts:** a note with (almost) nothing at its pitch in the piano stem while other keys sound
   is not there.
4. **Overtones:** a note an octave, octave + fifth or two octaves above another key struck with it,
   much weaker than it and ending with it, is that key's overtone.
5. **Hands and fingers:** two hands, five fingers each, and one hand reaches at most a ninth
   (`REACH` semitones from its lowest to its highest key). Notes struck together that no pair of
   hands could play (more than ten, more than five in one hand's reach, three clusters far apart)
   are not all real: the loudest set two hands can play stays, the rest goes. Only notes struck
   together count: with the sustain pedal a held note doesn't keep its finger down.
6. **Strays:** a short note far from every other note around it (more than an octave away for a
   second each side) is noise; so are notes shorter than 40 ms.
7. **Loudness:** MuScriptor has no velocity; it is measured on the piano stem.
8. **Hands:** each note gets `hand` 0 (left) or 1 (right). Notes struck together are split at their
   widest gap where each hand gets at most five notes within its reach, when they span more than an
   octave or are more than five; otherwise the whole group goes to the
   hand whose recent position is closest. Each hand's position follows its notes (moving average),
   so a left-hand melody in the treble stays left as long as it moves continuously.

Without the stems only 5, 6 and 8 run (and back-to-back notes of one key closer than 20 ms are joined).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from .tab.cleanup import CQT_FPS, CQT_LOWEST, _pitch_energy, estimate_velocity
from .tab.core import Note, group_events

MIN_DURATION = 0.04
MERGE_GAP = 0.02      # without the stem: back-to-back notes of one key this close are one note
TOUCH_GAP = 0.03      # with the stem: notes of one key this close are checked for a new attack
#: A note is bleed from another instrument when that stem is this many times louder than the
#: piano stem at the note's pitch and onset.
BLEED_RATIO = 2.5
#: Energy at the key just after the second note's onset / just before it: below this, no attack.
RESTRIKE_RATIO = 1.3
#: dB below the loudest key sounding at its onset: quieter than this, the note is a ghost.
GHOST_DB = -30.0
#: Overtone intervals and how much weaker (energy ratio) than the key below an overtone is.
OVERTONES = (12, 19, 24)
OVERTONE_RATIO = 0.3
#: Strays: no other note within this many semitones for this long on each side, and short.
STRAY_SEMITONES = 12
STRAY_WINDOW = 1.0
STRAY_MAX_DURATION = 0.3
#: Notes struck together wider than this (semitones) are split between the hands.
HAND_SPAN = 12
#: Fingers on one hand, and the widest one hand can reach (a ninth) in one strike.
FINGERS = 5
REACH = 14
#: How fast each hand's position follows its notes (0…1 per onset group).
HAND_FOLLOW = 0.35
MIDDLE_C = 60


def remove_bleed(notes: list[Note], piano: Path, others: list[Path]) -> list[Note]:
    """Drop the notes another stem (guitar, vocals) explains much better than the piano stem."""
    p = _pitch_energy(str(piano), piano.stat().st_mtime)
    rivals = [_pitch_energy(str(o), o.stat().st_mtime) for o in others]
    if not rivals:
        return notes
    frames = min(p.shape[1], *(r.shape[1] for r in rivals))
    keep = []
    for n in notes:
        k = n.midi - CQT_LOWEST
        a = int(n.time * CQT_FPS) + 1
        b = max(a + 1, int(min(n.end, n.time + 0.3) * CQT_FPS))
        if not 0 <= k < p.shape[0] or a >= frames:
            keep.append(n)
            continue
        own = p[k, a:b].mean()
        if max(r[k, a:b].mean() for r in rivals) <= BLEED_RATIO * own:
            keep.append(n)
    return keep


class _Stem:
    """Energy per key and frame of the piano stem."""

    def __init__(self, path: Path):
        self.e = _pitch_energy(str(path), path.stat().st_mtime)
        self.db = 20 * np.log10(self.e + 1e-6)

    def _range(self, midi: int, t: float) -> tuple[int, int] | None:
        k, a = midi - CQT_LOWEST, int(t * CQT_FPS)
        return (k, a) if 0 <= k < self.e.shape[0] and 0 <= a < self.e.shape[1] else None

    def attack(self, midi: int, t: float) -> float:
        """Energy at the key just after `t` over just before it (> 1: struck again)."""
        r = self._range(midi, t)
        if r is None or r[1] < 3:
            return np.inf
        k, a = r
        return float(self.e[k, a + 1:a + 4].mean() / (self.e[k, a - 3:a].mean() + 1e-9))

    def level(self, midi: int, t: float) -> float:
        """Energy at the key over the first 150 ms of a note."""
        r = self._range(midi, t)
        if r is None:
            return np.inf
        k, a = r
        return float(self.e[k, a + 1:a + 1 + max(2, int(0.15 * CQT_FPS))].mean())

    def support_db(self, midi: int, t: float) -> float:
        """dB at the key relative to the loudest key, over the first 150 ms of a note."""
        r = self._range(midi, t)
        if r is None:
            return 0.0
        k, a = r
        b = a + 1 + max(2, int(0.15 * CQT_FPS))
        return float(self.db[k, a + 1:b].mean() - self.db[:, a + 1:b].max())


def merge_held(notes: list[Note], stem: _Stem | None) -> tuple[list[Note], int]:
    """Join back-to-back notes of one key that are one held note."""
    out: list[Note] = []
    last: dict[int, Note] = {}
    merged = 0
    for n in sorted(notes, key=lambda n: (n.time, n.midi)):
        prev = last.get(n.midi)
        if prev is not None:
            gap = n.time - prev.end
            held = (gap <= TOUCH_GAP and stem.attack(n.midi, n.time) < RESTRIKE_RATIO) if stem else gap <= MERGE_GAP
            if held:
                prev.duration = max(prev.end, n.end) - prev.time
                merged += 1
                continue
        copy = Note(n.time, n.duration, n.midi, n.velocity)
        out.append(copy)
        last[n.midi] = copy
    return out, merged


def remove_ghosts(notes: list[Note], stem: _Stem) -> list[Note]:
    return [n for n in notes if stem.support_db(n.midi, n.time) >= GHOST_DB]


def remove_overtones(notes: list[Note], stem: _Stem) -> list[Note]:
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
    """Best set one hand can play from these (sorted) notes: at most FINGERS within REACH, the
    heaviest in total. Returns (total weight, indices)."""
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
    """Indices of the notes (sorted by pitch) two hands can strike together, keeping the heaviest
    set: the left hand plays some of the notes below a cut, the right hand some above it."""
    best: tuple[float, list[int]] = (-1.0, [])
    for cut in range(len(pitches) + 1):
        lw, left = _one_hand(pitches[:cut], weight[:cut])
        rw, right = _one_hand(pitches[cut:], weight[cut:])
        if lw + rw > best[0]:
            best = (lw + rw, left + [cut + k for k in right])
    return best[1]


def limit_fingers(notes: list[Note], stem: _Stem | None) -> list[Note]:
    """Drop what two hands can't strike together (see 5 in the docstring). Weight of a note: its
    energy in the stem, or its length without the stem; the lowest and highest notes (bass and
    melody) weigh a bit more."""
    keep: list[Note] = []
    for event in group_events(notes):
        group = event.notes  # sorted by pitch
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
        weight = [w / top + 0.01 for w in weight]  # every note counts, so no note goes for free
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


def clean(notes: list[Note], piano: Path | None = None) -> tuple[list[Note], dict]:
    """Every noise rule; returns the clean notes (sorted) and how many each rule removed."""
    stem = _Stem(piano) if piano else None
    out, merged = merge_held(notes, stem)
    removed = {"held_merged": merged}
    if stem:
        n0 = len(out)
        out = remove_ghosts(out, stem)
        removed["ghosts"] = n0 - len(out)
        n0 = len(out)
        out = remove_overtones(out, stem)
        removed["overtones"] = n0 - len(out)
    n0 = len(out)
    out = limit_fingers(out, stem)
    removed["fingers"] = n0 - len(out)
    out.sort(key=lambda n: (n.time, n.midi))
    n0 = len(out)
    out = remove_strays(out)
    removed["strays"] = n0 - len(out)
    return out, removed


def split_hands(notes: list[Note]) -> list[int]:
    """Hand of each note (0 = left, 1 = right), in the order of `notes` (sorted by time)."""
    hands = [1] * len(notes)
    index = {id(n): i for i, n in enumerate(notes)}
    pos = [MIDDLE_C - 12.0, MIDDLE_C + 7.0]  # where each hand is (MIDI pitch)
    for event in group_events(notes):
        group = sorted(event.notes, key=lambda n: n.midi)
        pitches = [n.midi for n in group]
        if pitches[-1] - pitches[0] > HAND_SPAN or len(pitches) > FINGERS:
            # Two hands: cut at the widest gap that leaves each hand something it can play (ties →
            # nearest to the middle of the two hands).
            mid = (pos[0] + pos[1]) / 2
            cuts = [i for i in range(1, len(pitches)) if _fits(pitches[:i]) and _fits(pitches[i:])]
            cut = max(cuts or range(1, len(pitches)),
                      key=lambda i: (pitches[i] - pitches[i - 1], -abs((pitches[i] + pitches[i - 1]) / 2 - mid)))
            parts = [(0, group[:cut]), (1, group[cut:])]
        else:
            centre = (pitches[0] + pitches[-1]) / 2
            hand = 0 if abs(centre - pos[0]) < abs(centre - pos[1]) else 1
            # A hand can't cross far over the other one.
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
        # Keep the hands apart so they don't swap roles after a crossing.
        if pos[0] > pos[1] - 5:
            m = (pos[0] + pos[1]) / 2
            pos[0], pos[1] = m - 2.5, m + 2.5
    return hands


def build_piano(notes: list[Note], piano: Path | None = None, rivals: list[Path] | None = None) -> dict:
    found = len(notes)
    if piano and rivals:
        notes = remove_bleed(notes, piano, rivals)
    bleed = found - len(notes)
    notes, removed = clean(notes, piano)
    if piano:
        estimate_velocity(notes, piano)
    hands = split_hands(notes)
    out = [{"id": i, "time": round(n.time, 4), "duration": round(n.duration, 4), "midi": n.midi,
            "velocity": round(n.velocity, 3), "hand": h} for i, (n, h) in enumerate(zip(notes, hands))]
    pitches = [n.midi for n in notes] or [MIDDLE_C]
    return {
        "notes": out,
        "range": [int(np.min(pitches)), int(np.max(pitches))],
        "removed": {"bleed": bleed, **removed},
    }
