const express = require('express');
const config = require('../config');
const centralSyncService = require('../services/centralSync');
const clientService = require('../services/clients');
const logger = require('../logger');

const router = express.Router();

/**
 * Middleware: Verify Central Token
 */
function verifyCentralToken(req, res, next) {
  const token = req.headers['x-central-token'] || req.headers['authorization']?.replace(/^Bearer\s+/i, '');
  const expectedToken = config.central.nodeSecret;

  if (!token || token !== expectedToken) {
    return res.status(401).json({ error: 'Unauthorized Central Master Request: Invalid or missing X-Central-Token' });
  }
  next();
}

/**
 * GET /api/central/status
 * Central master server endpoint: Fetches node telemetry & status
 */
router.get('/status', verifyCentralToken, async (req, res) => {
  try {
    const telemetry = await centralSyncService.getNodeTelemetry();
    return res.json(telemetry);
  } catch (err) {
    logger.error(`Error building central status: ${err.message}`);
    return res.status(500).json({ error: 'Failed to generate node telemetry' });
  }
});

/**
 * GET /api/central/clients
 * Central master server endpoint: List all WireGuard clients provisioned on this node
 */
router.get('/clients', verifyCentralToken, async (req, res) => {
  try {
    const clients = await clientService.getAllClients();
    return res.json({ nodeEndpoint: config.wireguard.endpoint, clients });
  } catch (err) {
    logger.error(`Error listing central clients: ${err.message}`);
    return res.status(500).json({ error: 'Failed to list clients' });
  }
});

/**
 * POST /api/central/clients
 * Central master server endpoint: Provision a new client key remotely
 */
router.post('/clients', verifyCentralToken, async (req, res) => {
  const { name, publicKey, userId } = req.body;
  if (!name || !publicKey) {
    return res.status(400).json({ error: 'name and publicKey are required' });
  }

  try {
    const newClient = await clientService.createClient({ name, publicKey, userId });
    return res.status(201).json(newClient);
  } catch (err) {
    logger.error(`Error creating central client: ${err.message}`);
    return res.status(400).json({ error: err.message });
  }
});

/**
 * DELETE /api/central/clients/:id
 * Central master server endpoint: Revoke a client key remotely
 */
router.delete('/clients/:id', verifyCentralToken, async (req, res) => {
  try {
    const result = await clientService.deleteClient(req.params.id);
    return res.json(result);
  } catch (err) {
    logger.error(`Error deleting central client: ${err.message}`);
    return res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/central/sync-users
 * Central master server endpoint: Push user account sync payload to this node
 */
router.post('/sync-users', verifyCentralToken, async (req, res) => {
  const { users } = req.body;
  if (!Array.isArray(users)) {
    return res.status(400).json({ error: 'users array is required' });
  }

  try {
    const result = await centralSyncService.syncUsersFromCentral(users);
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error(`Error syncing users from central: ${err.message}`);
    return res.status(400).json({ error: err.message });
  }
});

module.exports = router;
