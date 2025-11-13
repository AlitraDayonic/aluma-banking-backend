// ============================================
// controllers/support.controller.js
// ============================================

const { pool } = require('../config/database');
const logger = require('../utils/logger');
const emailService = require('../services/email.service');

// Get all tickets for user
exports.getUserTickets = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { status, category } = req.query;

    let query = `
      SELECT st.*, 
        (SELECT COUNT(*) FROM ticket_messages WHERE ticket_id = st.id) as message_count,
        (SELECT created_at FROM ticket_messages WHERE ticket_id = st.id ORDER BY created_at DESC LIMIT 1) as last_message_at
      FROM support_tickets st
      WHERE st.user_id = $1
    `;
    const params = [userId];

    if (status) {
      params.push(status);
      query += ` AND st.status = $${params.length}`;
    }

    if (category) {
      params.push(category);
      query += ` AND st.category = $${params.length}`;
    }

    query += ' ORDER BY st.created_at DESC';

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    logger.error('Error fetching tickets:', error);
    next(error);
  }
};

// Get ticket by ID with messages
exports.getTicketById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Get ticket details
    const ticketResult = await pool.query(
      `SELECT st.*, u.email, u.first_name, u.last_name
       FROM support_tickets st
       INNER JOIN users u ON st.user_id = u.id
       WHERE st.id = $1 AND st.user_id = $2`,
      [id, userId]
    );

    if (ticketResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found'
      });
    }

    // Get ticket messages
    const messagesResult = await pool.query(
      `SELECT tm.*, u.first_name, u.last_name, u.email
       FROM ticket_messages tm
       INNER JOIN users u ON tm.user_id = u.id
       WHERE tm.ticket_id = $1
       ORDER BY tm.created_at ASC`,
      [id]
    );

    res.json({
      success: true,
      data: {
        ...ticketResult.rows[0],
        messages: messagesResult.rows
      }
    });
  } catch (error) {
    logger.error('Error fetching ticket:', error);
    next(error);
  }
};

// Create new support ticket
exports.createTicket = async (req, res, next) => {
  const client = await pool.connect();
  
  try {
    const userId = req.user.id;
    const { subject, category, priority, message } = req.body;

    await client.query('BEGIN');

    // Create ticket
    const ticketResult = await client.query(
      `INSERT INTO support_tickets 
       (user_id, subject, category, priority, message, status)
       VALUES ($1, $2, $3, $4, $5, 'open')
       RETURNING *`,
      [userId, subject, category || 'other', priority || 'medium', message]
    );

    const ticket = ticketResult.rows[0];

    // Create first message
    await client.query(
      `INSERT INTO ticket_messages 
       (ticket_id, user_id, message, is_staff)
       VALUES ($1, $2, $3, false)`,
      [ticket.id, userId, message]
    );

    await client.query('COMMIT');

    logger.info('Support ticket created', { ticketId: ticket.id, userId });

    // Send email notification to support team
    try {
      await emailService.sendSupportTicketNotification({
        ticketId: ticket.id,
        subject: ticket.subject,
        category: ticket.category,
        priority: ticket.priority,
        userEmail: req.user.email
      });
    } catch (emailError) {
      logger.error('Failed to send ticket notification email:', emailError);
      // Don't fail the request if email fails
    }

    res.status(201).json({
      success: true,
      message: 'Support ticket created successfully',
      data: ticket
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error creating ticket:', error);
    next(error);
  } finally {
    client.release();
  }
};

// Add message to ticket
exports.addMessage = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { message } = req.body;

    // Verify ticket exists and belongs to user
    const ticketCheck = await pool.query(
      `SELECT st.*, u.email 
       FROM support_tickets st
       INNER JOIN users u ON st.user_id = u.id
       WHERE st.id = $1 AND st.user_id = $2`,
      [id, userId]
    );

    if (ticketCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found'
      });
    }

    const ticket = ticketCheck.rows[0];

    if (ticket.status === 'closed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot add message to closed ticket. Please open a new ticket.'
      });
    }

    // Add message
    const messageResult = await pool.query(
      `INSERT INTO ticket_messages 
       (ticket_id, user_id, message, is_staff)
       VALUES ($1, $2, $3, false)
       RETURNING *`,
      [id, userId, message]
    );

    // Update ticket status if it was resolved/waiting
    if (['resolved', 'waiting_customer'].includes(ticket.status)) {
      await pool.query(
        `UPDATE support_tickets 
         SET status = 'in_progress', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [id]
      );
    } else {
      await pool.query(
        `UPDATE support_tickets 
         SET updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [id]
      );
    }

    logger.info('Message added to ticket', { ticketId: id, userId });

    res.status(201).json({
      success: true,
      message: 'Message added successfully',
      data: messageResult.rows[0]
    });
  } catch (error) {
    logger.error('Error adding message:', error);
    next(error);
  }
};

