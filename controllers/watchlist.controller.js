// ============================================
// controllers/watchlist.controller.js
// ============================================

const { pool } = require('../config/database');
const logger = require('../utils/logger');

// Get all watchlists for user
exports.getUserWatchlists = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT w.*, 
        (SELECT COUNT(*) FROM watchlist_items WHERE watchlist_id = w.id) as item_count
       FROM watchlists w
       WHERE w.user_id = $1
       ORDER BY w.is_default DESC, w.created_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    logger.error('Error fetching watchlists:', error);
    next(error);
  }
};

// Get watchlist by ID with items
exports.getWatchlistById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Get watchlist
    const watchlistResult = await pool.query(
      'SELECT * FROM watchlists WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (watchlistResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Watchlist not found'
      });
    }

    // Get watchlist items with security details
    const itemsResult = await pool.query(
      `SELECT wi.*, s.symbol, s.name, s.last_price, s.change_amount, 
              s.change_percent, s.volume, s.market_cap
       FROM watchlist_items wi
       INNER JOIN securities s ON wi.security_id = s.id
       WHERE wi.watchlist_id = $1
       ORDER BY wi.added_at DESC`,
      [id]
    );

    res.json({
      success: true,
      data: {
        ...watchlistResult.rows[0],
        items: itemsResult.rows
      }
    });
  } catch (error) {
    logger.error('Error fetching watchlist:', error);
    next(error);
  }
};

// Create new watchlist
exports.createWatchlist = async (req, res, next) => {
  try {
    const { name, description, is_default } = req.body;
    const userId = req.user.id;

    // If setting as default, unset other defaults
    if (is_default) {
      await pool.query(
        'UPDATE watchlists SET is_default = false WHERE user_id = $1',
        [userId]
      );
    }

    const result = await pool.query(
      `INSERT INTO watchlists (user_id, name, description, is_default)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, name, description || null, is_default || false]
    );

    logger.info('Watchlist created', { watchlistId: result.rows[0].id, userId });

    res.status(201).json({
      success: true,
      message: 'Watchlist created successfully',
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Error creating watchlist:', error);
    next(error);
  }
};

// Update watchlist
exports.updateWatchlist = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, is_default } = req.body;
    const userId = req.user.id;

    // Verify ownership
    const checkResult = await pool.query(
      'SELECT id FROM watchlists WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Watchlist not found'
      });
    }

    // If setting as default, unset other defaults
    if (is_default) {
      await pool.query(
        'UPDATE watchlists SET is_default = false WHERE user_id = $1 AND id != $2',
        [userId, id]
      );
    }

    const result = await pool.query(
      `UPDATE watchlists 
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           is_default = COALESCE($3, is_default),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 AND user_id = $5
       RETURNING *`,
      [name, description, is_default, id, userId]
    );

    res.json({
      success: true,
      message: 'Watchlist updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Error updating watchlist:', error);
    next(error);
  }
};

// Delete watchlist
exports.deleteWatchlist = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await pool.query(
      'DELETE FROM watchlists WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Watchlist not found'
      });
    }

    logger.info('Watchlist deleted', { watchlistId: id, userId });

    res.json({
      success: true,
      message: 'Watchlist deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting watchlist:', error);
    next(error);
  }
};

// Add security to watchlist
exports.addToWatchlist = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { security_id, notes } = req.body;
    const userId = req.user.id;

    // Verify watchlist ownership
    const watchlistCheck = await pool.query(
      'SELECT id FROM watchlists WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (watchlistCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Watchlist not found'
      });
    }

    // Check if security exists
    const securityCheck = await pool.query(
      'SELECT id, symbol, name FROM securities WHERE id = $1',
      [security_id]
    );

    if (securityCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Security not found'
      });
    }

    // Add to watchlist (ignore if already exists)
    const result = await pool.query(
      `INSERT INTO watchlist_items (watchlist_id, security_id, notes)
       VALUES ($1, $2, $3)
       ON CONFLICT (watchlist_id, security_id) DO NOTHING
       RETURNING *`,
      [id, security_id, notes || null]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Security already in watchlist'
      });
    }

    logger.info('Security added to watchlist', { 
      watchlistId: id, 
      securityId: security_id, 
      userId 
    });

    res.status(201).json({
      success: true,
      message: 'Security added to watchlist',
      data: {
        ...result.rows[0],
        security: securityCheck.rows[0]
      }
    });
  } catch (error) {
    logger.error('Error adding to watchlist:', error);
    next(error);
  }
};

// Remove security from watchlist
exports.removeFromWatchlist = async (req, res, next) => {
  try {
    const { id, itemId } = req.params;
    const userId = req.user.id;

    // Verify watchlist ownership
    const watchlistCheck = await pool.query(
      'SELECT id FROM watchlists WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (watchlistCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Watchlist not found'
      });
    }

    const result = await pool.query(
      'DELETE FROM watchlist_items WHERE id = $1 AND watchlist_id = $2 RETURNING *',
      [itemId, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Item not found in watchlist'
      });
    }

    logger.info('Security removed from watchlist', { 
      watchlistId: id, 
      itemId, 
      userId 
    });

    res.json({
      success: true,
      message: 'Security removed from watchlist'
    });
  } catch (error) {
    logger.error('Error removing from watchlist:', error);
    next(error);
  }
};

// Update watchlist item notes
exports.updateWatchlistItem = async (req, res, next) => {
  try {
    const { id, itemId } = req.params;
    const { notes } = req.body;
    const userId = req.user.id;

    // Verify watchlist ownership
    const watchlistCheck = await pool.query(
      'SELECT id FROM watchlists WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (watchlistCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Watchlist not found'
      });
    }

    const result = await pool.query(
      `UPDATE watchlist_items 
       SET notes = $1
       WHERE id = $2 AND watchlist_id = $3
       RETURNING *`,
      [notes, itemId, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Item not found in watchlist'
      });
    }

    res.json({
      success: true,
      message: 'Watchlist item updated',
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Error updating watchlist item:', error);
    next(error);
  }
};