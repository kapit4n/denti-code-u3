#!/bin/bash
set -e

# Ensure pnpm is in PATH
export PATH="$HOME/.local/bin:$PATH"

cd "$(dirname "$0")/.."

echo "Cleaning build artifacts and caches..."
rm -rf node_modules/.cache .turbo
find . -name "dist" -not -path "./node_modules/*" -type d | xargs rm -rf 2>/dev/null || true
find . -name ".turbo" -not -path "./.turbo" -type d | xargs rm -rf 2>/dev/null || true

echo "Stopping any running dev processes..."
pkill -f "vite\|tauri\|tsx.*api" 2>/dev/null || true
pkill -f "pnpm.*dev" 2>/dev/null || true

echo "Cleaning complete"
