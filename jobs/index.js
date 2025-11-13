// ============================================
// jobs/index.js - Background Jobs with Bull
// ============================================

const logger = require('../utils/logger');

// Check if Redis is configured
const redisConfigured = process.env.REDIS_HOST && process.env.REDIS_PORT;

let emailQueue, portfolioQueue, alertQueue, reportQueue, cleanupQueue;
let Bull;

if (redisConfigured) {
  Bull = require('bull');
  
  // Redis configuration
  const redisConfig = {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB) || 0
  };

  // Initialize queues
  emailQueue = new Bull('email', { redis: redisConfig });
  portfolioQueue = new Bull('portfolio', { redis: redisConfig });
  alertQueue = new Bull('alerts', { redis: redisConfig });
  reportQueue = new Bull('reports', { redis: redisConfig });
  cleanupQueue = new Bull('cleanup', { redis: redisConfig });

  logger.info('Bull queues initialized with Redis');
  
  // Set up all the processors and listeners here...
  // (keep all your existing processor code)
  
} else {
  logger.warn('Redis not configured - background jobs disabled');
  
  // Create mock queues that do nothing
  const mockQueue = {
    process: () => {},
    add: async () => ({ id: 'mock' }),
    on: () => {}
  };
  
  emailQueue = mockQueue;
  portfolioQueue = mockQueue;
  alertQueue = mockQueue;
  reportQueue = mockQueue;
  cleanupQueue = mockQueue;
}

// ============================================
// SCHEDULED JOBS
// ============================================

const initializeJobs = async () => {
  try {
    logger.info('Initializing background jobs...');
    
    if (!redisConfigured) {
      logger.warn('Skipping job scheduling - Redis not configured');
      return;
    }
    
    // All your scheduling code...
    
    logger.info('Background jobs initialized successfully');
    
  } catch (error) {
    logger.error('Failed to initialize jobs:', error);
    // Don't throw - let server continue
  }
};

// ============================================
// QUEUE UTILITIES
// ============================================

const addEmailJob = async (type, data, options = {}) => {
  if (!redisConfigured) {
    logger.debug(`Email job skipped (no Redis): ${type}`);
    return { id: 'skipped' };
  }
  return emailQueue.add(type, data, options);
};

const addPortfolioJob = async (type, data, options = {}) => {
  if (!redisConfigured) {
    logger.debug(`Portfolio job skipped (no Redis): ${type}`);
    return { id: 'skipped' };
  }
  return portfolioQueue.add(type, data, options);
};

const addAlertJob = async (type, data, options = {}) => {
  if (!redisConfigured) {
    logger.debug(`Alert job skipped (no Redis): ${type}`);
    return { id: 'skipped' };
  }
  return alertQueue.add(type, data, options);
};

const addReportJob = async (type, data, options = {}) => {
  if (!redisConfigured) {
    logger.debug(`Report job skipped (no Redis): ${type}`);
    return { id: 'skipped' };
  }
  return reportQueue.add(type, data, options);
};

module.exports = {
  initializeJobs,
  emailQueue,
  portfolioQueue,
  alertQueue,
  reportQueue,
  cleanupQueue,
  addEmailJob,
  addPortfolioJob,
  addAlertJob,
  addReportJob
};