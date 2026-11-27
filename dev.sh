#!/usr/bin/env bash
# Runs the pipeline API (FastAPI, port 8765) and the web interface (Vite, port 5173) together.
# Ctrl+C stops both. First-time setup (engine build, venv, npm install) is done automatically.
set -euo pipefail
cd "$(dirname "$0")"

API_PORT="${API_PORT:-8765}"

# --- first-time setup ----------------------------------------------------------------------
if [ ! -x engine/bin/t2s_transcribe ]; then
  echo "▸ Building the MuScriptor engine (first time, ~2 min)…"
  engine/build.sh
fi
if [ ! -x .venv/bin/uvicorn ]; then
  echo "▸ Creating the Python venv (first time)…"
  uv venv --python 3.12 .venv
  uv pip install --python .venv -r api/requirements.txt
fi
if [ ! -d interfaz/node_modules ]; then
  echo "▸ Installing interface dependencies (first time)…"
  (cd interfaz && npm install)
fi

# --- run both ------------------------------------------------------------------------------
# On Ctrl+C (or when either one exits) stop everything this script started: the whole process
# group, so uvicorn / vite die too, not only the `sed` that prefixes their output.
cleanup() {
  trap - INT TERM EXIT
  echo
  echo "▸ Stopping…"
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null
  [ -n "${WEB_PID:-}" ] && kill "$WEB_PID" 2>/dev/null
  kill 0 2>/dev/null || true
}
trap cleanup INT TERM EXIT

API_PID=""
if lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "▸ Port $API_PORT is already in use: using the API that is running there (restart it if it is an old version)."
else
  # Process substitution (not a pipe) so $! is uvicorn itself, not the `sed` prefixing its output
  .venv/bin/uvicorn api.main:app --host 127.0.0.1 --port "$API_PORT" > >(sed -u 's/^/[api] /') 2>&1 &
  API_PID=$!
  for _ in $(seq 1 40); do
    curl -s "http://127.0.0.1:$API_PORT/health" >/dev/null && break
    sleep 0.5
  done
fi

(cd interfaz && VITE_PIPELINE_URL="http://127.0.0.1:$API_PORT" exec npm run dev) > >(sed -u 's/^/[web] /') 2>&1 &
WEB_PID=$!

echo "▸ API: http://127.0.0.1:$API_PORT   Interface: see the [web] Local: line below   (Ctrl+C to stop)"

# Stop both as soon as either one ends
while kill -0 "$WEB_PID" 2>/dev/null && { [ -z "$API_PID" ] || kill -0 "$API_PID" 2>/dev/null; }; do
  sleep 1
done
