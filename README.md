# Track2Sheet

Pegas un link de YouTube y la app descarga la canción, la separa en 6 pistas (voz, batería, bajo,
guitarra, piano y otros) con **BS-RoFormer SW**, la transcribe a MIDI con **MuScriptor large** (el
modelo de NeuralNote v2) y te deja practicar guitarra, batería o piano encima de las pistas.

## Cómo se corre

```bash
docker compose up --build
```

| | |
|---|---|
| Interfaz | http://localhost:5173 |
| API | http://localhost:8765 |
| Notebooks (JupyterLab) | http://localhost:8888 |

La primera vez construye la imagen (~10 min) y descarga MuScriptor large (2.7 GB) a `models/`.
El modelo de separación (~700 MB) se descarga con la primera canción. La carpeta del proyecto se
monta en el contenedor: los cambios de código se ven sin reconstruir.

Tests: `docker compose exec track2sheet python -m pytest api/tests`

En Docker todo corre en CPU (Docker en Mac no puede usar la GPU): una canción de 4 minutos tarda más
de una hora en transcribirse. Las canciones ya procesadas se reutilizan desde `output/`.

## Cómo funciona

```
link de YouTube
  └─ yt-dlp ─► output/downloads/<canción>.wav
        ├─ BS-RoFormer SW ─► output/stems/<canción>/{bass,drums,guitar,other,piano,vocals}.wav
        └─ MuScriptor (3 pasadas: guitarra, piano, batería + bajo) ─► output/midi/<canción>/*.mid
              la separación y la transcripción corren al mismo tiempo

la interfaz lee los stems y los .mid
  ├─ guitarra ─► POST /tab   ─► afinación, acordes, digitación y tablatura
  └─ piano    ─► POST /piano ─► limpieza de ruido y mano de cada nota
```

## Para qué sirve cada archivo

### Docker

| Archivo | Qué hace |
|---|---|
| `Dockerfile` | La imagen: Python, Node, ffmpeg, compila el motor de MuScriptor e instala las dependencias |
| `docker-compose.yml` | Levanta el contenedor, abre los 3 puertos y monta la carpeta del proyecto |
| `docker/start.sh` | Descarga el modelo si falta y arranca el API, la interfaz y JupyterLab |
| `requirements.txt` | Paquetes de Python (API, tests y notebooks) |

### Motor (`engine/cli/`)

| Archivo | Qué hace |
|---|---|
| `transcribe.cpp` | Programa que corre MuScriptor sobre audio crudo (float32, 16 kHz, mono) y escribe las notas en JSON. Recibe `--instruments` para buscar solo ciertos instrumentos e imprime `progress <0..1>` |
| `CMakeLists.txt` | Compila `transcribe.cpp` junto con la librería muscriptor.cpp |

### API de Python (`api/`)

| Archivo | Qué hace |
|---|---|
| `main.py` | Endpoints: `POST /jobs` (procesar un link), `GET /jobs/{id}` (progreso), `DELETE /jobs/{id}` (cancelar), `POST /tab`, `POST /piano`, `/files/...` (archivos de `output/`) |
| `pipeline.py` | Descarga, separación en stems, las 3 pasadas de MuScriptor y escritura de los `.mid` |
| `audio.py` | Herramientas de audio compartidas: energía por nota (CQT), quitar notas que otro stem explica mejor (bleed) y volumen de cada nota |
| `piano.py` | Limpieza del piano y reparto entre mano izquierda y derecha |
| `guitar/core.py` | `Note`, `Event` (notas que suenan juntas), afinaciones y detección de afinación |
| `guitar/chords.py` | Nombra acordes (C, Dm, G7…) y da sus formas en el diapasón |
| `guitar/cleaner.py` | Decide en cada golpe si es acorde o notas sueltas y pasa los acordes a su forma estándar |
| `guitar/fingering.py` | Elige cuerda y traste para cada nota (Viterbi) para que se pueda tocar |
| `guitar/build.py` | Une todo lo de guitarra y arma la respuesta de `/tab` |
| `tests/` | Pruebas de guitarra, piano y pipeline |

**Por qué 3 pasadas de MuScriptor:** si se le pide todo a la vez, etiqueta la canción entera como
un solo instrumento. Pidiéndole uno a la vez encuentra cada uno. Una pasada se salta si su stem
está en silencio (la canción no tiene ese instrumento). Pidiéndole solo guitarra, oye el piano como
guitarra (y al revés), así que se quitan las notas que el stem del otro instrumento explica mucho mejor.

