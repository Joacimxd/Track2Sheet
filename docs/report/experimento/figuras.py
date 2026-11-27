"""Figuras y tablas del reporte a partir de docs/report/data/*.csv."""
import json
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

DATA = Path("docs/report/data")
FIG = Path("docs/report/figuras")
TAB = Path("docs/report/tablas")
FIG.mkdir(exist_ok=True)
TAB.mkdir(exist_ok=True)
CLASES = ["BD", "SD", "TT", "HH", "CY"]
NOMBRE_CLASE = {"BD": "Bombo", "SD": "Caja", "TT": "Toms", "HH": "Hi-hat", "CY": "Platillos"}
COND = {"drum": "solo batería", "stem": "separada (SW)", "mix": "mezcla"}
ORDEN = [("ADTOF", "drum"), ("ADTOF", "stem"), ("ADTOF", "mix"), ("MuScriptor", "drum"), ("MuScriptor", "mix")]
COLOR = {("ADTOF", "drum"): "#9ecae1", ("ADTOF", "stem"): "#4292c6", ("ADTOF", "mix"): "#08519c",
         ("MuScriptor", "drum"): "#fdae6b", ("MuScriptor", "mix"): "#d94801"}

plt.rcParams.update({"font.size": 9, "axes.spines.top": False, "axes.spines.right": False,
                     "axes.grid": True, "grid.color": "#e5e5e5", "axes.axisbelow": True,
                     "font.family": "DejaVu Sans"})


def coma(x, d=3):
    return f"{x:.{d}f}".replace(".", "{,}")


def prf(tp, fp, fn):
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    return p, r, (2 * p * r / (p + r) if p + r else 0.0)


res = pd.read_csv(DATA / "resultados_por_cancion.csv")
todas_canciones = sorted(res["cancion"].unique())
# MuScriptor sobre la pista de solo batería quedó en 17 canciones: esa condición se compara aparte
con_drum_mus = sorted(res.loc[(res["modelo"] == "MuScriptor") & (res["cond"] == "drum"), "cancion"].unique())
comunes = todas_canciones
prueba = sorted(res.loc[res["prueba"], "cancion"].unique())
print("canciones:", len(comunes), "con MuScriptor solo batería:", len(con_drum_mus))


def resumen(df, orden=ORDEN):
    filas = []
    for (m, c) in orden:
        g = df[(df["modelo"] == m) & (df["cond"] == c)]
        if g.empty:
            continue
        tp, fp, fn = g[["tp", "fp", "fn"]].sum()
        p, r, f1 = prf(tp, fp, fn)
        por = {k: prf(*g[g["clase"] == k][["tp", "fp", "fn"]].sum())[2] for k in CLASES}
        filas.append({"modelo": m, "cond": c, "canciones": g["cancion"].nunique(), "P": p, "R": r, "F1": f1,
                      "macro": np.mean(list(por.values())), **por})
    return pd.DataFrame(filas)


PRINCIPAL = [("ADTOF", "drum"), ("ADTOF", "stem"), ("ADTOF", "mix"), ("MuScriptor", "mix")]
todas = resumen(res, PRINCIPAL)
sub = resumen(res[res["cancion"].isin(prueba)])
drum17 = resumen(res[res["cancion"].isin(con_drum_mus)], [("ADTOF", "drum"), ("MuScriptor", "drum")])
todas.to_csv(DATA / "resumen_final_23.csv", index=False)
sub.to_csv(DATA / "resumen_final_prueba7.csv", index=False)
drum17.to_csv(DATA / "resumen_final_drum17.csv", index=False)


def tabla_principal(df, nombre, n=None):
    mejor = {k: df[k].max() for k in ["P", "R", "F1", "macro"] + CLASES}
    lineas = []
    for _, f in df.iterrows():
        celdas = [f"{f['modelo']}", COND[f["cond"]]]
        for k in ["P", "R", "F1", "macro"] + CLASES:
            v = coma(f[k])
            celdas.append(f"\\textbf{{{v}}}" if abs(f[k] - mejor[k]) < 1e-9 else v)
        lineas.append(" & ".join(celdas) + r" \\")
    cuerpo = "\n".join(lineas)
    (TAB / f"{nombre}.tex").write_text(
        r"\begin{tabular}{llcccc|ccccc}" "\n" r"\toprule" "\n"
        r"& & \multicolumn{4}{c|}{\textbf{Global}} & \multicolumn{5}{c}{\textbf{$F_1$ por clase}} \\" "\n"
        r"\textbf{Modelo} & \textbf{Entrada} & $P$ & $R$ & $F_1$ & \textbf{macro} & BD & SD & TT & HH & CY \\" "\n"
        r"\midrule" "\n" + cuerpo + "\n" r"\bottomrule" "\n" r"\end{tabular}" "\n")


