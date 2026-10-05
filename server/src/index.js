const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const logger = require('./logger');
const { apiLimiter } = require('./middleware/rateLimiter');

// Import routes
const authRoutes = require('./routes/auth');
const serverRoutes = require('./routes/server');
const vpnRoutes = require('./routes/vpn');
const clientRoutes = require('./routes/clients');
const centralRoutes = require('./routes/central');
const centralSyncService = require('./services/centralSync');

const app = express();

// Trust reverse proxy (Nginx / Plesk)
app.set('trust proxy', 1);

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static public folder for Admin Web Dashboard
const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));

// Web Admin Dashboard shortcut
app.get('/admin', (req, res) => {
  res.sendFile(path.join(publicPath, 'admin', 'index.html'));
});

// Global API Rate Limiting
app.use('/api', apiLimiter);

// Register API Routes
app.use('/api/auth', authRoutes);
app.use('/api/server', serverRoutes);
app.use('/api/vpn', vpnRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/central', centralRoutes);

// Root API route
app.get('/api', (req, res) => {
  res.json({ name: 'Phoenix VPN API Server', version: '1.0.0', status: 'online' });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint or page not found' });
});

// Global Error Handler
app.use((err, req, res, next) => {
  logger.error('Unhandled Server Error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Start Server
if (require.main === module) {
  app.listen(config.port, config.host, () => {
    logger.info(`Phoenix API Server listening on http://${config.host}:${config.port}`);
    logger.info(`Web Admin Dashboard available at http://${config.host}:${config.port}/admin`);
    logger.info(`Centralized Management node target: ${config.central.url}`);

    if (config.central.autoSyncEnabled) {
      setInterval(() => centralSyncService.sendHeartbeat(), 60000);
      centralSyncService.sendHeartbeat();
    }
  });
}

module.exports = app;
