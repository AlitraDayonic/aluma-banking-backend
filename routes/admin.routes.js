// routes/admin.routes.js
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

router.get('/users', authenticate, asyncHandler(async (req, res) => {
  res.json({ success: true, data: { users: [] } });
}));

router.get('/kyc/pending', authenticate, asyncHandler(async (req, res) => {
  res.json({ success: true, data: { pending: [] } });
}));

module.exports = router;