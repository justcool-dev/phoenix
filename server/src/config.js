const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const config = {
  env: process.env.NODE_ENV || 'production',
  port: parseInt(process.env.PORT || '9300', 10),
  host: process.env.HOST || '0.0.0.0',

  jwt: {
    secret: process.env.JWT_SECRET || 'fallback_secret_must_change_in_production_32chars!',
    expiresIn: parseInt(process.env.JWT_EXPIRES_IN || '86400', 10), // 24h
    refreshExpiresIn: parseInt(process.env.REFRESH_TOKEN_EXPIRES_IN || '604800', 10), // 7d
  },

  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    passwordHash: process.env.ADMIN_PASSWORD_HASH || '10af59554a0a0c473f21084a33a4b292444c70453059a5e6f29c87fdb216e698.4fc627281c956916c9cb0fd05832d523',
  },

  database: {
    path: path.resolve(__dirname, '..', process.env.DATABASE_PATH || './data/phoenix.db'),
  },

  central: {
    url: process.env.CENTRAL_MANAGEMENT_URL || 'https://adminvpn.jcdev.top',
    nodeSecret: process.env.NODE_SECRET || 'phoenix-node-secret-key',
    autoSyncEnabled: process.env.CENTRAL_AUTO_SYNC === 'true',
  },

  wireguard: {
    interface: process.env.WIREGUARD_INTERFACE || 'wg0',
    port: parseInt(process.env.WIREGUARD_PORT || '51820', 10),
    vpnNetwork: process.env.VPN_NETWORK || '10.66.66.0/24',
    serverAddress: process.env.VPN_SERVER_ADDRESS || '10.66.66.1',
    endpoint: process.env.WIREGUARD_ENDPOINT || '212.132.119.66:51820',
    dns: process.env.WIREGUARD_DNS || '1.1.1.1, 8.8.8.8',
    configPath: process.env.WIREGUARD_CONFIG_PATH || '/etc/wireguard/wg0.conf',
  }
};

module.exports = config;
