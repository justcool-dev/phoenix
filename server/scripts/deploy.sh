#!/usr/bin/env bash
# ==============================================================================
# PHOENIX VPN SERVER - ONE-COMMAND DEPLOYMENT SCRIPT
# Supports: Rocky Linux 8/9, AlmaLinux, RHEL, CentOS, Ubuntu, Debian, Fedora
# ==============================================================================
set -euo pipefail

echo "======================================================================"
echo "          🚀 PHOENIX VPN SERVER ONE-CLICK DEPLOYMENT                  "
echo "======================================================================"

if [ "$EUID" -ne 0 ]; then
  echo "[ERROR] Please run this deployment script as root:"
  echo "        sudo bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/justcool-dev/phoenix/main/server/scripts/deploy.sh)\""
  exit 1
fi

TARGET_DIR="/opt/phoenix/server"
mkdir -p "$TARGET_DIR"

SCRIPT_DIR=""
if [ -f "${BASH_SOURCE[0]:-}" ]; then
  SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
fi

# Check if local installation files are available
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/install.sh" ]; then
  echo "[1/3] Using local installation files from $SCRIPT_DIR..."
  SERVER_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
  if [ "$SERVER_DIR" != "$TARGET_DIR" ]; then
    cp -r "$SERVER_DIR"/* "$TARGET_DIR/"
  fi
else
  echo "[1/3] Downloading latest Phoenix Server codebase..."
  if ! command -v git &> /dev/null; then
    if command -v dnf &> /dev/null; then
      dnf install -y git || true
    elif command -v apt-get &> /dev/null; then
      apt-get update -y && apt-get install -y git || true
    fi
  fi

  TEMP_CLONE_DIR=$(mktemp -d)
  if git clone https://github.com/justcool-dev/phoenix.git "$TEMP_CLONE_DIR"; then
    cp -r "$TEMP_CLONE_DIR/server"/* "$TARGET_DIR/"
    rm -rf "$TEMP_CLONE_DIR"
  else
    echo "[ERROR] Failed to clone Phoenix repository. Ensure internet connectivity and git availability."
    exit 1
  fi
fi

echo "[2/3] Executing automated installer on target server..."
cd "$TARGET_DIR"
chmod +x scripts/install.sh scripts/setup-wireguard.sh
./scripts/install.sh

echo "======================================================================"
echo "      🎉 PHOENIX VPN SERVER SUCCESSFULLY DEPLOYED & RUNNING!          "
echo "======================================================================"
EOF
