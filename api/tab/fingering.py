"""Global fingering: choose (string, fret) for every note of the part at once.

The old mapper was greedy (note by note, cost = distance to a drifting "hand" average). Here the
whole part is one shortest-path problem (Viterbi) over states = (fingering of the event, hand
position), where the hand position is the fret under the index finger and covers a 4-fret box:

* **static cost** of a fingering: span and stretch, fingers needed (≤ 4, barres count as one),
  muted strings inside a strum, open strings under a high hand, very high frets, and, for a
  standard voicing offered instead of the transcribed notes, how much it differs from them;
* **transition cost**: a position shift has a fixed price plus its distance, and costs more the
  less time there is to make it (it is nearly free over a rest); re-fretting a string that is still
  ringing from the previous event is penalised;
* **consistency**: a second pass rewards giving each repeated chord, and each repeated note in the
  same melodic context, the fingering it gets most often in the first pass, so a riff or chord
  is played the same way every time it comes back.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from itertools import product

import numpy as np

from .chords import name_chord, voicings
from .core import Event, Note, Tuning

MAX_FINGERINGS = 16
MAX_STRINGS = 6

SPAN_COST = {0: 0.0, 1: 0.0, 2: 0.0, 3: 0.0, 4: 0.8, 5: 2.5}
SHIFT_FIXED = 1.0
SHIFT_PER_FRET = 0.3
REST_GAP = 0.25
RING_CONFLICT = 1.0
SNAP_BASE = 0.6
SNAP_MISSING = 0.9
SNAP_ADDED = 0.5
CONSISTENCY_CHORD = 2.5
CONSISTENCY_NOTE = 1.0


@dataclass(frozen=True)
class Fingering:
    #: (string, fret, midi) per note, sorted by string.
    positions: tuple[tuple[int, int, int], ...]
    cost: float
    lo: int  # lowest fretted fret (0 = only open strings)
    hi: int
    voicing: str | None = None  # standard voicing used instead of the transcribed notes

    @property
    def signature(self) -> tuple[tuple[int, int], ...]:
        return tuple((s, f) for s, f, _ in self.positions)

    def hands(self) -> list[int] | None:
        """Index-finger frets from which every fretted note is within reach (None = open only)."""
        if self.lo == 0:
            return None
        if self.hi - self.lo > 3:
            return [self.lo]
        return list(range(max(1, self.hi - 3), self.lo + 1))


def static_cost(pos: list[tuple[int, int]]) -> float | None:
    """Difficulty of holding these (string, fret) positions at once; None if unplayable."""
    fretted = [f for _, f in pos if f > 0]
    cost = 0.0
    if fretted:
        lo, hi = min(fretted), max(fretted)
        span = hi - lo
        if span > 5 or (span == 5 and lo < 7):  # frets are too wide for a 5-fret stretch down low
            return None
        by_fret = Counter(fretted)
        # Index finger barres the lowest fret; 3+ strings on one higher fret take a partial barre.
        fingers = 1 + sum(1 if c >= 3 else c for f, c in by_fret.items() if f > lo)
        if fingers > 4:
            return None
        cost += SPAN_COST[span] + (0.7 if lo < 5 and span >= 4 else 0.0)
        cost += 0.12 * max(0.0, sum(fretted) / len(fretted) - 12)
        if hi >= 7:
            cost += 0.3 * sum(1 for _, f in pos if f == 0)
    strings = sorted(s for s, _ in pos)
    if len(strings) >= 2:
        gaps = strings[-1] - strings[0] + 1 - len(strings)
        cost += gaps * (0.4 if len(strings) >= 3 else 0.2)
    if len(pos) == 1:
        cost += 0.015 * pos[0][1]
    return cost


def _direct(pitches: tuple[int, ...], tuning: Tuning) -> list[Fingering]:
    out = []
    for combo in product(*(tuning.positions(p) for p in pitches)):
        strings = [s for s, _ in combo]
        if len(set(strings)) != len(strings):
            continue
        cost = static_cost(list(combo))
        if cost is None:
            continue
        fretted = [f for _, f in combo if f > 0]
        pos = tuple(sorted((s, f, p) for (s, f), p in zip(combo, pitches)))
        out.append(Fingering(pos, cost, min(fretted, default=0), max(fretted, default=0)))
    return out


def _reduce(pitches: tuple[int, ...], tuning: Tuning) -> tuple[int, ...]:
    """Drop notes until the set is playable: octave doublings in the middle first, then whichever
    removal leaves the easiest fingering."""
    ps = list(pitches)
    while len(ps) > MAX_STRINGS:
        pcs = Counter(p % 12 for p in ps)
        doubled = [p for p in ps[1:-1] if pcs[p % 12] > 1]
        ps.remove(doubled[len(doubled) // 2] if doubled else ps[len(ps) // 2])
    while len(ps) > 1 and not _direct(tuple(ps), tuning):
        best = min(
            (tuple(q for q in ps if q != r) for r in ps[1:] + ps[:1]),
            key=lambda sub: min((f.cost for f in _direct(sub, tuning)), default=99),
        )
        ps = list(best)
    return tuple(ps)


def fingerings(pitches: tuple[int, ...], tuning: Tuning, snap: bool = True) -> tuple[tuple[int, ...], list[Fingering]]:
    """Candidate fingerings of an event, cheapest first. Returns the (possibly reduced) pitches too.
    `snap=False`: only the notes as they are, never a standard voicing instead."""
    kept = _reduce(pitches, tuning)
    cands = _direct(kept, tuning)
    label = name_chord(pitches) if snap and len(pitches) >= 3 else None
    if label:
        wanted = set(pitches)
        for v in voicings(label, tuning):
            sounding = {tuning.strings[s] + f: (s, f) for s, f in v.positions}
            missing = len(wanted - sounding.keys())
            added = len(sounding.keys() - wanted)
            if missing > 1 or added > 2:
                continue
            cost = static_cost(list(v.positions))
            if cost is None:
                continue
            cost += v.penalty + SNAP_BASE + SNAP_MISSING * missing + SNAP_ADDED * added
            pos = tuple(sorted((s, f, tuning.strings[s] + f) for s, f in v.positions))
            fretted = [f for _, f in v.positions if f > 0]
            cands.append(Fingering(pos, cost, min(fretted, default=0), max(fretted, default=0), v.id))
    cands.sort(key=lambda f: f.cost)
    return kept, cands[:MAX_FINGERINGS]


# ─── Viterbi ──────────────────────────────────────────────────────────────────────────────


@dataclass
class Placed:
    event: Event
    fingering: Fingering
    hand: int


def _consistency_keys(events: list[Event]) -> list[tuple]:
    keys = []
    for i, e in enumerate(events):
        if len(e.pitches) >= 2:
            keys.append(("chord", e.pitches))
        else:
            prev = events[i - 1].pitches if i else ()
            nxt = events[i + 1].pitches if i + 1 < len(events) else ()
            keys.append(("note", prev, e.pitches, nxt))
    return keys


def fixed_fingering(shape: tuple[tuple[int, int], ...], tuning: Tuning, name: str = "standard") -> Fingering:
    """A given (string, fret) shape as a fingering (e.g. a standard chord voicing)."""
    fretted = [f for _, f in shape if f > 0]
    pos = tuple(sorted((s, f, tuning.strings[s] + f) for s, f in shape))
    cost = static_cost(list(shape))
    return Fingering(pos, 0.0 if cost is None else cost, min(fretted, default=0), max(fretted, default=0), name)


def solve(events: list[Event], tuning: Tuning, fixed: dict[int, Fingering] | None = None,
          snap: bool = True) -> list[Placed]:
    """Global fingering. `fixed`: id(event) → the only fingering allowed for that event (standard
    chord shapes). `snap=False`: the other events are played as heard, never as a voicing."""
    if not events:
        return []
    fixed = fixed or {}
    cands = [[fixed[id(e)]] if id(e) in fixed else fingerings(e.pitches, tuning, snap)[1] for e in events]
    keep = [i for i, c in enumerate(cands) if c]
    events, cands = [events[i] for i in keep], [cands[i] for i in keep]
    keys = _consistency_keys(events)

    first = _viterbi(events, cands, {}, keys)
    # Most common fingering of every chord / note-in-context that repeats.
    seen: dict[tuple, Counter] = {}
    for k, p in zip(keys, first):
        seen.setdefault(k, Counter())[p.fingering.signature] += 1
    preferred = {k: c.most_common(1)[0][0] for k, c in seen.items() if sum(c.values()) >= 2}
    return _viterbi(events, cands, preferred, keys)


def _viterbi(events: list[Event], cands: list[list[Fingering]], preferred: dict, keys: list[tuple]) -> list[Placed]:
    def layer_states(i: int, prev_hands: set[int]) -> list[tuple[int, int]]:
        states = []
        for fi, f in enumerate(cands[i]):
            for h in f.hands() or sorted(prev_hands):
                states.append((fi, h))
        return states

    def state_cost(i: int, states: list[tuple[int, int]]) -> np.ndarray:
        pref = preferred.get(keys[i])
        weight = CONSISTENCY_CHORD if keys[i][0] == "chord" else CONSISTENCY_NOTE
        return np.array([cands[i][fi].cost + (weight if pref and cands[i][fi].signature != pref else 0.0) for fi, _ in states])

    states = [layer_states(0, {5})]
    cost = state_cost(0, states[0])
    back: list[np.ndarray] = []
    for i in range(1, len(events)):
        prev, prev_ev, ev = states[-1], events[i - 1], events[i]
        cur = layer_states(i, {h for _, h in prev})
        dt = ev.time - prev_ev.time
        speed = 1 + min(3.0, 0.12 / max(dt, 0.03))
        if ev.time - prev_ev.end >= REST_GAP:
            speed *= 0.5
        ph = np.array([h for _, h in prev])
        ch = np.array([h for _, h in cur])
        shift = np.abs(ch[None, :] - ph[:, None])
        trans = np.where(shift > 0, (SHIFT_FIXED + SHIFT_PER_FRET * shift) * speed, 0.0)
        trans = trans + _ring_matrix(prev_ev, ev, cands[i - 1], cands[i])[np.ix_([fi for fi, _ in prev], [fi for fi, _ in cur])]
        total = cost[:, None] + trans
        back.append(total.argmin(axis=0))
        cost = total.min(axis=0) + state_cost(i, cur)
        states.append(cur)

    k = int(cost.argmin())
    out: list[Placed] = []
    for i in range(len(events) - 1, -1, -1):
        fi, h = states[i][k]
        out.append(Placed(events[i], cands[i][fi], h))
        if i:
            k = int(back[i - 1][k])
    return out[::-1]


def _ring_matrix(prev: Event, cur: Event, pf: list[Fingering], cf: list[Fingering]) -> np.ndarray:
    """Penalty for fretting a string that is still sounding a different note from `prev`."""
    m = np.zeros((len(pf), len(cf)))
    ringing = {n.midi for n in prev.notes if n.end > cur.time + 0.03}
    if not ringing:
        return m
    for a, f in enumerate(pf):
        held = {s: fret for s, fret, midi in f.positions if midi in ringing}
        if not held:
            continue
        for b, g in enumerate(cf):
            m[a, b] = RING_CONFLICT * sum(1 for s, fret, _ in g.positions if s in held and held[s] != fret)
    return m
