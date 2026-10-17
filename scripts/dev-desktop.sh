#!/bin/bash
set -e

# Ensure pnpm is in PATH
export PATH="$HOME/.local/bin:$PATH"

cd "$(dirname "$0")/.."

echo "Installing dependencies..."
pnpm install

# The desktop window renders the shared app, which talks to the API named by
# VITE_API_URL_DESKTOP (http://localhost:3010/api/v1). A dev window opened with
# no backend running draws "The patient list could not be loaded" and nothing
# else, so the API is started here rather than left to a second terminal.
# The port matches API_PORT in .env and must be kept in step with it.
API_PORT=3010

echo "Starting the API on http://localhost:${API_PORT} ..."
pnpm run dev:api &
API_PID=$!

cleanup() {
  echo "Stopping the API..."
  kill "$API_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  echo "Done"
}

trap cleanup EXIT INT TERM

# Wait for the API to answer before opening the window, so the first screen the
# desktop shell draws is not an error it has to retry out of. `curl` is not
# guaranteed on the machines this runs on (AGENTS.md §8), so the probe is bash's
# own /dev/tcp: a successful connect means Fastify is listening, which it only
# does once its routes are registered.
ready=0
for _ in $(seq 1 60); do
  if (exec 3<>"/dev/tcp/localhost/${API_PORT}") 2>/dev/null; then
    exec 3>&- 3<&-
    ready=1
    break
  fi
  sleep 0.5
done

if [ "$ready" -ne 1 ]; then
  echo "The API did not start on port ${API_PORT}; opening the desktop window anyway."
  echo "Check the API log above — it usually needs \`pnpm run db:migrate\` and \`pnpm run db:seed\` once."
fi

echo "Starting desktop development..."
pnpm run dev:desktop
