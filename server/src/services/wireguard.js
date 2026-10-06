const { execFile, exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const config = require('../config');
const logger = require('../logger');

const execFileAsync = util.promisify(execFile);
const execAsync = util.promisify(exec);

// Strict Regex Validations
const BASE64_KEY_REGEX = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;
const IPV4_SINGLE_REGEX = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
const IPV4_CIDR_REGEX = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\/([0-9]|[1-2][0-9]|3[0-2])$/;

function getWgBinaryPath() {
  if (process.platform !== 'linux') return 'wg';
  if (fs.existsSync('/usr/bin/wg')) return '/usr/bin/wg';
  if (fs.existsSync('/usr/sbin/wg')) return '/usr/sbin/wg';
  return 'wg';
}

class WireGuardService {
  constructor() {
    this.interfaceName = config.wireguard.interface;
    this.configPath = config.wireguard.configPath;
  }

  /**
   * Validates Base64 WireGuard key string format.
   */
  isValidPublicKey(key) {
    return typeof key === 'string' && BASE64_KEY_REGEX.test(key.trim());
  }

  /**
   * Validates IPv4 single or CIDR address format.
   */
  isValidIP(ip) {
    if (typeof ip !== 'string') return false;
    return IPV4_CIDR_REGEX.test(ip.trim()) || IPV4_SINGLE_REGEX.test(ip.trim());
  }

  /**
   * Executes a command using sudo if required, passing safe arguments array.
   */
  async runWgCommand(args) {
    try {
      // In production environment on Linux, wg commands require root or sudo access.
      const isLinux = process.platform === 'linux';
      const cmd = isLinux ? 'sudo' : 'wg';
      const wgBin = getWgBinaryPath();
      const cmdArgs = isLinux ? [wgBin, ...args] : args;

      const { stdout, stderr } = await execFileAsync(cmd, cmdArgs);
      if (stderr && stderr.trim().length > 0) {
        logger.warn(`wg command stderr: ${stderr.trim()}`);
      }
      return stdout.trim();
    } catch (error) {
      logger.error(`Error running wg command [args: ${args.join(' ')}]:`, error);
      throw new Error(`WireGuard command execution failed: ${error.message}`);
    }
  }

  /**
   * Obtains the WireGuard server public key.
   * If wg command is not available, reads/generates from config or simulated mock key in test mode.
   */
  async getServerPublicKey() {
    try {
      const output = await this.runWgCommand(['show', this.interfaceName, 'public-key']);
      if (output && this.isValidPublicKey(output)) {
        return output;
      }
    } catch (err) {
      logger.warn(`Could not read server public key via wg show: ${err.message}. Checking config file.`);
    }

    // Fallback: Read from wg0.conf or return fallback key if mock environment
    if (fs.existsSync(this.configPath)) {
      const content = fs.readFileSync(this.configPath, 'utf8');
      const match = content.match(/PrivateKey\s*=\s*(.+)/i);
      if (match && match[1]) {
        try {
          const pubKey = await this.getPublicKeyFromPrivate(match[1].trim());
          return pubKey;
        } catch (e) {
          logger.error('Failed to compute public key from private key in config');
        }
      }
    }

    // Default static public key representation if interface not started yet
    return 'SERVER_WG_PUBLIC_KEY_PLACEHOLDER_44_CHARS=';
  }

  /**
   * Computes public key from a given private key.
   */
  async getPublicKeyFromPrivate(privateKey) {
    if (!privateKey || privateKey.trim().length === 0) {
      throw new Error('Private key cannot be empty');
    }
    const isLinux = process.platform === 'linux';
    const cmd = isLinux ? 'sudo' : 'wg';
    const wgBin = getWgBinaryPath();
    const cmdArgs = isLinux ? [wgBin, 'pubkey'] : ['pubkey'];

    return new Promise((resolve, reject) => {
      const child = execFile(cmd, cmdArgs, (err, stdout, stderr) => {
        if (err) return reject(err);
        resolve(stdout.trim());
      });
      child.stdin.write(privateKey);
      child.stdin.end();
    });
  }

  /**
   * Adds a peer to the live WireGuard interface.
   * Command: sudo wg set wg0 peer <public_key> allowed-ips <allowed_ip>
   */
  async addPeer(publicKey, allowedIP) {
    if (!this.isValidPublicKey(publicKey)) {
      throw new Error(`Invalid WireGuard public key format: ${publicKey}`);
    }
    if (!this.isValidIP(allowedIP)) {
      throw new Error(`Invalid IP format: ${allowedIP}`);
    }

    const ipWithCidr = allowedIP.includes('/') ? allowedIP : `${allowedIP}/32`;
    logger.info(`Adding WireGuard peer: key=${publicKey}, ip=${ipWithCidr}`);

    await this.runWgCommand(['set', this.interfaceName, 'peer', publicKey, 'allowed-ips', ipWithCidr]);
    return true;
  }

  /**
   * Removes a peer from the live WireGuard interface.
   * Command: sudo wg set wg0 peer <public_key> remove
   */
  async removePeer(publicKey) {
    if (!this.isValidPublicKey(publicKey)) {
      throw new Error(`Invalid WireGuard public key format: ${publicKey}`);
    }

    logger.info(`Removing WireGuard peer: key=${publicKey}`);
    await this.runWgCommand(['set', this.interfaceName, 'peer', publicKey, 'remove']);
    return true;
  }

  /**
   * Parses output of `wg show wg0 dump` to retrieve runtime peer metrics.
   * Format of dump line:
   * public-key, preshared-key, endpoint, allowed-ips, latest-handshake, transfer-rx, transfer-tx, persistent-keepalive
   */
  async getDumpStatus() {
    try {
      const dumpOutput = await this.runWgCommand(['show', this.interfaceName, 'dump']);
      const lines = dumpOutput.split('\n').map(l => l.trim()).filter(l => l.length > 0);

      const peers = [];
      let interfaceInfo = null;

      lines.forEach((line, index) => {
        const parts = line.split('\t');
        if (index === 0) {
          // Interface header line: private-key, public-key, listen-port, fwmark
          interfaceInfo = {
            publicKey: parts[1] || '',
            listenPort: parseInt(parts[2] || '9301', 10),
          };
        } else if (parts.length >= 7) {
          // Peer line
          peers.push({
            publicKey: parts[0],
            presharedKey: parts[1],
            endpoint: parts[2] !== '(none)' ? parts[2] : null,
            allowedIPs: parts[3],
            latestHandshake: parseInt(parts[4] || '0', 10),
            transferRx: parseInt(parts[5] || '0', 10),
            transferTx: parseInt(parts[6] || '0', 10),
            persistentKeepalive: parts[7] || 'off',
          });
        }
      });

      return { interfaceInfo, peers };
    } catch (err) {
      logger.warn(`Failed to fetch WireGuard dump status: ${err.message}`);
      return { interfaceInfo: { listenPort: config.wireguard.port }, peers: [] };
    }
  }

  /**
   * Reloads / syncs WireGuard interface configuration.
   */
  async reloadInterface() {
    try {
      if (process.platform === 'linux') {
        await execAsync(`sudo systemctl reload wg-quick@${this.interfaceName}`);
      }
      return { success: true, message: 'Interface reloaded successfully' };
    } catch (err) {
      logger.error(`Failed to reload wg interface: ${err.message}`);
      throw new Error(`Failed to reload interface: ${err.message}`);
    }
  }
}

module.exports = new WireGuardService();
