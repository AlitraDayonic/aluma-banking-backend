// ============================================
// routes/notification.routes.js
// Notification API Routes
// ============================================

const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');
const { authenticate } = require('../middleware/auth');

// All routes require authentication
router.use(authenticate);

/**
 * @route   GET /api/v1/notifications
 * @desc    Get all notifications with pagination and filters
 * @access  Private
 * @query   page, limit, type, isRead, priority
 */
router.get('/', notificationController.getNotifications);

/**
 * @route   GET /api/v1/notifications/unread
 * @desc    Get unread notification count
 * @access  Private
 */
router.get('/unread', notificationController.getUnreadCount);

/**
 * @route   GET /api/v1/notifications/recent
 * @desc    Get recent 10 notifications
 * @access  Private
 */
router.get('/recent', notificationController.getRecentNotifications);

/**
 * @route   GET /api/v1/notifications/preferences
 * @desc    Get notification preferences
 * @access  Private
 */
router.get('/preferences', notificationController.getPreferences);

/**
 * @route   PUT /api/v1/notifications/preferences
 * @desc    Update notification preferences
 * @access  Private
 */
router.put('/preferences', notificationController.updatePreferences);

/**
 * @route   PUT /api/v1/notifications/read-all
 * @desc    Mark all notifications as read
 * @access  Private
 */
router.put('/read-all', notificationController.markAllAsRead);

/**
 * @route   DELETE /api/v1/notifications/clear-all
 * @desc    Clear all read notifications
 * @access  Private
 */
router.delete('/clear-all', notificationController.clearAllRead);

/**
 * @route   POST /api/v1/notifications/test
 * @desc    Create test notification (development only)
 * @access  Private
 */
router.post('/test', notificationController.createTestNotification);

/**
 * @route   GET /api/v1/notifications/:id
 * @desc    Get single notification
 * @access  Private
 */
router.get('/:id', notificationController.getNotificationById);

/**
 * @route   PUT /api/v1/notifications/:id/read
 * @desc    Mark notification as read
 * @access  Private
 */
router.put('/:id/read', notificationController.markAsRead);

/**
 * @route   DELETE /api/v1/notifications/:id
 * @desc    Delete notification
 * @access  Private
 */
router.delete('/:id', notificationController.deleteNotification);

module.exports = router;