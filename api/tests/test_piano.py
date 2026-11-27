import mido

from api import pipeline
from api.piano import FINGERS, REACH, build_piano, clean, split_hands
from api.guitar.core import Note


def hands_of(notes):
    notes = sorted(notes, key=lambda n: (n.time, n.midi))
    return {(n.time, n.midi): h for n, h in zip(notes, split_hands(notes))}


def test_bass_and_melody_go_to_different_hands():
    left = [Note(i * 0.5, 0.4, p) for i, p in enumerate([36, 43, 36, 43, 41, 48, 41, 48])]
    right = [Note(i * 0.25, 0.2, p) for i, p in enumerate([72, 74, 76, 77, 79, 77, 76, 74] * 2)]
    hands = hands_of(left + right)
    assert all(hands[(n.time, n.midi)] == 0 for n in left)
    assert all(hands[(n.time, n.midi)] == 1 for n in right)


def test_wide_chord_is_split_at_its_gap():
    chord = [Note(0, 1, p) for p in (40, 47, 52, 64, 67, 72)]
    hands = hands_of(chord)
    assert [hands[(0, p)] for p in (40, 47, 52)] == [0, 0, 0]
    assert [hands[(0, p)] for p in (64, 67, 72)] == [1, 1, 1]


def test_left_hand_run_climbing_stays_left():
    walk = [Note(i * 0.5, 0.4, 40 + i) for i in range(12)]
    chords = [Note(i * 2.0, 1.9, p) for i in range(3) for p in (72, 76, 79)]
    hands = hands_of(walk + chords)
    assert all(hands[(n.time, n.midi)] == 0 for n in walk)


def test_without_stem_only_touching_fragments_merge():
    out = clean([Note(0, 0.5, 60), Note(0.51, 0.5, 60), Note(1.3, 0.5, 60), Note(1.2, 0.01, 64)])
    assert [(n.time, round(n.duration, 2), n.midi) for n in out] == [(0, 1.01, 60), (1.3, 0.5, 60)]


def _tone(path, sr, parts):
    import numpy as np
    import soundfile as sf

    y = np.zeros(int(sr * 4), dtype=np.float32)
    for start, end, midi, _ in parts:
        t = np.arange(int((end - start) * sr)) / sr
        f = 440 * 2 ** ((midi - 69) / 12)
        y[int(start * sr):int(start * sr) + len(t)] += 0.3 * np.sin(2 * np.pi * f * t) * np.exp(-t * 1.5)
    sf.write(str(path), y, sr)


def test_stem_tells_held_from_restruck_and_ghosts(tmp_path):
    stem = tmp_path / "piano.wav"
    _tone(stem, 22050, [(0, 2, 60, True), (0, 1, 64, True), (1, 2, 64, True)])
    notes = [Note(0, 1, 60), Note(1, 1, 60),
             Note(0, 1, 64), Note(1, 1, 64),
             Note(0.5, 1, 79)]
    out = clean(notes, stem)
    assert [(n.time, n.duration, n.midi) for n in out] == [(0, 2, 60), (0, 1, 64), (1, 1, 64)]


def test_stray_note_far_from_everything_is_dropped():
    line = [Note(i * 0.25, 0.25, 60 + (i % 5)) for i in range(16)]
    out = clean(line + [Note(2.0, 0.1, 96)])
    assert len(out) == len(line) and all(n.midi < 70 for n in out)


def _hands_ok(notes):
    by_hand = {}
    for n, h in zip(notes, split_hands(notes)):
        by_hand.setdefault((n.time, h), []).append(n.midi)
    return all(len(v) <= FINGERS and max(v) - min(v) <= REACH for v in by_hand.values())


def test_no_more_than_ten_fingers():
    cluster = [Note(0, 1.0 - i * 0.05, p) for i, p in enumerate(range(48, 72, 2))]
    out = clean(cluster)
    assert len(out) == 10
    assert {48, 70} <= {n.midi for n in out}
    assert _hands_ok(out)


