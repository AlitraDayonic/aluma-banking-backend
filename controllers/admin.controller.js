const { pool } = require('../config/database');
const logger = require('../utils/logger');

exports.getDashboardStats = async (req, res, next) => {
  try {
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

    const accountStats = await pool.query(`
      SELECT 
        COUNT(*) as total_accounts,
        COALESCE(SUM(cash_balance), 0) as total_cash,
        COALESCE(SUM(portfolio_value), 0) as total_portfolio_value,
        COUNT(*) FILTER (WHERE status = 'active') as active_accounts
      FROM accounts
    `);

    const kycStats = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'pending') as pending_kyc,
        COUNT(*) FILTER (WHERE status = 'under_review') as under_review,
        COUNT(*) FILTER (WHERE status = 'approved') as approved_kyc,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected_kyc
      FROM user_kyc
    `);

    res.json({
      success: true,
      data: {
        users: usersStats.rows[0],
        accounts: accountStats.rows[0],
        kyc: kycStats.rows[0],
        trading: { total_orders: 0, orders_24h: 0, total_volume: 0, total_commissions: 0 },
        support: { open_tickets: 0, in_progress_tickets: 0, urgent_tickets: 0 },
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    next(error);
  }
};

exports.getAllUsers = async (req, res, next) => {
  try {
    const { status, search, kyc_status, limit = 50, offset = 0, sort_by = 'created_at', sort_order = 'DESC' } = req.query;
    let query = `SELECT u.*, uk.status as kyc_status, uk.verification_level, (SELECT COUNT(*) FROM accounts WHERE user_id = u.id) as account_count FROM users u LEFT JOIN user_kyc uk ON u.id = uk.user_id WHERE u.deleted_at IS NULL`;
    const params = [];
    if (status) { params.push(status); query += ` AND u.status = $${params.length}`; }
    if (kyc_status) { params.push(kyc_status); query += ` AND uk.status = $${params.length}`; }
    if (search) { params.push(`%${search}%`); query += ` AND (u.email ILIKE $${params.length} OR u.first_name ILIKE $${params.length} OR u.last_name ILIKE $${params.length})`; }
    const allowedSortFields = ['created_at', 'email', 'last_login_at', 'first_name'];
    const sortField = allowedSortFields.includes(sort_by) ? sort_by : 'created_at';
    const sortDir = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    query += ` ORDER BY u.${sortField} ${sortDir} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));
    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (error) { logger.error('Error fetching users:', error); next(error); }
};

exports.getUserDetails = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const userResult = await pool.query(
      `SELECT u.*, uk.status as kyc_status, uk.verification_level, uk.rejection_reason
       FROM users u
       LEFT JOIN user_kyc uk ON u.id = uk.user_id
       WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const accounts = await pool.query(
      'SELECT * FROM accounts WHERE user_id = $1 ORDER BY created_at DESC',
      [id]
    );

    res.json({
      success: true,
      data: {
        user: userResult.rows[0],
        accounts: accounts.rows,
        recent_activity: []
      }
    });
  } catch (error) {
    console.error('Error fetching user details:', error);
    next(error);
  }
};
exports.updateUserStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;
    const adminId = req.user.id;
    const validStatuses = ['active', 'suspended', 'closed'];
    if (!validStatuses.includes(status)) { return res.status(400).json({ success: false, message: 'Invalid status' }); }
    const result = await pool.query(`UPDATE users SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND deleted_at IS NULL RETURNING *`, [status, id]);
    if (result.rows.length === 0) { return res.status(404).json({ success: false, message: 'User not found' }); }
    await pool.query(`INSERT INTO audit_logs (user_id, action, entity_type, entity_id, changes) VALUES ($1, $2, $3, $4, $5)`, [adminId, 'USER_STATUS_CHANGED', 'user', id, JSON.stringify({ status, reason, changed_by: adminId })]);
    res.json({ success: true, message: 'User status updated successfully', data: result.rows[0] });
  } catch (error) { logger.error('Error updating user status:', error); next(error); }
};

exports.reviewKYC = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, rejection_reason, verification_level } = req.body;
    const adminId = req.user.id;

    const validStatuses = ['approved', 'rejected', 'under_review', 'pending'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid KYC status' });
    }

    if (status === 'rejected' && !rejection_reason) {
      return res.status(400).json({ success: false, message: 'Rejection reason required' });
    }

    // Update KYC status
    const result = await pool.query(
      `UPDATE user_kyc 
       SET status = $1,
           rejection_reason = $2,
           verification_level = $3,
           reviewed_at = CURRENT_TIMESTAMP,
           reviewed_by = $4,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $5
       RETURNING *`,
      [status, rejection_reason || null, verification_level || 0, adminId, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'KYC record not found' });
    }

    // If KYC approved, set user status to active
    if (status === 'approved') {
      await pool.query(
        `UPDATE users SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [id]
      );
    }

    // If KYC rejected, set user status to suspended
    if (status === 'rejected') {
      await pool.query(
        `UPDATE users SET status = 'suspended', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [id]
      );
    }

    res.json({
      success: true,
      message: 'KYC review completed',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error reviewing KYC:', error);
    next(error);
  }
};

exports.getPendingKYC = async (req, res, next) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    const result = await pool.query(`SELECT uk.*, u.email, u.first_name, u.last_name, u.created_at as user_created_at, (SELECT COUNT(*) FROM kyc_documents WHERE user_id = uk.user_id) as document_count FROM user_kyc uk INNER JOIN users u ON uk.user_id = u.id WHERE uk.status IN ('pending', 'under_review') ORDER BY uk.submitted_at DESC LIMIT $1 OFFSET $2`, [parseInt(limit), parseInt(offset)]);
    const countResult = await pool.query(`SELECT COUNT(*) FROM user_kyc WHERE status IN ('pending', 'under_review')`);
    res.json({ success: true, data: result.rows, pagination: { total: parseInt(countResult.rows[0].count), limit: parseInt(limit), offset: parseInt(offset) } });
  } catch (error) { logger.error('Error fetching pending KYC:', error); next(error); }
};

exports.getAllTransactions = async (req, res, next) => {
  try {
    const { type, status, start_date, end_date, limit = 50, offset = 0 } = req.query;
    let query = `SELECT t.*, a.account_number, u.email, u.first_name, u.last_name FROM transactions t INNER JOIN accounts a ON t.account_id = a.id INNER JOIN users u ON a.user_id = u.id WHERE 1=1`;
    const params = [];
    if (type) { params.push(type); query += ` AND t.type = $${params.length}`; }
    if (status) { params.push(status); query += ` AND t.status = $${params.length}`; }
    if (start_date) { params.push(start_date); query += ` AND t.created_at >= $${params.length}`; }
    if (end_date) { params.push(end_date); query += ` AND t.created_at <= $${params.length}`; }
    query += ` ORDER BY t.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));
    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (error) { logger.error('Error fetching transactions:', error); next(error); }
};

