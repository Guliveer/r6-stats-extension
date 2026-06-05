#!/usr/bin/env bash
# Install dependencies, scrape rank icons, and build the extension.
# Run from the repo root: ./setup.sh
set -euo pipefail

cd "$(dirname "$0")"

echo "==> Installing dependencies"
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

# Idempotent — only re-fetches missing icons.
echo "==> Fetching rank icons"
node scripts/scrape-rank-icons.mjs

# Champion top-X icons (1..9999). Skipped if already present.
if [ ! -d public/icons/ranks/champion-ranks ] || [ "$(ls -1 public/icons/ranks/champion-ranks 2>/dev/null | wc -l)" -lt 9999 ]; then
  echo "==> Fetching champion-rank icons (this takes a few minutes)"
  node scripts/scrape-champion-ranks.mjs
  echo "==> Compressing champion-rank icons"
  node scripts/convert-champion-ranks.mjs
fi

echo "==> Building extension"
npm run build

echo
echo "Done. Load 'dist/' in chrome://extensions (Developer mode → Load unpacked)."
