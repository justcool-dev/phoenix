const express = require('express');
const config = require('../config');

const router = express.Router();

/**
 * GET /api/server/health
 * Public health check endpoint
 */
router.get('/health', (req, res) => {
  return res.json({
    status: 'ok',
    service: 'phoenix-api',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/server/info
 * Public server endpoint metadata
 */
router.get('/info', (req, res) => {
  return res.json({
    serverName: config.serverName,
    locationName: config.locationName,
    countryFlag: config.countryFlag,
    vpnEndpoint: config.wireguard.endpoint,
    vpnPort: config.wireguard.port,
    serverAddress: config.wireguard.serverAddress,
    network: config.wireguard.vpnNetwork,
    dns: config.wireguard.dns,
  });
});

module.exports = router;
