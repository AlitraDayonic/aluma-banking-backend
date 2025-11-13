// ============================================
// controllers/report.controller.js
// ============================================

const { pool } = require('../config/database');
const logger = require('../utils/logger');

// Get account statements
exports.getAccountStatements = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { account_id, year } = req.query;

    let query = `
      SELECT ast.*, a.account_number, a.account_type
      FROM account_statements ast
      INNER JOIN accounts a ON ast.account_id = a.id
      WHERE a.user_id = $1
    `;
    const params = [userId];

    if (account_id) {
      params.push(account_id);
      query += ` AND ast.account_id = $${params.length}`;
    }

    if (year) {
      params.push(year);
      query += ` AND EXTRACT(YEAR FROM ast.period_end) = $${params.length}`;
    }

    query += ' ORDER BY ast.period_end DESC';

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    logger.error('Error fetching statements:', error);
    next(error);
  }
};

// Generate account statement for a period
exports.generateStatement = async (req, res, next) => {
  const client = await pool.connect();
  
  try {
    const { account_id } = req.params;
    const { period_start, period_end } = req.body;
    const userId = req.user.id;

    await client.query('BEGIN');

    // Verify account ownership
    const accountCheck = await client.query(
      'SELECT * FROM accounts WHERE id = $1 AND user_id = $2',
      [account_id, userId]
    );

    if (accountCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Account not found'
      });
    }

    const account = accountCheck.rows[0];

    // Get opening balance (closing balance from previous period or initial balance)
    const previousStatement = await client.query(
      `SELECT closing_balance 
       FROM account_statements 
       WHERE account_id = $1 AND period_end < $2
       ORDER BY period_end DESC LIMIT 1`,
      [account_id, period_start]
    );

    const opening_balance = previousStatement.rows.length > 0
      ? previousStatement.rows[0].closing_balance
      : 0;

    // Get transactions for the period
    const transactions = await client.query(
      `SELECT * FROM transactions
       WHERE account_id = $1 
       AND created_at >= $2 
       AND created_at <= $3
       AND status = 'completed'
       ORDER BY created_at ASC`,
      [account_id, period_start, period_end]
    );

    // Calculate totals
    let total_deposits = 0;
    let total_withdrawals = 0;

    transactions.rows.forEach(txn => {
      if (['deposit', 'transfer_in', 'dividend', 'interest'].includes(txn.type)) {
        total_deposits += parseFloat(txn.amount);
      } else if (['withdrawal', 'transfer_out', 'fee'].includes(txn.type)) {
        total_withdrawals += parseFloat(Math.abs(txn.amount));
      }
    });

    // Get total trades
    const tradesCount = await client.query(
      `SELECT COUNT(*) as total_trades
       FROM orders
       WHERE account_id = $1 
       AND created_at >= $2 
       AND created_at <= $3
       AND status = 'filled'`,
      [account_id, period_start, period_end]
    );

    const closing_balance = account.cash_balance;

    // Create statement
    const statement = await client.query(
      `INSERT INTO account_statements 
       (account_id, period_start, period_end, opening_balance, closing_balance, 
        total_deposits, total_withdrawals, total_trades, statement_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        account_id,
        period_start,
        period_end,
        opening_balance,
        closing_balance,
        total_deposits,
        total_withdrawals,
        tradesCount.rows[0].total_trades,
        JSON.stringify({
          transactions: transactions.rows,
          account_info: account
        })
      ]
    );

    await client.query('COMMIT');

    logger.info('Statement generated', { 
      accountId: account_id, 
      userId,
      period: `${period_start} to ${period_end}`
    });

    res.status(201).json({
      success: true,
      message: 'Statement generated successfully',
      data: statement.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error generating statement:', error);
    next(error);
  } finally {
    client.release();
  }
};

// Get statement by ID
exports.getStatementById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT ast.*, a.account_number, a.account_type
       FROM account_statements ast
       INNER JOIN accounts a ON ast.account_id = a.id
       WHERE ast.id = $1 AND a.user_id = $2`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Statement not found'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Error fetching statement:', error);
    next(error);
  }
};

