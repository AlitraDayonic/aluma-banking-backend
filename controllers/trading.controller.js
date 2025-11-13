// ============================================
// controllers/trading.controller.js
// Trading Operations Controller
// ============================================

const { query, transaction } = require('../config/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');
const marketDataService = require('../services/marketData.service');
const { emitOrderUpdate } = require('../websocket/handler');
const { addEmailJob } = require('../jobs');

/**
 * @route   POST /api/v1/trading/orders
 * @desc    Place a new order
 * @access  Private
 */
const placeOrder = asyncHandler(async (req, res) => {
  const {
    accountId,
    symbol,
    side, // 'buy' or 'sell'
    orderType, // 'market', 'limit', 'stop', 'stop_limit'
    quantity,
    limitPrice,
    stopPrice,
    timeInForce, // 'day', 'gtc' (good till cancelled), 'ioc' (immediate or cancel)
    extendedHours
  } = req.body;

  const userId = req.user.id;

  // Validate account ownership
  const accountResult = await query(
    'SELECT * FROM accounts WHERE id = $1 AND user_id = $2 AND status = $3',
    [accountId, userId, 'active']
  );

  if (accountResult.rows.length === 0) {
    throw new AppError('Account not found or inactive', 404);
  }

  const account = accountResult.rows[0];

  // Check KYC status
  const kycResult = await query(
    'SELECT status FROM user_kyc WHERE user_id = $1',
    [userId]
  );

  if (kycResult.rows.length === 0 || kycResult.rows[0].status !== 'approved') {
    throw new AppError('KYC verification required to trade', 403);
  }

  // Get security information
  const securityResult = await query(
    'SELECT * FROM securities WHERE symbol = $1',
    [symbol.toUpperCase()]
  );

  let security;
  if (securityResult.rows.length === 0) {
    // Fetch from market data API and create security
    try {
      const overview = await marketDataService.getCompanyOverview(symbol);
      const quote = await marketDataService.getQuote(symbol);

      const insertResult = await query(`
        INSERT INTO securities (symbol, name, exchange, currency, last_price, updated_at)
        VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
        RETURNING *
      `, [overview.symbol, overview.name, overview.exchange, overview.currency, quote.price]);

      security = insertResult.rows[0];
    } catch (error) {
      throw new AppError(`Invalid symbol: ${symbol}`, 400);
    }
  } else {
    security = securityResult.rows[0];
  }

  // Validate order parameters
  if (quantity <= 0) {
    throw new AppError('Quantity must be greater than 0', 400);
  }

  if (orderType === 'limit' && (!limitPrice || limitPrice <= 0)) {
    throw new AppError('Limit price required for limit orders', 400);
  }

  if ((orderType === 'stop' || orderType === 'stop_limit') && (!stopPrice || stopPrice <= 0)) {
    throw new AppError('Stop price required for stop orders', 400);
  }

  // Get current market price
  const currentQuote = await marketDataService.getQuote(symbol);
  const currentPrice = currentQuote.price;

  // Calculate estimated order value
  let estimatedPrice = currentPrice;
  if (orderType === 'limit') {
    estimatedPrice = limitPrice;
  }

  const estimatedValue = quantity * estimatedPrice;

  // Check buying power for buy orders
  if (side === 'buy') {
    const cashBalance = parseFloat(account.cash_balance);
    
    if (cashBalance < estimatedValue) {
      throw new AppError('Insufficient buying power', 400);
    }
  }

  // Check position for sell orders
  if (side === 'sell') {
    const positionResult = await query(
      'SELECT quantity FROM positions WHERE account_id = $1 AND security_id = $2',
      [accountId, security.id]
    );

    const currentQuantity = positionResult.rows[0]?.quantity || 0;
    if (currentQuantity < quantity) {
      throw new AppError('Insufficient shares to sell', 400);
    }
  }

  // Create order in transaction
  const order = await transaction(async (client) => {
    // Insert order
    const orderResult = await client.query(`
      INSERT INTO orders (
        account_id, security_id, side, order_type, quantity,
        limit_price, stop_price, time_in_force, status,
        estimated_value, extended_hours, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
      RETURNING *
    `, [
      accountId,
      security.id,
      side,
      orderType,
      quantity,
      limitPrice,
      stopPrice,
      timeInForce || 'day',
      'pending',
      estimatedValue,
      extendedHours || false
    ]);

    const newOrder = orderResult.rows[0];

    // For market orders, execute immediately (simplified)
    if (orderType === 'market') {
      // Execute the order
      const executedPrice = currentPrice;
      const executedValue = quantity * executedPrice;

      // Update order status
      await client.query(`
        UPDATE orders
        SET 
          status = 'filled',
          filled_quantity = $1,
          average_price = $2,
          filled_value = $3,
          executed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $4
      `, [quantity, executedPrice, executedValue, newOrder.id]);

      // Update account cash balance
      if (side === 'buy') {
        await client.query(`
          UPDATE accounts
          SET cash_balance = cash_balance - $1
          WHERE id = $2
        `, [executedValue, accountId]);
      } else {
        await client.query(`
          UPDATE accounts
          SET cash_balance = cash_balance + $1
          WHERE id = $2
        `, [executedValue, accountId]);
      }

      // Update or create position
      if (side === 'buy') {
        await client.query(`
          INSERT INTO positions (account_id, security_id, quantity, average_cost, market_value)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (account_id, security_id)
          DO UPDATE SET
            quantity = positions.quantity + $3,
            average_cost = ((positions.quantity * positions.average_cost) + ($3 * $4)) / (positions.quantity + $3),
            market_value = (positions.quantity + $3) * $4,
            updated_at = CURRENT_TIMESTAMP
        `, [accountId, security.id, quantity, executedPrice, quantity * executedPrice]);
      } else {
        await client.query(`
          UPDATE positions
          SET 
            quantity = quantity - $1,
            market_value = (quantity - $1) * $2,
            updated_at = CURRENT_TIMESTAMP
          WHERE account_id = $3 AND security_id = $4
        `, [quantity, executedPrice, accountId, security.id]);
      }

      // Create transaction record
      await client.query(`
        INSERT INTO transactions (
          account_id, type, amount, description, status, created_at
        ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
      `, [
        accountId,
        side === 'buy' ? 'trade_buy' : 'trade_sell',
        executedValue,
        `${side.toUpperCase()} ${quantity} ${symbol} @ $${executedPrice.toFixed(2)}`,
        'completed'
      ]);

      newOrder.status = 'filled';
      newOrder.filled_quantity = quantity;
      newOrder.average_price = executedPrice;
      newOrder.filled_value = executedValue;
      newOrder.executed_at = new Date();
    }

    return newOrder;
  });

  // Emit WebSocket update
  if (req.io) {
    emitOrderUpdate(req.io, userId, {
      orderId: order.id,
      status: order.status,
      symbol,
      side,
      quantity,
      price: order.average_price
    });
  }

  // Queue email notification for filled orders
  if (order.status === 'filled') {
    await addEmailJob('trade-confirmation', {
      email: req.user.email,
      orderId: order.id,
      orderData: {
        symbol,
        side,
        quantity,
        price: order.average_price,
        orderType,
        orderId: order.id,
        executedAt: order.executed_at
      }
    });
  }

  logger.info(`Order placed: ${order.id} - ${side} ${quantity} ${symbol}`);

  res.status(201).json({
    success: true,
    message: `Order ${order.status}`,
    data: {
      order: {
        id: order.id,
        symbol,
        side,
        orderType,
        quantity,
        status: order.status,
        limitPrice,
        stopPrice,
        filledQuantity: order.filled_quantity,
        averagePrice: order.average_price,
        estimatedValue,
        createdAt: order.created_at,
        executedAt: order.executed_at
      }
    }
  });
});

