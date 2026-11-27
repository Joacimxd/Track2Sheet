#!/usr/bin/env bash
# Builds engine/bin/t2s_transcribe: the MuScriptor engine NeuralNote v2 uses (muscriptor.cpp),
# with Metal on Apple Silicon. Needs: cmake, ninja (brew install cmake ninja), Xcode Command Line Tools.
#
# Metal shaders are compiled at run time (MUSCRIPTOR_METAL_PRECOMPILED=OFF), so full Xcode isn't
# needed; the first run takes ~20 s longer while macOS compiles and caches them.
set -euo pipefail
cd "$(dirname "$0")"

MUSCRIPTOR_COMMIT=8589219cc3b584bce970f95aec2ec4a04e53b280

if [ ! -d muscriptor.cpp ]; then
  git clone https://github.com/DamRsn/muscriptor.cpp.git
fi
git -C muscriptor.cpp fetch --quiet --depth 1 origin "$MUSCRIPTOR_COMMIT" 2>/dev/null || true
git -C muscriptor.cpp checkout --quiet "$MUSCRIPTOR_COMMIT"

cmake -S cli -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DMUSCRIPTOR_METAL_PRECOMPILED=OFF
cmake --build build

mkdir -p bin
rm -f bin/t2s_transcribe   # overwriting a signed binary in place gets it killed by macOS
cp build/t2s_transcribe bin/
echo "Built $(pwd)/bin/t2s_transcribe"
