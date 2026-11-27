"""Convierte las 23 canciones de MDB-Drums (mezcla y solo batería) a float32 16 kHz mono,
con la misma función que usa el pipeline antes de llamar a MuScriptor."""
from pathlib import Path
from api.pipeline import to_16k_mono

RAIZ = Path("datasets/MDBDrums/MDB Drums/audio")
SALIDA = Path("datasets/eval_drums/f32")
SALIDA.mkdir(parents=True, exist_ok=True)
for wav in sorted((RAIZ / "full_mix").glob("*_MIX.wav")):
    nombre = wav.stem.replace("_MIX", "")
    for tipo, ruta in (("mix", wav), ("drum", RAIZ / "drum_only" / f"{nombre}_Drum.wav")):
        destino = SALIDA / f"{nombre}_{tipo}.f32"
        if not destino.exists():
            to_16k_mono(ruta, destino)
print(len(list(SALIDA.glob("*.f32"))), "archivos")