exports.getAllTickets = async (req, res, next) => {
  try {
    const { status, priority, category, limit = 50, offset = 0 } = req.query;
    let query = `SELECT st.*, u.email, u.first_name, u.last_name, (SELECT COUNT(*) FROM ticket_messages WHERE ticket_id = st.id) as message_count FROM support_tickets st INNER JOIN users u ON st.user_id = u.id WHERE 1=1`;
    const params = [];
    if (status) { params.push(status); query += ` AND st.status = $${params.length}`; }
    if (priority) { params.push(priority); query += ` AND st.priority = $${params.length}`; }
    if (category) { params.push(category); query += ` AND st.category = $${params.length}`; }
    query += ` ORDER BY st.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));
    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (error) { logger.error('Error fetching tickets:', error); next(error); }
};

exports.assignTicket = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { assigned_to } = req.body;
    const adminId = req.user.id;
    const result = await pool.query(`UPDATE support_tickets SET assigned_to = $1, status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`, [assigned_to || adminId, id]);
    if (result.rows.length === 0) { return res.status(404).json({ success: false, message: 'Ticket not found' }); }
    res.json({ success: true, message: 'Ticket assigned successfully', data: result.rows[0] });
  } catch (error) { logger.error('Error assigning ticket:', error); next(error); }
};

exports.getAuditLogs = async (req, res, next) => {
  try {
    const { user_id, action, start_date, end_date, limit = 100, offset = 0 } = req.query;
    let query = 'SELECT al.*, u.email, u.first_name, u.last_name FROM audit_logs al LEFT JOIN users u ON al.user_id = u.id WHERE 1=1';
    const params = [];
    if (user_id) { params.push(user_id); query += ` AND al.user_id = $${params.length}`; }
    if (action) { params.push(action); query += ` AND al.action = $${params.length}`; }
    if (start_date) { params.push(start_date); query += ` AND al.created_at >= $${params.length}`; }
    if (end_date) { params.push(end_date); query += ` AND al.created_at <= $${params.length}`; }
    query += ` ORDER BY al.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));
    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (error) { logger.error('Error fetching audit logs:', error); next(error); }
};

exports.getPlatformAnalytics = async (req, res, next) => {
  try {
    const { period = '30d' } = req.query;
    let interval = '30 days';
    if (period === '7d') interval = '7 days';
    if (period === '90d') interval = '90 days';
    if (period === '1y') interval = '1 year';
    const userGrowth = await pool.query(`SELECT DATE(created_at) as date, COUNT(*) as new_users FROM users WHERE created_at >= NOW() - INTERVAL '${interval}' GROUP BY DATE(created_at) ORDER BY date ASC`);
    const tradingVolume = await pool.query(`SELECT DATE(created_at) as date, COUNT(*) as order_count, SUM(filled_value) as volume FROM orders WHERE created_at >= NOW() - INTERVAL '${interval}' AND status = 'filled' GROUP BY DATE(created_at) ORDER BY date ASC`);
    const revenue = await pool.query(`SELECT DATE(created_at) as date, SUM(commission) as revenue FROM orders WHERE created_at >= NOW() - INTERVAL '${interval}' AND status = 'filled' GROUP BY DATE(created_at) ORDER BY date ASC`);
    res.json({ success: true, period, data: { user_growth: userGrowth.rows, trading_volume: tradingVolume.rows, revenue: revenue.rows } });
  } catch (error) { logger.error('Error fetching platform analytics:', error); next(error); }
};

