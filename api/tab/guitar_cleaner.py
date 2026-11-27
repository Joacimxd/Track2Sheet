"""Guitar cleaner: tell chords from single notes, turn chords into standard shapes, leave notes alone.

What MuScriptor gives us shapes the whole design:

* Its notes sit on a beat grid: everything struck together has *exactly* the same onset, so a strum
  can't be told from a melody by onset spread. It has to be told by **what** is struck and by
  **context** (a strummed section is chords one after the other; a line is notes one after the
  other).
* A song often has two guitars at once (e.g. an acoustic strumming and an electric playing a line
  on top). MuScriptor labels them as different programs, and the .mid keeps one track per program.
  Mixed together, every strum + line note becomes a 7–16 note "chord". So each **layer** (program)
  is cleaned on its own and the layers are only combined at the end.

Steps, per layer:

1. **Events:** notes with the same onset (±35 ms); duplicated pitches dropped.
2. **Chord or notes?** Each event gets a cost for being a chord (C) and for being notes (N) from
   what it contains — 3+ pitch classes that name a chord → C; one pitch → N; root + fifth → leans C;
   a third or sixth (double stop) → leans N; an octave → leans N. Then a Viterbi pass over the
   layer picks C/N for every event with a price for switching, so an ambiguous event follows its
   neighbours (a dyad in the middle of a strummed section is a chord; inside a riff it is notes).
   A long rest makes switching free.
3. **Chords → standard:** the chord is named from its pitches (or, when it is a fragment, from the
   chord around it that contains it), extensions are dropped (maj7 / add9 → major, sus → power
   chord unless repeated as sus) and it is replaced by its chord-chart shape (open chord, or a barre
   as low on the neck as possible, bass on the bass that was heard) — one shape per chord for the
   whole song, whichever guitar plays it. A strum where only part of the chord was heard takes the
   name of the full chord around it (a C strum heard as root + fifth stays a C, not a C5).
4. **Notes stay as they are.**

Layers are then combined into the two parts the interface offers:

* `rhythm`: every chord, plus the single notes that don't clash with a chord being played;
* `lead` (the `auto` part): the same, except in the **solos** — stretches where a line is played
  over the chords — where the line replaces the chords.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

from .chords import TEMPLATES, ChordLabel, name_chord, voicings
from .core import Event, Note, Tuning, group_events

ONSET_WINDOW = 0.035
#: Viterbi costs (≈ negative log-likelihoods).
SWITCH_COST = 1.0
REST_GAP = 1.0  # s without notes → switching between chords and notes is free
#: Quality → standard quality.
STANDARD_QUALITY = {"": "", "m": "m", "5": "5", "7": "7", "m7": "m7", "maj7": "", "add9": "",
                    "sus2": "5", "sus4": "5"}
#: A sus chord heard this many times is a real sus chord, kept as one.
SUS_MIN_REPEATS = 4
#: Solos: line notes clashing with chords, joined across gaps and padded.
SOLO_JOIN = 2.0
SOLO_PAD = 0.25
SOLO_MIN = 0.0  # every clashing line shows up in `lead`, even a short lick


@dataclass
class Strike:
    """An event of one layer after classification."""

    event: Event
    layer: int
    kind: str  # "chord" | "notes"
    label: ChordLabel | None = None
    #: Standard voicing for chords: (string, fret) per note.
    shape: tuple[tuple[int, int], ...] | None = None
    notes: list[Note] = field(default_factory=list)

    @property
    def time(self) -> float:
        return self.event.time

    @property
    def end(self) -> float:
        return max(n.end for n in self.notes)


@dataclass
class Cleaned:
    rhythm: list[Strike]
    lead: list[Strike]
    solos: list[tuple[float, float]]
    stats: dict


# ─── 1. events ────────────────────────────────────────────────────────────────────────────


def _events(notes: list[Note]) -> list[Event]:
    events = group_events(notes, ONSET_WINDOW)
    for e in events:
        seen: dict[int, Note] = {}
        for n in e.notes:  # same pitch twice in one strike: keep the longer one
            if n.midi not in seen or n.duration > seen[n.midi].duration:
                seen[n.midi] = n
        e.notes = sorted(seen.values(), key=lambda n: n.midi)
    return events


# ─── 2. chord or notes ────────────────────────────────────────────────────────────────────


def _costs(event: Event) -> tuple[float, float]:
    """(cost as chord, cost as notes) from the event's content alone."""
    pitches = event.pitches
    pcs = {p % 12 for p in pitches}
    if len(pitches) == 1:
        return 4.0, 0.0
    if len(pcs) == 1:  # octaves
        return 1.8, 0.4
    if len(pcs) == 2:
        a, b = sorted(pcs)
        if (b - a) in (5, 7):  # root + fifth (or fifth + root above): power chord
            # with an octave doubled (3+ strings struck) it can only be a chord
            return (0.0, 3.0) if len(pitches) >= 3 else (0.3, 1.2)
        return 1.4, 0.3  # third, sixth, second: a double stop
    if name_chord(pitches) is not None:
        return 0.0, 3.0 + 0.5 * (len(pitches) - 3)
    return 0.9, 1.6  # a cluster that names no chord


