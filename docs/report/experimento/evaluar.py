"""Nivel 1 (ADTOF Frame RNN) contra MuScriptor large sobre MDB-Drums.

El modelo, el pre-proceso, la detección de picos y la métrica son los del notebook
notebooks/drums_level1.ipynb (secciones 2, 7 y 8). Condiciones de entrada:
  drum  -> pista de solo batería (la del notebook)
  stem  -> pista de batería separada por BS-RoFormer SW (lo que proponía el diseño)
  mix   -> la mezcla completa (lo que recibe MuScriptor en el sistema)
Se corre en el contenedor:  python docs/report/experimento/evaluar.py
"""
import json, math, time
from pathlib import Path

import numpy as np
import pandas as pd
import librosa
import torch, torch.nn as nn, torch.nn.functional as F
from scipy.ndimage import uniform_filter1d, maximum_filter1d

RAIZ = Path("datasets/MDBDrums/MDB Drums")
EVAL = Path("datasets/eval_drums")
SALIDA = Path("docs/report/data")
SALIDA.mkdir(parents=True, exist_ok=True)
(EVAL / "adtof").mkdir(parents=True, exist_ok=True)

SR, FPS = 44100, 100
CLASES = ["BD", "SD", "TT", "HH", "CY"]
UMBRALES = {"BD": 0.22, "SD": 0.24, "TT": 0.32, "HH": 0.22, "CY": 0.30}
TOLERANCIA = 0.05
PRUEBA = ["BebopJazz", "CoolJazz", "Gospel", "Grunge", "Rockabilly", "SpeedMetal", "SwingJazz"]
MAPA_MDB = {"KD": "BD", "SD": "SD", "TT": "TT", "HH": "HH", "CY": "CY"}
MAPA_GM = {}
for clase, notas in {"BD": [35, 36], "SD": [37, 38, 40], "TT": [41, 43, 45, 47, 48, 50, 58],
                     "HH": [22, 26, 42, 44, 46], "CY": [49, 51, 52, 53, 55, 57, 59]}.items():
    for n in notas:
        MAPA_GM[n] = clase