**Guitarra (`/tab`):**
1. Se quitan las notas que en realidad canta la voz (bleed del stem de voz).
2. El volumen de cada nota se mide en el stem de guitarra.
3. Se detecta la afinación (E estándar, Eb, Drop D, D).
4. Cada guitarra (programa MIDI) se limpia por separado. Cada golpe se clasifica como acorde o
   notas con Viterbi: un acorde de 3 o más notas o un power chord es acorde; una nota sola, una
   tercera o una sexta son notas; los casos dudosos siguen a sus vecinos.
5. Los acordes se pasan a su forma de libro (una sola por acorde en toda la canción). Las notas
   sueltas se quedan como se oyeron.
6. Donde una melodía suena encima de los acordes hay un **solo**: la parte `auto` muestra la
   melodía y la parte `rhythm` los acordes.
7. La digitación se escoge con Viterbi: poco movimiento de la mano, sin estiramientos imposibles
   y la misma forma para lo que se repite.

**Piano (`/piano`):**
1. Se quitan las notas que la guitarra o la voz explican mejor que el stem de piano.
2. Una nota sostenida partida en pedazos se une, salvo que el audio muestre un golpe nuevo.
3. Se quitan las notas fantasma (casi sin sonido en el stem) y los armónicos de otra tecla.
4. Límite físico: dos manos, cinco dedos cada una y una novena de alcance por mano.
5. Se quitan las notas aisladas lejos de todo y las de menos de 40 ms.
6. Cada nota se asigna a una mano siguiendo la posición de cada mano.

### Interfaz (`web/`)

| Archivo | Qué hace |
|---|---|
| `server/outputApi.ts` | Plugin de Vite que lista las canciones de `output/` (`/api/songs`) y sirve sus archivos (`/api/file`) |
| `src/main.tsx`, `src/App.tsx` | Arranque y estructura de la pantalla (barra, highway, panel de pistas, arrastrar archivos) |
| `src/hooks/useMultiTrackPlayer.ts` | Todo el estado: canción, instrumento, mute/solo/volumen, reproducción, YouTube, tablatura y piano |
| `src/utils/audioEngine.ts` | Tone.js: toca los 6 stems con un solo reloj, cambia la velocidad y sintetiza las pistas que son MIDI |
| `src/utils/api.ts` | Llamadas al API: procesar YouTube, `/tab` y `/piano` |
| `src/utils/songLoader.ts` | Carga canciones (de `output/`, de YouTube o archivos tuyos) y decodifica el audio |
| `src/utils/midiParser.ts` | Lee un `.mid` y saca notas, tiempos de pulso y compases |
| `src/utils/midiToFretboard.ts` | Tipos de la tablatura y carriles de la batería (qué nota MIDI va a qué pad) |
| `src/utils/demoSong.ts`, `drumLoop.ts` | La canción demo que aparece al abrir la app |
| `src/utils/format.ts` | Formato `mm:ss` |
| `src/components/FretboardHighway.tsx` | El canvas: diapasón, batería o teclado con las notas que vienen, y el modo práctica con puntos |
| `src/components/PlayerBar.tsx` | Barra superior: reproducir, posición, velocidad, canción, instrumento, lead/rítmica |
| `src/components/RightPanel.tsx` | Panel de pistas: mute, solo, volumen, medidores y cargar archivos |
| `src/components/YoutubeUrlBar.tsx` | Campo del link de YouTube con los pasos del proceso |
| `src/components/LevelMeter.tsx` | Medidor de nivel de cada pista |
| `src/hooks/useCanvas.ts` | Bucle de dibujo del canvas a la resolución de la pantalla |
| `src/types.ts` | Tipos y constantes compartidas (stems, instrumentos, colores) |

**Controles:** `Espacio` reproduce o pausa. En modo práctica, guitarra con `A S D F G H` (cuerdas
E A D G B e) y batería con `A S D F G` (pads) y `J` (bombo). Arrastra stems (.wav/.mp3) y .mid a la
ventana para cargar una canción tuya: se asignan por nombre (`guitar`, `drums`, `bass`, `piano`,
`vocals`, `other`).

### Notebooks (`notebooks/`)

| Archivo | Qué hace |
|---|---|
| `drums_datasets.ipynb`, `drums_level1.ipynb` | Modelos de batería (datasets, ADTOF y evaluación) |

### Otros

`docs/research/` tiene los documentos de investigación, `docs/design/` los bocetos de la interfaz,
`models/` los modelos descargados y `output/` las canciones procesadas.
