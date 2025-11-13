// ============================================
// routes/watchlist.routes.js
// ============================================
const express7 = require('express');
const router7 = express7.Router();
const { authenticate: auth7 } = require('../middleware/auth');
const { query } = require('../config/database');
const { asyncHandler: asyncH7 } = require('../middleware/errorHandler');

router7.get('/', auth7, asyncH7(async (req, res) => {
  const result = await query(`
    SELECT w.*, 
      (SELECT COUNT(*) FROM watchlist_items WHERE watchlist_id = w.id) as items_count
    FROM watchlists w
    WHERE w.user_id = $1
    ORDER BY w.is_default DESC, w.created_at DESC
  `, [req.user.id]);
  
  res.json({ success: true, data: { watchlists: result.rows } });
}));

router7.post('/', auth7, asyncH7(async (req, res) => {
  const { name, description } = req.body;
  const result = await query(`
    INSERT INTO watchlists (user_id, name, description)
    VALUES ($1, $2, $3)
    RETURNING *
  `, [req.user.id, name, description]);
  
  res.status(201).json({ success: true, data: { watchlist: result.rows[0] } });
}));

router7.get('/:id/items', auth7, asyncH7(async (req, res) => {
  const result = await query(`
    SELECT wi.*, s.symbol, s.name, s.last_price, s.change_percent
    FROM watchlist_items wi
    INNER JOIN securities s ON wi.security_id = s.id
    INNER JOIN watchlists w ON wi.watchlist_id = w.id
    WHERE wi.watchlist_id = $1 AND w.user_id = $2
    ORDER BY wi.added_at DESC
  `, [req.params.id, req.user.id]);
  
  res.json({ success: true, data: { items: result.rows } });
}));

router7.post('/:id/items', auth7, asyncH7(async (req, res) => {
  const { symbol } = req.body;
  
  // Get or create security
  let security = await query('SELECT id FROM securities WHERE symbol = $1', [symbol.toUpperCase()]);
  if (security.rows.length === 0) {
    const marketData = require('../services/marketData.service');
    const quote = await marketData.getQuote(symbol);
    security = await query(`
      INSERT INTO securities (symbol, name, last_price)
      VALUES ($1, $2, $3)
      RETURNING id
    `, [quote.symbol, quote.symbol, quote.price]);
  }
  
  const result = await query(`
    INSERT INTO watchlist_items (watchlist_id, security_id)
    VALUES ($1, $2)
    ON CONFLICT DO NOTHING
    RETURNING *
  `, [req.params.id, security.rows[0].id]);
  
  res.status(201).json({ success: true, data: { item: result.rows[0] } });
}));

router7.delete('/:id/items/:symbol', auth7, asyncH7(async (req, res) => {
  await query(`
    DELETE FROM watchlist_items wi
    USING securities s, watchlists w
    WHERE wi.security_id = s.id 
      AND wi.watchlist_id = w.id
      AND wi.watchlist_id = $1 
      AND s.symbol = $2 
      AND w.user_id = $3
  `, [req.params.id, req.params.symbol.toUpperCase(), req.user.id]);
  
  res.json({ success: true, message: 'Item removed from watchlist' });
}));

module.exports = router7;

