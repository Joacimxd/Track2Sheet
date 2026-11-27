from pathlib import Path

import numpy as np

from ..audio import estimate_velocity, remove_bleed
from .cleaner import Strike, clean_guitar
from .core import Event, Note, Tuning, detect_tuning
from .fingering import Placed, fixed_fingering, solve

VOCAL_RATIO = 2.0
MUTED_VELOCITY = 0.25
MUTED_MAX_DURATION = 0.15


def notes_from_json(raw: list[dict]) -> list[Note]:
    return [Note(float(n["time"]), float(n["duration"]), int(n["midi"]), float(n.get("velocity", 0.8)),
                 int(n.get("program") or 0)) for n in raw]


def has_velocity(notes: list[Note]) -> bool:
    return len(notes) > 1 and float(np.std([n.velocity for n in notes])) > 0.03


def build_tab(notes: list[Note], stem: Path | None = None, vocals: Path | None = None) -> dict:
    notes = [Note(n.time, n.duration, n.midi, n.velocity, n.layer) for n in notes]
    if stem and vocals:
        notes = remove_bleed(notes, stem, [vocals], VOCAL_RATIO, lambda n: (n.midi, n.time, n.end))
    if stem and not has_velocity(notes):
        estimate_velocity(notes, stem)
    loud = has_velocity(notes)
    tuning = detect_tuning(notes)
    in_range = []
    for n in notes:
        if n.midi < tuning.lowest:
            continue
        while n.midi > tuning.highest:
            n.midi -= 12
        in_range.append(n)

    cleaned = clean_guitar(in_range, tuning)
    return {
        "tuning": tuning.to_json(),
        "solos": [{"start": round(a, 3), "end": round(b, 3)} for a, b in cleaned.solos],
        "parts": {
            "auto": render(place(cleaned.lead, tuning), loud),
            "rhythm": render(place(cleaned.rhythm, tuning), loud),
        },
    }


def place(strikes: list[Strike], tuning: Tuning) -> list[Placed]:
    events, fixed = [], {}
    for s in strikes:
        event = Event(s.time, sorted(s.notes, key=lambda n: n.midi))
        events.append(event)
        if s.kind == "chord" and s.shape:
            fixed[id(event)] = fixed_fingering(s.shape, tuning, s.label.name)
    return solve(events, tuning, fixed)


def render(placed: list[Placed], loud: bool) -> dict:
    notes: list[dict] = []
    chords: list[dict] = []
    for p in placed:
        event, f = p.event, p.fingering
        by_pitch = {n.midi: n for n in event.notes}
        chord_index = len(chords) if len(f.positions) > 1 else -1
        for string, fret, midi in f.positions:
            src = by_pitch.get(midi)
            duration = src.duration if src and not f.name else max(n.duration for n in event.notes)
            velocity = src.velocity if src and not f.name else max(n.velocity for n in event.notes)
            notes.append({
                "id": len(notes),
                "time": round(event.time, 4),
                "duration": round(duration, 4),
                "midi": midi,
                "velocity": round(velocity, 3),
                "string": string,
                "fret": fret,
                "muted": loud and velocity < MUTED_VELOCITY and duration < MUTED_MAX_DURATION,
                "chord": chord_index,
            })
        if chord_index >= 0:
            frets = [fret for _, fret, _ in f.positions]
            strings = [s for s, _, _ in f.positions]
            chords.append({
                "time": round(event.time, 4),
                "minFret": min(frets),
                "maxFret": max(frets),
                "minString": min(strings),
                "maxString": max(strings),
                "name": f.name,
            })
    return {"notes": notes, "chords": chords}
