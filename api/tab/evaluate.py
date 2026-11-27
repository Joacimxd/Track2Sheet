"""Measure tablature quality, so changes to the mapper are judged by numbers, not by eye.

    .venv/bin/python -m api.tab.evaluate                     # every song in output/midi/
    .venv/bin/python -m api.tab.evaluate --baseline b.json   # also score another mapper's output

Metrics, all computed from the tab notes (string, fret, time) so any mapper can be compared:
  shifts/min      hand position changes per minute (hand = 4-fret box, moved only when needed)
  frets/min       total distance the hand travels per minute
  span>4          strums that need a stretch of 5+ frets
  ring            notes fretted on a string that is still sounding another note
  consistency     share of repeated chords (same pitches) played with their most common fingering
  solos           sections found and their total length
"""

from __future__ import annotations

import argparse
import json
import time
from collections import Counter, defaultdict
from pathlib import Path

import mido

from ..pipeline import OUTPUT_DIR
from .build import build_tab
from .core import Note


def read_midi_notes(path: Path) -> list[Note]:
    """Pitched notes of a .mid, merged across tracks (as the interface reads guitar.mid); each note's
    `layer` is the program of its channel."""
    mid = mido.MidiFile(str(path))
    notes: list[Note] = []
    t, tempo = 0.0, 500000
    open_: dict[tuple[int, int], tuple[float, int]] = {}
    programs: dict[int, int] = {}
    for msg in mido.merge_tracks(mid.tracks):
        t += mido.tick2second(msg.time, mid.ticks_per_beat, tempo)
        if msg.type == "set_tempo":
            tempo = msg.tempo
        elif msg.type == "program_change":
            programs[msg.channel] = msg.program
        elif msg.type == "note_on" and msg.velocity > 0 and msg.channel != 9:
            open_[(msg.channel, msg.note)] = (t, msg.velocity)
        elif msg.type in ("note_off", "note_on") and (msg.channel, msg.note) in open_:
            start, vel = open_.pop((msg.channel, msg.note))
            if t > start:
                notes.append(Note(start, t - start, msg.note, vel / 127, programs.get(msg.channel, 0)))
    return sorted(notes, key=lambda n: (n.time, n.midi))


def metrics(notes: list[dict], solos: list[dict] | None = None) -> dict:
    if not notes:
        return {}
    events: dict[float, list[dict]] = defaultdict(list)
    for n in notes:
        events[round(n["time"], 3)].append(n)
    times = sorted(events)
    minutes = max(1e-9, (times[-1] - times[0]) / 60)

    hand, shifts, travel, wide, ring = None, 0, 0, 0, 0
    sounding: dict[int, dict] = {}
    chord_fingerings: dict[tuple, Counter] = defaultdict(Counter)
    for t in times:
        ev = events[t]
        fretted = [n["fret"] for n in ev if n["fret"] > 0]
        if fretted:
            lo, hi = min(fretted), max(fretted)
            if hi - lo >= 5:
                wide += 1
            if hand is None:
                hand = lo
            elif lo < hand or hi > hand + 3:
                new = lo if lo < hand else max(1, hi - 3)
                shifts += 1
                travel += abs(new - hand)
                hand = new
        for n in ev:
            held = sounding.get(n["string"])
            if held and held["time"] + held["duration"] > t + 0.03 and held["fret"] != n["fret"]:
                ring += 1
            sounding[n["string"]] = n
        if len(ev) >= 2:
            key = tuple(sorted(n["midi"] for n in ev))
            chord_fingerings[key][tuple(sorted((n["string"], n["fret"]) for n in ev))] += 1

    repeated = [c for c in chord_fingerings.values() if sum(c.values()) >= 2]
    same = sum(c.most_common(1)[0][1] for c in repeated)
    total = sum(sum(c.values()) for c in repeated)
    out = {
        "notes": len(notes),
        "shifts/min": round(shifts / minutes, 1),
        "frets/min": round(travel / minutes, 1),
        "span>4": wide,
        "ring": ring,
        "consistency": round(same / total, 3) if total else 1.0,
    }
    if solos is not None:
        out["solos"] = f"{len(solos)} ({sum(s['end'] - s['start'] for s in solos):.0f}s)"
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--baseline", type=Path, help="JSON {song: {tab: {notes, solos}}} from another mapper")
    ap.add_argument("--json", type=Path, help="write results here")
    args = ap.parse_args()
    baseline = json.loads(args.baseline.read_text()) if args.baseline else {}

    results = {}
    for song_dir in sorted((OUTPUT_DIR / "midi").iterdir()):
        mid = song_dir / "guitar.mid"
        if not mid.exists():
            continue
        # Same input as the other mapper when there is one, else the .mid as the interface reads it
        if song_dir.name in baseline:
            notes = [Note(n["time"], n["duration"], n["midi"], n["velocity"]) for n in baseline[song_dir.name]["input"]]
        else:
            notes = read_midi_notes(mid)
        stem = next(iter(sorted((OUTPUT_DIR / "stems" / song_dir.name).glob("guitar.*"))), None)
        drums = next(iter(sorted((OUTPUT_DIR / "stems" / song_dir.name).glob("drums.*"))), None)
        vocals = next(iter(sorted((OUTPUT_DIR / "stems" / song_dir.name).glob("vocals.*"))), None)
        t0 = time.perf_counter()
        tab = build_tab(notes, stem, drums, vocals)
        ms = (time.perf_counter() - t0) * 1000
        row = {"new": metrics(tab["parts"]["auto"]["notes"], tab["solos"]), "ms": round(ms)}
        row["new_rhythm"] = metrics(tab["parts"]["rhythm"]["notes"])
        row["tuning"] = tab["tuning"]["name"]
        if song_dir.name in baseline:
            b = baseline[song_dir.name]["tab"]
            row["old"] = metrics(b["notes"], b["solos"])
        results[song_dir.name] = row

        print(f"\n{song_dir.name}  ({len(notes)} notes in, {row['tuning']}, {ms:.0f} ms, velocity: {tab['stats']['velocity']})")
        st = tab["stats"]
        print(f"  {st['layers']} guitars, {st['chords']} chord strikes, {st['note_events']} note strikes;"
              f" chords: {', '.join(f'{k}×{v}' for k, v in st['chord_names'].items())}")
        keys = ["notes", "shifts/min", "frets/min", "span>4", "ring", "consistency", "solos"]
        print(f"  {'':12s}" + "".join(f"{k:>13s}" for k in keys))
        for label in ("old", "new", "new_rhythm"):
            if label in row:
                print(f"  {label:12s}" + "".join(f"{str(row[label].get(k, '')):>13s}" for k in keys))
    if args.json:
        args.json.write_text(json.dumps(results, indent=1))


if __name__ == "__main__":
    main()
