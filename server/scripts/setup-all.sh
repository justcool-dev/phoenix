#!/usr/bin/env bash
set -euo pipefail

# Capture absolute script directory and source server directory AT THE VERY START
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SRC_SERVER_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

echo "=================================================="
echo "    JC VPN SERVER COMPLETE ALL-IN-ONE INSTALL     "
echo "=================================================="

if [ "$EUID" -ne 0 ]; then
  echo "[ERROR] Please run this script as root (sudo bash setup-all.sh)"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

echo "[1/7] Fixing apt broken dependencies & installing prerequisites..."
apt-get -y --fix-broken install || true
apt-get update -y || true

apt-get install -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" \
  wireguard wireguard-tools sqlite3 ufw iptables ca-certificates curl wget git gnupg apt-transport-https || {
  apt-get -y --fix-broken install
  apt-get install -y wireguard wireguard-tools sqlite3 ufw iptables ca-certificates curl wget git gnupg apt-transport-https
}

# Auto-detect public network interface (e.g. eth0, ens3, ens6, enp1s0)
INET_IF=$(ip route get 8.8.8.8 2>/dev/null | awk '{for(i=1;i<=NF;i++)if($i=="dev")print $(i+1)}' | head -n1 || echo "ens6")
if [ -z "$INET_IF" ]; then
  INET_IF="ens6"
fi

echo "[2/7] Checking/Installing Node.js 20 LTS..."
if ! command -v node &> /dev/null; then
  echo "Node.js not found. Installing Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | env DEBIAN_FRONTEND=noninteractive bash -
  apt-get install -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" nodejs
fi
echo "Node.js version: $(node -v)"

echo "[3/7] Setting up WireGuard Linux Server (wg0)..."
WG_IF="wg0"
WG_PORT="9301"
WG_ADDR="10.66.66.1/24"
WG_DIR="/etc/wireguard"

mkdir -p "$WG_DIR"
cd "$WG_DIR"

if [ ! -f "$WG_DIR/private.key" ]; then
  echo "Generating WireGuard server keypair..."
  wg genkey | tee "$WG_DIR/private.key" | wg pubkey > "$WG_DIR/public.key"
  chmod 600 "$WG_DIR/private.key"
fi

SERVER_PRIV_KEY=$(cat "$WG_DIR/private.key")
SERVER_PUB_KEY=$(cat "$WG_DIR/public.key")

echo "Configuring /etc/wireguard/$WG_IF.conf on interface $INET_IF..."
cat << EOF > "$WG_DIR/$WG_IF.conf"
[Interface]
Address = $WG_ADDR
ListenPort = $WG_PORT
PrivateKey = $SERVER_PRIV_KEY

PostUp = iptables -A FORWARD -i $WG_IF -j ACCEPT; iptables -t nat -A POSTROUTING -o $INET_IF -j MASQUERADE
PostDown = iptables -D FORWARD -i $WG_IF -j ACCEPT; iptables -t nat -A POSTROUTING -o $INET_IF -j MASQUERADE
EOF

chmod 600 "$WG_DIR/$WG_IF.conf"

echo "Enabling IPv4 forwarding..."
sysctl -w net.ipv4.ip_forward=1 || true
if grep -q "net.ipv4.ip_forward" /etc/sysctl.conf; then
  sed -i 's/#net.ipv4.ip_forward=1/net.ipv4.ip_forward=1/' /etc/sysctl.conf
else
  echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf
fi

systemctl enable wg-quick@$WG_IF || true
systemctl restart wg-quick@$WG_IF || true

echo "[4/7] Creating system user 'jcvpn'..."
if ! id "jcvpn" &>/dev/null; then
  useradd -r -s /bin/bash jcvpn || true
fi

echo "[5/7] Preparing application directory /opt/jcvpn/server..."
TARGET_DIR="/opt/jcvpn/server"
mkdir -p "$TARGET_DIR/data"
mkdir -p "$TARGET_DIR/logs"
mkdir -p "$TARGET_DIR/certs"

if [ "$SRC_SERVER_DIR" != "$TARGET_DIR" ]; then
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
CENTRAL_MANAGEMENT_URL=http://vpn.jcdev.top:8500
CENTRAL_AUTO_SYNC=true
NODE_SECRET=phoenix-node-secret-key
EOF
  fi
fi

PUBLIC_IP=$(curl -s https://api.ipify.org || curl -s https://ifconfig.me || curl -s https://icanhazip.com || echo "VOTRE_IP_PUBLIQUE")
if [ -n "$PUBLIC_IP" ] && [ "$PUBLIC_IP" != "VOTRE_IP_PUBLIQUE" ]; then
  echo "[INFO] Auto-configuring WIREGUARD_ENDPOINT in .env with public IP: ${PUBLIC_IP}:9301"
  sed -i "s|^WIREGUARD_ENDPOINT=.*|WIREGUARD_ENDPOINT=${PUBLIC_IP}:9301|" "$TARGET_DIR/.env"
fi

chown -R jcvpn:jcvpn /opt/jcvpn

echo "[6/7] Setting up restricted sudoers & UFW firewall ports..."
cat << 'EOF' > /etc/sudoers.d/jcvpn
jcvpn ALL=(ALL) NOPASSWD: /usr/bin/wg show wg0 dump, /usr/bin/wg show wg0 public-key, /usr/bin/wg set wg0 peer * allowed-ips *, /usr/bin/wg set wg0 peer * remove, /usr/bin/wg pubkey, /bin/systemctl reload wg-quick@wg0
EOF
chmod 0440 /etc/sudoers.d/jcvpn

if command -v ufw &> /dev/null; then
  ufw allow 9301/udp || true
  ufw allow 9300/tcp || true
fi

echo "[7/7] Starting JC VPN Systemd Service..."
cp systemd/jcvpn-api.service /etc/systemd/system/jcvpn-api.service
systemctl daemon-reload
systemctl enable jcvpn-api.service
systemctl restart jcvpn-api.service || true

PUBLIC_IP=$(curl -s https://api.ipify.org || echo "VOTRE_IP_PUBLIQUE")

echo "=================================================="
echo "    JC VPN SERVER INSTALLATION COMPLETE !        "
echo "=================================================="
echo " - Serveur Web Admin : http://$PUBLIC_IP:9300/admin"
echo " - Admin Identifiant : admin"
echo " - Admin Mot de passe : admin123"
echo " - Port VPN WireGuard : 9301/UDP"
echo "=================================================="