# ---------- Modelo del nivel 1 (idéntico al notebook) ----------
def pool_same(x, k=3):
    f = x.shape[-1]
    total = max(math.ceil(f / k) * k - f, 0)
    x = F.pad(x, (total // 2, total - total // 2), value=float("-inf"))
    return F.max_pool2d(x, (1, k))


class FrameRNN(nn.Module):
    def __init__(self, n_bandas=84, filters=(32, 64), gru_units=60, n_classes=5):
        super().__init__()
        self.cnn_blocks = nn.ModuleList()
        c_in = 1
        for f in filters:
            self.cnn_blocks.append(nn.Sequential(
                nn.Conv2d(c_in, f, 3, padding=1), nn.ReLU(), nn.BatchNorm2d(f, eps=1e-3),
                nn.Conv2d(f, f, 3, padding=1), nn.ReLU(), nn.BatchNorm2d(f, eps=1e-3)))
            c_in = f
        self.dropout = nn.Dropout2d(0.3)
        bandas = n_bandas
        for _ in filters:
            bandas = math.ceil(bandas / 3)
        entrada = filters[-1] * bandas
        self.gru_layers = nn.ModuleList([
            nn.GRU(entrada, gru_units, batch_first=True, bidirectional=True),
            nn.GRU(2 * gru_units, gru_units, batch_first=True, bidirectional=True),
            nn.GRU(2 * gru_units, gru_units, batch_first=True, bidirectional=True)])
        self.output_layer = nn.Linear(2 * gru_units, n_classes)

    def forward(self, x):
        x = x.unsqueeze(1)
        for blk in self.cnn_blocks:
            x = self.dropout(pool_same(blk(x)))
        x = x.permute(0, 2, 3, 1).reshape(x.shape[0], x.shape[2], -1)
        for g in self.gru_layers:
            x, _ = g(x)
        return torch.sigmoid(self.output_layer(x))


def banco_de_filtros(n_fft=2048, sr=SR, bandas_por_octava=12, fmin=20.0, fmax=20000.0):
    freqs_fft = np.fft.rfftfreq(n_fft, 1 / sr)[: n_fft // 2]
    centrales = fmin * 2 ** (np.arange(200) / bandas_por_octava)
    centrales = centrales[centrales <= fmax]
    bins = np.unique([np.argmin(np.abs(freqs_fft - f)) for f in centrales])
    filtros = np.zeros((len(bins) - 2, n_fft // 2), dtype=np.float32)
    for i in range(len(bins) - 2):
        izq, centro, der = bins[i], bins[i + 1], bins[i + 2]
        filtros[i, izq:centro + 1] = np.linspace(0, 1, centro - izq + 1)
        filtros[i, centro:der] = np.linspace(1, 0, der - centro + 1)[:-1]
        filtros[i] /= filtros[i].sum()
    return filtros


FILTROS = banco_de_filtros()


def espectrograma(y):
    stft = librosa.stft(y, n_fft=2048, hop_length=441, window=np.hanning(2048), center=True, pad_mode="constant")
    return np.log10(1 + FILTROS @ np.abs(stft)[:1024]).T.astype(np.float32)


def detectar_picos(curva, umbral):
    candidatos = curva * (curva >= uniform_filter1d(curva, 12, mode="constant", origin=4))
    candidatos = candidatos * (candidatos >= umbral)
    es_maximo = candidatos == maximum_filter1d(candidatos, 4, mode="constant", origin=0)
    cuadros = np.flatnonzero(es_maximo & (candidatos > 0))
    finales, previo = [], None
    for c in cuadros:
        if previo is not None and c - previo <= 2:
            if curva[c] > curva[finales[-1]]:
                finales[-1] = c
        else:
            finales.append(c)
        previo = c
    return np.array(finales) / FPS


# ---------- Métrica: emparejamiento uno a uno (equivalente a mir_eval.util.match_events) ----------
def emparejar(ref, est, tol=TOLERANCIA):
    """Máximo emparejamiento bipartito entre golpes a <= tol (algoritmo de caminos aumentantes)."""
    ref, est = np.asarray(ref, float), np.asarray(est, float)
    if not len(ref) or not len(est):
        return []
    vecinos = []
    for r in ref:
        lo, hi = np.searchsorted(est, r - tol - 1e-9), np.searchsorted(est, r + tol + 1e-9, side="right")
        vecinos.append([j for j in range(lo, hi) if abs(est[j] - r) <= tol + 1e-9])
    pareja_est = {}

    def aumentar(i, visto):
        for j in vecinos[i]:
            if j in visto:
                continue
            visto.add(j)
            if j not in pareja_est or aumentar(pareja_est[j], visto):
                pareja_est[j] = i
                return True
        return False

    import sys
    sys.setrecursionlimit(100000)
    for i in range(len(ref)):
        aumentar(i, set())
    return [(i, j) for j, i in pareja_est.items()]


def prf(tp, fp, fn):
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    return p, r, (2 * p * r / (p + r) if p + r else 0.0)


def anotaciones(cancion):
    t = pd.read_csv(RAIZ / "annotations" / "class" / f"MusicDelta_{cancion}_class.txt", sep=r"\s+",
                    header=None, usecols=[0, 1], names=["tiempo", "etiqueta"])
    t["clase"] = t["etiqueta"].map(MAPA_MDB)
    return {c: t.loc[t["clase"] == c, "tiempo"].to_numpy() for c in CLASES}


# ---------- Predicciones ----------
modelo = FrameRNN()
modelo.load_state_dict(torch.load("models/adtof_frame_rnn_pytorch_weights.pth", map_location="cpu")["model_weights"])
modelo.eval()
torch.set_num_threads(4)


def audio_de(cancion, cond):
    if cond == "drum":
        return RAIZ / "audio" / "drum_only" / f"MusicDelta_{cancion}_Drum.wav"
    if cond == "mix":
        return RAIZ / "audio" / "full_mix" / f"MusicDelta_{cancion}_MIX.wav"
    return EVAL / "stems" / cancion / "drums.wav"


def adtof(cancion, cond):
    cache = EVAL / "adtof" / f"{cancion}_{cond}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    ruta = audio_de(cancion, cond)
    if not ruta.exists():
        return None
    y, _ = librosa.load(str(ruta), sr=SR, mono=True)
    inicio = time.perf_counter()
    with torch.no_grad():
        act = modelo(torch.from_numpy(espectrograma(y))[None])[0].numpy()
    golpes = {c: detectar_picos(act[:, i], UMBRALES[c]).tolist() for i, c in enumerate(CLASES)}
    salida = {"golpes": golpes, "segundos": time.perf_counter() - inicio, "duracion": len(y) / SR}
    cache.write_text(json.dumps(salida))
    return salida


def muscriptor(cancion, cond):
    ruta = EVAL / "muscriptor" / f"MusicDelta_{cancion}_{cond}.json"
    if not ruta.exists() or not ruta.stat().st_size:
        return None
    notas = json.loads(ruta.read_text())["notes"]
    golpes = {c: [] for c in CLASES}
    otros = 0
    for n in notas:
        if not n["is_drum"]:
            continue
        c = MAPA_GM.get(n["pitch"])
        if c:
            golpes[c].append(n["onset"])
        else:
            otros += 1
    return {"golpes": golpes, "fuera_de_clases": otros}


canciones = sorted(p.stem.replace("_class", "").replace("MusicDelta_", "")
                   for p in (RAIZ / "annotations" / "class").glob("*_class.txt"))
filas, tiempos, confusion = [], [], []
for cancion in canciones:
    ref = anotaciones(cancion)
    for modelo_nombre, fn, conds in (("ADTOF", adtof, ("drum", "stem", "mix")), ("MuScriptor", muscriptor, ("drum", "mix"))):
        for cond in conds:
            pred = fn(cancion, cond)
            if pred is None:
                continue
            if modelo_nombre == "ADTOF":
                tiempos.append({"cancion": cancion, "cond": cond, "segundos": pred["segundos"], "duracion": pred["duracion"]})
            sueltos_ref, sueltos_est = {}, {}
            for c in CLASES:
                pares = emparejar(ref[c], pred["golpes"][c])
                tp = len(pares)
                sueltos_ref[c] = np.delete(np.asarray(ref[c], float), [i for i, _ in pares])
                sueltos_est[c] = np.delete(np.asarray(pred["golpes"][c], float), [j for _, j in pares])
                filas.append({"modelo": modelo_nombre, "cond": cond, "cancion": cancion,
                              "prueba": cancion in PRUEBA, "clase": c, "tp": tp,
                              "fp": len(pred["golpes"][c]) - tp, "fn": len(ref[c]) - tp})

            # Confusión: cada golpe anotado que no se detectó, ¿qué clase predijo el modelo a <= 50 ms?
            for a in CLASES:
                for t in sueltos_ref[a]:
                    cerca = [b for b in CLASES if b != a and len(sueltos_est[b]) and np.min(np.abs(sueltos_est[b] - t)) <= TOLERANCIA]
                    confusion.append({"modelo": modelo_nombre, "cond": cond, "cancion": cancion,
                                      "prueba": cancion in PRUEBA, "anotado": a,
                                      "predicho": cerca[0] if len(cerca) == 1 else ("varias" if cerca else "nada")})

res = pd.DataFrame(filas)
pd.DataFrame(confusion).to_csv(SALIDA / "confusion_fallos.csv", index=False)
res.to_csv(SALIDA / "resultados_por_cancion.csv", index=False)
pd.DataFrame(tiempos).to_csv(SALIDA / "tiempos_adtof.csv", index=False)


def resumen(df, por):
    t = df.groupby(por)[["tp", "fp", "fn"]].sum()
    t[["P", "R", "F1"]] = [prf(*f) for f in t[["tp", "fp", "fn"]].to_numpy()]
    return t


for nombre, sub in (("prueba", res[res["prueba"]]), ("todas", res)):
    micro = resumen(sub, ["modelo", "cond"])
    por_clase = resumen(sub, ["modelo", "cond", "clase"])["F1"].unstack()[CLASES]
    micro["F1 macro"] = por_clase.mean(axis=1)
    micro["canciones"] = sub.groupby(["modelo", "cond"])["cancion"].nunique()
    tabla = micro.join(por_clase)
    tabla.round(4).to_csv(SALIDA / f"resumen_{nombre}.csv")
    print(f"\n=== {nombre} ===")
    print(tabla.round(3).to_string())
