const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const wireguardService = require('../services/wireguard');
const statisticsService = require('../services/statistics');
const config = require('../config');
const logger = require('../logger');

const router = express.Router();

// Apply auth middleware to all vpn endpoints
router.use(authMiddleware);

/**
 * GET /api/vpn/status
 */
router.get('/status', async (req, res) => {
  try {
    const stats = await statisticsService.getVpnStatus();
    return res.json(stats);
  } catch (err) {
    logger.error(`Error in /api/vpn/status: ${err.message}`);
    return res.status(500).json({ error: 'Failed to retrieve VPN status' });
  }
});

/**
 * GET /api/vpn/peers
 */
router.get('/peers', async (req, res) => {
  try {
    const dump = await wireguardService.getDumpStatus();
    return res.json({ peers: dump.peers });
  } catch (err) {
    logger.error(`Error in /api/vpn/peers: ${err.message}`);
    return res.status(500).json({ error: 'Failed to retrieve WireGuard peers' });
  }
});

/**
 * GET /api/vpn/server
 */
router.get('/server', async (req, res) => {
  try {
    const publicKey = await wireguardService.getServerPublicKey();
    return res.json({
      interface: config.wireguard.interface,
      publicKey: publicKey,
      endpoint: config.wireguard.endpoint,
      port: config.wireguard.port,
      network: config.wireguard.vpnNetwork,
      dns: config.wireguard.dns,
    });
  } catch (err) {
    logger.error(`Error in /api/vpn/server: ${err.message}`);
    return res.status(500).json({ error: 'Failed to retrieve WireGuard server details' });
  }
});

/**
 * POST /api/vpn/reload
 */
router.post('/reload', async (req, res) => {
  try {
    const result = await wireguardService.reloadInterface();
    return res.json(result);
  } catch (err) {
    logger.error(`Error in /api/vpn/reload: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
