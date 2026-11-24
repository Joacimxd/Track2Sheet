---
name: Track2Sheet
description: Practice app that plays the real band minus your part, on a black stage lit by one gel per stem.
colors:
  stage: "#0e0f12"
  panel: "#15171b"
  raised: "#1c1e23"
  control: "#25272d"
  control-hover: "#2e3037"
  rule: "#2c2e34"
  ink: "#f2efe9"
  ink-2: "#b9b5ac"
  ink-3: "#8a877f"
  gel-ink: "#111214"
  alert: "#e0503a"
  gel-vocals: "#d65aa0"
  gel-guitar: "#f0b429"
  gel-bass: "#3f8fd2"
  gel-drums: "#e0503a"
  gel-piano: "#4fb286"
  gel-other: "#9a9fb0"
  string-orange: "#e8843a"
typography:
  numeral:
    fontFamily: "Barlow Condensed, Barlow, ui-sans-serif, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.4
    fontFeature: "tnum"
  title:
    fontFamily: "Barlow Condensed, Barlow, ui-sans-serif, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.55
    letterSpacing: "0.025em"
  swatch-label:
    fontFamily: "Barlow Condensed, Barlow, ui-sans-serif, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    letterSpacing: "0.025em"
  body-strong:
    fontFamily: "Barlow, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.25
  body:
    fontFamily: "Barlow, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.43
    fontFeature: "tnum"
  label:
    fontFamily: "Barlow, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.33
rounded:
  sm: "4px"
  md: "6px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  row: "10px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  band: "24px"
components:
  button-play:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.stage}"
    rounded: "{rounded.full}"
    size: "48px"
  button-icon:
    backgroundColor: "{colors.control}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.md}"
    size: "32px"
  button-icon-hover:
    backgroundColor: "{colors.control-hover}"
    textColor: "{colors.ink}"
  button-mute-on:
    textColor: "{colors.alert}"
    rounded: "{rounded.md}"
    size: "32px"
  button-solo-on:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.stage}"
    rounded: "{rounded.md}"
    size: "32px"
  button-secondary:
    backgroundColor: "{colors.control}"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "32px"
  button-submit:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.stage}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "32px"
  input-field:
    backgroundColor: "{colors.control}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 4px 0 10px"
    height: "44px"
  select:
    backgroundColor: "{colors.control}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 32px 0 10px"
    height: "36px"
  segmented-switch:
    backgroundColor: "{colors.control}"
    rounded: "{rounded.md}"
    padding: "2px"
  segmented-option-active:
    textColor: "{colors.gel-ink}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "32px"
  gel-swatch-lit:
    textColor: "{colors.gel-ink}"
    typography: "{typography.swatch-label}"
    rounded: "{rounded.md}"
    size: "44px"
---

# Design System: Track2Sheet

## Overview

**Creative North Star: "The Gel Swatchbook"**

Each of the six stems is a stage-lighting gel. What sounds is lit; what is muted goes dark. The whole interface is a black stage with warm off-white ink, and colour enters only through those six gels: the practised instrument's gel names the mode everywhere it appears (the seek fill, the active "Toco" segment, the tint on its mixer row, its notes on the highway). Everything else stays neutral so that colour always means "this part of the band".

The density is that of an operating surface read from a stool a few feet away: one top bar, a full-height highway canvas, one right column. Regions are full-bleed bands separated by 1px rules, not floating cards. Fills are flat; depth comes from three stacked dark tones and from the highway's own perspective, never from glow or ambient shadow. The interface is always dark.

The world refuses two things outright: the neon-glow rhythm-game look (halos, bloom, gradient chrome) and the grey DAW mixer with a single blue accent.

**Key Characteristics:**
- Black stage, lifted panel, warm ink; colour comes only from the six stem gels.
- The gel swatch lights (solid gel, dark ink) when the stem sounds and drops to an unlit filter (12% gel, gel-coloured text) when muted.
- Full-bleed bands divided by 1px rules; no cards.
- Flat fills, 6px corners, tabular numerals in Barlow Condensed.
- Spanish UI copy throughout.

## Colors

A near-black, slightly cool stage carrying warm paper-toned ink, with six saturated gels as the only chroma.

### Primary
- **The Six Stem Gels**: Vocals Rose, Guitar Amber, Bass Blue, Drums Red, Piano Green, Other Steel. One fixed gel per stem, shared by the mixer swatch, the level meter, and the highway notes / drum lanes. The practised instrument's gel (amber or red) is the mode colour: seek fill, active "Toco" segment, practised row tint (gel at ~7%), and the "La tocas tú" caption.
- **String Orange**: the fourth guitar string and the kick lane on the highway only. It completes the fretboard's string code (red, yellow, blue, orange, green, purple) and never appears in the chrome.

