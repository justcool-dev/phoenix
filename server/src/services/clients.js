const crypto = require('crypto');
const db = require('../db/database');
const config = require('../config');
const wireguardService = require('./wireguard');
const logger = require('../logger');

class ClientService {
  /**
   * Calculates next available IP address in the configured VPN subnet range.
   * Default network: 10.66.66.0/24. Server is 10.66.66.1.
   */
  getNextAvailableIp() {
    const existingClients = db.prepare('SELECT address FROM clients').all();
    const usedOctets = new Set();

    // Reserve .0 (network), .1 (server), .255 (broadcast)
    usedOctets.add(0);
    usedOctets.add(1);
    usedOctets.add(255);

    existingClients.forEach(row => {
      if (row.address) {
        const cleanIp = row.address.split('/')[0];
        const parts = cleanIp.split('.');
        if (parts.length === 4) {
          usedOctets.add(parseInt(parts[3], 10));
        }
      }
    });

    for (let i = 2; i < 255; i++) {
      if (!usedOctets.has(i)) {
        return `10.66.66.${i}/32`;
      }
    }

    throw new Error('VPN subnet IP pool exhausted. No available IPv4 addresses remaining.');
  }

  /**
   * Retrieves list of all clients, enriched with live status metrics from WireGuard.
   */
  async getAllClients() {
    const clients = db.prepare('SELECT * FROM clients ORDER BY created_at DESC').all();

    // Fetch live statistics from WireGuard runtime dump
    let dumpPeers = [];
    try {
      const dump = await wireguardService.getDumpStatus();
      dumpPeers = dump.peers || [];
    } catch (e) {
      logger.warn('Failed to fetch WireGuard dump status for client list');
    }

    const peerMap = new Map();
    dumpPeers.forEach(p => peerMap.set(p.publicKey, p));

    return clients.map(client => {
      const livePeer = peerMap.get(client.public_key);
      return {
        id: client.id,
        name: client.name,
        address: client.address,
        publicKey: client.public_key,
        enabled: Boolean(client.enabled),
        createdAt: client.created_at,
        lastHandshake: livePeer && livePeer.latestHandshake ? new Date(livePeer.latestHandshake * 1000).toISOString() : client.last_handshake,
        bytesReceived: livePeer ? livePeer.transferRx : client.bytes_received,
        bytesSent: livePeer ? livePeer.transferTx : client.bytes_sent,
        endpoint: livePeer ? livePeer.endpoint : null,
      };
    });
  }

  /**
   * Get single client by ID
   */
  async getClientById(id) {
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
    if (!client) return null;

    let livePeer = null;
    try {
      const dump = await wireguardService.getDumpStatus();
      livePeer = (dump.peers || []).find(p => p.publicKey === client.public_key);
    } catch (e) {
      logger.warn(`Failed to fetch dump for client ${id}`);
    }

    return {
      id: client.id,
      name: client.name,
      address: client.address,
      publicKey: client.public_key,
      enabled: Boolean(client.enabled),
      createdAt: client.created_at,
      lastHandshake: livePeer && livePeer.latestHandshake ? new Date(livePeer.latestHandshake * 1000).toISOString() : client.last_handshake,
      bytesReceived: livePeer ? livePeer.transferRx : client.bytes_received,
      bytesSent: livePeer ? livePeer.transferTx : client.bytes_sent,
    };
  }

  /**
   * Creates a new client peer and registers it in database and live WireGuard kernel table.
   * Client provides their generated Public Key.
   */
  async createClient({ name, publicKey, userId }) {
    if (!name || name.trim().length === 0) {
      throw new Error('Client name is required');
    }
    if (!wireguardService.isValidPublicKey(publicKey)) {
      throw new Error('Invalid WireGuard public key format provided');
    }

    // Check if public key already exists
    const existing = db.prepare('SELECT id FROM clients WHERE public_key = ?').get(publicKey);
    if (existing) {
      throw new Error('A client with this WireGuard public key already exists');
    }

    const clientId = crypto.randomUUID();
    const assignedAddress = this.getNextAvailableIp();

    // Register in DB
    db.prepare(`
      INSERT INTO clients (id, name, public_key, address, user_id, enabled)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(clientId, name.trim(), publicKey.trim(), assignedAddress, userId || null);

    // Apply live peer to WireGuard
    try {
      await wireguardService.addPeer(publicKey.trim(), assignedAddress);
    } catch (err) {
      logger.error(`Failed to apply peer to WireGuard interface: ${err.message}`);
      // Rollback database insertion if wireguard addition failed
      db.prepare('DELETE FROM clients WHERE id = ?').run(clientId);
      throw new Error(`WireGuard peer activation failed: ${err.message}`);
    }

    const serverPublicKey = await wireguardService.getServerPublicKey();

    // Log audit event
    db.prepare(`
      INSERT INTO audit_logs (event, user_id, details)
      VALUES ('client_created', ?, ?)
    `).run(userId || null, `Created client ${name} (${assignedAddress})`);

    return {
      id: clientId,
      name: name.trim(),
      address: assignedAddress,
      publicKey: publicKey.trim(),
      serverPublicKey: serverPublicKey,
      serverEndpoint: config.wireguard.endpoint,
      dns: config.wireguard.dns,
    };
  }

  /**
   * Deletes a client by ID.
   */
  async deleteClient(id, userId) {
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
    if (!client) {
      throw new Error('Client not found');
    }

    // Remove from WireGuard
    try {
      await wireguardService.removePeer(client.public_key);
    } catch (err) {
      logger.warn(`Could not remove peer from live wg interface: ${err.message}`);
    }

    // Delete from DB
    db.prepare('DELETE FROM clients WHERE id = ?').run(id);

    db.prepare(`
      INSERT INTO audit_logs (event, user_id, details)
      VALUES ('client_deleted', ?, ?)
    `).run(userId || null, `Deleted client ${client.name} (${client.address})`);

    return { success: true, id };
  }

  /**
   * Get Configuration details for client
   */
  async getClientConfigDetails(id) {
    const client = await this.getClientById(id);
    if (!client) {
      throw new Error('Client not found');
    }
    const serverPublicKey = await wireguardService.getServerPublicKey();

    return {
      address: client.address.endsWith('/32') ? client.address.replace('/32', '/24') : client.address,
      dns: config.wireguard.dns,
      serverPublicKey: serverPublicKey,
      endpoint: config.wireguard.endpoint,
      persistentKeepalive: 25,
    };
  }
}

module.exports = new ClientService();
