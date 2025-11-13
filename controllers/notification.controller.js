// ============================================
// controllers/notification.controller.js
// Notification Management Controller
// ============================================

const { query } = require('../config/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

/**
 * @route   GET /api/v1/notifications
 * @desc    Get all notifications for current user
 * @access  Private
 */
const getNotifications = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { 
    page = 1, 
    limit = 20, 
    type, 
    isRead, 
    priority 
  } = req.query;

  const offset = (page - 1) * limit;
  let whereConditions = ['user_id = $1', 'expires_at IS NULL'];
  const values = [userId];
  let paramCount = 1;

  if (type) {
    paramCount++;
    whereConditions.push(`type = $${paramCount}`);
    values.push(type);
  }

  if (isRead !== undefined) {
    paramCount++;
    whereConditions.push(`is_read = $${paramCount}`);
    values.push(isRead === 'true');
  }

  if (priority) {
    paramCount++;
    whereConditions.push(`priority = $${paramCount}`);
    values.push(priority);
  }

  values.push(parseInt(limit), parseInt(offset));

  const result = await query(`
    SELECT *
    FROM notifications
    WHERE ${whereConditions.join(' AND ')}
    ORDER BY 
      CASE priority
        WHEN 'urgent' THEN 1
        WHEN 'high' THEN 2
        WHEN 'normal' THEN 3
        WHEN 'low' THEN 4
      END,
      created_at DESC
    LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
  `, values);

  const countResult = await query(`
    SELECT COUNT(*) as total
    FROM notifications
    WHERE ${whereConditions.join(' AND ')}
  `, values.slice(0, -2));

  res.json({
    success: true,
    data: {
      notifications: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].total),
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(countResult.rows[0].total / limit)
      }
    }
  });
});

/**
 * @route   GET /api/v1/notifications/unread
 * @desc    Get unread notification count
 * @access  Private
 */
const getUnreadCount = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const result = await query(`
    SELECT COUNT(*) as count
    FROM notifications
    WHERE user_id = $1 AND is_read = FALSE AND expires_at IS NULL
  `, [userId]);

  res.json({
    success: true,
    data: {
      unreadCount: parseInt(result.rows[0].count)
    }
  });
});

/**
 * @route   GET /api/v1/notifications/recent
 * @desc    Get recent notifications (last 10)
 * @access  Private
 */
const getRecentNotifications = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const result = await query(`
    SELECT *
    FROM notifications
    WHERE user_id = $1 AND expires_at IS NULL
    ORDER BY created_at DESC
    LIMIT 10
  `, [userId]);

  res.json({
    success: true,
    data: {
      notifications: result.rows
    }
  });
});

/**
 * @route   GET /api/v1/notifications/:id
 * @desc    Get single notification
 * @access  Private
 */
const getNotificationById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const result = await query(`
    SELECT *
    FROM notifications
    WHERE id = $1 AND user_id = $2
  `, [id, userId]);

  if (result.rows.length === 0) {
    throw new AppError('Notification not found', 404);
  }

  res.json({
    success: true,
    data: {
      notification: result.rows[0]
    }
  });
});

/**
 * @route   PUT /api/v1/notifications/:id/read
 * @desc    Mark notification as read
 * @access  Private
 */
const markAsRead = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const result = await query(`
    UPDATE notifications
    SET is_read = TRUE, read_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND user_id = $2
    RETURNING *
  `, [id, userId]);

  if (result.rows.length === 0) {
    throw new AppError('Notification not found', 404);
  }

  logger.info(`Notification marked as read: ${id} by user: ${userId}`);

  res.json({
    success: true,
    message: 'Notification marked as read',
    data: {
      notification: result.rows[0]
    }
  });
});

/**
 * @route   PUT /api/v1/notifications/read-all
 * @desc    Mark all notifications as read
 * @access  Private
 */
const markAllAsRead = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const result = await query(`
    UPDATE notifications
    SET is_read = TRUE, read_at = CURRENT_TIMESTAMP
    WHERE user_id = $1 AND is_read = FALSE
    RETURNING id
  `, [userId]);

  logger.info(`All notifications marked as read for user: ${userId}, count: ${result.rowCount}`);

  res.json({
    success: true,
    message: `${result.rowCount} notifications marked as read`,
    data: {
      updatedCount: result.rowCount
    }
  });
});

/**
 * @route   DELETE /api/v1/notifications/:id
 * @desc    Delete a notification
 * @access  Private
 */
