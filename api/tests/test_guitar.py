from api.guitar.build import build_tab
from api.guitar.chords import TEMPLATES, ChordLabel, voicings
from api.guitar.cleaner import classify, clean_guitar
from api.guitar.core import TUNINGS, Note, detect_tuning, group_events
from api.guitar.fingering import solve, static_cost

STD = TUNINGS["standard"]
E = 0.26


def seq(pitches, start=0.0, step=E, dur=None):
    return [Note(start + i * step, dur or step, p) for i, p in enumerate(pitches)]


def chord(pitches, t, dur=E):
    return [Note(t, dur, p) for p in pitches]


def fingering_of(tab_part, t):
    return sorted((n["string"], n["fret"]) for n in tab_part["notes"] if abs(n["time"] - t) < 1e-6)


def test_scale_stays_in_one_position():
    box = [45, 48, 50, 52, 55, 57, 60, 62, 64, 67, 69, 72]
    placed = solve(group_events(seq(box + box[::-1])), STD)
    assert len({p.hand for p in placed if p.fingering.lo}) == 1
    assert all(5 <= f.fingering.lo <= 8 for f in placed if f.fingering.lo)


def test_repeated_chord_keeps_its_fingering():
    notes = []
    t = 0.0
    for _ in range(4):
        notes += chord([45, 52, 57, 61, 64], t)
        notes += seq([69, 72, 74, 76, 79], t + E)
        t += 6 * E
    tab = build_tab(notes)["parts"]["auto"]
    a_chords = [fingering_of(tab, i * 6 * E) for i in range(4)]
    assert all(c == a_chords[0] for c in a_chords)


def test_solo_over_rhythm_is_split():
    notes = []
    for i in range(80):
        notes += chord([45, 52, 57], i * E)
    melody = [69, 72, 74, 72, 69, 67, 69, 72, 76, 74, 72, 69] * 2
    for i, p in enumerate(melody):
        notes.append(Note(8 + i * E, E, p))
    tab = build_tab(notes)
    assert len(tab["solos"]) == 1
    solo = tab["solos"][0]
    assert solo["start"] < 8.5 and solo["end"] > 13.5

    auto, rhythm = tab["parts"]["auto"]["notes"], tab["parts"]["rhythm"]["notes"]
    in_solo = [n for n in auto if 9 <= n["time"] <= 13]
    assert in_solo and all(n["midi"] >= 64 for n in in_solo)
    assert all(n["chord"] == -1 for n in in_solo)
    assert {n["midi"] for n in rhythm if 9 <= n["time"] <= 13} == {45, 52, 57}


def test_no_solo_in_plain_strumming():
    notes = []
    for i in range(60):
        notes += chord([45, 52, 57] if i % 8 < 4 else [50, 57, 62], i * E)
    assert build_tab(notes)["solos"] == []


def test_tuning_detection():
    assert detect_tuning(seq([40, 45, 50, 55] * 20)).id == "standard"
    assert detect_tuning(seq([39, 46, 51, 44] * 20)).id == "eb"
    assert detect_tuning(seq([38, 45, 50, 38, 45, 50] * 20)).id == "drop_d"


def test_eb_song_keeps_its_low_notes():
    notes = seq([39, 46, 51] * 30)
    tab = build_tab(notes)
    assert tab["tuning"]["id"] == "eb"
    assert len(tab["parts"]["auto"]["notes"]) == len(notes)
    assert min(n["fret"] for n in tab["parts"]["auto"]["notes"]) == 0


def test_unplayable_shapes_are_rejected():
    assert static_cost([(0, 1), (1, 3), (2, 3), (3, 2), (4, 4)]) is None
    assert static_cost([(0, 1), (2, 6)]) is None
    assert static_cost([(1, 3), (2, 2), (3, 0), (4, 1), (5, 0)]) is not None


def test_every_output_note_is_playable():
    notes = []
    for i in range(40):
        notes += chord([40, 47, 52, 56, 59, 64, 67], i * E)
    for part in build_tab(notes)["parts"].values():
        by_time: dict[float, list] = {}
        for n in part["notes"]:
            assert STD.strings[n["string"]] + n["fret"] == n["midi"]
            by_time.setdefault(n["time"], []).append(n)
        for ev in by_time.values():
            assert len({n["string"] for n in ev}) == len(ev) <= 6


def test_voicings_sound_the_chord_in_every_tuning():
    for tuning in TUNINGS.values():
        for root in range(12):
            for quality in ("5", "", "m"):
                for v in voicings(ChordLabel(root, quality), tuning):
                    pcs = {(tuning.strings[s] + f - root) % 12 for s, f in v.positions}
                    assert pcs == set(TEMPLATES[quality]), (tuning.id, v.id)


def kinds(notes):
    return classify(group_events(notes))


def shape_at(part, t):
    return fingering_of(part, t), next((c["name"] for c in part["chords"] if abs(c["time"] - t) < 1e-6), None)


def test_strummed_chords_become_chart_shapes():
    notes = []
    for i in range(8):
        notes += chord([48, 55, 64, 67] if i < 4 else [43, 50, 59, 62, 67], i * E)
    part = build_tab(notes)["parts"]["rhythm"]
    assert shape_at(part, 0) == ([(1, 3), (2, 2), (3, 0), (4, 1), (5, 0)], "C")
    assert shape_at(part, 4 * E) == ([(0, 3), (1, 2), (2, 0), (3, 0), (4, 0), (5, 3)], "G")
    assert all(shape_at(part, i * E) == shape_at(part, 0) for i in range(4))


def test_single_note_line_is_left_as_heard():
    riff = [52, 55, 57, 59, 57, 55, 52, 50, 52, 55, 57, 62]
    notes = seq(riff)
    assert kinds(notes) == ["notes"] * len(riff)
    part = build_tab(notes)["parts"]["auto"]
    assert [n["midi"] for n in part["notes"]] == riff and part["chords"] == []


def test_double_stops_in_a_line_stay_notes():
    notes = seq([64, 67]) + chord([60, 64], 2 * E) + chord([62, 65], 3 * E) + seq([69, 67], 4 * E)
    assert kinds(notes) == ["notes"] * 6
    part = build_tab(notes)["parts"]["auto"]
    assert sorted(n["midi"] for n in part["notes"] if abs(n["time"] - 2 * E) < 1e-6) == [60, 64]
    assert all(c["name"] is None for c in part["chords"])


def test_fragment_of_a_strum_takes_the_chord_around_it():
    notes = []
    for i in range(6):
        notes += chord([48, 55] if i == 3 else [48, 52, 55, 60, 64], i * E)
    part = build_tab(notes)["parts"]["rhythm"]
    assert shape_at(part, 3 * E) == shape_at(part, 0)


def test_power_chords_with_octave_are_chords_even_inside_a_line():
    line = seq([62, 64, 65]) + chord([50, 57, 62, 74], 3 * E) + seq([65, 64, 62], 4 * E)
    assert kinds(line) == ["notes"] * 3 + ["chord"] + ["notes"] * 3


def test_two_guitars_are_cleaned_apart():
    notes = []
    for i in range(16):
        notes += [Note(i * E, E, p, layer=24) for p in (45, 52, 57, 60, 64)]
        notes.append(Note(i * E, E, [69, 72, 74, 76][i % 4], layer=29))
    cleaned = clean_guitar(notes, STD)
    assert {s.kind for s in cleaned.rhythm} == {"chord"}
    assert {s.label.name for s in cleaned.rhythm} == {"Am"}
    assert all(s.kind == "notes" and len(s.notes) == 1 for s in cleaned.lead)
    assert cleaned.solos