def classify(events: list[Event]) -> list[str]:
    """Chord ("chord") or notes ("notes") per event, smoothed over the layer with Viterbi."""
    if not events:
        return []
    states = ("chord", "notes")
    costs = [_costs(e) for e in events]
    total = list(costs[0])
    back: list[tuple[int, int]] = []
    for i in range(1, len(events)):
        switch = 0.0 if events[i].time - events[i - 1].end >= REST_GAP else SWITCH_COST
        row, ptr = [], []
        for s in range(2):
            stay, move = total[s], total[1 - s] + switch
            ptr.append(s if stay <= move else 1 - s)
            row.append(min(stay, move) + costs[i][s])
        total, back = row, back + [tuple(ptr)]
    s = 0 if total[0] <= total[1] else 1
    path = [s]
    for ptr in reversed(back):
        s = ptr[s]
        path.append(s)
    return [states[s] for s in reversed(path)]


# ─── 3. chords → standard ─────────────────────────────────────────────────────────────────

#: How far (s) a fragment looks for the full chord it belongs to.
CONTEXT = 3.0


def _tones(label: ChordLabel) -> set[int]:
    return {(label.root + i) % 12 for i in TEMPLATES[label.quality]}


def _full_label(event: Event) -> ChordLabel | None:
    """Name of an event that holds a whole chord (3+ pitch classes)."""
    return name_chord(event.pitches) if len({p % 12 for p in event.pitches}) >= 3 else None


def _label(event: Event, context: list[ChordLabel]) -> ChordLabel | None:
    """Name of a chord event. A fragment (fewer than 3 pitch classes) is the nearest full chord
    around it that contains it — a strum where only root and fifth were heard is still that C,
    not a C5; it is a power chord only when no full chord around explains it."""
    own = _full_label(event)
    if own is not None:
        return own
    pcs = {p % 12 for p in event.pitches}
    for other in context:  # nearest first
        if pcs <= _tones(other):
            return other
    label = name_chord(event.pitches)
    if label is not None:
        return label
    if len(pcs) == 2:  # e.g. a lone third: the triad on its bass
        return name_chord(tuple(sorted(event.pitches)) + (min(event.pitches) + 7,))
    return None


def _standardize(labels: list[ChordLabel]) -> dict[ChordLabel, ChordLabel]:
    """Extensions dropped; sus kept only when it keeps coming back."""
    counts = Counter(labels)
    out = {}
    for lab in counts:
        if lab.quality.startswith("sus") and counts[lab] >= SUS_MIN_REPEATS:
            out[lab] = lab
        else:
            out[lab] = ChordLabel(lab.root, STANDARD_QUALITY[lab.quality])
    return out


def _pick_shape(label: ChordLabel, bass_pc: int | None, tuning: Tuning):
    """The chord-chart shape of `label`: open chords where they exist, otherwise a barre as low on
    the neck as possible; a shape whose bass is the bass that was heard is preferred. Small
    three-string triads are not standard shapes (power chords keep their two/three-string shapes)."""
    best, best_cost = None, float("inf")
    for v in voicings(label, tuning):
        if v.id.startswith("tri-"):
            continue
        low = min(tuning.strings[s] + f for s, f in v.positions)
        base = min((f for _, f in v.positions if f > 0), default=0)
        cost = v.penalty + 0.12 * base + (0.0 if bass_pc is None or low % 12 == bass_pc else 0.6)
        cost -= 0.05 * len(v.positions) if label.quality != "5" else 0.0  # fuller shapes
        if cost < best_cost:
            best, best_cost = v, cost
    return best