tabla_principal(todas, "comparativa_todas")
tabla_principal(sub, "comparativa_prueba")
tabla_principal(drum17, "comparativa_drum17")

# ---- Figura: F1 micro y macro por modelo y entrada ----
fig, ejes = plt.subplots(1, 2, figsize=(7.2, 3.0), sharey=True)
for eje, (df, titulo) in zip(ejes, ((todas, f"Las {len(comunes)} canciones"), (sub, f"Las {len(prueba)} de prueba del cuaderno"))):
    x = np.arange(2)
    w = 0.16
    for i, (m, c) in enumerate(ORDEN):
        f = df[(df["modelo"] == m) & (df["cond"] == c)]
        if f.empty:
            continue
        v = [f["F1"].iloc[0], f["macro"].iloc[0]]
        barras = eje.bar(x + (i - 2) * w, v, w, color=COLOR[(m, c)], label=f"{m} · {COND[c]}")
        for b, val in zip(barras, v):
            eje.text(b.get_x() + b.get_width() / 2, val + 0.01, f"{val:.2f}".replace(".", ","), ha="center",
                     fontsize=6.3, rotation=90)
    eje.set_xticks(x, ["$F_1$ micro", "$F_1$ macro"])
    eje.set_ylim(0, 1.05)
    eje.set_title(titulo, fontsize=9)
ejes[0].set_ylabel("$F_1$ de onset (50 ms)")
h, l = ejes[1].get_legend_handles_labels()
fig.legend(h, l, fontsize=7, loc="lower center", ncol=5, frameon=False)
fig.tight_layout(rect=(0, 0.08, 1, 1))
fig.savefig(FIG / "comparativa_f1.pdf")

# ---- Figura: F1 por clase ----
fig, eje = plt.subplots(figsize=(7.2, 2.6))
x = np.arange(len(CLASES))
w = 0.16
for i, (m, c) in enumerate(PRINCIPAL):
    f = todas[(todas["modelo"] == m) & (todas["cond"] == c)]
    eje.bar(x + (i - 1.5) * w, f[CLASES].iloc[0].to_numpy(), w, color=COLOR[(m, c)], label=f"{m} · {COND[c]}")
eje.set_xticks(x, [f"{NOMBRE_CLASE[k]} ({k})" for k in CLASES])
eje.set_ylabel("$F_1$ de onset")
eje.set_ylim(0, 1.05)
eje.legend(fontsize=7, ncol=3, loc="upper center", bbox_to_anchor=(0.5, 1.22), frameon=False)
fig.tight_layout()
fig.savefig(FIG / "comparativa_clases.pdf")

# ---- Figura: F1 por canción, ADTOF contra MuScriptor en la mezcla ----
def por_cancion(m, c):
    g = res[(res["modelo"] == m) & (res["cond"] == c)].groupby("cancion")[["tp", "fp", "fn"]].sum()
    return g.apply(lambda r: prf(*r)[2], axis=1)

fig, ejes = plt.subplots(1, 2, figsize=(7.2, 3.1))
for eje, cond in zip(ejes, ("mix", "drum")):
    a, b = por_cancion("ADTOF", cond), por_cancion("MuScriptor", cond)
    a = a.loc[b.index]
    es_prueba = a.index.isin(prueba)
    eje.plot([0, 1], [0, 1], color="#999", lw=0.8, ls="--")
    eje.scatter(a[~es_prueba], b[~es_prueba], s=18, color="#4292c6", label="resto")
    eje.scatter(a[es_prueba], b[es_prueba], s=22, color="#d94801", marker="s", label="prueba del cuaderno")
    for nombre in a.index:
        if abs(a[nombre] - b[nombre]) > 0.15:
            eje.annotate(nombre, (a[nombre], b[nombre]), fontsize=6, xytext=(3, -3), textcoords="offset points")
    eje.set_xlim(0.3, 1.0)
    eje.set_ylim(0.3, 1.0)
    eje.set_aspect("equal")
    eje.set_xlabel("$F_1$ ADTOF (nivel 1)")
    eje.set_ylabel("$F_1$ MuScriptor")
    eje.set_title(f"Entrada: {COND[cond]}", fontsize=9)
    gana = int((b > a).sum())
    eje.text(0.32, 0.95, f"MuScriptor mejor en {gana} de {len(a)}", fontsize=7, va="top")
