const { verifyAccessToken } = require('../config/jwt');
const { query } = require('../config/database');
const logger = require('../utils/logger');

/**
 * Authentication middleware
 * Verifies JWT token and attaches user to request
 */
const authenticate = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No token provided. Authorization header must be in format: Bearer [token]'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token
    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token',
        error: error.message
      });
    }

    // Check if user exists and is active
    const result = await query(
      `SELECT 
        id, 
        email, 
        username, 
        first_name, 
        last_name, 
        status, 
        email_verified
        role
      FROM users 
      WHERE id = $1`,
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = result.rows[0];

    // Check if user is active
    if (user.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: `Account is ${user.status}. Please contact support.`
      });
    }

    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email,
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      emailVerified: user.email_verified,
      role: user.role
    };

    // Set user context for database row-level security
    await query('SELECT set_config($1, $2, true)', [
      'app.current_user_id',
      user.id
    ]);

    logger.debug(`User authenticated: ${user.email}`);
    next();

  } catch (error) {
    logger.error('Authentication error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication failed',
      error: error.message
    });
  }
};

/**
 * Optional authentication middleware
 * Attaches user if token is provided, but doesn't fail if not
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.substring(7);
    
    try {
      const decoded = verifyAccessToken(token);
      const result = await query(
        'SELECT id, email, username FROM users WHERE id = $1 AND status = $2',
        [decoded.userId, 'active']
      );

      if (result.rows.length > 0) {
        req.user = result.rows[0];
      }
    } catch (error) {
      // Token invalid, but continue without user
      logger.debug('Optional auth: Invalid token, continuing without user');
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Verify email middleware
 * Checks if user's email is verified
 */
const requireEmailVerified = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  if (!req.user.emailVerified) {
    return res.status(403).json({
      success: false,
      message: 'Email verification required. Please check your email.'
    });
  }

  next();
};

module.exports = {
  authenticate,
  optionalAuth,
  requireEmailVerified
};