### Neutral
- **Stage Black**: page and highway background.
- **Panel Graphite**: top bar and right column bands, one step above the stage.
- **Raised Graphite**: reserved third tonal step.
- **Control Graphite**: fills of buttons, fields, the segmented switch, slider and meter tracks. **Control Hover** is one step lighter for hover.
- **Rule Line**: 1px dividers between bands and between mixer rows; field borders at rest.
- **Warm Ink**: primary text, the play disc, active solo, the slider thumb, focus outlines.
- **Ink 2 / Ink 3**: secondary text and idle icons; tertiary labels ("Canción", "Toco"), placeholders, total time.
- **Gel Ink**: the near-black text printed on any lit gel (swatch, active segment, note fret numbers).
- **Alert Red**: mute-on state (20% tint fill, red icon), invalid field border, error messages. It shares the drums gel's hue on purpose: muted is "red light off".

### Named Rules
**The Gel-Only Chroma Rule.** Colour outside the neutral ramp comes only from the six stem gels (plus String Orange on the fretboard). No brand accent, no blue "primary". If a colour on screen doesn't name a stem, it should be ink or graphite.

**The Lit / Unlit Rule.** A sounding stem shows its gel at full strength with Gel Ink on it; a muted or silent stem shows the same gel at 12% with gel-coloured text. State is carried by light, not by icons alone.

**The Mode Gel Rule.** The practised instrument's gel is applied to every control that expresses the practice mode, so switching guitar/drums recolours the seek fill, the switch, and the row tint together.

## Typography

**Display Font:** Barlow Condensed 500/600 (fallback Barlow, ui-sans-serif)
**Body Font:** Barlow 400/500/600 (fallback ui-sans-serif, system-ui)

**Character:** A narrow, engineered pairing from road-sign and stage-signage lineage: Barlow Condensed for numbers, swatch codes and headings that must read across the room; Barlow for everything else. Both are self-hosted woff2 (latin + latin-ext). Numerals are tabular app-wide so the clock never jitters.

### Hierarchy
- **Numeral** (Condensed 600, 1.25rem): elapsed and total time beside the seek bar; also highway fret numbers and lane labels on canvas.
- **Title** (Condensed 600, 1.125rem, slight tracking): section heading ("Pistas").
- **Swatch Label** (Condensed 600, 0.875rem, slight tracking, uppercase codes): three-letter stem codes on gel swatches (VOZ, GTR, BAJ, BAT, PNO, OTR).
- **Body Strong** (Barlow 600, 15px, 1.25): stem names in the mixer.
- **Body** (Barlow 500, 0.875rem): select text, field labels, input text, switch segments (600).
- **Label** (Barlow 600, 0.75rem): secondary buttons, file captions (400), pipeline status lines.

### Named Rules
**The Condensed-For-Reading-At-Distance Rule.** Anything the player must read from the stool (time, fret numbers, swatch codes, section names) is Barlow Condensed 600. Barlow body sizes are for controls reached with the mouse.

## Layout

A three-region operating layout. A top bar band (`panel`, 20px horizontal / 12px vertical padding, wrapping flex with 24px column / 12px row gaps) holds transport, the seek bar (flexes, min 260px), song select and the "Toco" switch. Below, a grid: the highway canvas fills the remaining width on the stage colour; the right column is `minmax(320px, 24%)`. Bands are separated by 1px rules, never by gaps or card edges.

Inside the right column, sections are full-bleed bands with 16px padding divided by rules. Mixer rows are stacked with 1px rules between them (10px vertical / 8px horizontal row padding), a 44px swatch, 10px gaps, and a second line (slider + meter) indented to align with the name column (54px).

Below the `lg` breakpoint (1024px) the layout stacks: top bar, highway (min 560px tall), then the mixer column with a top rule instead of a left rule; the page scrolls instead of locking to the viewport.

Spacing rhythm is a 4px base: 4, 8, 10, 12, 16, 20, 24.

## Elevation & Depth

