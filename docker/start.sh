#!/usr/bin/env bash
set -uo pipefail
cd /workspace

if [ ! -f "$MUSCRIPTOR_MODEL" ]; then
  echo "Downloading MuScriptor large (2.7 GB, first time only)…"
  mkdir -p "$(dirname "$MUSCRIPTOR_MODEL")"
  curl -fL --progress-bar -o "$MUSCRIPTOR_MODEL.part" \
    https://huggingface.co/DamRsn/muscriptor-gguf/resolve/main/v1/muscriptor-large-f16.gguf \
    && mv "$MUSCRIPTOR_MODEL.part" "$MUSCRIPTOR_MODEL" || exit 1
fi

if ! (cd web && sha1sum -c --status node_modules/.installed-lock 2>/dev/null); then
  (cd web && npm ci --no-audit --no-fund && sha1sum package-lock.json > node_modules/.installed-lock)
fi

uvicorn api.main:app --host 0.0.0.0 --port 8765 2>&1 | sed -u "s/^/[api] /" &
(cd web && VITE_PIPELINE_URL=http://localhost:8765 npx vite --host 0.0.0.0 --port 5173 --strictPort) 2>&1 | sed -u "s/^/[web] /" &
jupyter lab --ip=0.0.0.0 --port=8888 --no-browser --allow-root --IdentityProvider.token= \
  --ServerApp.root_dir=/workspace 2>&1 | sed -u "s/^/[jupyter] /" &

echo "Interface: http://localhost:5173   API: http://localhost:8765   Notebooks: http://localhost:8888"
wait -n
kill 0
