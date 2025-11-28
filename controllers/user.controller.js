// controllers/user.controller.js
const User = require('../models/User');
const { query } = require('../config/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const twoFactorService = require('../services/twoFactor.service');

/**
 * Get current user profile
 */
const getProfile = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const profile = await User.getProfile(userId);

  if (!profile) {
    throw new AppError('Profile not found', 404);
  }

  res.json({
    success: true,
    data: { user: profile }
  });
});

/**
 * Update user profile
 */
const updateProfile = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const {
    firstName,
    lastName,
    phone,
    addressLine1,
    addressLine2,
    city,
    state,
    postalCode,
    country
  } = req.body;

  // Update user basic info
  const userUpdates = {};
  if (firstName) userUpdates.first_name = firstName;
  if (lastName) userUpdates.last_name = lastName;
  if (phone) userUpdates.phone = phone;

  if (Object.keys(userUpdates).length > 0) {
    await User.update(userId, userUpdates);
  }

  // Update profile info
  const profileUpdates = {};
  if (addressLine1) profileUpdates.address_line1 = addressLine1;
  if (addressLine2) profileUpdates.address_line2 = addressLine2;
  if (city) profileUpdates.city = city;
  if (state) profileUpdates.state = state;
  if (postalCode) profileUpdates.postal_code = postalCode;
  if (country) profileUpdates.country = country;

  if (Object.keys(profileUpdates).length > 0) {
    const fields = [];
    const values = [];
    let paramCount = 0;

    Object.keys(profileUpdates).forEach(key => {
      paramCount++;
      fields.push(`${key} = $${paramCount}`);
      values.push(profileUpdates[key]);
    });

    values.push(userId);

    await query(`
      UPDATE user_profiles
      SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $${paramCount + 1}
    `, values);
  }

  const updatedProfile = await User.getProfile(userId);

  logger.info(`Profile updated for user: ${userId}`);

  res.json({
    success: true,
    message: 'Profile updated successfully',
    data: { user: updatedProfile }
  });
});

/**
 * Change password
 */
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id;

  const userWithPassword = await query(
    'SELECT password_hash FROM users WHERE id = $1',
    [userId]
  );

  const isValid = await User.verifyPassword(currentPassword, userWithPassword.rows[0].password_hash);

  if (!isValid) {
    throw new AppError('Current password is incorrect', 400);
  }

  await User.changePassword(userId, newPassword);

  await query(`
    UPDATE user_sessions
    SET is_active = false
    WHERE user_id = $1
  `, [userId]);

  logger.info(`Password changed for user: ${userId}`);

  res.json({
    success: true,
    message: 'Password changed successfully. Please login again.'
  });
});

