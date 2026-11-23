# Track2Sheet — Interfaz

Interfaz web (Vite + React + TypeScript + Tailwind CSS + Tone.js) para practicar con lo que genera el
pipeline: un link de YouTube → **6 stems** (`bass`, `drums`, `guitar`, `other`, `piano`, `vocals`) +
un **`.mid`** de la guitarra o la batería. Diseño de referencia: [`public/boceto_v2.jpeg`](public/boceto_v2.jpeg).

- Eliges **Guitarra** o **Batería**: el stem de ese instrumento se silencia (`MUTED`), el resto suena
  y las notas de su `.mid` llegan por un **diapasón 3D estilo Rocksmith** (6 cuerdas por color,
  trastes, sustains, acordes, notas muertas con `X`) o por **carriles de batería** (hi-hat, tarola,
  toms, platillos y bombo).
- Al abrir la app se carga una **canción demo** (6 stems sintetizados con Tone.js a partir de MIDI
  reales), así que todo se puede probar sin procesar nada.

## Ejecutar

Requiere Node 20+.

```bash
cd interfaz
npm install
npm run dev          # http://localhost:5173
npm run build        # type-check + build en dist/
npm run preview      # sirve dist/ (con la API de output/ incluida)
```

## Link de YouTube

`handleYoutubeSubmit(url)` (en `useMultiTrackPlayer`) valida el enlace y llama a
`processYoutube()` de `src/utils/pipelineApi.ts`:

- Sin backend: simula las etapas (descarga → separación → transcripción) y carga la demo.
- Con backend: define `VITE_PIPELINE_URL` y la app hará `POST ${VITE_PIPELINE_URL}/process`
  con `{ "url": "..." }`. Respuesta esperada:

```json
{ "id": "abc", "title": "Canción",
  "stems": { "bass": "<url>", "drums": "<url>", "guitar": "<url>", "other": "<url>", "piano": "<url>", "vocals": "<url>" },
  "midi":  { "guitar": "<url>", "drums": "<url>" } }
```

## Cargar archivos

- Botón **Cargar** de ARCHIVOS (o arrastrar a la ventana): los archivos se asignan por nombre
  (`bass/bajo`, `drums/batería`, `guitar/guitarra`, `piano`, `vocals/voz`, `other/otros`).
- Menú `⋮` de cada stem: volumen, cargar el audio de ese stem y, en `guitar`/`drums`, su `.mid`.
- Un `.mid` solo reemplaza las notas de la canción actual; un audio crea (o completa) una canción local.

También se leen las canciones ya procesadas en `../output` (servidor de Vite):
`output/stems/<canción>/{bass,drums,guitar,other,piano,vocals}.wav` y `output/midi/<canción>/{guitar,drums}.mid`.
Otra carpeta: `TRACK2SHEET_OUTPUT=/ruta npm run dev`.

## Controles

| Control | Acción |
|---|---|
| ▶ / `Espacio` | Play: todos los stems a la vez, con el instrumento elegido silenciado |
| ⏸ | Pausa todo y congela la autopista en el punto exacto |
| ⏮ | Detiene y regresa los 6 stems y el `.mid` a 00:00 |
| ▶ de cada stem | Solo: escuchar ese stem sincronizado (sirve para oír la guitarra/batería original) |
| 🔊 de cada stem | Silenciar / activar |
| **Tocar con teclado** | Guitarra: `A S D F G H` = cuerdas E A D G B e. Batería: `A S D F G` = pads, `J` = bombo |

## Estructura

```
server/outputApi.ts               middleware de Vite que lee output/
scripts/make_stage_bg.py          recorta el fondo blanco de las ardillas → public/ardilla-guitarra.webp y public/ardilla-bateria.webp
src/hooks/useMultiTrackPlayer.ts  estado: canciones, instrumento, mute/solo/volumen, transporte, YouTube
src/utils/audioEngine.ts          Tone.js: 6 stems (audio o synth) en un único reloj maestro
src/utils/midiParser.ts           @tonejs/midi → notas, BPM, compases
src/utils/midiToFretboard.ts      notas → (cuerda, traste) con digitación; notas → carriles de batería
src/utils/pipelineApi.ts          puente con el backend (YouTube → stems + .mid), simulado por defecto
src/utils/songLoader.ts           API / archivos locales → canción decodificada
src/utils/demoSong.ts             canción demo: 6 .mid generados
src/components/LeftPanel          instrumento a practicar + pistas activas con medidores
src/components/YoutubeUrlBar      "Ingresar link de youtube" con progreso de las etapas
src/components/FretboardHighway   canvas: diapasón 3D / batería sobre el escenario con la ardilla
src/components/RightPanel         reloj, ARCHIVOS (6 stems) y controles de transporte
```
