// ============================================
// server.js - Main Application Entry Point
// ============================================

require('dotenv').config();
console.log('DATABASE_URL loaded:', process.env.DATABASE_URL ? 'YES' : 'NO');
console.log('CORS_ORIGIN:', process.env.CORS_ORIGIN);
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const http = require('http');
const socketIo = require('socket.io');
const Bull = require('bull');
const path = require('path');

// Import configurations and utilities
const logger = require('./utils/logger');
const { pool } = require('./config/database');
const { initializeJobs } = require('./jobs');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimiter');

// Import WebSocket handler
const { initializeWebSocket } = require('./websocket/handler');

// Initialize Express app
const app = express();
const server = http.createServer(app);
const corsOrigins = process.env.CORS_ORIGIN 
  ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
  : '*';

const io = socketIo(server, {
  cors: {
    origin: corsOrigins,
    methods: ['GET', 'POST']
  }
});

// ============================================
// MIDDLEWARE CONFIGURATION
// ============================================

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));


app.use(cors({
  origin: corsOrigins,
  credentials: true,
  optionsSuccessStatus: 200
}));

// Request parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression
app.use(compression());

// Logging
if (process.env.NODE_ENV === 'production') {
  app.use(morgan('combined', { stream: logger.stream }));
} else {
  app.use(morgan('dev'));
}

// Rate limiting
app.use('/api/', apiLimiter);

// Health check endpoint (before rate limiting)
app.get('/health', async (req, res) => {
  try {
    // Check database connection
    await pool.query('SELECT 1');
    
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV,
      database: 'connected'
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: error.message
    });
  }
});

// Attach Socket.io to request object
app.use((req, res, next) => {
  req.io = io;
  next();
});

// ============================================
// API ROUTES
// ============================================

// Mount API routes
app.use('/api/v1', require('./routes'));

// Serve static files for uploaded documents (production)
if (process.env.NODE_ENV === 'production') {
  app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
}

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Aluma Banking Broker API',
    version: '1.0.0',
    status: 'running',
    documentation: '/api/v1',
    health: '/health'
  });
});

// ============================================
// ERROR HANDLING
// ============================================

// 404 handler
app.use(notFound);

// Global error handler
app.use(errorHandler);

// ============================================
// WEBSOCKET INITIALIZATION
// ============================================

initializeWebSocket(io);

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

const gracefulShutdown = async (signal) => {
  logger.info(`${signal} received. Starting graceful shutdown...`);
  
  server.close(async () => {
    logger.info('HTTP server closed');
    
    try {
      // Close database pool
      await pool.end();
      logger.info('Database connections closed');
      
      // Close Redis connections (Bull queues)
      // Add your queue closing logic here
      
      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  });

  // Force shutdown after 30 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit in production, just log
  if (process.env.NODE_ENV !== 'production') {
    process.exit(1);
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

// ============================================
// SERVER STARTUP
// ============================================

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const startServer = async () => {
  try {
    // Test database connection
    await pool.query('SELECT NOW()');
    logger.info('Database connection established');

    // Initialize background jobs
    await initializeJobs();

   // Start server
server.listen(PORT, HOST, (err) => {
  if (err) {
    console.error('❌ Failed to start server:', err);
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
  
  const address = server.address();
  console.log('✅ Server address:', address);
  console.log(`✅ Server actually listening on ${address.address}:${address.port}`);
  
  logger.info(`🚀 Server running on http://${HOST}:${PORT}`);
  logger.info(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`🔌 WebSocket server initialized`);
  logger.info(`📝 API Documentation: http://${HOST}:${PORT}/api/v1`);
});

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Start the server
if (require.main === module) {
  startServer();
}

module.exports = { app, server, io };
