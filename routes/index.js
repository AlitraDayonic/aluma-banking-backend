const express = require('express');
const router = express.Router();

// Import route modules
const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');
const kycRoutes = require('./kyc.routes');
const accountRoutes = require('./account.routes');
const tradingRoutes = require('./trading.routes');
const marketRoutes = require('./market.routes');
const fundingRoutes = require('./funding.routes');
const watchlistRoutes = require('./watchlist.routes');
const reportRoutes = require('./report.routes');
const alertRoutes = require('./alert.routes');
const supportRoutes = require('./support.routes');
const adminRoutes = require('./admin.routes');
const notificationRoutes = require('./notification.routes');
// API Info
router.get('/', (req, res) => {
  res.json({
    message: 'Aluma Banking Broker API v1',
    version: '1.0.0',
    endpoints: {
      auth: '/api/v1/auth',
      users: '/api/v1/users',
      kyc: '/api/v1/kyc',
      accounts: '/api/v1/accounts',
      trading: '/api/v1/trading',
      market: '/api/v1/market',
      funding: '/api/v1/funding',
      watchlists: '/api/v1/watchlists',
      reports: '/api/v1/reports',
      alerts: '/api/v1/alerts',
      support: '/api/v1/support',
      admin: '/api/v1/admin'
    }
  });
});

// Mount routes
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/kyc', kycRoutes);
router.use('/accounts', accountRoutes);
router.use('/trading', tradingRoutes);
router.use('/market', marketRoutes);
router.use('/funding', fundingRoutes);
router.use('/watchlists', watchlistRoutes);
router.use('/reports', reportRoutes);
router.use('/alerts', alertRoutes);
router.use('/support', supportRoutes);
router.use('/admin', adminRoutes);
router.use('/notifications', notificationRoutes);
module.exports = router;