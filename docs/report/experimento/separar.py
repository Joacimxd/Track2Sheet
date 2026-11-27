"""Separa las mezclas de MDB-Drums con BS-RoFormer SW, igual que el pipeline.
Primero las 7 canciones de prueba del notebook. Solo se conserva drums.wav."""
import sys, time, types
from pathlib import Path

# Fuera del contenedor: api.pipeline importa paquetes de descarga que no hacen falta para separar
for m in ("yt_dlp", "soxr", "mido"):
    try:
        __import__(m)
    except ImportError:
        sys.modules[m] = types.ModuleType(m)
from api.pipeline import Progress, separate

RAIZ = Path("datasets/MDBDrums/MDB Drums/audio/full_mix")
SALIDA = Path("datasets/eval_drums/stems")
PRUEBA = ["BebopJazz", "CoolJazz", "Gospel", "Grunge", "Rockabilly", "SpeedMetal", "SwingJazz"]
todas = sorted(p.stem.replace("_MIX", "").replace("MusicDelta_", "") for p in RAIZ.glob("*_MIX.wav"))
for t in PRUEBA + [t for t in todas if t not in PRUEBA]:
    destino = SALIDA / t
    if (destino / "drums.wav").exists():
        continue
    inicio = time.time()
    separate(RAIZ / f"MusicDelta_{t}_MIX.wav", destino, Progress())
    for f in destino.iterdir():
        if f.name != "drums.wav":
            f.unlink()
    with open(SALIDA / "tiempos.txt", "a") as log:
        log.write(f"{t} {time.time() - inicio:.0f}\n")
    print(t, flush=True)
