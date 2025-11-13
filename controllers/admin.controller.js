// ============================================
// controllers/admin.controller.js
// ============================================

const { pool } = require('../config/database');
const logger = require('../utils/logger');

// Dashboard statistics
exports.getDashboardStats = async (req, res, next) => {
  try {
    // Total users
    const usersStats = await pool.query(`
      SELECT 
        COUNT(*) as total_users,
        COUNT(*) FILTER (WHERE status = 'active') as active_users,
        COUNT(*) FILTER (WHERE status = 'pending') as pending_users,
        COUNT(*) FILTER (WHERE status = 'suspended') as suspended_users,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') as new_users_30d
      FROM users
      WHERE deleted_at IS NULL
    `);

    // Account statistics
    const accountStats = await pool.query(`
      SELECT 
        COUNT(*) as total_accounts,
        SUM(cash_balance) as total_cash,
        SUM(market_value) as total_market_value,
        COUNT(*) FILTER (WHERE status = 'active') as active_accounts
      FROM accounts
    `);

    // Trading statistics
    const tradingStats = await pool.query(`
      SELECT 
        COUNT(*) as total_orders,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day') as orders_24h,
        SUM(filled_value) FILTER (WHERE status = 'filled') as total_volume,
        SUM(commission) as total_commissions
      FROM orders
      WHERE created_at >= NOW() - INTERVAL '30 days'
    `);

    // KYC statistics
    const kycStats = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'pending') as pending_kyc,
        COUNT(*) FILTER (WHERE status = 'under_review') as under_review,
        COUNT(*) FILTER (WHERE status = 'approved') as approved_kyc,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected_kyc
      FROM user_kyc
    `);

    // Support tickets
    const supportStats = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'open') as open_tickets,
        COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress_tickets,
        COUNT(*) FILTER (WHERE priority = 'urgent') as urgent_tickets
      FROM support_tickets
    `);

    res.json({
      success: true,
      data: {
        users: usersStats.rows[0],
        accounts: accountStats.rows[0],
        trading: tradingStats.rows[0],
        kyc: kycStats.rows[0],
        support: supportStats.rows[0],
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Error fetching dashboard stats:', error);
    next(error);
  }
};

// Get all users with filters
exports.getAllUsers = async (req, res, next) => {
  try {
    const { 
      status, 
      search, 
      kyc_status,
      limit = 50, 
      offset = 0,
      sort_by = 'created_at',
      sort_order = 'DESC'
    } = req.query;

    let query = `
      SELECT u.*, uk.status as kyc_status, uk.verification_level,
        (SELECT COUNT(*) FROM accounts WHERE user_id = u.id) as account_count
      FROM users u
      LEFT JOIN user_kyc uk ON u.id = uk.user_id
      WHERE u.deleted_at IS NULL
    `;
    const params = [];

    if (status) {
      params.push(status);
      query += ` AND u.status = $${params.length}`;
    }

    if (kyc_status) {
      params.push(kyc_status);
      query += ` AND uk.status = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (u.email ILIKE $${params.length} OR u.first_name ILIKE $${params.length} OR u.last_name ILIKE $${params.length})`;
    }

    const allowedSortFields = ['created_at', 'email', 'last_login_at', 'first_name'];
    const sortField = allowedSortFields.includes(sort_by) ? sort_by : 'created_at';
    const sortDir = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    
    query += ` ORDER BY u.${sortField} ${sortDir} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) FROM users u LEFT JOIN user_kyc uk ON u.id = uk.user_id WHERE u.deleted_at IS NULL';
    const countParams = [];

    if (status) {
      countParams.push(status);
      countQuery += ` AND u.status = $${countParams.length}`;
    }

    if (kyc_status) {
      countParams.push(kyc_status);
      countQuery += ` AND uk.status = $${countParams.length}`;
    }

    if (search) {
      countParams.push(`%${search}%`);
      countQuery += ` AND (u.email ILIKE $${countParams.length} OR u.first_name ILIKE $${countParams.length} OR u.last_name ILIKE $${countParams.length})`;
    }

    const countResult = await pool.query(countQuery, countParams);

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        limit: parseInt(limit),
        offset: parseInt(offset),
        has_more: parseInt(offset) + result.rows.length < parseInt(countResult.rows[0].count)
      }
    });
  } catch (error) {
    logger.error('Error fetching users:', error);
    next(error);
  }
};

// Get user details
exports.getUserDetails = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Get user info
    const userResult = await pool.query(
      `SELECT u.*, up.*, uk.status as kyc_status, uk.verification_level, uk.rejection_reason
       FROM users u
       LEFT JOIN user_profiles up ON u.id = up.user_id
       LEFT JOIN user_kyc uk ON u.id = uk.user_id
       WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get user accounts
    const accounts = await pool.query(
      'SELECT * FROM accounts WHERE user_id = $1 ORDER BY created_at DESC',
      [id]
    );

    // Get recent activity
    const activity = await pool.query(
      `SELECT type, action, created_at, ip_address
       FROM audit_logs
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [id]
    );

    res.json({
      success: true,
      data: {
        user: userResult.rows[0],
        accounts: accounts.rows,
        recent_activity: activity.rows
      }
    });
  } catch (error) {
    logger.error('Error fetching user details:', error);
    next(error);
  }
};

// Update user status
exports.updateUserStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;
    const adminId = req.user.id;

    const validStatuses = ['active', 'suspended', 'closed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status'
      });
    }

    const result = await pool.query(
      `UPDATE users 
       SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Log the action
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, changes)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        adminId,
        'USER_STATUS_CHANGED',
        'user',
        id,
        JSON.stringify({ status, reason, changed_by: adminId })
      ]
    );

    logger.info('User status updated', { userId: id, status, adminId });

    res.json({
      success: true,
      message: 'User status updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Error updating user status:', error);
    next(error);
  }
};