/**
 * @route   GET /api/v1/trading/orders
 * @desc    Get user's orders
 * @access  Private
 */
const getOrders = asyncHandler(async (req, res) => {
  const { accountId, status, symbol, startDate, endDate, limit = 50, offset = 0 } = req.query;
  const userId = req.user.id;

  let whereConditions = ['a.user_id = $1'];
  const values = [userId];
  let paramCount = 1;

  if (accountId) {
    paramCount++;
    whereConditions.push(`o.account_id = $${paramCount}`);
    values.push(accountId);
  }

  if (status) {
    paramCount++;
    whereConditions.push(`o.status = $${paramCount}`);
    values.push(status);
  }

  if (symbol) {
    paramCount++;
    whereConditions.push(`s.symbol = $${paramCount}`);
    values.push(symbol.toUpperCase());
  }

  if (startDate) {
    paramCount++;
    whereConditions.push(`o.created_at >= $${paramCount}`);
    values.push(startDate);
  }

  if (endDate) {
    paramCount++;
    whereConditions.push(`o.created_at <= $${paramCount}`);
    values.push(endDate);
  }

  values.push(parseInt(limit), parseInt(offset));

  const result = await query(`
    SELECT 
      o.*,
      s.symbol,
      s.name as security_name,
      a.account_number
    FROM orders o
    INNER JOIN securities s ON o.security_id = s.id
    INNER JOIN accounts a ON o.account_id = a.id
    WHERE ${whereConditions.join(' AND ')}
    ORDER BY o.created_at DESC
    LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
  `, values);

  const countResult = await query(`
    SELECT COUNT(*) as total
    FROM orders o
    INNER JOIN securities s ON o.security_id = s.id
    INNER JOIN accounts a ON o.account_id = a.id
    WHERE ${whereConditions.join(' AND ')}
  `, values.slice(0, -2));

  res.json({
    success: true,
    data: {
      orders: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].total),
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    }
  });
});