exports.creditAccount = async (req, res, next) => {
exports.creditAccount = async (req, res, next) => {
  try {
    const { account_id } = req.params;
    const { amount, reason } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid amount' });
    }

    // Check if account exists
    const accountCheck = await pool.query('SELECT * FROM accounts WHERE id = $1', [account_id]);
    if (accountCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    const account = accountCheck.rows[0];

    // Update account balance
    const updatedAccount = await pool.query(
      `UPDATE accounts 
       SET cash_balance = cash_balance + $1, buying_power = buying_power + $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [amount, account_id]
    );

    // Create transaction record
    await pool.query(
      `INSERT INTO transactions (id, account_id, transaction_type, amount, status, description, reference_id, currency, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 'deposit', $2, 'completed', $3, $4, 'USD', NOW(), NOW())`,
      [account_id, amount, reason || 'Admin credit', 'ADMIN-CR-' + Date.now()]
    );

    res.json({
      success: true,
      message: 'Account credited successfully',
      data: { account: updatedAccount.rows[0] }
    });
  } catch (error) {
    console.error('Error crediting account:', error);
    next(error);
  }
};

exports.debitAccount = async (req, res, next) => {
exports.debitAccount = async (req, res, next) => {
  try {
    const { account_id } = req.params;
    const { amount, reason } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid amount' });
    }

    // Check if account exists
    const accountCheck = await pool.query('SELECT * FROM accounts WHERE id = $1', [account_id]);
    if (accountCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    const account = accountCheck.rows[0];
    const currentBalance = parseFloat(account.cash_balance);

    if (currentBalance < amount) {
      return res.status(400).json({ success: false, message: 'Insufficient balance' });
    }

    // Update account balance
    const updatedAccount = await pool.query(
      `UPDATE accounts 
       SET cash_balance = cash_balance - $1, buying_power = buying_power - $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [amount, account_id]
    );

    // Create transaction record
    await pool.query(
      `INSERT INTO transactions (id, account_id, transaction_type, amount, status, description, reference_id, currency, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 'withdrawal', $2, 'completed', $3, $4, 'USD', NOW(), NOW())`,
      [account_id, amount, reason || 'Admin debit', 'ADMIN-DB-' + Date.now()]
    );

    res.json({
      success: true,
      message: 'Account debited successfully',
      data: { account: updatedAccount.rows[0] }
    });
  } catch (error) {
    console.error('Error debiting account:', error);
    next(error);
  }
};

exports.getBalanceAdjustments = async (req, res, next) => {
  try {
    const { account_id } = req.params;
    const { limit = 50, offset = 0 } = req.query;
    const result = await pool.query(`SELECT t.*, u.email as admin_email, u.first_name as admin_first_name, u.last_name as admin_last_name FROM transactions t LEFT JOIN users u ON t.created_by = u.id WHERE t.account_id = $1 AND t.type IN ('credit', 'debit') AND t.metadata->>'admin_action' = 'true' ORDER BY t.created_at DESC LIMIT $2 OFFSET $3`, [account_id, parseInt(limit), parseInt(offset)]);
    const countResult = await pool.query(`SELECT COUNT(*) FROM transactions WHERE account_id = $1 AND type IN ('credit', 'debit') AND metadata->>'admin_action' = 'true'`, [account_id]);
    res.json({ success: true, data: result.rows, pagination: { total: parseInt(countResult.rows[0].count), limit: parseInt(limit), offset: parseInt(offset) } });
  } catch (error) { logger.error('Error fetching balance adjustments:', error); next(error); }
};

exports.getAllAccounts = async (req, res, next) => {
  try {
    const { status, search, min_balance, max_balance, limit = 50, offset = 0 } = req.query;
    let query = `SELECT a.*, u.email, u.first_name, u.last_name, u.status as user_status FROM accounts a INNER JOIN users u ON a.user_id = u.id WHERE 1=1`;
    const params = [];
    if (status) { params.push(status); query += ` AND a.status = $${params.length}`; }
    if (search) { params.push(`%${search}%`); query += ` AND (u.email ILIKE $${params.length} OR u.first_name ILIKE $${params.length} OR u.last_name ILIKE $${params.length} OR a.account_number ILIKE $${params.length})`; }
    if (min_balance) { params.push(min_balance); query += ` AND a.cash_balance >= $${params.length}`; }
    if (max_balance) { params.push(max_balance); query += ` AND a.cash_balance <= $${params.length}`; }
    query += ` ORDER BY a.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));
    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (error) { logger.error('Error fetching accounts:', error); next(error); }
};
