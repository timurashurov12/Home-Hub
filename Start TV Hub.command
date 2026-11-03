#!/usr/bin/env bash
# Двойной клик в Finder запускает TV Hub без Docker и открывает панель в браузере.
cd "$(dirname "$0")"
git pull --ff-only 2>/dev/null || true
PORT="$( [ -f .env ] && grep -E '^TVHUB_PORT=' .env | cut -d= -f2 )"
PORT="${PORT:-8765}"
( for i in $(seq 1 120); do
    curl -sf "http://localhost:$PORT/api/health" >/dev/null && open "http://localhost:$PORT" && exit 0
    sleep 2
  done ) &
./scripts/start-mac.sh
