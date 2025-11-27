const { query, transaction } = require('../config/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const emailService = require('../services/email-resend.service');
/**
 * @route   POST /api/v1/support/tickets
 * @desc    Create new support ticket
 * @access  Public (authenticated users get user_id attached)
 */
const createTicket = asyncHandler(async (req, res) => {
  const { subject, category, message, priority, email, name } = req.body;
  
  // If user is authenticated, use their info
  const userId = req.user?.id || null;
  const userEmail = req.user?.email || email;
  const userName = req.user ? `${req.user.firstName} ${req.user.lastName}` : name;
  const ticketPriority = priority || 'normal';

  // Validate required fields
  if (!userEmail || userEmail.trim() === '') {
    throw new AppError('Email is required', 400);
  }

  if (!userName || userName.trim() === '') {
    throw new AppError('Name is required', 400);
  }

  if (!subject || subject.trim() === '') {
    throw new AppError('Subject is required', 400);
  }

  if (!category) {
    throw new AppError('Category is required', 400);
  }

  if (!message || message.trim() === '') {
    throw new AppError('Message is required', 400);
  }

  const result = await transaction(async (client) => {
    // Generate ticket number
    const ticketNumberResult = await client.query('SELECT generate_ticket_number() as ticket_number');
    const ticketNumber = ticketNumberResult.rows[0].ticket_number;

    // Create ticket
    const ticketResult = await client.query(
      `INSERT INTO support_tickets (
        user_id, ticket_number, subject, category, priority, status, email, name
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [userId, ticketNumber, subject, category, ticketPriority, 'open', userEmail, userName]
    );

    const ticket = ticketResult.rows[0];

    // Create initial message
    await client.query(
      `INSERT INTO support_messages (ticket_id, user_id, message, is_staff_reply)
       VALUES ($1, $2, $3, $4)`,
      [ticket.id, userId, message, false]
    );

    return ticket;
  });

  // Send confirmation email
  try {
    await emailService.sendSupportTicketConfirmation(userEmail, {
      ticketNumber: result.ticket_number,
      subject: result.subject,
      name: userName
    });
  } catch (emailError) {
    logger.error('Failed to send support ticket confirmation email:', emailError);
    // Don't fail ticket creation if email fails
  }

  logger.info(`Support ticket created: ${result.ticket_number} by ${userEmail}`);

  res.status(201).json({
    success: true,
    message: 'Support ticket created successfully. You will receive updates via email.',
    data: {
      ticket: {
        id: result.id,
        ticketNumber: result.ticket_number,
        subject: result.subject,
        category: result.category,
        priority: result.priority,
        status: result.status,
        createdAt: result.created_at
      }
    }
  });
});

/**
 * @route   GET /api/v1/support/tickets
 * @desc    Get user's support tickets
 * @access  Private
 */
const getMyTickets = asyncHandler(async (req, res) => {
  const { status, limit = 50, offset = 0 } = req.query;

  let queryStr = `
    SELECT 
      id, ticket_number, subject, category, priority, status,
      created_at, updated_at, resolved_at, closed_at
    FROM support_tickets
    WHERE user_id = $1
  `;
  const params = [req.user.id];

  if (status) {
    queryStr += ` AND status = $${params.length + 1}`;
    params.push(status);
  }

  queryStr += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const result = await query(queryStr, params);

  // Get total count
  const countResult = await query(
    `SELECT COUNT(*) as total FROM support_tickets WHERE user_id = $1 ${status ? 'AND status = $2' : ''}`,
    status ? [req.user.id, status] : [req.user.id]
  );

  res.json({
    success: true,
    data: {
      tickets: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].total),
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    }
  });
});

/**
 * @route   GET /api/v1/support/tickets/:ticketNumber
 * @desc    Get ticket details with messages
 * @access  Private/Public (with ticket access)
 */
const getTicket = asyncHandler(async (req, res) => {
  const { ticketNumber } = req.params;

  // Get ticket
  const ticketResult = await query(
    `SELECT * FROM support_tickets WHERE ticket_number = $1`,
    [ticketNumber]
  );

  if (ticketResult.rows.length === 0) {
    throw new AppError('Ticket not found', 404);
  }

  const ticket = ticketResult.rows[0];

  // Check access: user must own the ticket or be staff
  if (req.user) {
    if (ticket.user_id !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'support') {
      throw new AppError('Access denied', 403);
    }
  }

  // Get messages
  const messagesResult = await query(
    `SELECT 
      m.id, m.message, m.is_staff_reply, m.attachments, m.created_at,
      u.username, u.first_name, u.last_name
     FROM support_messages m
     LEFT JOIN users u ON m.user_id = u.id
     WHERE m.ticket_id = $1
     ORDER BY m.created_at ASC`,
    [ticket.id]
  );

  res.json({
    success: true,
    data: {
      ticket: {
        id: ticket.id,
        ticketNumber: ticket.ticket_number,
        subject: ticket.subject,
        category: ticket.category,
        priority: ticket.priority,
        status: ticket.status,
        email: ticket.email,
        name: ticket.name,
        createdAt: ticket.created_at,
        updatedAt: ticket.updated_at,
        resolvedAt: ticket.resolved_at,
        closedAt: ticket.closed_at
      },
      messages: messagesResult.rows.map(msg => ({
        id: msg.id,
        message: msg.message,
        isStaffReply: msg.is_staff_reply,
        attachments: msg.attachments,
        createdAt: msg.created_at,
        author: msg.is_staff_reply ? 'Support Team' : (msg.username || ticket.name)
      }))
    }
  });
});

/**
 * @route   POST /api/v1/support/tickets/:ticketNumber/messages
 * @desc    Add message to ticket
 * @access  Private
 */
const addMessage = asyncHandler(async (req, res) => {
  const { ticketNumber } = req.params;
  const { message } = req.body;

  // Get ticket
  const ticketResult = await query(
    `SELECT id, user_id, email, name, subject, status FROM support_tickets WHERE ticket_number = $1`,
    [ticketNumber]
  );

  if (ticketResult.rows.length === 0) {
    throw new AppError('Ticket not found', 404);
  }

  const ticket = ticketResult.rows[0];

  // Check access
  if (ticket.user_id !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'support') {
    throw new AppError('Access denied', 403);
  }

  // Check if ticket is closed
  if (ticket.status === 'closed') {
    throw new AppError('Cannot add messages to closed tickets', 400);
  }

  const isStaffReply = req.user.role === 'admin' || req.user.role === 'support';

  // Add message
  const messageResult = await query(
    `INSERT INTO support_messages (ticket_id, user_id, message, is_staff_reply)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [ticket.id, req.user.id, message, isStaffReply]
  );

  // Update ticket status if staff replied
  if (isStaffReply && ticket.status === 'open') {
    await query(
      `UPDATE support_tickets SET status = 'in_progress', updated_at = NOW() WHERE id = $1`,
      [ticket.id]
    );
  } else {
    await query(
      `UPDATE support_tickets SET updated_at = NOW() WHERE id = $1`,
      [ticket.id]
    );
  }

  // Send email notification
  if (isStaffReply) {
    await emailService.sendSupportReplyNotification(ticket.email, {
      ticketNumber,
      subject: ticket.subject,
      message,
      name: ticket.name
    });
  }

  logger.info(`Message added to ticket ${ticketNumber} by ${req.user.email}`);

  res.status(201).json({
    success: true,
    message: 'Message added successfully',
    data: {
      message: messageResult.rows[0]
    }
  });
});

/**
 * @route   PATCH /api/v1/support/tickets/:ticketNumber/status
 * @desc    Update ticket status (admin/support only)
 * @access  Private (Admin/Support)
 */
const updateTicketStatus = asyncHandler(async (req, res) => {
  const { ticketNumber } = req.params;
  const { status } = req.body;

  // Only admin/support can change status
  if (req.user.role !== 'admin' && req.user.role !== 'support') {
    throw new AppError('Access denied', 403);
  }

  const validStatuses = ['open', 'in_progress', 'waiting', 'resolved', 'closed'];
  if (!validStatuses.includes(status)) {
    throw new AppError('Invalid status', 400);
  }

  const updateFields = ['status = $1', 'updated_at = NOW()'];
  const params = [status];

  if (status === 'resolved') {
    updateFields.push('resolved_at = NOW()');
  } else if (status === 'closed') {
    updateFields.push('closed_at = NOW()');
  }

  params.push(ticketNumber);

  const result = await query(
    `UPDATE support_tickets 
     SET ${updateFields.join(', ')}
     WHERE ticket_number = $${params.length}
     RETURNING *`,
    params
  );

  if (result.rows.length === 0) {
    throw new AppError('Ticket not found', 404);
  }

  logger.info(`Ticket ${ticketNumber} status updated to ${status} by ${req.user.email}`);

  res.json({
    success: true,
    message: 'Ticket status updated',
    data: {
      ticket: result.rows[0]
    }
  });
});

/**
 * @route   GET /api/v1/support/tickets/admin/all
 * @desc    Get all tickets (admin/support only)
 * @access  Private (Admin/Support)
 */
const getAllTickets = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'support') {
    throw new AppError('Access denied', 403);
  }

  const { status, category, priority, limit = 50, offset = 0 } = req.query;

  let queryStr = `
    SELECT 
      t.*,
      (SELECT COUNT(*) FROM support_messages WHERE ticket_id = t.id) as message_count,
      (SELECT created_at FROM support_messages WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1) as last_message_at
    FROM support_tickets t
    WHERE 1=1
  `;
  const params = [];

  if (status) {
    params.push(status);
    queryStr += ` AND status = $${params.length}`;
  }

  if (category) {
    params.push(category);
    queryStr += ` AND category = $${params.length}`;
  }

  if (priority) {
    params.push(priority);
    queryStr += ` AND priority = $${params.length}`;
  }

  params.push(limit, offset);
  queryStr += ` ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

  const result = await query(queryStr, params);

  res.json({
    success: true,
    data: {
      tickets: result.rows
    }
  });
});

module.exports = {
  createTicket,
  getMyTickets,
  getTicket,
  addMessage,
  updateTicketStatus,
  getAllTickets
};
