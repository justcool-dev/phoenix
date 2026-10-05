const wireguardService = require('./wireguard');
const db = require('../db/database');
const logger = require('../logger');

class StatisticsService {
  async getVpnStatus() {
    let activePeers = 0;
    let totalRx = 0;
    let totalTx = 0;
    let isInterfaceUp = false;

    try {
      const dump = await wireguardService.getDumpStatus();
      if (dump.interfaceInfo) {
        isInterfaceUp = true;
      }
      const nowSec = Math.floor(Date.now() / 1000);
      (dump.peers || []).forEach(peer => {
        totalRx += peer.transferRx || 0;
        totalTx += peer.transferTx || 0;
        // Consider active if handshake was within 3 minutes (180 seconds)
        if (peer.latestHandshake && (nowSec - peer.latestHandshake) < 180) {
          activePeers++;
        }
      });
    } catch (err) {
      logger.warn(`Failed to read stats: ${err.message}`);
    }

    const clientCount = db.prepare('SELECT COUNT(*) as count FROM clients').get().count;

    return {
      status: isInterfaceUp ? 'active' : 'inactive',
      interface: wireguardService.interfaceName,
      totalClients: clientCount,
      activePeers: activePeers,
      totalRxBytes: totalRx,
      totalTxBytes: totalTx,
      timestamp: new Date().toISOString(),
    };
  }
}

module.exports = new StatisticsService();
