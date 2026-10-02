#!/bin/bash
set -e

# Ensure pnpm is in PATH
export PATH="$HOME/.local/bin:$PATH"

cd "$(dirname "$0")/.."

echo "Installing dependencies..."
pnpm install

echo "Starting development servers..."
echo "Web will run on http://localhost:5173"
echo "API will run on http://localhost:3010"
echo "Press Ctrl+C to stop all processes"

pnpm run dev:web &
WEB_PID=$!
pnpm run dev:api &
API_PID=$!

cleanup() {
  echo "Stopping development servers..."
  kill $WEB_PID $API_PID 2>/dev/null || true
  wait 2>/dev/null || true
  echo "Done"
}

trap cleanup EXIT INT TERM

wait
