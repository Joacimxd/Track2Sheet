---
version: 1
slug: "interfaz-src-app-tsx"
primary_target: "interfaz/src/App.tsx"
related_targets: ["interfaz/src/components"]
---

# Surface: practice app (interfaz)

Mode: Operate. Audience: a guitarist or drummer at home, instrument in hand, screen a few feet away, evening lamp light; reads at a glance. Task: play along with the song minus their part; mute/solo/volume stems; switch guitar/drums; seek; load songs.
Constraints: Spanish UI, dark screen, layout approved by the user (top player bar, centre highway canvas, right column with YouTube link + PISTAS mixer). Fretboard string colours stay.

## Direction contract

THESIS: Each stem is a stage-lighting gel. What sounds is lit, what is muted goes dark. Refuses the neon-glow game look and the grey DAW mixer with one blue accent.

OWN-WORLD: Black stage (#0e0f12) under a slightly lifted panel tone (#15171b), warm off-white ink (#f2efe9), warm grey secondary. Six fixed gel colours, one per stem: Voces rose #d65aa0, Guitarra amber #f0b429, Bajo blue #3f8fd2, Batería red #e0503a, Piano green #4fb286, Otros steel #9a9fb0. Barlow for UI, Barlow Condensed for numbers and labels, tabular numerals. Square-ish 6px radii, flat fills, real offset shadows only on floating menus. No glow halos, no gradients as decoration.

STORY: The player sees at once which parts of the band are sounding (lit gels), which one is theirs (its gel names the mode everywhere: seek fill, Toco switch), and mutes or solos a stem with one obvious press.

FIRST VIEWPORT: Top bar: play (off-white disc), restart, time in condensed tabular numerals, seek bar filled in the practised instrument's gel colour, song select, Toco segmented switch whose active segment is that gel colour. Centre: the 3D highway on black stage. Right: compact YouTube field, then PISTAS: six rows, each led by a square gel swatch with the stem's short name, name + file, mute and solo buttons, volume slider, and a level meter drawn in the gel colour. Muted rows dim the swatch to an unlit filter.

FORM: Gel Swatchbook, IMPECCABLE’S PICK (my top-ranked grounded candidate), seed:618ceff00dbbdd69. Signature move: the gel swatch lights and unlights with the stem's audible state; the meter is the light passing through it.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
