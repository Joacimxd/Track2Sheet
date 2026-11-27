"""MIDI notes of a guitar part → playable tablature for the highway.

    notes ─► sung notes out, loudness ─► tuning ─► guitar cleaner (guitar_cleaner.py: per guitar
    layer, chord or notes; chords → standard shapes, notes untouched; layers → parts)
          ─► global fingering (chords keep their standard shape) ─► tab JSON

The result has two parts:
  * `auto`: what one guitarist plays through the song (chords, and the line in solos);
  * `rhythm`: the chords throughout, single notes only where no chord is being played.
"""

from __future__ import annotations

from pathlib import Path

from .cleanup import detect_tuning, estimate_velocity, has_velocity, remove_vocal_notes
from .core import Event, Note, Tuning
from .fingering import Placed, fixed_fingering, solve
from .guitar_cleaner import Strike, clean_guitar

MUTED_VELOCITY = 0.25
MUTED_MAX_DURATION = 0.15


def notes_from_json(raw: list[dict]) -> list[Note]:
    return [Note(float(n["time"]), float(n["duration"]), int(n["midi"]), float(n.get("velocity", 0.8)),
                 int(n.get("program") or 0)) for n in raw]


def build_tab(notes: list[Note], stem: Path | None = None, drums: Path | None = None,
              vocals: Path | None = None) -> dict:
    """`stem`: the guitar stem (loudness of each note). `vocals`: the vocals stem (with the guitar
    stem, drops sung notes the transcriber labelled as guitar). `drums` is accepted and unused."""
    notes = [Note(n.time, n.duration, n.midi, n.velocity, n.layer) for n in notes]
    n_input = len(notes)
    if stem is not None and stem.exists() and vocals is not None and vocals.exists():
        notes = remove_vocal_notes(notes, stem, vocals)
    if stem is not None and stem.exists() and not has_velocity(notes):
        estimate_velocity(notes, stem)
    loud = has_velocity(notes)
    tuning = detect_tuning(notes)
    in_range = []
    for n in notes:
        if n.midi < tuning.lowest:
            continue
        while n.midi > tuning.highest:  # above the last fret: an octave down rather than lost
            n.midi -= 12
        in_range.append(n)

    cleaned = clean_guitar(in_range, tuning)
    stats = {"input": n_input, "vocal_notes_removed": n_input - len(notes),
             "velocity": "stem" if stem and loud else ("midi" if loud else "none"), **cleaned.stats}
    return {
        "tuning": tuning.to_json(),
        "solos": [{"start": round(a, 3), "end": round(b, 3)} for a, b in cleaned.solos],
        "parts": {
            "auto": _render(_place(cleaned.lead, tuning), tuning, loud),
            "rhythm": _render(_place(cleaned.rhythm, tuning), tuning, loud),
        },
        "stats": stats,
    }


def _place(strikes: list[Strike], tuning: Tuning) -> list[Placed]:
    events, fixed = [], {}
    for s in strikes:
        ev = Event(s.time, sorted(s.notes, key=lambda n: n.midi))
        events.append(ev)
        if s.kind == "chord" and s.shape:
            fixed[id(ev)] = fixed_fingering(s.shape, tuning, s.label.name if s.label else "standard")
    return solve(events, tuning, fixed, snap=False)


def _render(placed: list[Placed], tuning: Tuning, loud: bool) -> dict:
    notes: list[dict] = []
    chords: list[dict] = []
    for p in placed:
        ev, f = p.event, p.fingering
        by_pitch = {n.midi: n for n in ev.notes}
        chord_index = len(chords) if len(f.positions) > 1 else -1
        for s, fret, midi in f.positions:
            src = by_pitch.get(midi)
            duration = src.duration if src and not f.voicing else max(n.duration for n in ev.notes)
            velocity = src.velocity if src and not f.voicing else max(n.velocity for n in ev.notes)
            notes.append({
                "id": len(notes),
                "time": round(ev.time, 4),
                "duration": round(duration, 4),
                "midi": midi,
                "velocity": round(velocity, 3),
                "string": s,
                "fret": fret,
                "muted": loud and velocity < MUTED_VELOCITY and duration < MUTED_MAX_DURATION,
                "chord": chord_index,
            })
        if chord_index >= 0:
            frets = [fret for _, fret, _ in f.positions]
            strings = [s for s, _, _ in f.positions]
            # Only chords get a name (the cleaner's); a double stop of a line is just two notes.
            chords.append({
                "time": round(ev.time, 4),
                "minFret": min(frets),
                "maxFret": max(frets),
                "minString": min(strings),
                "maxString": max(strings),
                "name": f.voicing,
            })
    return {"notes": notes, "chords": chords, "hands": [p.hand for p in placed]}
