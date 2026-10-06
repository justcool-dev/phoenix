#!/usr/bin/env bash
set -euo pipefail

echo "=================================================="
echo "      PHOENIX WIREGUARD SERVER INITIALIZATION     "
echo "=================================================="

if [ "$EUID" -ne 0 ]; then
  echo "[ERROR] Please run this script as root (sudo ./setup-wireguard.sh)"
  exit 1
fi

# Ensure WireGuard kernel module is loaded if available
modprobe wireguard 2>/dev/null || true

WG_IF="wg0"
WG_PORT="9301"

# Auto-detect default outbound network interface (e.g. eth0, ens3, enp1s0, ens6)
DETECTED_IF=$(ip route show default | awk '/default/ {print $5}' | head -n1 || true)
INET_IF="${DETECTED_IF:-eth0}"
echo "[INFO] Using outbound network interface: $INET_IF"

WG_ADDR="10.66.66.1/24"
WG_DIR="/etc/wireguard"

mkdir -p "$WG_DIR"
cd "$WG_DIR"

if [ ! -f "$WG_DIR/private.key" ]; then
  echo "[1/4] Generating WireGuard server private & public keys..."
  wg genkey | tee "$WG_DIR/private.key" | wg pubkey > "$WG_DIR/public.key"
  chmod 600 "$WG_DIR/private.key"
fi

SERVER_PRIV_KEY=$(cat "$WG_DIR/private.key")
SERVER_PUB_KEY=$(cat "$WG_DIR/public.key")

echo "[2/4] Server Public Key: $SERVER_PUB_KEY"

echo "[3/4] Generating /etc/wireguard/wg0.conf..."
cat << EOF > "$WG_DIR/$WG_IF.conf"
[Interface]
Address = $WG_ADDR
ListenPort = $WG_PORT
PrivateKey = $SERVER_PRIV_KEY

PostUp = iptables -A FORWARD -i $WG_IF -j ACCEPT; iptables -t nat -A POSTROUTING -o $INET_IF -j MASQUERADE
PostDown = iptables -D FORWARD -i $WG_IF -j ACCEPT; iptables -t nat -A POSTROUTING -o $INET_IF -j MASQUERADE

# Client peers appended dynamically below
EOF

chmod 600 "$WG_DIR/$WG_IF.conf"

echo "[4/4] Enabling IPv4 forwarding & firewall rules..."
sysctl -w net.ipv4.ip_forward=1 || true
if [ -f /etc/sysctl.conf ]; then
  if grep -q "net.ipv4.ip_forward" /etc/sysctl.conf; then
    sed -i 's/#net.ipv4.ip_forward=1/net.ipv4.ip_forward=1/' /etc/sysctl.conf
  else
    echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf
  fi
fi

# Configure firewall based on active service (firewalld for Rocky Linux / RHEL, UFW for Ubuntu/Debian)
if command -v firewall-cmd &> /dev/null && systemctl is-active --quiet firewalld; then
  echo "[INFO] Applying firewalld rules for Rocky Linux / RHEL..."
  firewall-cmd --permanent --add-port=$WG_PORT/udp || true
  firewall-cmd --permanent --add-port=9300/tcp || true
  firewall-cmd --permanent --add-masquerade || true
  firewall-cmd --reload || true
elif command -v ufw &> /dev/null && ufw status | grep -q "active"; then
  echo "[INFO] Applying UFW rules for Ubuntu / Debian..."
  ufw allow $WG_PORT/udp || true
  ufw allow 9300/tcp || true
else
  echo "[INFO] Applying iptables fallback rules..."
  iptables -A INPUT -p udp --dport $WG_PORT -j ACCEPT || true
  iptables -A INPUT -p tcp --dport 9300 -j ACCEPT || true
fi

# Stop existing interface if active to ensure clean restart
wg-quick down $WG_IF 2>/dev/null || true

systemctl enable wg-quick@$WG_IF || true
systemctl restart wg-quick@$WG_IF || wg-quick up $WG_IF || true

echo "=================================================="
echo " WireGuard interface $WG_IF active on port $WG_PORT "
echo "=================================================="
