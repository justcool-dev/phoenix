const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db/database');

/**
 * Hashes a plaintext password using native crypto.scryptSync with salt.
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${derivedKey}.${salt}`;
}

/**
 * Verifies a plaintext password against a stored derivedKey.salt hash.
 */
function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes('.')) {
    return false;
  }
  const [key, salt] = storedHash.split('.');
  const keyBuffer = Buffer.from(key, 'hex');
  const derivedKey = crypto.scryptSync(password, salt, 32);
  if (keyBuffer.length !== derivedKey.length) {
    return false;
  }
  return crypto.timingSafeEqual(keyBuffer, derivedKey);
}

/**
 * Generates JWT access token and refresh token for a user.
 */
function generateTokens(user) {
  const payload = {
    sub: user.id,
    username: user.username,
    role: user.role,
  };

  const accessToken = jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });

  const refreshToken = crypto.randomBytes(40).toString('hex');
  const sessionExp = new Date(Date.now() + config.jwt.refreshExpiresIn * 1000).toISOString();
  const sessionId = crypto.randomUUID();

  db.prepare(`
    INSERT INTO sessions (id, user_id, refresh_token, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(sessionId, user.id, refreshToken, sessionExp);

  return {
    token: accessToken,
    refreshToken: refreshToken,
    expiresIn: config.jwt.expiresIn,
  };
}

/**
 * Verifies JWT token.
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwt.secret);
  } catch (err) {
    return null;
  }
}

/**
 * Refresh access token using valid refresh token.
 */
function refreshAccessToken(refreshToken) {
  const session = db.prepare(`
    SELECT s.*, u.id as user_id, u.username, u.role
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.refresh_token = ? AND datetime(s.expires_at) > datetime('now')
  `).get(refreshToken);

  if (!session) {
    return null;
  }

  // Delete used refresh token
  db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);

  // Generate new token pair
  return generateTokens({
    id: session.user_id,
    username: session.username,
    role: session.role,
  });
}

/**
 * Revokes a session / refresh token.
 */
function revokeRefreshToken(refreshToken) {
  return db.prepare('DELETE FROM sessions WHERE refresh_token = ?').run(refreshToken);
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateTokens,
  verifyToken,
  refreshAccessToken,
  revokeRefreshToken,
};
