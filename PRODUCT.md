# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Hobby and student musicians (guitarists and drummers) practising alone at home. The instrument is in their hands and the screen is a few feet away, so they read the interface at a glance, between phrases, often without touching the mouse.

## Product Purpose

Track2Sheet turns a song (a YouTube link or local files) into six separated stems (bass, drums, guitar, other, piano, vocals) and a MIDI transcription of guitar or drums. The practice app mutes the stem of the instrument the user plays, keeps the rest of the band sounding, and scrolls that instrument's notes on a 3D fretboard or drum-lane highway in sync. Success: the user plays along with the real band in place of the original player.

## Positioning

The backing track is the song itself, minus you: real separated stems from any song, not a pre-made catalogue or a synthesized backing.

## Operating Context

- Pipeline runs in Docker/Jupyter (`notebooks/track2stems.ipynb`): yt-dlp download → BS-RoFormer SW separation → Basic Pitch / MIDI transcription, written to `output/`.
- The web app (`interfaz/`, Vite + React + Tailwind + Tone.js) reads `output/stems/<song>/` and `output/midi/<song>/`, accepts dropped or uploaded files, and ships a synthesized demo song.
- Controls used mid-practice: play/pause (Space), restart, seek, mute/solo/volume per stem, switching between guitar and drums, keyboard play-along mode.

## Capabilities and Constraints

- Practisable instruments: guitar and drums only. The practised stem is always muted.
- Six stems, fixed IDs: bass, drums, guitar, other, piano, vocals.
- YouTube processing in the app is simulated unless `VITE_PIPELINE_URL` points at a backend.

## Brand Commitments

- All UI text is in Spanish (Pistas, Toco, Canción…).
- The interface stays dark.
- No logo or brand colours exist yet; the name is Track2Sheet.

## Evidence on Hand

- Demo song generated in code (`interfaz/src/utils/demoSong.ts`), labelled as a demo.
- No users, testimonials or metrics exist; none may be invented.

## Product Principles

1. Readable from the stool: what is playing and what comes next must read at a distance, at a glance.
2. The notes are the star; every other control stays quiet until reached for.
3. The real song is the backing; never hide which stems are sounding.
4. Controls answer immediately; practice is not interrupted by the interface.
