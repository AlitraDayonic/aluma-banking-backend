// ============================================
// services/twoFactor.service.js
// Two-Factor Authentication using Speakeasy
// ============================================

const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { query } = require('../config/database');
const logger = require('../utils/logger');
const crypto = require('crypto');

const APP_NAME = process.env.APP_NAME || 'Aluma Banking';

/**
 * Generate 2FA secret for user
 */
const generateSecret = async (userId, email) => {
  try {
    // Generate secret
    const secret = speakeasy.generateSecret({
      name: `${APP_NAME} (${email})`,
      issuer: APP_NAME,
      length: 32
    });

    // Store encrypted secret in database
    const encryptedSecret = encryptSecret(secret.base32);
    
    await query(`
      UPDATE user_security
      SET 
        two_factor_secret = $1,
        two_factor_enabled = false,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $2
    `, [encryptedSecret, userId]);

    logger.info(`2FA secret generated for user ${userId}`);

    return {
      secret: secret.base32,
      otpauth_url: secret.otpauth_url
    };

  } catch (error) {
    logger.error(`Error generating 2FA secret for user ${userId}:`, error);
    throw error;
  }
};

/**
 * Generate QR code for 2FA setup
 */
const generateQRCode = async (otpauthUrl) => {
  try {
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);
    return qrCodeDataUrl;
  } catch (error) {
    logger.error('Error generating QR code:', error);
    throw error;
  }
};

/**
 * Enable 2FA for user after verification
 */
const enable2FA = async (userId, token) => {
  try {
    // Get user's secret
    const result = await query(`
      SELECT two_factor_secret
      FROM user_security
      WHERE user_id = $1
    `, [userId]);

    if (result.rows.length === 0 || !result.rows[0].two_factor_secret) {
      throw new Error('2FA secret not found');
    }

    const encryptedSecret = result.rows[0].two_factor_secret;
    const secret = decryptSecret(encryptedSecret);

    // Verify token
    const isValid = speakeasy.totp.verify({
      secret: secret,
      encoding: 'base32',
      token: token,
      window: 2 // Allow 2 time steps before and after
    });

    if (!isValid) {
      throw new Error('Invalid verification code');
    }

    // Generate backup codes
    const backupCodes = generateBackupCodes();
    const hashedBackupCodes = backupCodes.map(code => hashBackupCode(code));

    // Enable 2FA and store backup codes
    await query(`
      UPDATE user_security
      SET 
        two_factor_enabled = true,
        two_factor_backup_codes = $1,
        two_factor_enabled_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $2
    `, [JSON.stringify(hashedBackupCodes), userId]);

    logger.info(`2FA enabled for user ${userId}`);

    return {
      success: true,
      backupCodes // Return these once for user to save
    };

  } catch (error) {
    logger.error(`Error enabling 2FA for user ${userId}:`, error);
    throw error;
  }
};

/**
 * Disable 2FA for user
 */
const disable2FA = async (userId, token) => {
  try {
    // Verify current 2FA token before disabling
    const isValid = await verify2FAToken(userId, token);

    if (!isValid) {
      throw new Error('Invalid verification code');
    }

    // Disable 2FA
    await query(`
      UPDATE user_security
      SET 
        two_factor_enabled = false,
        two_factor_secret = NULL,
        two_factor_backup_codes = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
    `, [userId]);

    logger.info(`2FA disabled for user ${userId}`);

    return { success: true };

  } catch (error) {
    logger.error(`Error disabling 2FA for user ${userId}:`, error);
    throw error;
  }
};

/**
 * Verify 2FA token
 */
const verify2FAToken = async (userId, token) => {
  try {
    // Check if trying backup code first
    if (token.length > 6) {
      return await verifyBackupCode(userId, token);
    }

    // Get user's secret
    const result = await query(`
      SELECT two_factor_secret, two_factor_enabled
      FROM user_security
      WHERE user_id = $1
    `, [userId]);

    if (result.rows.length === 0) {
      return false;
    }

    const { two_factor_secret, two_factor_enabled } = result.rows[0];

    if (!two_factor_enabled || !two_factor_secret) {
      return false;
    }

    const secret = decryptSecret(two_factor_secret);

    // Verify TOTP token
    const isValid = speakeasy.totp.verify({
      secret: secret,
      encoding: 'base32',
      token: token,
      window: 2
    });

    if (isValid) {
      logger.debug(`2FA token verified for user ${userId}`);
    } else {
      logger.warn(`Invalid 2FA token attempt for user ${userId}`);
    }

    return isValid;

  } catch (error) {
    logger.error(`Error verifying 2FA token for user ${userId}:`, error);
    return false;
  }
};

/**
 * Verify backup code
 */
