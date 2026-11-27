"""Shared types and the guitar model (tunings, playable positions)."""

from __future__ import annotations

from dataclasses import dataclass, field

MAX_FRET = 22


@dataclass
class Note:
    time: float
    duration: float
    midi: int
    velocity: float = 0.8
    #: Which guitar of the song it comes from (the MIDI program of its track; 0 = unknown).
    layer: int = 0

    @property
    def end(self) -> float:
        return self.time + self.duration


@dataclass(frozen=True)
class Tuning:
    id: str
    name: str
    #: Open-string pitches, string 0 = lowest (6th string) … string 5 = highest.
    strings: tuple[int, ...]
    labels: tuple[str, ...]

    @property
    def lowest(self) -> int:
        return self.strings[0]

    @property
    def highest(self) -> int:
        return self.strings[-1] + MAX_FRET

    def positions(self, midi: int) -> list[tuple[int, int]]:
        """Every (string, fret) that sounds `midi`."""
        return [(s, midi - open_) for s, open_ in enumerate(self.strings) if 0 <= midi - open_ <= MAX_FRET]

    def to_json(self) -> dict:
        return {"id": self.id, "name": self.name, "strings": list(self.strings), "labels": list(self.labels)}


TUNINGS: dict[str, Tuning] = {
    t.id: t
    for t in (
        Tuning("standard", "E estándar", (40, 45, 50, 55, 59, 64), ("E", "A", "D", "G", "B", "e")),
        Tuning("eb", "Eb estándar", (39, 44, 49, 54, 58, 63), ("Eb", "Ab", "Db", "Gb", "Bb", "eb")),
        Tuning("drop_d", "Drop D", (38, 45, 50, 55, 59, 64), ("D", "A", "D", "G", "B", "e")),
        Tuning("d", "D estándar", (38, 43, 48, 53, 57, 62), ("D", "G", "C", "F", "A", "d")),
    )
}


@dataclass
class Event:
    """Notes that start together (one pick or strum)."""

    time: float
    notes: list[Note] = field(default_factory=list)

    @property
    def pitches(self) -> tuple[int, ...]:
        return tuple(sorted({n.midi for n in self.notes}))

    @property
    def end(self) -> float:
        return max(n.end for n in self.notes)


def group_events(notes: list[Note], window: float = 0.035) -> list[Event]:
    """Group notes whose onsets are within `window` of the first one (MuScriptor's grid is 10 ms)."""
    events: list[Event] = []
    for n in sorted(notes, key=lambda n: (n.time, n.midi)):
        if events and n.time - events[-1].time < window:
            events[-1].notes.append(n)
        else:
            events.append(Event(n.time, [n]))
    for e in events:
        e.notes.sort(key=lambda n: n.midi)
    return events
