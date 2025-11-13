// ============================================
// controllers/alert.controller.js
// ============================================

const { pool } = require('../config/database');
const logger = require('../utils/logger');

// Get all alerts for user
exports.getUserAlerts = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { status, symbol } = req.query;

    let query = `
      SELECT pa.*, s.symbol, s.name, s.last_price
      FROM price_alerts pa
      INNER JOIN securities s ON pa.security_id = s.id
      WHERE pa.user_id = $1
    `;
    const params = [userId];

    if (status) {
      params.push(status);
      query += ` AND pa.status = $${params.length}`;
    }

    if (symbol) {
      params.push(symbol.toUpperCase());
      query += ` AND s.symbol = $${params.length}`;
    }

    query += ' ORDER BY pa.created_at DESC';

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    logger.error('Error fetching alerts:', error);
    next(error);
  }
};

// Get alert by ID
exports.getAlertById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT pa.*, s.symbol, s.name, s.last_price, s.change_amount, s.change_percent
       FROM price_alerts pa
       INNER JOIN securities s ON pa.security_id = s.id
       WHERE pa.id = $1 AND pa.user_id = $2`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Alert not found'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Error fetching alert:', error);
    next(error);
  }
};

// Create new price alert
exports.createAlert = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { 
      security_id, 
      condition, 
      target_price, 
      notify_email, 
      notify_sms,
      expires_at 
    } = req.body;

    // Verify security exists
    const securityCheck = await pool.query(
      'SELECT id, symbol, name, last_price FROM securities WHERE id = $1',
      [security_id]
    );

    if (securityCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Security not found'
      });
    }

    const security = securityCheck.rows[0];

    // Validate condition
    if (!['above', 'below'].includes(condition)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid condition. Must be "above" or "below"'
      });
    }

    // Validate target price
    if (target_price <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Target price must be greater than 0'
      });
    }

    // Check if alert already triggered
    const currentPrice = parseFloat(security.last_price);
    const targetPrice = parseFloat(target_price);
    
    let alreadyTriggered = false;
    if (condition === 'above' && currentPrice >= targetPrice) {
      alreadyTriggered = true;
    } else if (condition === 'below' && currentPrice <= targetPrice) {
      alreadyTriggered = true;
    }

    if (alreadyTriggered) {
      return res.status(400).json({
        success: false,
        message: `Current price ($${currentPrice}) has already ${condition === 'above' ? 'exceeded' : 'fallen below'} target price ($${targetPrice})`
      });
    }

    const result = await pool.query(
      `INSERT INTO price_alerts 
       (user_id, security_id, condition, target_price, notify_email, notify_sms, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        userId, 
        security_id, 
        condition, 
        target_price, 
        notify_email !== false,
        notify_sms || false,
        expires_at || null
      ]
    );

    logger.info('Price alert created', { 
      alertId: result.rows[0].id, 
      userId, 
      symbol: security.symbol,
      condition,
      targetPrice: target_price
    });

    res.status(201).json({
      success: true,
      message: 'Price alert created successfully',
      data: {
        ...result.rows[0],
        security: {
          symbol: security.symbol,
          name: security.name,
          current_price: security.last_price
        }
      }
    });
  } catch (error) {
    logger.error('Error creating alert:', error);
    next(error);
  }
};

// Update alert
exports.updateAlert = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { target_price, notify_email, notify_sms, expires_at } = req.body;

    // Verify ownership
    const checkResult = await pool.query(
      'SELECT id, status FROM price_alerts WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Alert not found'
      });
    }

    if (checkResult.rows[0].status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update inactive alert'
      });
    }

    const result = await pool.query(
      `UPDATE price_alerts 
       SET target_price = COALESCE($1, target_price),
           notify_email = COALESCE($2, notify_email),
           notify_sms = COALESCE($3, notify_sms),
           expires_at = COALESCE($4, expires_at)
       WHERE id = $5 AND user_id = $6
       RETURNING *`,
      [target_price, notify_email, notify_sms, expires_at, id, userId]
    );

    res.json({
      success: true,
      message: 'Alert updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Error updating alert:', error);
    next(error);
  }
};

// Cancel/Delete alert
exports.deleteAlert = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await pool.query(
      `UPDATE price_alerts 
       SET status = 'cancelled'
       WHERE id = $1 AND user_id = $2 AND status = 'active'
       RETURNING *`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Alert not found or already cancelled'
      });
    }

    logger.info('Alert cancelled', { alertId: id, userId });

    res.json({
      success: true,
      message: 'Alert cancelled successfully'
    });
  } catch (error) {
    logger.error('Error deleting alert:', error);
    next(error);
  }
};

// Get alert statistics
exports.getAlertStats = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT 
        COUNT(*) FILTER (WHERE status = 'active') as active_alerts,
        COUNT(*) FILTER (WHERE status = 'triggered') as triggered_alerts,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_alerts,
        COUNT(*) FILTER (WHERE status = 'expired') as expired_alerts,
        COUNT(*) as total_alerts
       FROM price_alerts
       WHERE user_id = $1`,
      [userId]
    );

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Error fetching alert stats:', error);
    next(error);
  }
};

// Reactivate expired or cancelled alert
exports.reactivateAlert = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { expires_at } = req.body;

    // Check if alert exists and belongs to user
    const alertCheck = await pool.query(
      `SELECT pa.*, s.last_price
       FROM price_alerts pa
       INNER JOIN securities s ON pa.security_id = s.id
       WHERE pa.id = $1 AND pa.user_id = $2`,
      [id, userId]
    );

    if (alertCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Alert not found'
      });
    }

    const alert = alertCheck.rows[0];

    if (alert.status === 'active') {
      return res.status(400).json({
        success: false,
        message: 'Alert is already active'
      });
    }

    // Check if condition is still valid
    const currentPrice = parseFloat(alert.last_price);
    const targetPrice = parseFloat(alert.target_price);
    
    let alreadyTriggered = false;
    if (alert.condition === 'above' && currentPrice >= targetPrice) {
      alreadyTriggered = true;
    } else if (alert.condition === 'below' && currentPrice <= targetPrice) {
      alreadyTriggered = true;
    }

    if (alreadyTriggered) {
      return res.status(400).json({
        success: false,
        message: `Cannot reactivate: current price already meets condition`
      });
    }

    const result = await pool.query(
      `UPDATE price_alerts 
       SET status = 'active',
           triggered = false,
           triggered_at = NULL,
           expires_at = COALESCE($1, expires_at)
       WHERE id = $2 AND user_id = $3
       RETURNING *`,
      [expires_at, id, userId]
    );

    logger.info('Alert reactivated', { alertId: id, userId });

    res.json({
      success: true,
      message: 'Alert reactivated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Error reactivating alert:', error);
    next(error);
  }
};