// routes/support.routes.js
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

router.post('/tickets', authenticate, asyncHandler(async (req, res) => {
  res.json({ success: true, message: 'Ticket created' });
}));

router.get('/tickets', authenticate, asyncHandler(async (req, res) => {
  res.json({ success: true, data: { tickets: [] } });
}));

router.get('/tickets/:id', authenticate, asyncHandler(async (req, res) => {
  res.json({ success: true, data: { ticket: {} } });
}));

module.exports = router;