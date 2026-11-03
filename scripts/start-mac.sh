#!/usr/bin/env bash
# Запуск TV Hub на macOS без Docker: процесс работает прямо в сети Mac,
# поэтому видит все устройства в LAN и mDNS.
#   ./scripts/start-mac.sh            — установить зависимости, собрать и запустить
#   TVHUB_PORT=9000 ./scripts/start-mac.sh
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] && set -a && . ./.env && set +a
PORT="${TVHUB_PORT:-8765}"

if ! command -v brew >/dev/null; then
  echo "Нужен Homebrew: https://brew.sh" >&2; exit 1
fi
command -v adb  >/dev/null || brew install --cask android-platform-tools
command -v node >/dev/null || brew install node

if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Порт $PORT занят (возможно, контейнер tv-hub: docker compose -f docker-compose.bridge.yml down). Укажи другой: TVHUB_PORT=..." >&2
  exit 1
fi

npm ci --no-audit --no-fund
npm run build
mkdir -p data
echo "TV Hub: http://localhost:$PORT"
# SCAN_SUBNETS не нужен: без Docker сервер сам видит подсеть Mac
PORT="$PORT" HOST="${HOST:-0.0.0.0}" DATA_DIR="$PWD/data" SCAN_SUBNETS="" exec node server/dist/main.js
