// ============================================
// websocket/handler.js - WebSocket Management
// ============================================

const { verifyAccessToken } = require('../config/jwt');
const logger = require('../utils/logger');
const marketDataService = require('../services/marketData.service');

// Store active connections
const activeConnections = new Map();
const subscriptions = new Map(); // symbol -> Set of socketIds

/**
 * Initialize WebSocket server
 */
const initializeWebSocket = (io) => {
  
  // Authentication middleware for Socket.io
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.query.token;
      
      if (!token) {
        return next(new Error('Authentication token required'));
      }

      // Verify token
      const decoded = verifyAccessToken(token);
      socket.userId = decoded.userId;
      socket.userEmail = decoded.email;
      
      logger.debug(`WebSocket authenticated: ${socket.userEmail}`);
      next();
    } catch (error) {
      logger.error('WebSocket authentication failed:', error.message);
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    logger.info(`Client connected: ${socket.id}, User: ${socket.userId}`);
    
    // Store connection
    activeConnections.set(socket.id, {
      userId: socket.userId,
      userEmail: socket.userEmail,
      connectedAt: new Date()
    });

    // Join user's personal room for private updates
    socket.join(`user_${socket.userId}`);

    // Send welcome message
    socket.emit('connected', {
      message: 'Connected to Aluma real-time server',
      socketId: socket.id,
      timestamp: new Date().toISOString()
    });

    // ============================================
    // MARKET DATA SUBSCRIPTIONS
    // ============================================

    /**
     * Subscribe to real-time quotes for symbols
     */
    socket.on('subscribe_quotes', async (symbols) => {
      try {
        if (!Array.isArray(symbols) || symbols.length === 0) {
          socket.emit('error', { message: 'Invalid symbols array' });
          return;
        }

        // Limit subscriptions per connection
        if (symbols.length > 50) {
          socket.emit('error', { message: 'Maximum 50 symbols per subscription' });
          return;
        }

        // Subscribe to each symbol
        symbols.forEach(symbol => {
          const normalizedSymbol = symbol.toUpperCase();
          
          if (!subscriptions.has(normalizedSymbol)) {
            subscriptions.set(normalizedSymbol, new Set());
          }
          
          subscriptions.get(normalizedSymbol).add(socket.id);
          socket.join(`quote_${normalizedSymbol}`);
        });

        logger.debug(`Socket ${socket.id} subscribed to quotes: ${symbols.join(', ')}`);
        
        socket.emit('subscribed', {
          type: 'quotes',
          symbols,
          timestamp: new Date().toISOString()
        });

        // Send initial quotes
        const initialQuotes = await marketDataService.getQuotes(symbols);
        socket.emit('quotes_snapshot', initialQuotes);

      } catch (error) {
        logger.error('Quote subscription error:', error);
        socket.emit('error', { message: 'Failed to subscribe to quotes' });
      }
    });

    /**
     * Unsubscribe from quotes
     */
    socket.on('unsubscribe_quotes', (symbols) => {
      try {
        symbols.forEach(symbol => {
          const normalizedSymbol = symbol.toUpperCase();
          
          if (subscriptions.has(normalizedSymbol)) {
            subscriptions.get(normalizedSymbol).delete(socket.id);
            socket.leave(`quote_${normalizedSymbol}`);
            
            // Clean up empty subscription sets
            if (subscriptions.get(normalizedSymbol).size === 0) {
              subscriptions.delete(normalizedSymbol);
            }
          }
        });

        logger.debug(`Socket ${socket.id} unsubscribed from quotes: ${symbols.join(', ')}`);
        
        socket.emit('unsubscribed', {
          type: 'quotes',
          symbols,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        logger.error('Quote unsubscription error:', error);
      }
    });

    /**
     * Subscribe to order book updates
     */
    socket.on('subscribe_orderbook', (symbol) => {
      const normalizedSymbol = symbol.toUpperCase();
      socket.join(`orderbook_${normalizedSymbol}`);
      
      logger.debug(`Socket ${socket.id} subscribed to orderbook: ${normalizedSymbol}`);
      
      socket.emit('subscribed', {
        type: 'orderbook',
        symbol: normalizedSymbol,
        timestamp: new Date().toISOString()
      });
    });

    /**
     * Unsubscribe from order book
     */
    socket.on('unsubscribe_orderbook', (symbol) => {
      const normalizedSymbol = symbol.toUpperCase();
      socket.leave(`orderbook_${normalizedSymbol}`);
      
      socket.emit('unsubscribed', {
        type: 'orderbook',
        symbol: normalizedSymbol,
        timestamp: new Date().toISOString()
      });
    });

    // ============================================
    // ACCOUNT & TRADING UPDATES
    // ============================================

    /**
     * Subscribe to account updates
     */
    socket.on('subscribe_account', (accountId) => {
      socket.join(`account_${accountId}`);
      logger.debug(`Socket ${socket.id} subscribed to account: ${accountId}`);
    });

    /**
     * Subscribe to order updates
     */
    socket.on('subscribe_orders', () => {
      socket.join(`orders_${socket.userId}`);
      logger.debug(`Socket ${socket.id} subscribed to order updates`);
    });

    // ============================================
    // HEARTBEAT / PING-PONG
    // ============================================

    socket.on('ping', () => {
      socket.emit('pong', { timestamp: new Date().toISOString() });
    });

    // ============================================
    // DISCONNECTION
    // ============================================

    socket.on('disconnect', (reason) => {
      logger.info(`Client disconnected: ${socket.id}, Reason: ${reason}`);
      
      // Clean up subscriptions
      subscriptions.forEach((subscribers, symbol) => {
        subscribers.delete(socket.id);
        if (subscribers.size === 0) {
          subscriptions.delete(symbol);
        }
      });

      // Remove from active connections
      activeConnections.delete(socket.id);
    });

    // Handle errors
    socket.on('error', (error) => {
      logger.error(`Socket error for ${socket.id}:`, error);
    });
  });

  // Start market data broadcast (if needed)
  startMarketDataBroadcast(io);

  logger.info('WebSocket server initialized successfully');
};

