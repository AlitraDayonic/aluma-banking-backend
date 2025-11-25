const express = require('express');
const router = express.Router();
const supportController = require('../controllers/support.controller');
const { validate, schemas } = require('../middleware/validate');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');

/**
 * @route   POST /api/v1/support/tickets
 * @desc    Create new support ticket
 * @access  Public (with optional auth)
 */
router.post(
  '/tickets',
  authLimiter,
  optionalAuth,
  validate(schemas.createSupportTicket),
  supportController.createTicket
);

/**
 * @route   GET /api/v1/support/tickets
 * @desc    Get user's support tickets
 * @access  Private
 */
router.get(
  '/tickets',
  authenticate,
  supportController.getMyTickets
);

/**
 * @route   GET /api/v1/support/tickets/:ticketNumber
 * @desc    Get ticket details with messages
 * @access  Private
 */
router.get(
  '/tickets/:ticketNumber',
  authenticate,
  supportController.getTicket
);

/**
 * @route   POST /api/v1/support/tickets/:ticketNumber/messages
 * @desc    Add message to ticket
 * @access  Private
 */
router.post(
  '/tickets/:ticketNumber/messages',
  authenticate,
 // validate(schemas.addTicketMessage),
  supportController.addMessage
);

/**
 * @route   PATCH /api/v1/support/tickets/:ticketNumber/status
 * @desc    Update ticket status (admin/support only)
 * @access  Private (Admin/Support)
 */
router.patch(
  '/tickets/:ticketNumber/status',
  authenticate,
  validate(schemas.updateTicketStatus),
  supportController.updateTicketStatus
);

/**
 * @route   GET /api/v1/support/tickets/admin/all
 * @desc    Get all tickets (admin/support only)
 * @access  Private (Admin/Support)
 */
router.get(
  '/tickets/admin/all',
  authenticate,
  supportController.getAllTickets
);

module.exports = router;
