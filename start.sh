#!/usr/bin/env bash
# Starts Saver on macOS / Linux. Run with: ./start.sh
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Saver needs Node.js 22 or newer. Download it from https://nodejs.org and run this again."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing Saver. This only happens the first time and takes a minute or two..."
  npm install --no-audit --no-fund
fi

npm start