// Review KYC documents
exports.reviewKYC = async (req, res, next) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const { status, rejection_reason, verification_level } = req.body;
    const adminId = req.user.id;

    await client.query('BEGIN');

    const validStatuses = ['approved', 'rejected', 'under_review'];
    if (!validStatuses.includes(status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Invalid KYC status'
      });
    }

    if (status === 'rejected' && !rejection_reason) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Rejection reason required'
      });
    }

    // Update KYC status
    const result = await client.query(
      `UPDATE user_kyc 
       SET status = $1,
           rejection_reason = $2,
           verification_level = $3,
           reviewed_at = CURRENT_TIMESTAMP,
           reviewed_by = $4
       WHERE user_id = $5
       RETURNING *`,
      [status, rejection_reason, verification_level, adminId, id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'KYC record not found'
      });
    }

    // Log the action
    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, changes)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        adminId,
        'KYC_REVIEWED',
        'user_kyc',
        id,
        JSON.stringify({ status, rejection_reason, reviewed_by: adminId })
      ]
    );

    await client.query('COMMIT');

    logger.info('KYC reviewed', { userId: id, status, adminId });

    res.json({
      success: true,
      message: 'KYC review completed',
      data: result.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error reviewing KYC:', error);
    next(error);
  } finally {
    client.release();
  }
};