const deleteNotification = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const result = await query(`
    DELETE FROM notifications
    WHERE id = $1 AND user_id = $2
    RETURNING id
  `, [id, userId]);

  if (result.rows.length === 0) {
    throw new AppError('Notification not found', 404);
  }

  logger.info(`Notification deleted: ${id} by user: ${userId}`);

  res.json({
    success: true,
    message: 'Notification deleted successfully'
  });
});

/**
 * @route   DELETE /api/v1/notifications/clear-all
 * @desc    Delete all read notifications
 * @access  Private
 */
const clearAllRead = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const result = await query(`
    DELETE FROM notifications
    WHERE user_id = $1 AND is_read = TRUE
    RETURNING id
  `, [userId]);

  logger.info(`All read notifications cleared for user: ${userId}, count: ${result.rowCount}`);

  res.json({
    success: true,
    message: `${result.rowCount} notifications cleared`,
    data: {
      deletedCount: result.rowCount
    }
  });
});

/**
 * @route   POST /api/v1/notifications/test
 * @desc    Create a test notification (development only)
 * @access  Private
 */
const createTestNotification = asyncHandler(async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    throw new AppError('Test notifications not available in production', 403);
  }

  const userId = req.user.id;
  const { type = 'system', title, message, priority = 'normal' } = req.body;

  const result = await query(`
    INSERT INTO notifications (user_id, type, title, message, priority)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `, [userId, type, title || 'Test Notification', message || 'This is a test notification', priority]);

  // Emit WebSocket event if available
  if (req.io) {
    req.io.to(`user_${userId}`).emit('new_notification', result.rows[0]);
  }

  res.status(201).json({
    success: true,
    message: 'Test notification created',
    data: {
      notification: result.rows[0]
    }
  });
});

/**
 * @route   GET /api/v1/notifications/preferences
 * @desc    Get notification preferences
 * @access  Private
 */
const getPreferences = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const result = await query(`
    SELECT *
    FROM notification_preferences
    WHERE user_id = $1
  `, [userId]);

  // Create default preferences if they don't exist
  if (result.rows.length === 0) {
    const createResult = await query(`
      INSERT INTO notification_preferences (user_id)
      VALUES ($1)
      RETURNING *
    `, [userId]);

    return res.json({
      success: true,
      data: {
        preferences: createResult.rows[0]
      }
    });
  }

  res.json({
    success: true,
    data: {
      preferences: result.rows[0]
    }
  });
});

/**
 * @route   PUT /api/v1/notifications/preferences
 * @desc    Update notification preferences
 * @access  Private
 */
const updatePreferences = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const {
    email_enabled,
    push_enabled,
    sms_enabled,
    order_notifications,
    trade_notifications,
    deposit_notifications,
    withdrawal_notifications,
    alert_notifications,
    kyc_notifications,
    system_notifications,
    security_notifications
  } = req.body;

  const updates = {};
  if (email_enabled !== undefined) updates.email_enabled = email_enabled;
  if (push_enabled !== undefined) updates.push_enabled = push_enabled;
  if (sms_enabled !== undefined) updates.sms_enabled = sms_enabled;
  if (order_notifications !== undefined) updates.order_notifications = order_notifications;
  if (trade_notifications !== undefined) updates.trade_notifications = trade_notifications;
  if (deposit_notifications !== undefined) updates.deposit_notifications = deposit_notifications;
  if (withdrawal_notifications !== undefined) updates.withdrawal_notifications = withdrawal_notifications;
  if (alert_notifications !== undefined) updates.alert_notifications = alert_notifications;
  if (kyc_notifications !== undefined) updates.kyc_notifications = kyc_notifications;
  if (system_notifications !== undefined) updates.system_notifications = system_notifications;
  if (security_notifications !== undefined) updates.security_notifications = security_notifications;

  if (Object.keys(updates).length === 0) {
    throw new AppError('No valid fields to update', 400);
  }

  const fields = [];
  const values = [];
  let paramCount = 0;

  Object.keys(updates).forEach(key => {
    paramCount++;
    fields.push(`${key} = $${paramCount}`);
    values.push(updates[key]);
  });

  values.push(userId);

  const result = await query(`
    UPDATE notification_preferences
    SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = $${paramCount + 1}
    RETURNING *
  `, values);

  logger.info(`Notification preferences updated for user: ${userId}`);

  res.json({
    success: true,
    message: 'Preferences updated successfully',
    data: {
      preferences: result.rows[0]
    }
  });
});

module.exports = {
  getNotifications,
  getUnreadCount,
  getRecentNotifications,
  getNotificationById,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  clearAllRead,
  createTestNotification,
  getPreferences,
  updatePreferences
};