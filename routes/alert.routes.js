// ============================================
// routes/alert.routes.js
// ============================================
const express8 = require('express');
const router8 = express8.Router();
const { authenticate: auth8 } = require('../middleware/auth');
const { query: query8 } = require('../config/database');
const { asyncHandler: asyncH8 } = require('../middleware/errorHandler');

router8.get('/', auth8, asyncH8(async (req, res) => {
  const result = await query8(`
    SELECT a.*, s.symbol, s.name, s.last_price
    FROM price_alerts a
    INNER JOIN securities s ON a.security_id = s.id
    WHERE a.user_id = $1 AND a.status = 'active'
    ORDER BY a.created_at DESC
  `, [req.user.id]);
  
  res.json({ success: true, data: { alerts: result.rows } });
}));

router8.post('/', auth8, asyncH8(async (req, res) => {
  const { symbol, condition, targetPrice, notifyEmail, notifySms } = req.body;
  
  const security = await query8('SELECT id FROM securities WHERE symbol = $1', [symbol.toUpperCase()]);
  if (security.rows.length === 0) {
    return res.status(404).json({ success: false, message: 'Security not found' });
  }
  
  const result = await query8(`
    INSERT INTO price_alerts (user_id, security_id, condition, target_price, notify_email, notify_sms)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [req.user.id, security.rows[0].id, condition, targetPrice, notifyEmail, notifySms]);
  
  res.status(201).json({ success: true, data: { alert: result.rows[0] } });
}));

router8.delete('/:id', auth8, asyncH8(async (req, res) => {
  await query8(`
    UPDATE price_alerts
    SET status = 'cancelled'
    WHERE id = $1 AND user_id = $2
  `, [req.params.id, req.user.id]);
  
  res.json({ success: true, message: 'Alert cancelled' });
}));

module.exports = router8;