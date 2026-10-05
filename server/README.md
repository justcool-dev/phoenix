# Phoenix - Server Node.js & WireGuard Linux

Serveur backend Node.js API et gestionnaire d'interface WireGuard pour l'application **Phoenix**.

---

## 📋 Table des Matières
1. [Architecture](#architecture)
2. [Prérequis System Ubuntu](#prérequis-system-ubuntu)
3. [Installation Automatique](#installation-automatique)
4. [Installation & Configuration Manuelle](#installation--configuration-manuelle)
5. [Configuration WireGuard Server](#configuration-wireguard-server)
6. [Configuration Nginx & Reverse Proxy Plesk](#configuration-nginx--reverse-proxy-plesk)
7. [Permissions Linux & Sudoers](#permissions-linux--sudoers)
8. [Service Systemd](#service-systemd)
9. [Base de Données SQLite](#base-de-données-sqlite)
10. [Compte Administrateur & Mots de Passe](#compte-administrateur--mots-de-passe)
11. [Sauvegardes & Mises à Jour](#sauvegardes--mises-à-jour)
12. [Dépannage & Journaux](#dépannage--journaux)

---

## 🏗️ Architecture

- **OS Server**: Ubuntu 22.04 LTS / 24.04 LTS (Allemagne)
- **Node.js LTS**: API Express.js (Ecoute locale sur `0.0.0.0:9300`)
- **WireGuard**: Kernel module Linux (`wg0`, Subnet `10.66.66.0/24`, Port `51820/UDP`, Interface Internet `ens6`)
- **Base de données**: SQLite (`better-sqlite3` stocké dans `./data/phoenix.db`)
- **Centralized Master Management**: Node status & remote provision API for `adminvpn.jcdev.top` (`/api/central`)

---

## ⚡ Déploiement en Une Seule Commande (Rocky Linux, Ubuntu, Debian, RHEL)

Pour déployer automatiquement le serveur Phoenix sur n'importe quel serveur Linux (**Rocky Linux 8/9**, **AlmaLinux**, **RHEL**, **Ubuntu**, **Debian**), exécutez simplement cette commande unique en tant que `root` :

```bash
curl -fsSL https://raw.githubusercontent.com/justcool-dev/phoenix/main/server/scripts/deploy.sh | sudo bash
```

Ou en local depuis le dossier du projet :
```bash
sudo ./scripts/install.sh
```

Le script s'occupe automatiquement de :
1. Détecter votre distribution Linux (Rocky Linux, RHEL, Ubuntu, Debian, etc.).
2. Installer `wireguard-tools`, `Node.js 20 LTS`, `sqlite3`, et les dépendances système.
3. Détecter l'interface réseau sortante et configurer le pare-feu (`firewalld` ou `ufw`).
4. Détecter automatiquement votre **Adresse IP Publique** et configurer l'endpoint VPN.
5. Créer l'utilisateur système `phoenix`, configurer les règles sudoers restreintes, et démarrer le service `phoenix-api.service`.

---

## 🛠️ Configuration Manuelle Étape par Étape

### 1. Variables d'Environnement (`.env`)
Copiez `.env.example` vers `.env` et ajustez vos paramètres :

```env
NODE_ENV=production
PORT=3000
HOST=127.0.0.1
JWT_SECRET=votre_secret_jwt_tres_long_et_securise_32_caracteres_min
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=votre_hash_scrypt_genere
DATABASE_PATH=./data/jcvpn.db
WIREGUARD_INTERFACE=wg0
WIREGUARD_PORT=51820
VPN_NETWORK=10.66.66.0/24
VPN_SERVER_ADDRESS=10.66.66.1
WIREGUARD_ENDPOINT=212.132.119.66:51820
WIREGUARD_DNS=1.1.1.1, 8.8.8.8
```

Générez un hash sécurisé pour le mot de passe administrateur :
```bash
npm run hash-password MonMotDePasseFort123!
```

---

## 🔒 Configuration WireGuard Server (`/etc/wireguard/wg0.conf`)

Fichier `/etc/wireguard/wg0.conf` :

```ini
[Interface]
Address = 10.66.66.1/24
ListenPort = 51820
PrivateKey = <CLE_PRIVEE_SERVEUR_UBUNTU>

PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o ens6 -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o ens6 -j MASQUERADE
```

Activer le transfert d'IP (IP Forwarding) :
```bash
sudo sysctl -w net.ipv4.ip_forward=1
sudo systemctl enable wg-quick@wg0
sudo systemctl start wg-quick@wg0
```

---

## 🌐 Reverse Proxy Nginx & Plesk (`api.jcdev.top`)

Afin d'exposer l'API Node.js de manière sécurisée sous HTTPS sans exécuter le processus Node.js en root :

1. Dans votre panneau **Plesk**, créez le sous-domaine `api.jcdev.top`.
2. Activez le certificat SSL / Let's Encrypt pour `api.jcdev.top`.
3. Dans **Directives Nginx supplémentaires** (ou `/etc/nginx/conf.d/api.jcdev.top.conf`) :

```nginx
location / {
    proxy_pass http://127.0.0.1:9300;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

---

## 🔐 Permissions Sudoers Restreintes

Pour éviter que Node.js ne s'exécute en root, l'utilisateur non privilégier `jcvpn` exécute l'API. Seules les commandes WireGuard strictes sont autorisées sans mot de passe via `/etc/sudoers.d/jcvpn` :

```sudoers
jcvpn ALL=(ALL) NOPASSWD: /usr/bin/wg show wg0 dump, \
                          /usr/bin/wg show wg0 public-key, \
                          /usr/bin/wg set wg0 peer * allowed-ips *, \
                          /usr/bin/wg set wg0 peer * remove, \
                          /usr/bin/wg pubkey, \
                          /bin/systemctl reload wg-quick@wg0
```

---

## ⚙️ Systemd Service

Le service Node.js est géré par Systemd (`/etc/systemd/system/jcvpn-api.service`) :

```bash
# Redémarrer l'API
sudo systemctl restart jcvpn-api.service

# Consulter les logs en temps réel
sudo journalctl -u jcvpn-api.service -f
```

---

## 💾 Backup & Update

### Sauvegarde
```bash
sudo bash scripts/backup.sh
```
La sauvegarde est enregistrée dans `/var/backups/jcvpn/` (base SQLite et configurations, hors clés privées).

### Mise à jour
```bash
sudo bash scripts/update.sh
```