// Update ticket (change category or priority)
exports.updateTicket = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { category, priority } = req.body;

    // Verify ownership
    const checkResult = await pool.query(
      'SELECT id FROM support_tickets WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found'
      });
    }

    const result = await pool.query(
      `UPDATE support_tickets 
       SET category = COALESCE($1, category),
           priority = COALESCE($2, priority),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND user_id = $4
       RETURNING *`,
      [category, priority, id, userId]
    );

    res.json({
      success: true,
      message: 'Ticket updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Error updating ticket:', error);
    next(error);
  }
};

// Close ticket
exports.closeTicket = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await pool.query(
      `UPDATE support_tickets 
       SET status = 'closed',
           resolved_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2 AND status != 'closed'
       RETURNING *`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found or already closed'
      });
    }

    logger.info('Ticket closed', { ticketId: id, userId });

    res.json({
      success: true,
      message: 'Ticket closed successfully',
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Error closing ticket:', error);
    next(error);
  }
};

// Reopen ticket
exports.reopenTicket = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await pool.query(
      `UPDATE support_tickets 
       SET status = 'open',
           resolved_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2 AND status = 'closed'
       RETURNING *`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found or not closed'
      });
    }

    logger.info('Ticket reopened', { ticketId: id, userId });

    res.json({
      success: true,
      message: 'Ticket reopened successfully',
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Error reopening ticket:', error);
    next(error);
  }
};

// Get ticket statistics
exports.getTicketStats = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT 
        COUNT(*) FILTER (WHERE status = 'open') as open_tickets,
        COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress_tickets,
        COUNT(*) FILTER (WHERE status = 'waiting_customer') as waiting_tickets,
        COUNT(*) FILTER (WHERE status = 'resolved') as resolved_tickets,
        COUNT(*) FILTER (WHERE status = 'closed') as closed_tickets,
        COUNT(*) as total_tickets,
        AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600) FILTER (WHERE resolved_at IS NOT NULL) as avg_resolution_time_hours
       FROM support_tickets
       WHERE user_id = $1`,
      [userId]
    );

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Error fetching ticket stats:', error);
    next(error);
  }
};

// Get common issues / FAQ categories
exports.getFAQCategories = async (req, res, next) => {
  try {
    // This could come from a separate FAQ table or be hardcoded
    const categories = [
      {
        category: 'account',
        title: 'Account & Login',
        common_issues: [
          'Forgot password',
          'Two-factor authentication issues',
          'Account verification'
        ]
      },
      {
        category: 'trading',
        title: 'Trading & Orders',
        common_issues: [
          'Order not executing',
          'Understanding order types',
          'Trading fees'
        ]
      },
      {
        category: 'funding',
        title: 'Deposits & Withdrawals',
        common_issues: [
          'Deposit not showing',
          'Withdrawal delays',
          'Bank account verification'
        ]
      },
      {
        category: 'kyc',
        title: 'Identity Verification',
        common_issues: [
          'Document upload issues',
          'Verification taking too long',
          'Document rejected'
        ]
      }
    ];

    res.json({
      success: true,
      data: categories
    });
  } catch (error) {
    logger.error('Error fetching FAQ categories:', error);
    next(error);
  }
};