const verifyBackupCode = async (userId, code) => {
  try {
    // Get backup codes
    const result = await query(`
      SELECT two_factor_backup_codes
      FROM user_security
      WHERE user_id = $1 AND two_factor_enabled = true
    `, [userId]);

    if (result.rows.length === 0 || !result.rows[0].two_factor_backup_codes) {
      return false;
    }

    const backupCodes = JSON.parse(result.rows[0].two_factor_backup_codes);
    const hashedCode = hashBackupCode(code);

    // Check if code exists and hasn't been used
    const codeIndex = backupCodes.findIndex(bc => bc.hash === hashedCode && !bc.used);

    if (codeIndex === -1) {
      logger.warn(`Invalid or used backup code attempt for user ${userId}`);
      return false;
    }

    // Mark code as used
    backupCodes[codeIndex].used = true;
    backupCodes[codeIndex].usedAt = new Date().toISOString();

    await query(`
      UPDATE user_security
      SET 
        two_factor_backup_codes = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $2
    `, [JSON.stringify(backupCodes), userId]);

    logger.info(`Backup code used for user ${userId}`);
    return true;

  } catch (error) {
    logger.error(`Error verifying backup code for user ${userId}:`, error);
    return false;
  }
};

/**
 * Generate new backup codes
 */
const regenerateBackupCodes = async (userId) => {
  try {
    // Verify 2FA is enabled
    const result = await query(`
      SELECT two_factor_enabled
      FROM user_security
      WHERE user_id = $1
    `, [userId]);

    if (result.rows.length === 0 || !result.rows[0].two_factor_enabled) {
      throw new Error('2FA is not enabled');
    }

    // Generate new backup codes
    const backupCodes = generateBackupCodes();
    const hashedBackupCodes = backupCodes.map(code => hashBackupCode(code));

    // Update backup codes
    await query(`
      UPDATE user_security
      SET 
        two_factor_backup_codes = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $2
    `, [JSON.stringify(hashedBackupCodes), userId]);

    logger.info(`Backup codes regenerated for user ${userId}`);

    return backupCodes;

  } catch (error) {
    logger.error(`Error regenerating backup codes for user ${userId}:`, error);
    throw error;
  }
};

/**
 * Check if 2FA is enabled for user
 */
const is2FAEnabled = async (userId) => {
  try {
    const result = await query(`
      SELECT two_factor_enabled
      FROM user_security
      WHERE user_id = $1
    `, [userId]);

    return result.rows.length > 0 && result.rows[0].two_factor_enabled === true;

  } catch (error) {
    logger.error(`Error checking 2FA status for user ${userId}:`, error);
    return false;
  }
};

/**
 * Get 2FA status and info
 */
const get2FAStatus = async (userId) => {
  try {
    const result = await query(`
      SELECT 
        two_factor_enabled,
        two_factor_enabled_at,
        two_factor_backup_codes
      FROM user_security
      WHERE user_id = $1
    `, [userId]);

    if (result.rows.length === 0) {
      return {
        enabled: false,
        enabledAt: null,
        backupCodesRemaining: 0
      };
    }

    const data = result.rows[0];
    let backupCodesRemaining = 0;

    if (data.two_factor_backup_codes) {
      const backupCodes = JSON.parse(data.two_factor_backup_codes);
      backupCodesRemaining = backupCodes.filter(bc => !bc.used).length;
    }

    return {
      enabled: data.two_factor_enabled,
      enabledAt: data.two_factor_enabled_at,
      backupCodesRemaining
    };

  } catch (error) {
    logger.error(`Error getting 2FA status for user ${userId}:`, error);
    throw error;
  }
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Generate backup codes (10 codes)
 */
const generateBackupCodes = () => {
  const codes = [];
  for (let i = 0; i < 10; i++) {
    // Generate 8-character alphanumeric code
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push(code);
  }
  return codes;
};

/**
 * Hash backup code for storage
 */
const hashBackupCode = (code) => {
  return {
    hash: crypto.createHash('sha256').update(code).digest('hex'),
    used: false,
    usedAt: null
  };
};

/**
 * Encrypt 2FA secret
 */
const encryptSecret = (secret) => {
  const algorithm = 'aes-256-cbc';
  const key = crypto.scryptSync(
    process.env.ENCRYPTION_KEY || 'default-encryption-key-change-in-production',
    'salt',
    32
  );
  const iv = crypto.randomBytes(16);
  
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(secret, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return iv.toString('hex') + ':' + encrypted;
};

/**
 * Decrypt 2FA secret
 */
const decryptSecret = (encryptedSecret) => {
  const algorithm = 'aes-256-cbc';
  const key = crypto.scryptSync(
    process.env.ENCRYPTION_KEY || 'default-encryption-key-change-in-production',
    'salt',
    32
  );
  
  const parts = encryptedSecret.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
};

module.exports = {
  generateSecret,
  generateQRCode,
  enable2FA,
  disable2FA,
  verify2FAToken,
  verifyBackupCode,
  regenerateBackupCodes,
  is2FAEnabled,
  get2FAStatus
};