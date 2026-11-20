# Track2Sheet — Interfaz

Interfaz web (Vite + React + TypeScript + Tailwind CSS + Lucide) para practicar las pistas que
genera el pipeline de Track2Sheet: elige **Guitarra** o **Batería**, ese instrumento se silencia
(`MUTED`) y suenan el resto de stems como acompañamiento mientras las notas de su `.mid` caen por
una autopista estilo *Guitar Hero* y se dibujan en una partitura sincronizada.

## Ejecutar

Requiere Node 20+. El boceto de diseño está en [`docs/boceto_interfaz.jpeg`](../docs/boceto_interfaz.jpeg).

```bash
cd interfaz
npm install
npm run dev          # http://localhost:5173
```

Producción:

```bash
npm run build        # type-check + build en dist/
npm run preview      # sirve dist/ (con la API de output/ incluida)
```

Al abrir la app se carga una **canción demo** (MIDI generado + audio sintetizado con Tone.js), así
que se puede probar sin haber procesado nada.

## Canciones de `output/`

El servidor de Vite (dev y preview) expone la carpeta `../output` del proyecto:

| Ruta | Contenido |
|---|---|
| `GET /api/songs` | canciones encontradas en `output/stems/<canción>/` |
| `GET /api/file?p=<ruta>` | un archivo dentro de `output/` |

Estructura esperada (los `.mid` pueden ir junto a los stems o en `output/midi/<canción>/`):

```
output/stems/<canción>/guitar.wav  drums.wav  vocals.wav  bass.wav  piano.wav  other.wav
output/midi/<canción>/guitar.mid   drums.mid
```

- `guitar.*` → pista **Guitarra**, `drums.*` → **Batería**, el resto (voces, bajo, piano, otros) se
  mezcla en **Voces / Otros**.
- Los MIDI se reconocen por nombre (`guitar`/`guitarra`, `drum`/`batería`).
- Una pista sin audio pero con `.mid` se sintetiza; una canción sin `.mid` suena pero no muestra notas.

Para usar otra carpeta: `TRACK2SHEET_OUTPUT=/ruta/a/output npm run dev`.

## Cargar archivos locales

Botón **Cargar .mid / stems** (o arrastrar archivos a la ventana):

- Solo `.mid` → se añaden a la canción actual (por nombre; si el nombre no indica instrumento, al
  instrumento seleccionado).
- Con audio → se crea una canción local nueva con todos los archivos.

## Controles

| Tecla | Acción |
|---|---|
| `Espacio` | Play / Pausa |
| `A S D F G` o `1 2 3 4 5` | carriles 1–5 (en batería: Bombo, Caja, Hi-Hat, Toms, Platillos) |

La barra bajo la partitura permite saltar a cualquier punto.

## Estructura

```
server/outputApi.ts          middleware de Vite que lee output/
src/hooks/useMidiPlayer.ts   estado: canciones, instrumento, mutes, transporte (reloj maestro)
src/hooks/useCanvas.ts       canvas con DPR + bucle requestAnimationFrame
src/utils/midiParser.ts      @tonejs/midi -> notas, carriles, BPM, compases
src/utils/audioEngine.ts     Tone.js: stems / sintetizadores por pista, mute, transporte
src/utils/songLoader.ts      API / archivos locales -> canción decodificada
src/utils/demoSong.ts        canción demo generada como .mid
src/components/LeftPanel     instrumento seleccionado + pistas activas con visualizador
src/components/SheetMusic    pentagrama en canvas con playhead y barra de progreso
src/components/NoteHighway   autopista 3D a 60 FPS, aciertos y fuego
src/components/RightPanel    tiempo, archivo/canción y controles
```
