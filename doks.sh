#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js 20+ is required to run Doks."
  echo "Please install Node.js from https://nodejs.org/"
  exit 1
fi

if [ ! -f "agent/dist/index.js" ]; then
  echo "[Doks] First-time build..."
  npm run build
fi

node agent/dist/index.js --open "$@"