// Get pending KYC submissions
exports.getPendingKYC = async (req, res, next) => {
  try {
    const { limit = 20, offset = 0 } = req.query;

    const result = await pool.query(
      `SELECT uk.*, u.email, u.first_name, u.last_name, u.created_at as user_created_at,
        (SELECT COUNT(*) FROM kyc_documents WHERE user_id = uk.user_id) as document_count
       FROM user_kyc uk
       INNER JOIN users u ON uk.user_id = u.id
       WHERE uk.status IN ('pending', 'under_review')
       ORDER BY uk.submitted_at DESC
       LIMIT $1 OFFSET $2`,
      [parseInt(limit), parseInt(offset)]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM user_kyc WHERE status IN ('pending', 'under_review')`
    );

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
  } catch (error) {
    logger.error('Error fetching pending KYC:', error);
    next(error);
  }
};

// Get all transactions (admin view)
exports.getAllTransactions = async (req, res, next) => {
  try {
    const { 
      type, 
      status, 
      start_date, 
      end_date,
      limit = 50, 
      offset = 0 
    } = req.query;

    let query = `
      SELECT t.*, a.account_number, u.email, u.first_name, u.last_name
      FROM transactions t
      INNER JOIN accounts a ON t.account_id = a.id
      INNER JOIN users u ON a.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (type) {
      params.push(type);
      query += ` AND t.type = $${params.length}`;
    }

    if (status) {
      params.push(status);
      query += ` AND t.status = $${params.length}`;
    }

    if (start_date) {
      params.push(start_date);
      query += ` AND t.created_at >= $${params.length}`;
    }

    if (end_date) {
      params.push(end_date);
      query += ` AND t.created_at <= $${params.length}`;
    }

    query += ` ORDER BY t.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    logger.error('Error fetching transactions:', error);
    next(error);
  }
};

// Get support tickets (admin view)
exports.getAllTickets = async (req, res, next) => {
  try {
    const { status, priority, category, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT st.*, u.email, u.first_name, u.last_name,
        (SELECT COUNT(*) FROM ticket_messages WHERE ticket_id = st.id) as message_count
      FROM support_tickets st
      INNER JOIN users u ON st.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      params.push(status);
      query += ` AND st.status = $${params.length}`;
    }

    if (priority) {
      params.push(priority);
      query += ` AND st.priority = $${params.length}`;
    }

    if (category) {
      params.push(category);
      query += ` AND st.category = $${params.length}`;
    }

    query += ` ORDER BY 
      CASE st.priority 
        WHEN 'urgent' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
      END,
      st.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

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

// Assign ticket to staff
exports.assignTicket = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { assigned_to } = req.body;
    const adminId = req.user.id;

    const result = await pool.query(
      `UPDATE support_tickets 
       SET assigned_to = $1,
           status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      [assigned_to || adminId, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found'
      });
    }

    logger.info('Ticket assigned', { ticketId: id, assignedTo: assigned_to, adminId });

    res.json({
      success: true,
      message: 'Ticket assigned successfully',
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Error assigning ticket:', error);
    next(error);
  }
};

// Get system audit logs
exports.getAuditLogs = async (req, res, next) => {
  try {
    const { user_id, action, start_date, end_date, limit = 100, offset = 0 } = req.query;

    let query = 'SELECT al.*, u.email, u.first_name, u.last_name FROM audit_logs al LEFT JOIN users u ON al.user_id = u.id WHERE 1=1';
    const params = [];

    if (user_id) {
      params.push(user_id);
      query += ` AND al.user_id = $${params.length}`;
    }

    if (action) {
      params.push(action);
      query += ` AND al.action = $${params.length}`;
    }

    if (start_date) {
      params.push(start_date);
      query += ` AND al.created_at >= $${params.length}`;
    }

    if (end_date) {
      params.push(end_date);
      query += ` AND al.created_at <= $${params.length}`;
    }

    query += ` ORDER BY al.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    logger.error('Error fetching audit logs:', error);
    next(error);
  }
};

// Get platform analytics
exports.getPlatformAnalytics = async (req, res, next) => {
  try {
    const { period = '30d' } = req.query;

    let interval;
    switch(period) {
      case '7d':
        interval = '7 days';
        break;
      case '30d':
        interval = '30 days';
        break;
      case '90d':
        interval = '90 days';
        break;
      case '1y':
        interval = '1 year';
        break;
      default:
        interval = '30 days';
    }

    // User growth
    const userGrowth = await pool.query(
      `SELECT DATE(created_at) as date, COUNT(*) as new_users
       FROM users
       WHERE created_at >= NOW() - INTERVAL '${interval}'
       GROUP BY DATE(created_at)
       ORDER BY date ASC`
    );

    // Trading volume
    const tradingVolume = await pool.query(
      `SELECT DATE(created_at) as date, 
              COUNT(*) as order_count,
              SUM(filled_value) as volume
       FROM orders
       WHERE created_at >= NOW() - INTERVAL '${interval}' AND status = 'filled'
       GROUP BY DATE(created_at)
       ORDER BY date ASC`
    );

    // Revenue (commissions)
    const revenue = await pool.query(
      `SELECT DATE(created_at) as date, SUM(commission) as revenue
       FROM orders
       WHERE created_at >= NOW() - INTERVAL '${interval}' AND status = 'filled'
       GROUP BY DATE(created_at)
       ORDER BY date ASC`
    );

    res.json({
      success: true,
      period,
      data: {
        user_growth: userGrowth.rows,
        trading_volume: tradingVolume.rows,
        revenue: revenue.rows
      }
    });
  } catch (error) {
    logger.error('Error fetching platform analytics:', error);
    next(error);
  }
};