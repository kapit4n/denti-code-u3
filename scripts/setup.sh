#!/bin/bash
set -e

# Ensure pnpm is in PATH
export PATH="$HOME/.local/bin:$PATH"

cd "$(dirname "$0")/.."

echo "Setting up Denti-Code U3 development environment..."

# Check Node version
node --version
echo "Node OK"

# Install pnpm if not in PATH
if ! command -v pnpm &> /dev/null; then
  echo "Installing pnpm..."
  npm i -g pnpm@10 --prefix "$HOME/.local"
  export PATH="$HOME/.local/bin:$PATH"
fi
pnpm --version
echo "pnpm OK"

# Install dependencies
echo "Installing dependencies..."
pnpm install

# Setup environment
if [ ! -f .env ]; then
  echo "Creating .env from .env.example..."
  cp .env.example .env
  echo "Please update .env with your configuration"
fi

echo "Setup complete!"
