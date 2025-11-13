// ============================================
// middleware/errorHandler.js
// Global Error Handling
// ============================================

const logger = require('../utils/logger');

/**
 * Custom Error Class
 */
class AppError extends Error {
  constructor(message, statusCode, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Async Handler Wrapper
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * 404 Not Found Handler
 */
const notFound = (req, res, next) => {
  const error = new AppError(`Route not found: ${req.originalUrl}`, 404);
  next(error);
};

/**
 * Global Error Handler Middleware
 */
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;
  error.statusCode = err.statusCode || 500;

  // Log error
  if (error.statusCode === 500) {
    logger.error('Server Error:', {
      message: error.message,
      stack: err.stack,
      url: req.originalUrl,
      method: req.method,
      ip: req.ip,
      userId: req.user?.id
    });
  } else {
    logger.warn('Client Error:', {
      message: error.message,
      statusCode: error.statusCode,
      url: req.originalUrl,
      method: req.method
    });
  }

  // PostgreSQL errors
  if (err.code === '23505') {
    // Unique violation
    const field = err.detail?.match(/Key \((.*?)\)/)?.[1] || 'field';
    error = new AppError(`Duplicate ${field}. This value already exists.`, 400);
  }

  if (err.code === '23503') {
    // Foreign key violation
    error = new AppError('Referenced record does not exist', 400);
  }

  if (err.code === '22P02') {
    // Invalid text representation
    error = new AppError('Invalid data format', 400);
  }

  if (err.code === '23502') {
    // Not null violation
    const column = err.column || 'field';
    error = new AppError(`Missing required field: ${column}`, 400);
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error = new AppError('Invalid token. Please log in again.', 401);
  }

  if (err.name === 'TokenExpiredError') {
    error = new AppError('Token expired. Please log in again.', 401);
  }

  // Validation errors
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(e => e.message).join(', ');
    error = new AppError(message, 400);
  }

  // Multer errors
  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      error = new AppError('File size too large', 400);
    } else if (err.code === 'LIMIT_FILE_COUNT') {
      error = new AppError('Too many files', 400);
    } else {
      error = new AppError(err.message, 400);
    }
  }

  // Send response
  res.status(error.statusCode).json({
    success: false,
    error: {
      message: error.message,
      ...(process.env.NODE_ENV === 'development' && {
        stack: err.stack,
        details: err
      })
    }
  });
};

module.exports = {
  AppError,
  asyncHandler,
  notFound,
  errorHandler
};
