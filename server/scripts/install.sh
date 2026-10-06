#!/usr/bin/env bash
set -euo pipefail

# Capture absolute script directory and source server directory AT THE VERY START
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SRC_SERVER_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

echo "=================================================="
echo "      JC VPN SERVER AUTOMATED INSTALLATION        "
echo "=================================================="

if [ "$EUID" -ne 0 ]; then
  echo "[ERROR] Please run this script as root (sudo ./install.sh)"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "[1/6] Fixing apt broken dependencies & installing prerequisites..."
apt-get -y --fix-broken install || true
apt-get update -y || true

apt-get install -y wireguard wireguard-tools sqlite3 ufw iptables ca-certificates curl wget git || {
  apt-get -y --fix-broken install
  apt-get install -y wireguard wireguard-tools sqlite3 ufw iptables ca-certificates curl wget git
}

echo "[2/6] Checking Node.js LTS installation..."
if ! command -v node &> /dev/null; then
  echo "Node.js not found. Installing Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "Node.js version: $(node -v)"

echo "[3/6] Creating system user 'jcvpn'..."
if ! id "jcvpn" &>/dev/null; then
  useradd -r -s /bin/bash jcvpn || true
  echo "Created user 'jcvpn'."
fi

echo "[4/6] Preparing application directory /opt/jcvpn..."
TARGET_DIR="/opt/jcvpn/server"
mkdir -p "$TARGET_DIR/data"
mkdir -p "$TARGET_DIR/logs"
mkdir -p "$TARGET_DIR/certs"

if [ "$SRC_SERVER_DIR" != "$TARGET_DIR" ]; then
  echo "Copying application files from $SRC_SERVER_DIR to $TARGET_DIR..."
  cp -r "$SRC_SERVER_DIR"/. "$TARGET_DIR/"
fi

cd "$TARGET_DIR"
npm install --production

if [ ! -f "$TARGET_DIR/.env" ]; then
  if [ -f "$TARGET_DIR/.env.example" ]; then
    cp "$TARGET_DIR/.env.example" "$TARGET_DIR/.env"
  else
    cat << EOF > "$TARGET_DIR/.env"
NODE_ENV=production
PORT=9300
HOST=0.0.0.0
JWT_SECRET=replace_this_with_a_super_secret_jwt_key_32bytes_min
JWT_EXPIRES_IN=86400
REFRESH_TOKEN_EXPIRES_IN=604800
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=10af59554a0a0c473f21084a33a4b292444c70453059a5e6f29c87fdb216e698.4fc627281c956916c9cb0fd05832d523
DATABASE_PATH=./data/jcvpn.db
WIREGUARD_INTERFACE=wg0
WIREGUARD_PORT=9301
VPN_NETWORK=10.66.66.0/24
VPN_SERVER_ADDRESS=10.66.66.1
WIREGUARD_ENDPOINT=VOTRE_IP_SERVEUR:9301
WIREGUARD_DNS=1.1.1.1, 8.8.8.8
WIREGUARD_CONFIG_PATH=/etc/wireguard/wg0.conf
EOF
  fi
  echo "[NOTICE] Created default $TARGET_DIR/.env file."
fi

PUBLIC_IP=$(curl -s https://api.ipify.org || curl -s https://ifconfig.me || curl -s https://icanhazip.com || echo "")
if [ -n "$PUBLIC_IP" ]; then
  echo "[INFO] Auto-configuring WIREGUARD_ENDPOINT in .env with public IP: ${PUBLIC_IP}:9301"
  sed -i "s|^WIREGUARD_ENDPOINT=.*|WIREGUARD_ENDPOINT=${PUBLIC_IP}:9301|" "$TARGET_DIR/.env"
fi

chown -R jcvpn:jcvpn /opt/jcvpn

echo "[5/6] Setting up restricted sudoers rule..."
cat << 'EOF' > /etc/sudoers.d/jcvpn
jcvpn ALL=(ALL) NOPASSWD: /usr/bin/wg show wg0 dump, /usr/bin/wg show wg0 public-key, /usr/bin/wg set wg0 peer * allowed-ips *, /usr/bin/wg set wg0 peer * remove, /usr/bin/wg pubkey, /bin/systemctl reload wg-quick@wg0
EOF
chmod 0440 /etc/sudoers.d/jcvpn

echo "[6/6] Installing Systemd service..."
cp systemd/jcvpn-api.service /etc/systemd/system/jcvpn-api.service
systemctl daemon-reload
systemctl enable jcvpn-api.service
systemctl restart jcvpn-api.service || true

echo "=================================================="
echo "      JC VPN INSTALLATION COMPLETE!             "
echo "=================================================="
echo "Systemd service status:"
systemctl status jcvpn-api.service --no-pager || true
