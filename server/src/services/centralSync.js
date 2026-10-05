const os = require('os');
const config = require('../config');
const logger = require('../logger');
const wireguardService = require('./wireguard');
const clientService = require('./clients');
const db = require('../db/database');

class CentralSyncService {
  constructor() {
    this.centralUrl = config.central.url;
    this.nodeSecret = config.central.nodeSecret;
  }

  /**
   * Get node telemetry metrics for central dashboard
   */
  async getNodeTelemetry() {
    const clients = await clientService.getAllClients();
    const wgStatus = await wireguardService.getStatus();
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    return {
      nodeName: os.hostname(),
      apiPort: config.port,
      centralServer: this.centralUrl,
      nodeEndpoint: config.wireguard.endpoint,
      system: {
        platform: os.platform(),
        uptimeSeconds: Math.floor(os.uptime()),
        cpuCount: cpus.length,
        memTotalMb: Math.round(totalMem / (1024 * 1024)),
        memFreeMb: Math.round(freeMem / (1024 * 1024)),
        memUsagePercent: Math.round(((totalMem - freeMem) / totalMem) * 100),
      },
      vpn: {
        interface: config.wireguard.interface,
        serverAddress: config.wireguard.serverAddress,
        network: config.wireguard.vpnNetwork,
        totalProvisionedClients: clients.length,
        activeWireGuardPeers: wgStatus.activePeersCount || 0,
        interfaceActive: wgStatus.interfaceActive,
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Send heartbeat telemetry to central master server (e.g. adminvpn.jcdev.top)
   */
  async sendHeartbeat() {
    if (!this.centralUrl) return;

    try {
      const telemetry = await this.getNodeTelemetry();
      const url = `${this.centralUrl.replace(/\/+$/, '')}/api/nodes/heartbeat`;

      const httpLib = url.startsWith('https') ? require('https') : require('http');
      const parsedUrl = new URL(url);

      const postData = JSON.stringify(telemetry);
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (url.startsWith('https') ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'X-Central-Token': this.nodeSecret,
        },
        timeout: 5000,
      };

      const req = httpLib.request(options, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          logger.info(`Successfully posted telemetry heartbeat to central server: ${this.centralUrl}`);
        } else {
          logger.warn(`Central server returned status ${res.statusCode} on heartbeat`);
        }
      });

      req.on('error', (err) => {
        logger.warn(`Notice: Central server unreachable at ${this.centralUrl}: ${err.message}`);
      });

      req.write(postData);
      req.end();
    } catch (e) {
      logger.warn(`Central sync heartbeat notice: ${e.message}`);
    }
  }

  /**
   * Synchronize remote user payload into local sqlite database
   */
  async syncUsersFromCentral(usersPayload) {
    if (!Array.isArray(usersPayload)) {
      throw new Error('usersPayload must be an array');
    }

    const stmt = db.prepare(`
      INSERT INTO users (username, password_hash, role)
      VALUES (@username, @password_hash, @role)
      ON CONFLICT(username) DO UPDATE SET
        password_hash = excluded.password_hash,
        role = excluded.role
    `);

    const transaction = db.transaction((users) => {
      let count = 0;
      for (const u of users) {
        stmt.run({
          username: u.username,
          password_hash: u.passwordHash || u.password_hash,
          role: u.role || 'user',
        });
        count++;
      }
      return count;
    });

    const syncedCount = transaction(usersPayload);
    logger.info(`Synchronized ${syncedCount} users from central master server.`);
    return { syncedCount };
  }
}

module.exports = new CentralSyncService();
