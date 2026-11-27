from collections import Counter
from dataclasses import dataclass, field

from .chords import TEMPLATES, ChordLabel, name_chord, voicings
from .core import Event, Note, Tuning, group_events

ONSET_WINDOW = 0.035
SWITCH_COST = 1.0
REST_GAP = 1.0
STANDARD_QUALITY = {"": "", "m": "m", "5": "5", "7": "7", "m7": "m7", "maj7": "", "add9": "",
                    "sus2": "5", "sus4": "5"}
SUS_MIN_REPEATS = 4
SOLO_JOIN = 2.0
SOLO_PAD = 0.25
CONTEXT = 3.0


@dataclass
class Strike:

    event: Event
    layer: int
    kind: str
    label: ChordLabel | None = None
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


def _events(notes: list[Note]) -> list[Event]:
    events = group_events(notes, ONSET_WINDOW)
    for e in events:
        seen: dict[int, Note] = {}
        for n in e.notes:
            if n.midi not in seen or n.duration > seen[n.midi].duration:
                seen[n.midi] = n
        e.notes = sorted(seen.values(), key=lambda n: n.midi)
    return events


def _costs(event: Event) -> tuple[float, float]:
    pitches = event.pitches
    pcs = {p % 12 for p in pitches}
    if len(pitches) == 1:
        return 4.0, 0.0
    if len(pcs) == 1:
        return 1.8, 0.4
    if len(pcs) == 2:
        a, b = sorted(pcs)
        if (b - a) in (5, 7):
            return (0.0, 3.0) if len(pitches) >= 3 else (0.3, 1.2)
        return 1.4, 0.3
    if name_chord(pitches) is not None:
        return 0.0, 3.0 + 0.5 * (len(pitches) - 3)
    return 0.9, 1.6


def classify(events: list[Event]) -> list[str]:
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



def _tones(label: ChordLabel) -> set[int]:
    return {(label.root + i) % 12 for i in TEMPLATES[label.quality]}


def _full_label(event: Event) -> ChordLabel | None:
    return name_chord(event.pitches) if len({p % 12 for p in event.pitches}) >= 3 else None


def _label(event: Event, context: list[ChordLabel]) -> ChordLabel | None:
    own = _full_label(event)
    if own is not None:
        return own
    pcs = {p % 12 for p in event.pitches}
    for other in context:
        if pcs <= _tones(other):
            return other
    label = name_chord(event.pitches)
    if label is not None:
        return label
    if len(pcs) == 2:
        return name_chord(tuple(sorted(event.pitches)) + (min(event.pitches) + 7,))
    return None


def _standardize(labels: list[ChordLabel]) -> dict[ChordLabel, ChordLabel]:
    counts = Counter(labels)
    out = {}
    for lab in counts:
        if lab.quality.startswith("sus") and counts[lab] >= SUS_MIN_REPEATS:
            out[lab] = lab
        else:
            out[lab] = ChordLabel(lab.root, STANDARD_QUALITY[lab.quality])
    return out


def _pick_shape(label: ChordLabel, bass_pc: int | None, tuning: Tuning):
    best, best_cost = None, float("inf")
    for v in voicings(label, tuning):
        low = min(tuning.strings[s] + f for s, f in v.positions)
        base = min((f for _, f in v.positions if f > 0), default=0)
        cost = v.penalty + 0.12 * base + (0.0 if bass_pc is None or low % 12 == bass_pc else 0.6)
        cost -= 0.05 * len(v.positions) if label.quality != "5" else 0.0
        if cost < best_cost:
            best, best_cost = v, cost
    return best


def _chord_notes(strike: Strike, tuning: Tuning) -> list[Note]:
    ev = strike.event
    duration = max(n.duration for n in ev.notes)
    velocity = max(n.velocity for n in ev.notes)
    return [Note(ev.time, duration, tuning.strings[s] + f, velocity, strike.layer) for s, f in strike.shape]


def standardize_chords(strikes: list[Strike], tuning: Tuning) -> None:
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
        if v is None:
            s.kind, s.label = "notes", None
            continue
        s.label, s.shape = standard[s.label], v.positions
        s.notes = _chord_notes(s, tuning)


def classify_layer(notes: list[Note], layer: int) -> list[Strike]:
    events = _events(notes)
    return [Strike(e, layer, k, notes=list(e.notes)) for e, k in zip(events, classify(events))]


def _clashes(line: Strike, chords: list[Strike]) -> bool:
    return any(c.time - 0.05 <= line.time < c.end - 0.05 for c in chords)


def _sections(times: list[float]) -> list[tuple[float, float]]:
    spans: list[list[float]] = []
    for t in sorted(times):
        if spans and t - spans[-1][1] <= SOLO_JOIN:
            spans[-1][1] = t
        else:
            spans.append([t, t])
    return [(a - SOLO_PAD, b + SOLO_PAD) for a, b in spans]


def _merge_same_onset(strikes: list[Strike]) -> list[Strike]:
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
    in_solo = lambda t: any(a <= t <= b for a, b in solos)
    clash_ids = {id(s) for s in clashing}

    rhythm = _merge_same_onset(chords + [s for s in lines if id(s) not in clash_ids])
    lead = _merge_same_onset([s for s in rhythm if not in_solo(s.time)] + [s for s in lines if in_solo(s.time)])
    return Cleaned(rhythm, lead, solos)