/**
‎ * Set transaction PIN (first time)
‎ */
‎const setPin = asyncHandler(async (req, res) => {
‎  const { pin } = req.body;
‎  const userId = req.user.id;
‎
‎  // Check if user already has a PIN
‎  const existingPin = await query(
‎    'SELECT transaction_pin FROM users WHERE id = $1',
‎    [userId]
‎  );
‎
‎  if (existingPin.rows[0].transaction_pin) {
‎    throw new AppError('PIN already set. Use change PIN instead.', 400);
‎  }
‎
‎  // Store PIN (plain text for now - can hash later if needed)
‎  await query(
‎    'UPDATE users SET transaction_pin = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
‎    [pin, userId]
‎  );
‎
‎  logger.info(`Transaction PIN set for user: ${userId}`);
‎
‎  res.json({
‎    success: true,
‎    message: 'Transaction PIN set successfully'
‎  });
‎});
‎
‎/**
‎ * Change transaction PIN
‎ */
‎const changePin = asyncHandler(async (req, res) => {
‎  const { currentPin, newPin } = req.body;
‎  const userId = req.user.id;
‎
‎  // Get current PIN
‎  const result = await query(
‎    'SELECT transaction_pin FROM users WHERE id = $1',
‎    [userId]
‎  );
‎
‎  if (!result.rows[0].transaction_pin) {
‎    throw new AppError('No PIN set. Please set a PIN first.', 400);
‎  }
‎
‎  // Verify current PIN
‎  if (result.rows[0].transaction_pin !== currentPin) {
‎    throw new AppError('Current PIN is incorrect', 401);
‎  }
‎
‎  // Update to new PIN
‎  await query(
‎    'UPDATE users SET transaction_pin = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
‎    [newPin, userId]
‎  );
‎
‎  logger.info(`Transaction PIN changed for user: ${userId}`);
‎
‎  res.json({
‎    success: true,
‎    message: 'Transaction PIN changed successfully'
‎  });
‎});
‎
‎/**
‎ * Check if user has PIN
‎ */
‎const checkPinStatus = asyncHandler(async (req, res) => {
‎  const userId = req.user.id;
‎
‎  const result = await query(
‎    'SELECT transaction_pin FROM users WHERE id = $1',
‎    [userId]
‎  );
‎
‎  const hasPin = !!result.rows[0].transaction_pin;
‎
‎  res.json({
‎    success: true,
‎    data: { hasPin }
‎  });
‎});
‎
‎/**
‎ * Reset PIN (admin only or with email verification)
‎ */
‎const resetPin = asyncHandler(async (req, res) => {
‎  const userId = req.user.id;
‎
‎  // Clear the PIN
‎  await query(
‎    'UPDATE users SET transaction_pin = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
‎    [userId]
‎  );
‎
‎  logger.info(`Transaction PIN reset for user: ${userId}`);
‎
‎  res.json({
‎    success: true,
‎    message: 'Transaction PIN reset successfully. Please set a new PIN.'
‎  });
‎});


/**
 * Setup 2FA
 */
const setup2FA = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const email = req.user.email;

  const { secret, otpauth_url } = await twoFactorService.generateSecret(userId, email);
  const qrCode = await twoFactorService.generateQRCode(otpauth_url);

  res.json({
    success: true,
    message: 'Scan this QR code with your authenticator app',
    data: { secret, qrCode }
  });
});

/**
 * Enable 2FA
 */
const enable2FA = asyncHandler(async (req, res) => {
  const { token } = req.body;
  const userId = req.user.id;

  const result = await twoFactorService.enable2FA(userId, token);

  logger.info(`2FA enabled for user: ${userId}`);

  res.json({
    success: true,
    message: '2FA enabled successfully. Save these backup codes in a safe place.',
    data: { backupCodes: result.backupCodes }
  });
});

/**
 * Disable 2FA
 */
const disable2FA = asyncHandler(async (req, res) => {
  const { token } = req.body;
  const userId = req.user.id;

  await twoFactorService.disable2FA(userId, token);

  logger.info(`2FA disabled for user: ${userId}`);

  res.json({
    success: true,
    message: '2FA disabled successfully'
  });
});

/**
 * Verify 2FA code
 */
const verify2FA = asyncHandler(async (req, res) => {
  const { token } = req.body;
  const userId = req.user.id;

  const isValid = await twoFactorService.verify2FAToken(userId, token);

  res.json({
    success: true,
    data: { valid: isValid }
  });
});

/**
 * Get 2FA status
 */
const get2FAStatus = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const status = await twoFactorService.get2FAStatus(userId);

  res.json({
    success: true,
    data: status
  });
});

/**
 * Regenerate backup codes
 */
const regenerateBackupCodes = asyncHandler(async (req, res) => {
  const { token } = req.body;
  const userId = req.user.id;

  const isValid = await twoFactorService.verify2FAToken(userId, token);
  if (!isValid) {
    throw new AppError('Invalid 2FA code', 400);
  }

  const backupCodes = await twoFactorService.regenerateBackupCodes(userId);

  logger.info(`Backup codes regenerated for user: ${userId}`);

  res.json({
    success: true,
    message: 'New backup codes generated. Save these in a safe place.',
    data: { backupCodes }
  });
});

module.exports = {
  getProfile,
  updateProfile,
  changePassword,
  setPin,
  changePin,
  checkPinStatus,
  resetPin,
  setup2FA,
  enable2FA,
  disable2FA,
  verify2FA,
  get2FAStatus,
  regenerateBackupCodes
};
