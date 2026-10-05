#!/usr/bin/env bash
set -euo pipefail

echo "=================================================="
echo "          PHOENIX SERVER UPDATE SCRIPT            "
echo "=================================================="

if [ "$EUID" -ne 0 ]; then
  echo "[ERROR] Please run this script as root"
  exit 1
fi

APP_DIR="/opt/phoenix/server"

if [ -d "$APP_DIR" ]; then
  cd "$APP_DIR"
  echo "Pulling latest code / dependencies..."
  npm install --production
  chown -R phoenix:phoenix "$APP_DIR"
  echo "Restarting phoenix-api service..."
  systemctl restart phoenix-api.service
  echo "Update finished successfully."
else
  echo "[ERROR] Directory $APP_DIR not found."
fi
