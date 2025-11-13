// ============================================
// controllers/account.controller.js
// Account Management Controller
// ============================================

const { query, transaction } = require('../config/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

/**
 * @route   GET /api/v1/accounts
 * @desc    Get all user accounts
 * @access  Private
 */
const getAccounts = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const result = await query(`
    SELECT 
      a.*,
      (SELECT COUNT(*) FROM positions p WHERE p.account_id = a.id AND p.quantity > 0) as positions_count,
      a.cash_balance + COALESCE((SELECT SUM(market_value) FROM positions WHERE account_id = a.id), 0) as total_value
    FROM accounts a
    WHERE a.user_id = $1 AND a.status != 'closed'
    ORDER BY a.created_at DESC
  `, [userId]);

  res.json({
    success: true,
    data: {
      accounts: result.rows
    }
  });
});

/**
 * @route   POST /api/v1/accounts
 * @desc    Create new account
 * @access  Private
 */
const createAccount = asyncHandler(async (req, res) => {
  const { accountType, accountName } = req.body;
  const userId = req.user.id;

  // Check KYC status
  const kycResult = await query(
    'SELECT status FROM user_kyc WHERE user_id = $1',
    [userId]
  );

  if (kycResult.rows.length === 0 || kycResult.rows[0].status !== 'approved') {
    throw new AppError('KYC verification required to open an account', 403);
  }

  // Check account limit (max 5 accounts per user)
  const accountCountResult = await query(
    'SELECT COUNT(*) as count FROM accounts WHERE user_id = $1 AND status != $2',
    [userId, 'closed']
  );

  if (parseInt(accountCountResult.rows[0].count) >= 5) {
    throw new AppError('Maximum account limit reached (5 accounts)', 400);
  }

  // Create account
  const result = await transaction(async (client) => {
    // Generate account number
    const accountNumber = await client.query('SELECT generate_account_number() as number');
    
    // Insert account
    const accountResult = await client.query(`
      INSERT INTO accounts (
        user_id, account_number, account_type, account_name, status
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [userId, accountNumber.rows[0].number, accountType, accountName, 'active']);

    // Create initial transaction record
    await client.query(`
      INSERT INTO transactions (
        account_id, type, amount, description, status
      ) VALUES ($1, $2, $3, $4, $5)
    `, [
      accountResult.rows[0].id,
      'adjustment',
      0,
      'Account opened',
      'completed'
    ]);

    return accountResult.rows[0];
  });

  logger.info(`New account created: ${result.id} for user: ${userId}`);

  res.status(201).json({
    success: true,
    message: 'Account created successfully',
    data: {
      account: result
    }
  });
});

/**
 * @route   GET /api/v1/accounts/:id
 * @desc    Get account details
 * @access  Private
 */
const getAccountById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const result = await query(`
    SELECT 
      a.*,
      (SELECT COUNT(*) FROM positions p WHERE p.account_id = a.id AND p.quantity > 0) as positions_count,
      a.cash_balance + COALESCE((SELECT SUM(market_value) FROM positions WHERE account_id = a.id), 0) as total_value,
      COALESCE((SELECT SUM(market_value) FROM positions WHERE account_id = a.id), 0) as securities_value
    FROM accounts a
    WHERE a.id = $1 AND a.user_id = $2
  `, [id, userId]);

  if (result.rows.length === 0) {
    throw new AppError('Account not found', 404);
  }

  res.json({
    success: true,
    data: {
      account: result.rows[0]
    }
  });
});

/**
 * @route   GET /api/v1/accounts/:id/balance
 * @desc    Get account balance details
 * @access  Private
 */
const getAccountBalance = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  // Verify ownership
  const accountResult = await query(
    'SELECT * FROM accounts WHERE id = $1 AND user_id = $2',
    [id, userId]
  );

  if (accountResult.rows.length === 0) {
    throw new AppError('Account not found', 404);
  }

  const account = accountResult.rows[0];

  // Get positions value
  const positionsResult = await query(`
    SELECT COALESCE(SUM(market_value), 0) as total_value
    FROM positions
    WHERE account_id = $1 AND quantity > 0
  `, [id]);

  const positionsValue = parseFloat(positionsResult.rows[0].total_value);
  const cashBalance = parseFloat(account.cash_balance);
  const totalValue = cashBalance + positionsValue;

  // Calculate buying power (simplified - doesn't account for margin)
  const buyingPower = cashBalance;

  res.json({
    success: true,
    data: {
      balance: {
        cashBalance,
        positionsValue,
        totalValue,
        buyingPower,
        currency: account.currency
      }
    }
  });
});

/**
 * @route   GET /api/v1/accounts/:id/positions
 * @desc    Get account positions
 * @access  Private
 */
const getAccountPositions = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  // Verify ownership
  const accountResult = await query(
    'SELECT id FROM accounts WHERE id = $1 AND user_id = $2',
    [id, userId]
  );

  if (accountResult.rows.length === 0) {
    throw new AppError('Account not found', 404);
  }

  const result = await query(`
    SELECT 
      p.*,
      s.symbol,
      s.name as security_name,
      s.last_price as current_price,
      s.exchange,
      (p.quantity * s.last_price) as current_value,
      ((s.last_price - p.average_cost) * p.quantity) as unrealized_gain_loss,
      (((s.last_price - p.average_cost) / p.average_cost) * 100) as gain_loss_percent
    FROM positions p
    INNER JOIN securities s ON p.security_id = s.id
    WHERE p.account_id = $1 AND p.quantity > 0
    ORDER BY p.market_value DESC
  `, [id]);

  res.json({
    success: true,
    data: {
      positions: result.rows
    }
  });
});

/**
 * @route   GET /api/v1/accounts/:id/activity
 * @desc    Get account activity/transactions
 * @access  Private
 */
const getAccountActivity = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const { startDate, endDate, type, limit = 50, offset = 0 } = req.query;

  // Verify ownership
  const accountResult = await query(
    'SELECT id FROM accounts WHERE id = $1 AND user_id = $2',
    [id, userId]
  );

  if (accountResult.rows.length === 0) {
    throw new AppError('Account not found', 404);
  }

  let whereConditions = ['account_id = $1'];
  const values = [id];
  let paramCount = 1;

  if (startDate) {
    paramCount++;
    whereConditions.push(`created_at >= $${paramCount}`);
    values.push(startDate);
  }

  if (endDate) {
    paramCount++;
    whereConditions.push(`created_at <= $${paramCount}`);
    values.push(endDate);
  }

  if (type) {
    paramCount++;
    whereConditions.push(`type = $${paramCount}`);
    values.push(type);
  }

  values.push(parseInt(limit), parseInt(offset));

  const result = await query(`
    SELECT *
    FROM transactions
    WHERE ${whereConditions.join(' AND ')}
    ORDER BY created_at DESC
    LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
  `, values);

  const countResult = await query(`
    SELECT COUNT(*) as total
    FROM transactions
    WHERE ${whereConditions.join(' AND ')}
  `, values.slice(0, -2));

  res.json({
    success: true,
    data: {
      transactions: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].total),
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    }
  });
});

/**
 * @route   PUT /api/v1/accounts/:id
 * @desc    Update account (limited fields)
 * @access  Private
 */
const updateAccount = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { accountName } = req.body;
  const userId = req.user.id;

  // Verify ownership
  const accountResult = await query(
    'SELECT id FROM accounts WHERE id = $1 AND user_id = $2',
    [id, userId]
  );

  if (accountResult.rows.length === 0) {
    throw new AppError('Account not found', 404);
  }

  const result = await query(`
    UPDATE accounts
    SET account_name = $1, updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
    RETURNING *
  `, [accountName, id]);

  res.json({
    success: true,
    message: 'Account updated successfully',
    data: {
      account: result.rows[0]
    }
  });
});

/**
 * @route   POST /api/v1/accounts/:id/close
 * @desc    Close account
 * @access  Private
 */
const closeAccount = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  // Verify ownership
  const accountResult = await query(
    'SELECT * FROM accounts WHERE id = $1 AND user_id = $2',
    [id, userId]
  );

  if (accountResult.rows.length === 0) {
    throw new AppError('Account not found', 404);
  }

  const account = accountResult.rows[0];

  // Check if account can be closed
  const positionsResult = await query(
    'SELECT COUNT(*) as count FROM positions WHERE account_id = $1 AND quantity > 0',
    [id]
  );

  if (parseInt(positionsResult.rows[0].count) > 0) {
    throw new AppError('Cannot close account with open positions', 400);
  }

  if (parseFloat(account.cash_balance) > 0) {
    throw new AppError('Please withdraw all cash before closing account', 400);
  }

  // Check for pending orders
  const ordersResult = await query(
    "SELECT COUNT(*) as count FROM orders WHERE account_id = $1 AND status IN ('pending', 'open')",
    [id]
  );

  if (parseInt(ordersResult.rows[0].count) > 0) {
    throw new AppError('Cannot close account with pending orders', 400);
  }

  // Close account
  await query(`
    UPDATE accounts
    SET status = 'closed', closed_at = CURRENT_TIMESTAMP
    WHERE id = $1
  `, [id]);

  logger.info(`Account closed: ${id}`);

  res.json({
    success: true,
    message: 'Account closed successfully'
  });
});

module.exports = {
  getAccounts,
  createAccount,
  getAccountById,
  getAccountBalance,
  getAccountPositions,
  getAccountActivity,
  updateAccount,
  closeAccount
};