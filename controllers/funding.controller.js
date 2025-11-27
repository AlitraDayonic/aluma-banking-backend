// ============================================
// controllers/funding.controller.js
// Funding Operations Controller (FIXED)
// ============================================

const { query, transaction } = require('../config/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

/**
 * @route   POST /api/v1/funding/deposits
 * @desc    Initiate deposit
 * @access  Private
 */
const initiateDeposit = asyncHandler(async (req, res) => {
  const { accountId, bankAccountId, amount, notes } = req.body;
  const userId = req.user.id;

  // Verify account ownership
  const accountResult = await query(
    'SELECT * FROM accounts WHERE id = $1 AND user_id = $2 AND status = $3',
    [accountId, userId, 'active']
  );

  if (accountResult.rows.length === 0) {
    throw new AppError('Account not found or inactive', 404);
  }

  // Verify bank account ownership (FIXED: using linked_bank_accounts)
  const bankResult = await query(
    'SELECT * FROM linked_bank_accounts WHERE id = $1 AND user_id = $2',
    [bankAccountId, userId]
  );

  if (bankResult.rows.length === 0) {
    throw new AppError('Bank account not found', 404);
  }

  const bankAccount = bankResult.rows[0];

  if (!bankAccount.is_verified) {
    throw new AppError('Bank account must be verified before deposits', 400);
  }

  // Validate amount
  if (amount <= 0 || amount > 1000000) {
    throw new AppError('Invalid deposit amount. Must be between $0.01 and $1,000,000', 400);
  }

  // Create deposit record
  const result = await transaction(async (client) => {
    // Insert deposit
    const depositResult = await client.query(`
      INSERT INTO deposits (
        account_id, bank_account_id, amount, status, notes
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [accountId, bankAccountId, amount, 'pending', notes]);

    const deposit = depositResult.rows[0];

    // Get last 4 digits of account number (FIXED: decrypt or extract)
    const last4 = bankAccount.account_number_encrypted.slice(-4);

    // Create pending transaction
    await client.query(`
      INSERT INTO transactions (
        account_id, type, amount, reference_id, description, status
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      accountId,
      'deposit',
      amount,
      deposit.id,
      `Deposit from ${bankAccount.bank_name} (****${last4})`,
      'pending'
    ]);

    // In real implementation, integrate with payment processor here
    // For now, we'll simulate instant approval for testing
    if (process.env.NODE_ENV === 'development') {
      // Auto-approve in development
      await client.query(`
        UPDATE deposits
        SET status = 'completed', completed_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [deposit.id]);

      await client.query(`
        UPDATE accounts
        SET cash_balance = cash_balance + $1
        WHERE id = $2
      `, [amount, accountId]);

      await client.query(`
        UPDATE transactions
        SET status = 'completed', completed_at = CURRENT_TIMESTAMP
        WHERE reference_id = $1
      `, [deposit.id]);

      deposit.status = 'completed';
      deposit.completed_at = new Date();
    }

    return deposit;
  });

  logger.info(`Deposit initiated: ${result.id}, Amount: $${amount}`);

  res.status(201).json({
    success: true,
    message: 'Deposit initiated successfully',
    data: {
      deposit: result
    }
  });
});

/**
 * @route   POST /api/v1/funding/withdrawals
 * @desc    Request withdrawal
 * @access  Private
 */
const requestWithdrawal = asyncHandler(async (req, res) => {
  const { accountId, bankAccountId, amount, notes } = req.body;
  const userId = req.user.id;

  // Verify account ownership
  const accountResult = await query(
    'SELECT * FROM accounts WHERE id = $1 AND user_id = $2 AND status = $3',
    [accountId, userId, 'active']
  );

  if (accountResult.rows.length === 0) {
    throw new AppError('Account not found or inactive', 404);
  }

  const account = accountResult.rows[0];

  // Verify bank account ownership (FIXED: using linked_bank_accounts)
  const bankResult = await query(
    'SELECT * FROM linked_bank_accounts WHERE id = $1 AND user_id = $2',
    [bankAccountId, userId]
  );

  if (bankResult.rows.length === 0) {
    throw new AppError('Bank account not found', 404);
  }

  const bankAccount = bankResult.rows[0];

  if (!bankAccount.is_verified) {
    throw new AppError('Bank account must be verified before withdrawals', 400);
  }

  // Validate amount
  if (amount <= 0 || amount > 1000000) {
    throw new AppError('Invalid withdrawal amount. Must be between $0.01 and $1,000,000', 400);
  }

  // Check sufficient balance
  const cashBalance = parseFloat(account.cash_balance);
  if (cashBalance < amount) {
    throw new AppError('Insufficient cash balance', 400);
  }

  // Check for pending withdrawals
  const pendingResult = await query(
    "SELECT COUNT(*) as count FROM withdrawals WHERE account_id = $1 AND status IN ('pending', 'processing')",
    [accountId]
  );

  if (parseInt(pendingResult.rows[0].count) >= 3) {
    throw new AppError('Maximum pending withdrawals limit reached (3)', 400);
  }

  // Create withdrawal record
  const result = await transaction(async (client) => {
    // Insert withdrawal
    const withdrawalResult = await client.query(`
      INSERT INTO withdrawals (
        account_id, bank_account_id, amount, status, notes
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [accountId, bankAccountId, amount, 'pending', notes]);

    const withdrawal = withdrawalResult.rows[0];

    // Deduct from account (hold the funds)
    await client.query(`
      UPDATE accounts
      SET cash_balance = cash_balance - $1
      WHERE id = $2
    `, [amount, accountId]);

    // Get last 4 digits (FIXED)
    const last4 = bankAccount.account_number_encrypted.slice(-4);

    // Create transaction record
    await client.query(`
      INSERT INTO transactions (
        account_id, type, amount, reference_id, description, status
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      accountId,
      'withdrawal',
      -amount,
      withdrawal.id,
      `Withdrawal to ${bankAccount.bank_name} (****${last4})`,
      'pending'
    ]);

    return withdrawal;
  });

  logger.info(`Withdrawal requested: ${result.id}, Amount: $${amount}`);

  res.status(201).json({
    success: true,
    message: 'Withdrawal request submitted successfully',
    data: {
      withdrawal: result
    }
  });
});

/**
 * @route   POST /api/v1/funding/transfers
 * @desc    Internal transfer between accounts
 * @access  Private
 */
const internalTransfer = asyncHandler(async (req, res) => {
  const { fromAccountId, toAccountId, amount, notes } = req.body;
  const userId = req.user.id;

  // Verify both accounts belong to user
  const accountsResult = await query(
    'SELECT * FROM accounts WHERE id IN ($1, $2) AND user_id = $3 AND status = $4',
    [fromAccountId, toAccountId, userId, 'active']
  );

  if (accountsResult.rows.length !== 2) {
    throw new AppError('One or both accounts not found', 404);
  }

  const fromAccount = accountsResult.rows.find(a => a.id === fromAccountId);
  const toAccount = accountsResult.rows.find(a => a.id === toAccountId);

  // Validate amount
  if (amount <= 0) {
    throw new AppError('Invalid transfer amount', 400);
  }

  // Check sufficient balance
  if (parseFloat(fromAccount.cash_balance) < amount) {
    throw new AppError('Insufficient balance in source account', 400);
  }

  // Perform transfer
  await transaction(async (client) => {
    // Deduct from source
    await client.query(`
      UPDATE accounts
      SET cash_balance = cash_balance - $1
      WHERE id = $2
    `, [amount, fromAccountId]);

    // Add to destination
    await client.query(`
      UPDATE accounts
      SET cash_balance = cash_balance + $1
      WHERE id = $2
    `, [amount, toAccountId]);

    // Create transaction records
    await client.query(`
      INSERT INTO transactions (
        account_id, type, amount, description, status
      ) VALUES 
      ($1, $2, $3, $4, $5),
      ($6, $7, $8, $9, $10)
    `, [
      fromAccountId,
      'transfer_out',
      -amount,
      `Transfer to account ${toAccount.account_number}${notes ? ': ' + notes : ''}`,
      'completed',
      toAccountId,
      'transfer_in',
      amount,
      `Transfer from account ${fromAccount.account_number}${notes ? ': ' + notes : ''}`,
      'completed'
    ]);
  });

  logger.info(`Internal transfer: ${fromAccountId} -> ${toAccountId}, Amount: $${amount}`);

  res.json({
    success: true,
    message: 'Transfer completed successfully',
    data: {
      fromAccount: fromAccountId,
      toAccount: toAccountId,
      amount
    }
  });
});

     /**
 * @route   POST /api/v1/funding/transfers/external
 * @desc    Transfer to another user's account by account number
 * @access  Private
 */
const externalTransfer = asyncHandler(async (req, res) => {
  const { fromAccountId, toAccountNumber, amount, notes } = req.body;
  const userId = req.user.id;

  // Verify source account ownership
  const fromAccountResult = await query(
    'SELECT * FROM accounts WHERE id = $1 AND user_id = $2 AND status = $3',
    [fromAccountId, userId, 'active']
  );

  if (fromAccountResult.rows.length === 0) {
    throw new AppError('Source account not found or inactive', 404);
  }

  const fromAccount = fromAccountResult.rows[0];

  // Find destination account by account number
  const toAccountResult = await query(
    'SELECT * FROM accounts WHERE account_number = $1 AND status = $2',
    [toAccountNumber, 'active']
  );

  if (toAccountResult.rows.length === 0) {
    throw new AppError('Recipient account not found', 404);
  }

  const toAccount = toAccountResult.rows[0];

  // Prevent transfer to same account
  if (fromAccount.id === toAccount.id) {
    throw new AppError('Cannot transfer to the same account', 400);
  }

  // Validate amount
  if (amount <= 0) {
    throw new AppError('Invalid transfer amount', 400);
  }

  // Check sufficient balance
  const cashBalance = parseFloat(fromAccount.cash_balance);
  if (cashBalance < amount) {
    throw new AppError('Insufficient balance', 400);
  }

  // Get recipient user info for transaction description
  const recipientResult = await query(
    'SELECT first_name, last_name FROM users WHERE id = $1',
    [toAccount.user_id]
  );

  const recipientName = recipientResult.rows.length > 0 
    ? `${recipientResult.rows[0].first_name} ${recipientResult.rows[0].last_name}`.trim()
    : 'Unknown';

  // Get sender info
  const senderResult = await query(
    'SELECT first_name, last_name FROM users WHERE id = $1',
    [userId]
  );

  const senderName = senderResult.rows.length > 0 
    ? `${senderResult.rows[0].first_name} ${senderResult.rows[0].last_name}`.trim()
    : 'Unknown';

  // Perform transfer
  await transaction(async (client) => {
    // Deduct from source
    await client.query(`
      UPDATE accounts
      SET cash_balance = cash_balance - $1
      WHERE id = $2
    `, [amount, fromAccount.id]);

    // Add to destination
    await client.query(`
      UPDATE accounts
      SET cash_balance = cash_balance + $1
      WHERE id = $2
    `, [amount, toAccount.id]);

    // Create transaction records
    await client.query(`
      INSERT INTO transactions (
        account_id, type, amount, description, status
      ) VALUES 
      ($1, $2, $3, $4, $5),
      ($6, $7, $8, $9, $10)
    `, [
      fromAccount.id,
      'transfer_out',
      -amount,
      `Transfer to ${recipientName} (${toAccount.account_number})${notes ? ': ' + notes : ''}`,
      'completed',
      toAccount.id,
      'transfer_in',
      amount,
      `Transfer from ${senderName} (${fromAccount.account_number})${notes ? ': ' + notes : ''}`,
      'completed'
    ]);
  });

  logger.info(`External transfer: ${fromAccount.id} -> ${toAccount.id}, Amount: $${amount}`);

  res.json({
    success: true,
    message: 'Transfer completed successfully',
    data: {
      fromAccount: fromAccount.id,
      toAccount: toAccount.id,
      toAccountNumber: toAccount.account_number,
      recipientName: recipientName,
      amount
    }
  });
});

// Add this to module.exports at the bottom of funding.controller.js
module.exports = {
  initiateDeposit,
  requestWithdrawal,
  internalTransfer,
  externalTransfer,  // ADD THIS LINE
  getFundingTransactions,
  getBankAccounts,
  linkBankAccount,
  removeBankAccount
}; 

/**
 * @route   GET /api/v1/funding/transactions
 * @desc    Get funding transactions
 * @access  Private
 */
const getFundingTransactions = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { accountId, type, status, limit = 50, offset = 0 } = req.query;

  let whereConditions = ['a.user_id = $1'];
  const values = [userId];
  let paramCount = 1;

  if (accountId) {
    paramCount++;
    whereConditions.push(`t.account_id = $${paramCount}`);
    values.push(accountId);
  }

  if (type) {
    paramCount++;
    whereConditions.push(`t.type = $${paramCount}`);
    values.push(type);
  }

  if (status) {
    paramCount++;
    whereConditions.push(`t.status = $${paramCount}`);
    values.push(status);
  }

  values.push(parseInt(limit), parseInt(offset));

  const result = await query(`
    SELECT 
      t.*,
      a.account_number
    FROM transactions t
    INNER JOIN accounts a ON t.account_id = a.id
    WHERE ${whereConditions.join(' AND ')}
    AND t.type IN ('deposit', 'withdrawal', 'transfer_in', 'transfer_out')
    ORDER BY t.created_at DESC
    LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
  `, values);

  const countResult = await query(`
    SELECT COUNT(*) as total
    FROM transactions t
    INNER JOIN accounts a ON t.account_id = a.id
    WHERE ${whereConditions.join(' AND ')}
    AND t.type IN ('deposit', 'withdrawal', 'transfer_in', 'transfer_out')
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
 * @route   GET /api/v1/funding/bank-accounts
 * @desc    Get linked bank accounts
 * @access  Private
 */
const getBankAccounts = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  // FIXED: Query from linked_bank_accounts with correct columns
  const result = await query(`
    SELECT 
      id, bank_name, account_holder_name, account_type,
      RIGHT(account_number_encrypted, 4) as account_number_last4,
      is_verified, is_default as is_primary, created_at
    FROM linked_bank_accounts
    WHERE user_id = $1
    ORDER BY is_default DESC, created_at DESC
  `, [userId]);

  res.json({
    success: true,
    data: {
      bankAccounts: result.rows
    }
  });
});

/**
 * @route   POST /api/v1/funding/bank-accounts
 * @desc    Link new bank account
 * @access  Private
 */
const linkBankAccount = asyncHandler(async (req, res) => {
  const {
    bankName,
    accountHolderName,
    accountType,
    accountNumber,
    routingNumber
  } = req.body;
  const userId = req.user.id;

  // In production, properly encrypt these values
  // For now, storing as-is (you should use encryption in production!)

  const last4 = accountNumber.slice(-4);

  // Check if already linked (FIXED)
  const existingResult = await query(
    'SELECT id FROM linked_bank_accounts WHERE user_id = $1 AND RIGHT(account_number_encrypted, 4) = $2',
    [userId, last4]
  );

  if (existingResult.rows.length > 0) {
    throw new AppError('Bank account already linked', 400);
  }

  // Check if this should be default/primary (FIXED)
  const countResult = await query(
    'SELECT COUNT(*) as count FROM linked_bank_accounts WHERE user_id = $1',
    [userId]
  );

  const isDefault = parseInt(countResult.rows[0].count) === 0;

  // FIXED: Insert into linked_bank_accounts with correct columns
  const result = await query(`
    INSERT INTO linked_bank_accounts (
      user_id, bank_name, account_holder_name, account_type,
      account_number_encrypted, routing_number_encrypted, is_default, is_verified
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, bank_name, account_holder_name, account_type,
              RIGHT(account_number_encrypted, 4) as account_number_last4,
              is_verified, is_default as is_primary, created_at
  `, [userId, bankName, accountHolderName, accountType, accountNumber, routingNumber, isDefault, false]);

  logger.info(`Bank account linked for user: ${userId}`);

  res.status(201).json({
    success: true,
    message: 'Bank account linked successfully. Verification pending.',
    data: {
      bankAccount: result.rows[0]
    }
  });
});

/**
 * @route   DELETE /api/v1/funding/bank-accounts/:id
 * @desc    Remove bank account
 * @access  Private
 */
const removeBankAccount = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  // Verify ownership (FIXED)
  const bankResult = await query(
    'SELECT * FROM linked_bank_accounts WHERE id = $1 AND user_id = $2',
    [id, userId]
  );

  if (bankResult.rows.length === 0) {
    throw new AppError('Bank account not found', 404);
  }

  // Check for pending transactions
  const pendingResult = await query(`
    SELECT COUNT(*) as count
    FROM withdrawals w
    INNER JOIN accounts a ON w.account_id = a.id
    WHERE w.bank_account_id = $1 AND a.user_id = $2 AND w.status IN ('pending', 'processing')
    UNION ALL
    SELECT COUNT(*) as count
    FROM deposits d
    INNER JOIN accounts a ON d.account_id = a.id
    WHERE d.bank_account_id = $1 AND a.user_id = $2 AND d.status IN ('pending', 'processing')
  `, [id, userId]);

  const totalPending = pendingResult.rows.reduce((sum, row) => sum + parseInt(row.count), 0);

  if (totalPending > 0) {
    throw new AppError('Cannot remove bank account with pending transactions', 400);
  }

  // Hard delete (since there's no status column in linked_bank_accounts)
  await query(`
    DELETE FROM linked_bank_accounts
    WHERE id = $1
  `, [id]);

  logger.info(`Bank account removed: ${id}`);

  res.json({
    success: true,
    message: 'Bank account removed successfully'
  });
});

module.exports = {
  initiateDeposit,
  requestWithdrawal,
  internalTransfer,
  getFundingTransactions,
  getBankAccounts,
  linkBankAccount,
  externalTransfer,
  removeBankAccount
};