ejes[1].legend(fontsize=7, loc="lower right")
fig.tight_layout()
fig.savefig(FIG / "por_cancion.pdf")

# ---- Confusión: qué predijo el modelo cerca de los golpes que no detectó ----
conf = pd.read_csv(DATA / "confusion_fallos.csv")
conf = conf[conf["cancion"].isin(comunes)]
lineas = []
for (m, c) in [("ADTOF", "mix"), ("MuScriptor", "mix")]:
    g = conf[(conf["modelo"] == m) & (conf["cond"] == c)]
    t = pd.crosstab(g["anotado"], g["predicho"]).reindex(index=CLASES, columns=CLASES + ["varias", "nada"], fill_value=0)
    for k in CLASES:
        fila = t.loc[k]
        celdas = [m if k == "BD" else "", NOMBRE_CLASE[k], str(int(fila.sum()))]
        for col in CLASES + ["varias", "nada"]:
            celdas.append("--" if col == k else str(int(fila[col])))
        lineas.append(" & ".join(celdas) + r" \\")
    lineas.append(r"\midrule")
(TAB / "confusion.tex").write_text(
    r"\begin{tabular}{llr|ccccccc}" "\n" r"\toprule" "\n"
    r"& \textbf{Clase anotada} & \textbf{Fallos} & \multicolumn{7}{c}{\textbf{Lo que predijo el modelo a $\le$ 50 ms}} \\" "\n"
    r"\textbf{Modelo} & & & BD & SD & TT & HH & CY & varias & nada \\" "\n" r"\midrule" "\n"
    + "\n".join(lineas[:-1]) + "\n" r"\bottomrule" "\n" r"\end{tabular}" "\n")

# ---- Tiempo de inferencia ----
ta = pd.read_csv(DATA / "tiempos_adtof.csv")
ta = ta[ta["cancion"].isin(comunes) & (ta["cond"] == "mix")]
tm = pd.read_csv("datasets/eval_drums/tiempos_muscriptor.txt", sep=" ", names=["cancion", "cond", "segundos"]).dropna()
tm = tm[(tm["cond"] == "mix") & tm["cancion"].isin(comunes)]
dur = ta.set_index("cancion")["duracion"]
rtf_a = (ta["segundos"].sum() / ta["duracion"].sum())
rtf_m = (tm["segundos"].sum() / dur.loc[tm["cancion"]].sum())
json.dump({"rtf_adtof": rtf_a, "rtf_muscriptor_mix": rtf_m, "segundos_audio": float(dur.sum()),
           "seg_adtof": float(ta["segundos"].sum()), "seg_muscriptor": float(tm["segundos"].sum()),
           "comunes": len(comunes), "prueba": len(prueba)},
          open(DATA / "tiempos.json", "w"), indent=1)
print(json.load(open(DATA / "tiempos.json")))

# ---- Figura de datos del cuaderno: golpes por clase (proporción) ----
golpes = pd.DataFrame({"E-GMD": [35177, 57483, 17965, 50360, 19244], "MDB": [1539, 2654, 90, 2639, 1002],
                       "ENST": [1906, 2194, 604, 2093, 1047]}, index=CLASES)
fig, ejes = plt.subplots(1, 2, figsize=(7.2, 2.4))
(golpes / golpes.sum() * 100).plot.bar(ax=ejes[0], color=["#08519c", "#d94801", "#6baed6"], width=0.75, rot=0)
ejes[0].set_ylabel("% de los golpes del dataset")
ejes[0].set_title("Proporción de golpes por clase", fontsize=9)
ejes[0].legend(fontsize=7)
sim = pd.DataFrame({"E-GMD": [38.7, 23.7, 20.1, 29.3, 43.5], "MDB": [46.6, 24.2, 17.8, 37.0, 52.3]}, index=CLASES)
sim.plot.bar(ax=ejes[1], color=["#08519c", "#d94801"], width=0.7, rot=0)
ejes[1].set_ylabel("% de golpes simultáneos")
ejes[1].set_title("Golpes a ≤ 10 ms de otra pieza", fontsize=9)
ejes[1].legend(fontsize=7)
fig.tight_layout()
fig.savefig(FIG / "datos_cuaderno.pdf")
print(todas.round(3).to_string())
print(sub.round(3).to_string())