def test_three_hands_worth_of_notes_loses_the_weakest_cluster():
    low, mid, high = [36, 40, 43], [60, 64], [84, 88, 91]
    notes = [Note(0, 1, p) for p in low + high] + [Note(0, 0.3, p) for p in mid]
    out = clean(notes)
    assert sorted(n.midi for n in out) == low + high


def test_six_notes_in_an_octave_take_both_hands():
    notes = [Note(0, 1, p) for p in (60, 62, 64, 65, 67, 69)]
    out = clean(notes)
    assert len(out) == 6
    assert set(split_hands(out)) == {0, 1} and _hands_ok(out)


def test_build_piano_without_stems():
    res = build_piano([Note(0, 0.5, 48), Note(0, 0.5, 72)])
    assert [n["hand"] for n in res["notes"]] == [0, 1]


def note(onset, pitch, program, drum=False):
    return {"onset": onset, "offset": onset + 0.5, "pitch": pitch, "program": program, "is_drum": drum,
            "instrument": "x"}


def fake_muscriptor(monkeypatch, tmp_path, output):
    calls = []

    def fake_run(raw, out, groups, progress, on_progress):
        calls.append(groups)
        return {"notes": output}

    monkeypatch.setattr(pipeline, "run_muscriptor", fake_run)
    monkeypatch.setattr(pipeline, "to_16k_mono", lambda mix, dst: None)
    monkeypatch.setattr(pipeline, "MUSCRIPTOR_BIN", tmp_path)
    monkeypatch.setattr(pipeline, "MUSCRIPTOR_MODEL", tmp_path)
    return calls


HEARD = [note(1, 60, 0), note(0, 52, 29), note(0, 36, 0, drum=True), note(0, 40, 33), note(2, 64, 52)]


def test_a_pass_per_instrument(tmp_path, monkeypatch):
    calls = fake_muscriptor(monkeypatch, tmp_path, HEARD)
    notes_json = tmp_path / "notes.json"

    data = pipeline.transcribe(tmp_path / "mix.wav", notes_json, pipeline.Progress())
    assert calls == [groups for _, groups, _ in pipeline.PASSES]
    assert sorted(pipeline.family(n) for n in data["notes"]) == ["bass", "drums", "guitar", "piano"]
    assert sorted(pipeline.write_midis(data, tmp_path)) == ["all", "bass", "drums", "guitar", "piano"]

    calls.clear()
    pipeline.transcribe(tmp_path / "mix.wav", notes_json, pipeline.Progress())
    assert calls == []


def test_silent_instrument_is_skipped(tmp_path, monkeypatch):
    calls = fake_muscriptor(monkeypatch, tmp_path, HEARD)
    data = pipeline.transcribe(tmp_path / "mix.wav", tmp_path / "notes.json", pipeline.Progress(),
                               skip=lambda name: name == "piano")
    assert len(calls) == 2
    midis = pipeline.write_midis(data, tmp_path, silent={"bass"})
    assert sorted(midis) == ["all", "drums", "guitar"]


def test_piano_heard_as_guitar_is_dropped(tmp_path):
    import numpy as np
    import soundfile as sf

    sr = 22050
    t = np.arange(sr * 2) / sr
    a4 = 0.3 * np.sin(2 * np.pi * 440 * t).astype(np.float32)
    sf.write(str(tmp_path / "piano.wav"), a4, sr)
    sf.write(str(tmp_path / "guitar.wav"), 0.3 * np.sin(2 * np.pi * 196 * t).astype(np.float32), sr)
    data = {"notes": [note(0.5, 69, 29), note(0.5, 55, 29), note(0.5, 69, 0)]}
    (tmp_path / "midi").mkdir()
    pipeline.write_midis(data, tmp_path / "midi", tmp_path)
    assert pitches(tmp_path / "midi" / "guitar.mid") == [55]
    assert pitches(tmp_path / "midi" / "piano.mid") == [69]


def pitches(path):
    return [m.note for t in mido.MidiFile(str(path)).tracks for m in t if m.type == "note_on" and m.velocity]