// Get tax documents
exports.getTaxDocuments = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { tax_year, document_type } = req.query;

    let query = 'SELECT * FROM tax_documents WHERE user_id = $1';
    const params = [userId];

    if (tax_year) {
      params.push(tax_year);
      query += ` AND tax_year = $${params.length}`;
    }

    if (document_type) {
      params.push(document_type);
      query += ` AND document_type = $${params.length}`;
    }

    query += ' ORDER BY tax_year DESC, generated_at DESC';

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    logger.error('Error fetching tax documents:', error);
    next(error);
  }
};

// Generate tax document (1099 form)
exports.generateTaxDocument = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { tax_year, document_type } = req.body;

    // Get user accounts
    const accounts = await pool.query(
      'SELECT * FROM accounts WHERE user_id = $1 AND status = $2',
      [userId, 'active']
    );

    if (accounts.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No active accounts found'
      });
    }

    // Calculate tax data for the year
    const startDate = `${tax_year}-01-01`;
    const endDate = `${tax_year}-12-31`;

    // Get dividends and interest
    const income = await pool.query(
      `SELECT type, SUM(amount) as total
       FROM transactions
       WHERE account_id = ANY($1)
       AND type IN ('dividend', 'interest')
       AND created_at >= $2
       AND created_at <= $3
       AND status = 'completed'
       GROUP BY type`,
      [accounts.rows.map(a => a.id), startDate, endDate]
    );

    // Get capital gains/losses from trades
    const trades = await pool.query(
      `SELECT 
        SUM(CASE WHEN side = 'sell' THEN filled_value ELSE 0 END) as total_proceeds,
        COUNT(*) FILTER (WHERE side = 'sell') as total_sales
       FROM orders
       WHERE account_id = ANY($1)
       AND created_at >= $2
       AND created_at <= $3
       AND status = 'filled'`,
      [accounts.rows.map(a => a.id), startDate, endDate]
    );

    const taxData = {
      tax_year: tax_year,
      dividends: income.rows.find(i => i.type === 'dividend')?.total || 0,
      interest: income.rows.find(i => i.type === 'interest')?.total || 0,
      total_proceeds: trades.rows[0]?.total_proceeds || 0,
      total_sales: trades.rows[0]?.total_sales || 0,
      accounts: accounts.rows.map(a => ({
        account_number: a.account_number,
        account_type: a.account_type
      }))
    };

    // Store tax document
    const result = await pool.query(
      `INSERT INTO tax_documents 
       (user_id, tax_year, document_type, document_data)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, tax_year, document_type || '1099', JSON.stringify(taxData)]
    );

    logger.info('Tax document generated', { 
      userId, 
      taxYear: tax_year,
      documentType: document_type 
    });

    res.status(201).json({
      success: true,
      message: 'Tax document generated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Error generating tax document:', error);
    next(error);
  }
};

// Get portfolio performance report
exports.getPortfolioPerformance = async (req, res, next) => {
  try {
    const { account_id } = req.params;
    const userId = req.user.id;
    const { period = '1M' } = req.query;

    // Verify account ownership
    const accountCheck = await pool.query(
      'SELECT * FROM accounts WHERE id = $1 AND user_id = $2',
      [account_id, userId]
    );

    if (accountCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Account not found'
      });
    }

    const account = accountCheck.rows[0];

    // Calculate date range
    let startDate;
    const endDate = new Date();
    
    switch(period) {
      case '1D':
        startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '1W':
        startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '1M':
        startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '3M':
        startDate = new Date(endDate.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case '1Y':
        startDate = new Date(endDate.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Get current positions
    const positions = await pool.query(
      `SELECT p.*, s.symbol, s.name, s.last_price, s.change_percent
       FROM positions p
       INNER JOIN securities s ON p.security_id = s.id
       WHERE p.account_id = $1 AND p.quantity > 0`,
      [account_id]
    );

    // Calculate total gains/losses
    let total_gain_loss = 0;
    let total_investment = 0;

    positions.rows.forEach(pos => {
      const cost_basis = parseFloat(pos.average_cost) * pos.quantity;
      const current_value = parseFloat(pos.market_value);
      total_investment += cost_basis;
      total_gain_loss += (current_value - cost_basis);
    });

    const total_return_pct = total_investment > 0 
      ? (total_gain_loss / total_investment) * 100 
      : 0;

    // Get transactions in period
    const transactions = await pool.query(
      `SELECT type, COUNT(*) as count, SUM(amount) as total
       FROM transactions
       WHERE account_id = $1
       AND created_at >= $2
       AND created_at <= $3
       AND status = 'completed'
       GROUP BY type`,
      [account_id, startDate, endDate]
    );

    const total_value = parseFloat(account.cash_balance) + 
                       parseFloat(account.market_value || 0);

    res.json({
      success: true,
      data: {
        period,
        account_summary: {
          cash_balance: account.cash_balance,
          market_value: account.market_value,
          total_value: total_value,
          buying_power: account.buying_power
        },
        performance: {
          total_gain_loss: total_gain_loss.toFixed(2),
          total_return_pct: total_return_pct.toFixed(2),
          total_investment: total_investment.toFixed(2)
        },
        positions: positions.rows,
        activity: transactions.rows
      }
    });
  } catch (error) {
    logger.error('Error generating portfolio performance:', error);
    next(error);
  }
};

// Get transaction history report
exports.getTransactionHistory = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { 
      account_id, 
      type, 
      start_date, 
      end_date,
      limit = 100,
      offset = 0
    } = req.query;

    let query = `
      SELECT t.*, a.account_number
      FROM transactions t
      INNER JOIN accounts a ON t.account_id = a.id
      WHERE a.user_id = $1
    `;
    const params = [userId];

    if (account_id) {
      params.push(account_id);
      query += ` AND t.account_id = $${params.length}`;
    }

    if (type) {
      params.push(type);
      query += ` AND t.type = $${params.length}`;
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

    // Get total count
    let countQuery = `
      SELECT COUNT(*) 
      FROM transactions t
      INNER JOIN accounts a ON t.account_id = a.id
      WHERE a.user_id = $1
    `;
    const countParams = [userId];

    if (account_id) {
      countParams.push(account_id);
      countQuery += ` AND t.account_id = $${countParams.length}`;
    }

    if (type) {
      countParams.push(type);
      countQuery += ` AND t.type = $${countParams.length}`;
    }

    if (start_date) {
      countParams.push(start_date);
      countQuery += ` AND t.created_at >= $${countParams.length}`;
    }

    if (end_date) {
      countParams.push(end_date);
      countQuery += ` AND t.created_at <= $${countParams.length}`;
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
    logger.error('Error fetching transaction history:', error);
    next(error);
  }
};

// Get trading activity summary
exports.getTradingSummary = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { account_id, start_date, end_date } = req.query;

    let accountIds;
    if (account_id) {
      accountIds = [account_id];
    } else {
      const accountsResult = await pool.query(
        'SELECT id FROM accounts WHERE user_id = $1',
        [userId]
      );
      accountIds = accountsResult.rows.map(a => a.id);
    }

    let dateFilter = '';
    const params = [accountIds];

    if (start_date) {
      params.push(start_date);
      dateFilter += ` AND created_at >= $${params.length}`;
    }

    if (end_date) {
      params.push(end_date);
      dateFilter += ` AND created_at <= $${params.length}`;
    }

    const summary = await pool.query(
      `SELECT 
        COUNT(*) as total_orders,
        COUNT(*) FILTER (WHERE status = 'filled') as filled_orders,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_orders,
        COUNT(*) FILTER (WHERE side = 'buy') as buy_orders,
        COUNT(*) FILTER (WHERE side = 'sell') as sell_orders,
        SUM(filled_value) FILTER (WHERE status = 'filled') as total_value,
        SUM(commission) as total_commissions,
        AVG(filled_value) FILTER (WHERE status = 'filled') as avg_order_value
       FROM orders
       WHERE account_id = ANY($1) ${dateFilter}`,
      params
    );

    res.json({
      success: true,
      data: summary.rows[0]
    });
  } catch (error) {
    logger.error('Error fetching trading summary:', error);
    next(error);
  }
};