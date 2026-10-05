#!/usr/bin/env bash
set -euo pipefail

echo "=================================================="
echo "      PHOENIX SERVER AUTOMATED INSTALLATION       "
echo "=================================================="

if [ "$EUID" -ne 0 ]; then
  echo "[ERROR] Please run this script as root (sudo ./install.sh)"
  exit 1
fi

# Detect OS distribution family (RHEL/Rocky/Alma vs Debian/Ubuntu)
OS_FAMILY="unknown"
if [ -f /etc/os-release ]; then
  . /etc/os-release
  if [[ "${ID:-}" =~ ^(rocky|almalinux|rhel|centos|fedora)$ ]] || [[ "${ID_LIKE:-}" =~ (rhel|fedora) ]]; then
    OS_FAMILY="rhel"
  elif [[ "${ID:-}" =~ ^(ubuntu|debian)$ ]] || [[ "${ID_LIKE:-}" =~ debian ]]; then
    OS_FAMILY="debian"
  fi
fi

echo "[1/6] Installing prerequisites for OS family: $OS_FAMILY..."

if [ "$OS_FAMILY" = "rhel" ]; then
  echo "[INFO] Running package installation via dnf/yum..."
  PKG_MGR="dnf"
  if ! command -v dnf &>/dev/null; then
    PKG_MGR="yum"
  fi
  $PKG_MGR install -y epel-release || true
  $PKG_MGR install -y wireguard-tools sqlite iptables firewalld curl wget ca-certificates gcc-c++ make
elif [ "$OS_FAMILY" = "debian" ]; then
  echo "[INFO] Running package installation via apt-get..."
  apt-get update -y
  apt-get install -y curl wget wireguard sqlite3 ufw iptables ca-certificates build-essential
else
  echo "[WARN] Unrecognized Linux distribution. Attempting generic package installation..."
  if command -v apt-get &>/dev/null; then
    apt-get update -y && apt-get install -y curl wget wireguard sqlite3 ufw iptables ca-certificates build-essential || true
  elif command -v dnf &>/dev/null; then
    dnf install -y wireguard-tools sqlite iptables firewalld curl wget ca-certificates gcc-c++ make || true
  fi
fi

echo "[2/6] Checking Node.js LTS installation..."
if ! command -v node &> /dev/null; then
  echo "[INFO] Node.js not found. Installing Node.js 20 LTS..."
  if [ "$OS_FAMILY" = "rhel" ]; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    $PKG_MGR install -y nodejs
  else
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  fi
fi
echo "[INFO] Node.js version: $(node -v)"

echo "[3/6] Creating system user 'phoenix'..."
if ! id "phoenix" &>/dev/null; then
  useradd -r -s /bin/bash phoenix || true
  echo "[INFO] Created user 'phoenix'."
fi

echo "[4/6] Preparing application directory /opt/phoenix..."
TARGET_DIR="/opt/phoenix/server"
mkdir -p "$TARGET_DIR/data"
mkdir -p "$TARGET_DIR/logs"
mkdir -p "$TARGET_DIR/certs"

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SRC_SERVER_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

# Only copy if source and target are different directories
if [ "$SRC_SERVER_DIR" != "$TARGET_DIR" ]; then
  echo "[INFO] Copying application files from $SRC_SERVER_DIR to $TARGET_DIR..."
  cp -r "$SRC_SERVER_DIR"/* "$TARGET_DIR/"
fi

cd "$TARGET_DIR"
npm install --production

# Auto-detect Public IP Address
PUBLIC_IP=$(curl -s --max-time 5 https://api.ipify.org || curl -s --max-time 5 https://ifconfig.me || echo "YOUR_SERVER_IP")
echo "[INFO] Auto-detected Server Public IP: $PUBLIC_IP"

if [ ! -f "$TARGET_DIR/.env" ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
  else
    cat << EOF > .env
PORT=9300
HOST=0.0.0.0
NODE_ENV=production
DATABASE_PATH=./data/phoenix.db
JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || echo "phoenix_jwt_secret_random_key_$(date +%s)")
WIREGUARD_ENDPOINT=${PUBLIC_IP}:51820
WIREGUARD_INTERFACE=wg0
WIREGUARD_PORT=51820
VPN_NETWORK=10.66.66.0/24
VPN_SERVER_ADDRESS=10.66.66.1
CENTRAL_MANAGEMENT_URL=https://adminvpn.jcdev.top
EOF
  fi
  sed -i "s/WIREGUARD_ENDPOINT=.*/WIREGUARD_ENDPOINT=${PUBLIC_IP}:51820/" .env || true
  echo "[NOTICE] Created $TARGET_DIR/.env with server IP endpoint ${PUBLIC_IP}:51820."
fi

chown -R phoenix:phoenix /opt/phoenix

echo "[5/6] Setting up restricted sudoers rule..."
cat << 'EOF' > /etc/sudoers.d/phoenix
# Sudoers permissions for Phoenix API Server
phoenix ALL=(ALL) NOPASSWD: /usr/bin/wg show wg0 dump, /usr/bin/wg show wg0 public-key, /usr/bin/wg set wg0 peer * allowed-ips *, /usr/bin/wg set wg0 peer * remove, /usr/bin/wg pubkey, /bin/systemctl reload wg-quick@wg0
EOF
chmod 0440 /etc/sudoers.d/phoenix

echo "[6/6] Installing Systemd service & WireGuard..."
cp systemd/phoenix-api.service /etc/systemd/system/phoenix-api.service
systemctl daemon-reload
systemctl enable phoenix-api.service

if [ -f scripts/setup-wireguard.sh ]; then
  chmod +x scripts/setup-wireguard.sh
  ./scripts/setup-wireguard.sh || true
fi

systemctl restart phoenix-api.service || true

echo "=================================================="
echo "      PHOENIX INSTALLATION COMPLETE!            "
echo "=================================================="
echo " Server Public IP:    $PUBLIC_IP"
echo " API Endpoint URL:    http://${PUBLIC_IP}:9300"
echo " Admin Web Dashboard: http://${PUBLIC_IP}:9300/admin"
echo " Systemd status:"
systemctl status phoenix-api.service --no-pager || true