def _chord_notes(strike: Strike, tuning: Tuning) -> list[Note]:
    ev = strike.event
    duration = max(n.duration for n in ev.notes)
    velocity = max(n.velocity for n in ev.notes)
    return [Note(ev.time, duration, tuning.strings[s] + f, velocity, strike.layer) for s, f in strike.shape]


def standardize_chords(strikes: list[Strike], tuning: Tuning) -> None:
    """Name every chord strike (all layers together) and give it the song's one shape for it."""
    chords = sorted((s for s in strikes if s.kind == "chord"), key=lambda s: s.time)
    full = [(s.time, lab) for s in chords if (lab := _full_label(s.event)) is not None]
    for s in chords:
        near = sorted((abs(t - s.time), i) for i, (t, _) in enumerate(full) if abs(t - s.time) <= CONTEXT)
        s.label = _label(s.event, [full[i][1] for _, i in near])
    standard = _standardize([s.label for s in chords if s.label])
    bass: dict[ChordLabel, Counter] = {}
    for s in chords:
        if s.label:
            bass.setdefault(standard[s.label], Counter())[min(s.event.pitches) % 12] += 1
    shapes = {lab: _pick_shape(lab, c.most_common(1)[0][0], tuning) for lab, c in bass.items()}
    for s in chords:
        v = shapes.get(standard[s.label]) if s.label else None
        if v is None:  # no standard shape for it: keep what was heard
            s.kind, s.label = "notes", None
            continue
        s.label, s.shape = standard[s.label], v.positions
        s.notes = _chord_notes(s, tuning)


# ─── layers ───────────────────────────────────────────────────────────────────────────────


def classify_layer(notes: list[Note], layer: int) -> list[Strike]:
    events = _events(notes)
    return [Strike(e, layer, k, notes=list(e.notes)) for e, k in zip(events, classify(events))]


# ─── combining layers ─────────────────────────────────────────────────────────────────────


def _clashes(line: Strike, chords: list[Strike]) -> bool:
    """A line note played while a chord is struck or still sounding (another guitar's, or the same
    guitar holding a chord under a melody)."""
    return any(c.time - 0.05 <= line.time < c.end - 0.05 for c in chords)


def _sections(times: list[float]) -> list[tuple[float, float]]:
    spans: list[list[float]] = []
    for t in sorted(times):
        if spans and t - spans[-1][1] <= SOLO_JOIN:
            spans[-1][1] = t
        else:
            spans.append([t, t])
    return [(a - SOLO_PAD, b + SOLO_PAD) for a, b in spans if b - a >= SOLO_MIN]


def _merge_same_onset(strikes: list[Strike]) -> list[Strike]:
    """Strikes of different layers at the same instant: one chord (the fullest), or the notes of
    every line together."""
    out: list[Strike] = []
    for s in sorted(strikes, key=lambda s: (s.time, s.kind != "chord", -len(s.notes))):
        if out and abs(s.time - out[-1].time) < ONSET_WINDOW:
            prev = out[-1]
            if prev.kind == "chord":
                continue
            have = {n.midi for n in prev.notes}
            prev.notes = prev.notes + [n for n in s.notes if n.midi not in have]
            continue
        out.append(Strike(s.event, s.layer, s.kind, s.label, s.shape, list(s.notes)))
    return out


def clean_guitar(notes: list[Note], tuning: Tuning) -> Cleaned:
    layers: dict[int, list[Note]] = {}
    for n in notes:
        layers.setdefault(n.layer, []).append(n)
    strikes = [s for layer, ns in sorted(layers.items()) for s in classify_layer(ns, layer)]
    standardize_chords(strikes, tuning)
    chords = [s for s in strikes if s.kind == "chord"]
    lines = [s for s in strikes if s.kind == "notes"]
    clashing = [s for s in lines if _clashes(s, chords)]
    solos = _sections([s.time for s in clashing])
    in_solo = lambda t: any(a <= t <= b for a, b in solos)  # noqa: E731
    clash_ids = {id(s) for s in clashing}

    rhythm = _merge_same_onset(chords + [s for s in lines if id(s) not in clash_ids])
    lead = _merge_same_onset([s for s in rhythm if not in_solo(s.time)] + [s for s in lines if in_solo(s.time)])
    names = Counter(s.label.name for s in chords if s.label)
    return Cleaned(rhythm, lead, solos, {
        "layers": len(layers),
        "events": len(strikes),
        "chords": len(chords),
        "note_events": len(lines),
        "chord_names": dict(names.most_common(12)),
    })
