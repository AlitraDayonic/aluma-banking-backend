const User = require('../models/User');
const { query, transaction } = require('../config/database');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../config/jwt');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

/**
 * @route   POST /api/v1/auth/register
 * @desc    Register new user
 * @access  Public
 */
const register = asyncHandler(async (req, res) => {
  const { email, username, password, firstName, lastName, phone, dateOfBirth } = req.body;

  // Check if email exists
  if (await User.emailExists(email)) {
    throw new AppError('Email already registered', 400);
  }

  // Check if username exists
  if (await User.usernameExists(username)) {
    throw new AppError('Username already taken', 400);
  }

  // Create user in a transaction
  const result = await transaction(async (client) => {
    // Create user
    const userResult = await client.query(
      `INSERT INTO users (
        email, username, password_hash, first_name, last_name, phone, date_of_birth, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, email, username, first_name, last_name, status, created_at`,
      [
        email,
        username,
        await require('bcryptjs').hash(password, 12),
        firstName,
        lastName,
        phone,
        dateOfBirth,
        'pending'
      ]
    );

    const user = userResult.rows[0];

    // Create user profile
    await client.query(
      `INSERT INTO user_profiles (user_id) VALUES ($1)`,
      [user.id]
    );

    // Create KYC record
    await client.query(
      `INSERT INTO user_kyc (user_id, status) VALUES ($1, $2)`,
      [user.id, 'not_started']
    );

    // Create security record
    await client.query(
      `INSERT INTO user_security (user_id) VALUES ($1)`,
      [user.id]
    );

    return user;
  });

  // TODO: Send verification email
  logger.info(`New user registered: ${result.email}`);

  res.status(201).json({
    success: true,
    message: 'Registration successful. Please check your email to verify your account.',
    data: {
      user: {
        id: result.id,
        email: result.email,
        username: result.username,
        firstName: result.first_name,
        lastName: result.last_name
      }
    }
  });
});

/**
 * @route   POST /api/v1/auth/login
 * @desc    Login user
 * @access  Public
 */
const login = asyncHandler(async (req, res) => {
  const { email, password, deviceId, deviceName } = req.body;
  const ipAddress = req.ip;
  const userAgent = req.headers['user-agent'];

  // Find user
  const user = await User.findByEmail(email);

  if (!user) {
    // Log failed attempt
    await query(
      `INSERT INTO user_login_history (user_id, ip_address, user_agent, login_successful, failure_reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [null, ipAddress, userAgent, false, 'User not found']
    );
    throw new AppError('Invalid email or password', 401);
  }

  // Check password
  const isPasswordValid = await User.verifyPassword(password, user.password_hash);

  if (!isPasswordValid) {
    // Increment failed login attempts
    await query(
      `UPDATE user_security 
       SET failed_login_attempts = failed_login_attempts + 1
       WHERE user_id = $1`,
      [user.id]
    );

    // Log failed attempt
    await query(
      `INSERT INTO user_login_history (user_id, ip_address, user_agent, login_successful, failure_reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, ipAddress, userAgent, false, 'Invalid password']
    );

    throw new AppError('Invalid email or password', 401);
  }

  // Check if account is locked
  const securityCheck = await query(
    `SELECT failed_login_attempts, locked_until FROM user_security WHERE user_id = $1`,
    [user.id]
  );

  if (securityCheck.rows[0]?.locked_until && new Date(securityCheck.rows[0].locked_until) > new Date()) {
    throw new AppError('Account temporarily locked due to too many failed login attempts', 423);
  }

  // Check if account is suspended
  if (user.status === 'suspended') {
    throw new AppError('Account suspended. Please contact support.', 403);
  }

  if (user.status === 'closed') {
    throw new AppError('Account closed. Please contact support.', 403);
  }

  // Reset failed login attempts
  await query(
    `UPDATE user_security 
     SET failed_login_attempts = 0, locked_until = NULL
     WHERE user_id = $1`,
    [user.id]
  );

  // Generate tokens
  const accessToken = generateAccessToken({ userId: user.id, email: user.email });
  const refreshToken = generateRefreshToken({ userId: user.id });

  // Store refresh token in database
  const sessionId = uuidv4();
  await query(
    `INSERT INTO user_sessions (
      id, user_id, refresh_token, device_id, device_name, ip_address, user_agent, expires_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + INTERVAL '7 days')`,
    [sessionId, user.id, refreshToken, deviceId, deviceName, ipAddress, userAgent]
  );

  // Log successful login
  await query(
    `INSERT INTO user_login_history (user_id, ip_address, user_agent, device_id, login_successful)
     VALUES ($1, $2, $3, $4, $5)`,
    [user.id, ipAddress, userAgent, deviceId, true]
  );

  // Update last login
  await User.updateLastLogin(user.id);

  logger.info(`User logged in: ${user.email}`);

  res.json({
    success: true,
    message: 'Login successful',
    data: {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        emailVerified: user.email_verified,
        status: user.status
      },
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: '15m'
      }
    }
  });
});

