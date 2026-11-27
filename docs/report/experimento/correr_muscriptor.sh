#!/bin/sh
# Corre MuScriptor large (binario nativo, Metal) sobre MDB-Drums en dos condiciones:
#   mix   -> la mezcla completa, con la misma pasada del sistema (drums + bajos)
#   drum  -> la pista de solo batería, pidiendo solo batería
# Primero las 7 canciones de prueba del notebook, luego el resto.
cd "$(dirname "$0")/../../.."
PRUEBA="BebopJazz CoolJazz Gospel Grunge Rockabilly SpeedMetal SwingJazz"
TODAS=$(ls datasets/eval_drums/f32 | sed -n 's/^MusicDelta_\(.*\)_mix\.f32$/\1/p')
orden=""
for t in $PRUEBA; do orden="$orden $t"; done
for t in $TODAS; do case " $PRUEBA " in *" $t "*) ;; *) orden="$orden $t";; esac; done
correr() {
    t=$1; tipo=$2
    out=datasets/eval_drums/muscriptor/MusicDelta_${t}_${tipo}.json
    [ -s "$out" ] && return
    if [ $tipo = mix ]; then inst=drums,acoustic_bass,electric_bass; else inst=drums; fi
    inicio=$(date +%s)
    engine/bin/t2s_transcribe --model models/muscriptor-large-f16.gguf \
      --audio datasets/eval_drums/f32/MusicDelta_${t}_${tipo}.f32 --out "$out" --instruments $inst 2>/dev/null
    echo "$t $tipo $(( $(date +%s) - inicio ))" >> datasets/eval_drums/tiempos_muscriptor.txt
}
for t in $PRUEBA; do correr $t mix; correr $t drum; done
for t in $orden; do correr $t mix; done
for t in $orden; do correr $t drum; done
echo FIN >> datasets/eval_drums/tiempos_muscriptor.txt
