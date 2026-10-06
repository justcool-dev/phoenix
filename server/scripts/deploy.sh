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
  echo "        sudo bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/justcool-dev/phoenix/refs/heads/main/server/scripts/deploy.sh)\""
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
  SERVER_DIR="$( cd "$SCRIPT_DIR/.." && pwd -P )"
  REAL_TARGET="$( cd "$TARGET_DIR" && pwd -P )"
  if [ "$SERVER_DIR" != "$REAL_TARGET" ]; then
    if command -v rsync &>/dev/null; then
      rsync -a --exclude='node_modules' --exclude='.git' "$SERVER_DIR/" "$REAL_TARGET/"
    else
      cp -ru "$SERVER_DIR"/* "$REAL_TARGET/" 2>/dev/null || cp -r "$SERVER_DIR"/* "$REAL_TARGET/" || true
    fi
  fi
else
  echo "[1/3] Downloading latest Phoenix Server codebase..."
  
  # Ensure ca-certificates, curl, tar, git are present
  if command -v dnf &> /dev/null; then
    dnf install -y ca-certificates curl tar git || true
  elif command -v apt-get &> /dev/null; then
    apt-get update -y && apt-get install -y ca-certificates curl tar git || true
  fi

  TEMP_CLONE_DIR=$(mktemp -d)
  DOWNLOAD_SUCCESS=0

  # Strategy 1: Git clone
  if command -v git &> /dev/null && git clone --depth 1 https://github.com/justcool-dev/phoenix.git "$TEMP_CLONE_DIR/repo" 2>/dev/null; then
    echo "[INFO] Successfully cloned repository via git."
    cp -r "$TEMP_CLONE_DIR/repo/server"/* "$TARGET_DIR/"
    DOWNLOAD_SUCCESS=1
  # Strategy 2: Tarball download via curl / wget
  elif curl -fsSL "https://github.com/justcool-dev/phoenix/archive/refs/heads/main.tar.gz" -o "$TEMP_CLONE_DIR/archive.tar.gz" 2>/dev/null; then
    echo "[INFO] Downloaded repository archive via curl."
    mkdir -p "$TEMP_CLONE_DIR/extracted"
    tar -xzf "$TEMP_CLONE_DIR/archive.tar.gz" -C "$TEMP_CLONE_DIR/extracted" --strip-components=1
    cp -r "$TEMP_CLONE_DIR/extracted/server"/* "$TARGET_DIR/"
    DOWNLOAD_SUCCESS=1
  fi

  rm -rf "$TEMP_CLONE_DIR"

  if [ "$DOWNLOAD_SUCCESS" -ne 1 ]; then
    echo "----------------------------------------------------------------------"
    echo "[ERROR] Could not download Phoenix repository from GitHub."
    echo ""
    echo "Possible causes:"
    echo "  1. You haven't pushed your code to GitHub yet."
    echo "     -> Run these commands on your local machine first:"
    echo "        git init"
    echo "        git add ."
    echo "        git commit -m \"Initial commit\""
    echo "        git branch -M main"
    echo "        git remote add origin https://github.com/justcool-dev/phoenix.git"
    echo "        git push -u origin main"
    echo ""
    echo "  2. The repository is PRIVATE."
    echo "     -> On your server, clone with your GitHub credentials or SSH key:"
    echo "        git clone https://github.com/justcool-dev/phoenix.git"
    echo "        cd phoenix/server && sudo ./scripts/install.sh"
    echo "----------------------------------------------------------------------"
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
