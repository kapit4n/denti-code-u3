#!/bin/bash
set -e

# Ensure pnpm is in PATH
export PATH="$HOME/.local/bin:$PATH"

cd "$(dirname "$0")/.."

echo "Installing dependencies..."
pnpm install

echo "Starting desktop development..."
pnpm run dev:desktop
