from dataclasses import dataclass, field

import numpy as np

MAX_FRET = 22


@dataclass
class Note:
    time: float
    duration: float
    midi: int
    velocity: float = 0.8
    layer: int = 0

    @property
    def end(self) -> float:
        return self.time + self.duration


@dataclass(frozen=True)
class Tuning:
    id: str
    name: str
    strings: tuple[int, ...]
    labels: tuple[str, ...]
    prior: float

    @property
    def lowest(self) -> int:
        return self.strings[0]

    @property
    def highest(self) -> int:
        return self.strings[-1] + MAX_FRET

    def positions(self, midi: int) -> list[tuple[int, int]]:
        return [(s, midi - open_) for s, open_ in enumerate(self.strings) if 0 <= midi - open_ <= MAX_FRET]

    def to_json(self) -> dict:
        return {"id": self.id, "name": self.name, "strings": list(self.strings), "labels": list(self.labels)}


TUNINGS = {
    t.id: t
    for t in (
        Tuning("standard", "E estándar", (40, 45, 50, 55, 59, 64), ("E", "A", "D", "G", "B", "e"), 0.0),
        Tuning("eb", "Eb estándar", (39, 44, 49, 54, 58, 63), ("Eb", "Ab", "Db", "Gb", "Bb", "eb"), 1.0),
        Tuning("drop_d", "Drop D", (38, 45, 50, 55, 59, 64), ("D", "A", "D", "G", "B", "e"), 1.2),
        Tuning("d", "D estándar", (38, 43, 48, 53, 57, 62), ("D", "G", "C", "F", "A", "d"), 1.5),
    )
}


def detect_tuning(notes: list[Note]) -> Tuning:
    if not notes:
        return TUNINGS["standard"]
    pitches = np.array([n.midi for n in notes])

    def cost(tuning: Tuning) -> float:
        lost = 100.0 * float(np.mean(pitches < tuning.lowest))
        no_low_d = tuning.id == "drop_d" and not np.any(pitches == 38)
        return lost + tuning.prior + (1.0 if no_low_d else 0.0)

    return min(TUNINGS.values(), key=cost)


@dataclass
class Event:
    time: float
    notes: list[Note] = field(default_factory=list)

    @property
    def pitches(self) -> tuple[int, ...]:
        return tuple(sorted({n.midi for n in self.notes}))

    @property
    def end(self) -> float:
        return max(n.end for n in self.notes)


def group_events(notes: list[Note], window: float = 0.035) -> list[Event]:
    events: list[Event] = []
    for n in sorted(notes, key=lambda n: (n.time, n.midi)):
        if events and n.time - events[-1].time < window:
            events[-1].notes.append(n)
        else:
            events.append(Event(n.time, [n]))
    for e in events:
        e.notes.sort(key=lambda n: n.midi)
    return events
