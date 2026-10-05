const express = require('express');
const { z } = require('zod');
const db = require('../db/database');
const { hashPassword, verifyPassword, generateTokens, refreshAccessToken, revokeRefreshToken } = require('../auth/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const { authMiddleware } = require('../middleware/auth');
const logger = require('../logger');

const router = express.Router();

const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

const registerSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters').max(32, 'Username too long'),
  password: z.string().min(4, 'Password must be at least 4 characters'),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

/**
 * POST /api/auth/login
 */
router.post('/login', authLimiter, (req, res) => {
  const result = loginSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: 'Invalid input', details: result.error.errors });
  }

  const { username, password } = result.data;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (!user || !verifyPassword(password, user.password_hash)) {
    logger.warn(`Failed login attempt for username: ${username}`);
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const tokens = generateTokens(user);

  db.prepare(`
    INSERT INTO audit_logs (event, user_id, ip_address, details)
    VALUES ('login_success', ?, ?, 'User authenticated successfully')
  `).run(user.id, req.ip);

  logger.info(`User authenticated: ${user.username}`);
  return res.json({
    token: tokens.token,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
    }
  });
});

/**
 * POST /api/auth/register
 */
router.post('/register', authLimiter, (req, res) => {
  const result = registerSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: 'Invalid registration input', details: result.error.errors });
  }

  const { username, password } = result.data;
  const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);

  if (existingUser) {
    return res.status(400).json({ error: 'Username already exists. Please choose another.' });
  }

  const passwordHash = hashPassword(password);
  const info = db.prepare(`
    INSERT INTO users (username, password_hash, role)
    VALUES (?, ?, 'user')
  `).run(username, passwordHash);

  const newUser = {
    id: info.lastInsertRowid,
    username: username,
    role: 'user',
  };

  const tokens = generateTokens(newUser);

  logger.info(`New user registered: ${username}`);
  return res.status(201).json({
    token: tokens.token,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    user: newUser,
  });
});

/**
 * POST /api/auth/refresh
 */
router.post('/refresh', (req, res) => {
  const result = refreshSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: 'Invalid refresh request' });
  }

  const newTokens = refreshAccessToken(result.data.refreshToken);
  if (!newTokens) {
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }

  return res.json(newTokens);
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    revokeRefreshToken(refreshToken);
  }
  return res.json({ message: 'Logged out successfully' });
});

/**
 * GET /api/auth/me
 */
router.get('/me', authMiddleware, (req, res) => {
  return res.json({ user: req.user });
});

module.exports = router;