/**
 * @route   GET /api/v1/trading/orders/:id
 * @desc    Get order details
 * @access  Private
 */
const getOrderById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const result = await query(`
    SELECT 
      o.*,
      s.symbol,
      s.name as security_name,
      a.account_number
    FROM orders o
    INNER JOIN securities s ON o.security_id = s.id
    INNER JOIN accounts a ON o.account_id = a.id
    WHERE o.id = $1 AND a.user_id = $2
  `, [id, userId]);

  if (result.rows.length === 0) {
    throw new AppError('Order not found', 404);
  }

  res.json({
    success: true,
    data: {
      order: result.rows[0]
    }
  });
});

/**
 * @route   PUT /api/v1/trading/orders/:id
 * @desc    Modify pending order
 * @access  Private
 */
const modifyOrder = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { quantity, limitPrice, stopPrice } = req.body;
  const userId = req.user.id;

  // Check order exists and is modifiable
  const orderResult = await query(`
    SELECT o.*, a.user_id
    FROM orders o
    INNER JOIN accounts a ON o.account_id = a.id
    WHERE o.id = $1 AND a.user_id = $2
  `, [id, userId]);

  if (orderResult.rows.length === 0) {
    throw new AppError('Order not found', 404);
  }

  const order = orderResult.rows[0];

  if (!['pending', 'open'].includes(order.status)) {
    throw new AppError('Only pending or open orders can be modified', 400);
  }

  // Update order
  const updates = [];
  const values = [];
  let paramCount = 0;

  if (quantity !== undefined) {
    paramCount++;
    updates.push(`quantity = $${paramCount}`);
    values.push(quantity);
  }

  if (limitPrice !== undefined) {
    paramCount++;
    updates.push(`limit_price = $${paramCount}`);
    values.push(limitPrice);
  }

  if (stopPrice !== undefined) {
    paramCount++;
    updates.push(`stop_price = $${paramCount}`);
    values.push(stopPrice);
  }

  if (updates.length === 0) {
    throw new AppError('No valid fields to update', 400);
  }

  values.push(id);

  const result = await query(`
    UPDATE orders
    SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
    WHERE id = $${paramCount + 1}
    RETURNING *
  `, values);

  logger.info(`Order modified: ${id}`);

  res.json({
    success: true,
    message: 'Order modified successfully',
    data: {
      order: result.rows[0]
    }
  });
});

/**
 * @route   DELETE /api/v1/trading/orders/:id
 * @desc    Cancel order
 * @access  Private
 */
const cancelOrder = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  // Check order exists and is cancellable
  const orderResult = await query(`
    SELECT o.*, a.user_id
    FROM orders o
    INNER JOIN accounts a ON o.account_id = a.id
    WHERE o.id = $1 AND a.user_id = $2
  `, [id, userId]);

  if (orderResult.rows.length === 0) {
    throw new AppError('Order not found', 404);
  }

  const order = orderResult.rows[0];

  if (!['pending', 'open'].includes(order.status)) {
    throw new AppError('Only pending or open orders can be cancelled', 400);
  }

  // Cancel order
  await query(`
    UPDATE orders
    SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
  `, [id]);

  logger.info(`Order cancelled: ${id}`);

  res.json({
    success: true,
    message: 'Order cancelled successfully'
  });
});

/**
 * @route   GET /api/v1/trading/positions
 * @desc    Get user's positions
 * @access  Private
 */
const getPositions = asyncHandler(async (req, res) => {
  const { accountId } = req.query;
  const userId = req.user.id;

  let whereCondition = 'a.user_id = $1 AND p.quantity > 0';
  const values = [userId];

  if (accountId) {
    whereCondition += ' AND p.account_id = $2';
    values.push(accountId);
  }

  const result = await query(`
    SELECT 
      p.*,
      s.symbol,
      s.name as security_name,
      s.last_price as current_price,
      a.account_number,
      (p.quantity * s.last_price) as current_value,
      ((s.last_price - p.average_cost) * p.quantity) as unrealized_gain_loss,
      (((s.last_price - p.average_cost) / p.average_cost) * 100) as gain_loss_percent
    FROM positions p
    INNER JOIN securities s ON p.security_id = s.id
    INNER JOIN accounts a ON p.account_id = a.id
    WHERE ${whereCondition}
    ORDER BY p.market_value DESC
  `, values);

  res.json({
    success: true,
    data: {
      positions: result.rows
    }
  });
});

module.exports = {
  placeOrder,
  getOrders,
  getOrderById,
  modifyOrder,
  cancelOrder,
  getPositions
};