Flat. Depth is tonal: stage (#0e0f12), then panel, then control fills, each a small lift in lightness. No surface in the chrome carries a resting shadow, glow or halo. The one floating element, the error toast over the highway, takes a single soft drop shadow because it sits over moving content. The highway draws its own depth through perspective projection, extruded note undersides (the gel darkened ~55%), and a functional bottom-darkening gradient for readability.

### Shadow Vocabulary
- **Floating overlay** (`box-shadow: 0 6px 20px rgba(0,0,0,0.5)`): floating messages over the highway only.

### Named Rules
**The No-Halo Rule.** A note about to be played brightens its gel fill; it never glows. No `shadowBlur`, bloom, or coloured halos anywhere, chrome or canvas.

**The Functional-Gradient Rule.** Gradients exist only where they do a job: the fader's hard-stop fill, the highway's readability shade and neck tone. Never as decoration on chrome.

## Shapes

Square-ish. Controls, fields, swatches, rows and the switch use 6px corners; segments and small submit buttons nested inside a 6px container use 4px. Only the play disc, the seek track/thumb, the slider thumb and status dots are fully round. Highway note blocks cap their corner radius at 6px too. Borders are 1px rules; strokes are not used for decoration.

## Components

### Buttons
Quiet until reached for; the only loud button is play.
- **Play:** 48px warm-ink disc with a stage-coloured filled icon; hover goes pure white, press scales to 95%.
- **Icon buttons (restart, mute, solo):** 40px (transport) or 32px (mixer) squares at 6px. Idle: control fill, Ink 2 icon; hover: Control Hover fill and Ink. Restart sits transparent until hover.
- **Mute on:** Alert Red at 20% fill with a red crossed-speaker icon. The practised stem's mute is locked on and disabled.
- **Solo on:** inverts to Warm Ink fill with stage-coloured icon; the row gains a 6% ink tint.
- **Secondary ("Cargar archivos", per-stem upload):** 32px tall, control fill, 12px semibold label with a 14px leading icon.
- **Submit ("Procesar"):** ink fill, stage text, 4px corners, nested inside the field.
- **Press feedback:** every button scales to 95-97% on active; disabled drops to 40% opacity.

### Segmented Switch ("Toco")
- Control-filled track with 2px padding. The active segment fills with the instrument's gel and Gel Ink text; inactive segments are Ink 2, hover Ink. Colour change transitions over 200ms. A segment without a loaded .mid drops to 60% opacity.

### Inputs / Fields
- **Style:** control fill, 1px rule border, 6px corners; 44px tall (YouTube field) or 36px (song select, custom chevron in Ink 3).
- **Focus:** border lifts to Ink 3 (field) and a global 2px Warm Ink outline at 2px offset for keyboard focus.
- **Error:** border turns Alert Red with a red helper line below. Pipeline progress runs as a 2px ink bar along the field's bottom edge, with step labels that turn Piano Green when done.

### Seek Bar
- 6px fully round control track filled in the mode gel; a 14px ink thumb appears on hover or keyboard focus. Arrow keys seek by 5 seconds.

### Gel Swatch (signature)
- 44px square at 6px carrying the stem's three-letter code. Lit: solid gel, Gel Ink text. Unlit: gel at 12%, gel-coloured text. Transitions background and colour over 200ms ease-out.

### Mixer Row
- Swatch, name (Body Strong, Ink when lit, Ink 2 when not) over a caption (file name in Ink 3, or "La tocas tú" in the gel when practised), then mute, solo and a disclosure chevron. Second line: 96px fader and the level meter. Rows divide by rules; the practised row takes a ~7% gel tint; rows without a file drop to 50% opacity.

### Fader
- 3px track with a hard-stop fill in Ink 2 over control, 12px ink thumb that scales to 120% on hover.

### Level Meter (signature)
- A 4px rounded bar on the control track, filled with the stem's gel; fast attack, slow release, and a 2px peak tick. Rests as a dim track when the stem is muted or playback is stopped. It is the light passing through the gel.

### Highway (signature canvas)
- 3D perspective lane on the stage. Guitar notes are flat gel blocks in the string colour with an extruded darker underside and the fret number in Condensed 600 Gel Ink; drum notes are gel blocks per lane with a full-width kick bar in String Orange. Beat lines in ink at 9%, bar lines at 30%. Muted notes go dark with a red cross. Hits release short gel-coloured spark particles.

## Do's and Don'ts

### Do:
- **Do** take every non-neutral colour from the six stem gels via `--color-gel-*` / `STEM_GEL`, and keep the two in sync.
- **Do** print Gel Ink (#111214) on any lit gel, and gel-coloured text on an unlit (12%) gel.
- **Do** recolour every practice-mode control with the practised instrument's gel when the instrument changes.
- **Do** divide regions and list rows with 1px rules on full-bleed bands.
- **Do** use 6px corners for controls and containers, 4px for elements nested inside them.
- **Do** set time, codes and fret numbers in Barlow Condensed 600 with tabular numerals.
- **Do** keep all UI copy in Spanish.

### Don't:
- **Don't** add glow, bloom, `shadowBlur` or coloured halos to notes, swatches or meters; brighten the fill instead.
- **Don't** introduce a brand accent or a single blue "primary" over a grey mixer.
- **Don't** wrap panels or rows in floating cards or give resting surfaces shadows; shadows are for overlays floating over the highway only.
- **Don't** use gradients as decoration on chrome.
- **Don't** reuse a gel for anything other than its stem (String Orange stays on the fretboard and kick lane).
- **Don't** ship a light theme; the interface stays dark.
