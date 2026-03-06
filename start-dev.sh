#!/usr/bin/env bash
# Start local development servers for RAAS Ontology Testing Platform
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Starting RAAS Ontology Testing Platform ==="

# Backend
echo "[1/2] Starting backend (FastAPI) on http://localhost:8000 ..."
cd "$SCRIPT_DIR/backend"
if [ ! -d ".venv" ]; then
  echo "  Creating Python virtual environment..."
  python3 -m venv .venv
  source .venv/bin/activate
  pip install -r requirements.txt
else
  source .venv/bin/activate
fi
uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

# Frontend
echo "[2/2] Starting frontend (Vite) on http://localhost:5173 ..."
cd "$SCRIPT_DIR/frontend"
if [ ! -d "node_modules" ]; then
  echo "  Installing npm dependencies..."
  npm install
fi
npx vite --host 0.0.0.0 --port 5173 &
FRONTEND_PID=$!

echo ""
echo "=== Servers started ==="
echo "  Frontend: http://localhost:5173"
echo "  Backend:  http://localhost:8000"
echo "  API Docs: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop all servers."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait
