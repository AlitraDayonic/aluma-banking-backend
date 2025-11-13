// config/database.js
const { Pool } = require('pg');
const logger = require('../utils/logger');

// Database configuration
const config = process.env.DATABASE_URL 
  ? {
      // Use connection string (Neon cloud database)
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false
      }
    }
  : {
      // Fallback to individual variables (local database)
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME || 'aluma_db',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD,
      min: parseInt(process.env.DB_POOL_MIN) || 2,
      max: parseInt(process.env.DB_POOL_MAX) || 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 30000,
    };

// Create connection pool
const pool = new Pool(config);

// Pool error handler
pool.on('error', (err) => {
  logger.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Pool connect event
pool.on('connect', () => {
  logger.debug('New client connected to database');
});

// Query helper
const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug('Executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    logger.error('Query error', { text, error: error.message });
    throw error;
  }
};

// Transaction helper
const transaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// Get a client from pool
const getClient = async () => {
  return await pool.connect();
};

module.exports = {
  pool,
  query,
  transaction,
  getClient
};