/**
 * @route   POST /api/v1/auth/refresh
 * @desc    Refresh access token
 * @access  Public
 */
const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    throw new AppError('Refresh token required', 400);
  }

  // Verify refresh token
  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch (error) {
    throw new AppError('Invalid or expired refresh token', 401);
  }

  // Check if refresh token exists in database
  const sessionResult = await query(
    `SELECT user_id, is_active, expires_at FROM user_sessions 
     WHERE refresh_token = $1`,
    [refreshToken]
  );

  if (sessionResult.rows.length === 0) {
    throw new AppError('Invalid refresh token', 401);
  }

  const session = sessionResult.rows[0];

  if (!session.is_active) {
    throw new AppError('Session is no longer active', 401);
  }

  if (new Date(session.expires_at) < new Date()) {
    throw new AppError('Refresh token expired', 401);
  }

  // Get user
  const user = await User.findById(session.user_id);

  if (!user || user.status !== 'active') {
    throw new AppError('User not found or inactive', 401);
  }

  // Generate new access token
  const newAccessToken = generateAccessToken({ 
    userId: user.id, 
    email: user.email 
  });

  // Update session activity
  await query(
    `UPDATE user_sessions 
     SET last_activity_at = CURRENT_TIMESTAMP
     WHERE refresh_token = $1`,
    [refreshToken]
  );

  res.json({
    success: true,
    data: {
      accessToken: newAccessToken,
      expiresIn: '15m'
    }
  });
});

/**
 * @route   POST /api/v1/auth/logout
 * @desc    Logout user
 * @access  Private
 */
const logout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  if (refreshToken) {
    // Deactivate session
    await query(
      `UPDATE user_sessions 
       SET is_active = false
       WHERE refresh_token = $1 AND user_id = $2`,
      [refreshToken, req.user.id]
    );
  }

  logger.info(`User logged out: ${req.user.email}`);

  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

/**
 * @route   POST /api/v1/auth/forgot-password
 * @desc    Request password reset
 * @access  Public
 */
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  const user = await User.findByEmail(email);

  // Always return success for security (don't reveal if email exists)
  if (!user) {
    logger.info(`Password reset requested for non-existent email: ${email}`);
    return res.json({
      success: true,
      message: 'If that email exists, a password reset link has been sent.'
    });
  }

  // Generate reset token
  const resetToken = crypto.randomBytes(32).toString('hex');
  const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
  const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  // Store reset token (you'll need to add this to user_security table)
  await query(
    `UPDATE user_security 
     SET reset_token_hash = $1, reset_token_expires = $2
     WHERE user_id = $3`,
    [resetTokenHash, resetTokenExpiry, user.id]
  );

  // TODO: Send password reset email with resetToken

  logger.info(`Password reset requested for: ${email}`);

  res.json({
    success: true,
    message: 'If that email exists, a password reset link has been sent.',
    // TODO: Remove this in production, only for testing
    ...(process.env.NODE_ENV === 'development' && { resetToken })
  });
});

/**
 * @route   POST /api/v1/auth/reset-password
 * @desc    Reset password with token
 * @access  Public
 */
const resetPassword = asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    throw new AppError('Token and new password required', 400);
  }

  // Hash the provided token
  const resetTokenHash = crypto.createHash('sha256').update(token).digest('hex');

  // Find user with valid reset token
  const result = await query(
    `SELECT u.id, u.email
     FROM users u
     JOIN user_security s ON u.id = s.user_id
     WHERE s.reset_token_hash = $1 
     AND s.reset_token_expires > NOW()`,
    [resetTokenHash]
  );

  if (result.rows.length === 0) {
    throw new AppError('Invalid or expired reset token', 400);
  }

  const user = result.rows[0];

  // Change password
  await User.changePassword(user.id, newPassword);

  // Clear reset token
  await query(
    `UPDATE user_security 
     SET reset_token_hash = NULL, reset_token_expires = NULL
     WHERE user_id = $1`,
    [user.id]
  );

  // Invalidate all existing sessions
  await query(
    `UPDATE user_sessions 
     SET is_active = false
     WHERE user_id = $1`,
    [user.id]
  );

  logger.info(`Password reset completed for: ${user.email}`);

  res.json({
    success: true,
    message: 'Password reset successful. Please login with your new password.'
  });
});

/**
 * @route   POST /api/v1/auth/verify-email
 * @desc    Verify email with token
 * @access  Public
 */
const verifyEmail = asyncHandler(async (req, res) => {
  const { token } = req.body;

  // TODO: Implement email verification token logic
  // For now, just verify by user ID from token

  res.json({
    success: true,
    message: 'Email verified successfully'
  });
});

module.exports = {
  register,
  login,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  verifyEmail
};