/**
 * Broadcast market data updates periodically
 */
const startMarketDataBroadcast = (io) => {
  // Update quotes every 3 seconds for subscribed symbols
  setInterval(async () => {
    try {
      if (subscriptions.size === 0) return;

      const symbols = Array.from(subscriptions.keys());
      const quotes = await marketDataService.getQuotes(symbols);

      quotes.forEach(quote => {
        io.to(`quote_${quote.symbol}`).emit('quote_update', quote);
      });

    } catch (error) {
      logger.error('Market data broadcast error:', error);
    }
  }, 3000);
};

/**
 * Emit order update to specific user
 */
const emitOrderUpdate = (io, userId, orderData) => {
  io.to(`user_${userId}`).emit('order_update', {
    ...orderData,
    timestamp: new Date().toISOString()
  });
};

/**
 * Emit account balance update
 */
const emitBalanceUpdate = (io, userId, accountId, balanceData) => {
  io.to(`account_${accountId}`).emit('balance_update', {
    ...balanceData,
    timestamp: new Date().toISOString()
  });
};

/**
 * Emit position update
 */
const emitPositionUpdate = (io, userId, positionData) => {
  io.to(`user_${userId}`).emit('position_update', {
    ...positionData,
    timestamp: new Date().toISOString()
  });
};

/**
 * Emit price alert notification
 */
const emitPriceAlert = (io, userId, alertData) => {
  io.to(`user_${userId}`).emit('price_alert', {
    ...alertData,
    timestamp: new Date().toISOString()
  });
};

/**
 * Get active connection stats
 */
const getConnectionStats = () => {
  return {
    totalConnections: activeConnections.size,
    activeSubscriptions: subscriptions.size,
    connections: Array.from(activeConnections.values())
  };
};

module.exports = {
  initializeWebSocket,
  emitOrderUpdate,
  emitBalanceUpdate,
  emitPositionUpdate,
  emitPriceAlert,
  getConnectionStats
};