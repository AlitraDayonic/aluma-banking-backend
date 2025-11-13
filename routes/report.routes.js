// routes/report.routes.js
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

router.get('/statements', authenticate, asyncHandler(async (req, res) => {
  res.json({ success: true, data: { statements: [] } });
}));

router.get('/confirmations', authenticate, asyncHandler(async (req, res) => {
  res.json({ success: true, data: { confirmations: [] } });
}));

router.get('/tax-documents', authenticate, asyncHandler(async (req, res) => {
  res.json({ success: true, data: { taxDocuments: [] } });
}));

module.exports = router;