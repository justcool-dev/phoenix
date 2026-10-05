const express = require('express');
const { z } = require('zod');
const { authMiddleware, optionalAuthMiddleware } = require('../middleware/auth');
const { clientCreationLimiter } = require('../middleware/rateLimiter');
const clientService = require('../services/clients');
const logger = require('../logger');

const router = express.Router();

const createClientSchema = z.object({
  name: z.string().min(1, 'Client name is required').max(64, 'Client name too long'),
  publicKey: z.string().min(1, 'Public key is required'),
});

/**
 * GET /api/clients
 * Requires Admin / User Authentication
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const clients = await clientService.getAllClients();
    return res.json({ clients });
  } catch (err) {
    logger.error(`Error listing clients: ${err.message}`);
    return res.status(500).json({ error: 'Failed to retrieve clients list' });
  }
});

/**
 * POST /api/clients
 * Device registration (Optional auth: associates userId if token is provided)
 */
router.post('/', clientCreationLimiter, optionalAuthMiddleware, async (req, res) => {
  const parseResult = createClientSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Invalid client parameters', details: parseResult.error.errors });
  }

  try {
    const userId = req.user ? req.user.sub : null;
    const newClient = await clientService.createClient({
      name: parseResult.data.name,
      publicKey: parseResult.data.publicKey,
      userId: userId,
    });
    return res.status(201).json(newClient);
  } catch (err) {
    logger.error(`Error creating client: ${err.message}`);
    return res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/clients/:id/config
 * Configuration retrieval for existing client ID
 */
router.get('/:id/config', optionalAuthMiddleware, async (req, res) => {
  try {
    const configDetails = await clientService.getClientConfigDetails(req.params.id);
    return res.json(configDetails);
  } catch (err) {
    logger.error(`Error fetching config for client ${req.params.id}: ${err.message}`);
    return res.status(404).json({ error: err.message });
  }
});

/**
 * GET /api/clients/:id
 * Admin details view
 */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const client = await clientService.getClientById(req.params.id);
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    return res.json(client);
  } catch (err) {
    logger.error(`Error fetching client ${req.params.id}: ${err.message}`);
    return res.status(500).json({ error: 'Failed to retrieve client details' });
  }
});

/**
 * DELETE /api/clients/:id
 * Admin client deletion
 */
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const userId = req.user ? req.user.sub : null;
    const result = await clientService.deleteClient(req.params.id, userId);
    return res.json(result);
  } catch (err) {
    logger.error(`Error deleting client ${req.params.id}: ${err.message}`);
    return res.status(400).json({ error: err.message });
  }
});

module.exports = router;
