const { query } = require('../config/database');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

class User {
  /**
   * Create a new user
   */
  static async create(userData) {
    const {
      email,
      username,
      password,
      firstName,
      lastName,
      phone,
      dateOfBirth
    } = userData;

    // Hash password
    const passwordHash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);

    const result = await query(
      `INSERT INTO users (
        email, username, password_hash, first_name, last_name, phone, date_of_birth, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, email, username, first_name, last_name, phone, date_of_birth, status, created_at`,
      [email, username, passwordHash, firstName, lastName, phone, dateOfBirth, 'pending']
    );

    return result.rows[0];
  }

  /**
   * Find user by ID
   */
  static async findById(id) {
    const result = await query(
      `SELECT 
        id, email, username, first_name, last_name, phone, date_of_birth,
        status, email_verified, phone_verified, created_at, last_login_at
      FROM users
      WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );

    return result.rows[0] || null;
  }

  /**
   * Find user by email
   */
  static async findByEmail(email) {
    const result = await query(
      `SELECT 
        id, email, username, password_hash, first_name, last_name, 
        status, email_verified, created_at, role
      FROM users
      WHERE email = $1 AND deleted_at IS NULL`,
      [email]
    );

    return result.rows[0] || null;
  }

  /**
   * Find user by username
   */
  static async findByUsername(username) {
    const result = await query(
      `SELECT 
        id, email, username, first_name, last_name, status
      FROM users
      WHERE username = $1 AND deleted_at IS NULL`,
      [username]
    );

    return result.rows[0] || null;
  }

  /**
   * Verify password
   */
  static async verifyPassword(plainPassword, hashedPassword) {
    return await bcrypt.compare(plainPassword, hashedPassword);
  }

  /**
   * Update user
   */
  static async update(id, updates) {
    const allowedFields = ['first_name', 'last_name', 'phone'];
    const fields = [];
    const values = [];
    let paramCount = 1;

    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key)) {
        fields.push(`${key} = $${paramCount}`);
        values.push(updates[key]);
        paramCount++;
      }
    });

    if (fields.length === 0) {
      throw new Error('No valid fields to update');
    }

    values.push(id);

    const result = await query(
      `UPDATE users 
       SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${paramCount}
       RETURNING id, email, username, first_name, last_name, phone, updated_at`,
      values
    );

    return result.rows[0];
  }

  /**
   * Update email verified status
   */
  static async verifyEmail(id) {
    const result = await query(
      `UPDATE users 
       SET email_verified = true, status = 'active', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING id, email, email_verified, status`,
      [id]
    );

    return result.rows[0];
  }

  /**
   * Update phone verified status
   */
  static async verifyPhone(id) {
    const result = await query(
      `UPDATE users 
       SET phone_verified = true, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING id, phone, phone_verified`,
      [id]
    );

    return result.rows[0];
  }

  /**
   * Change password
   */
  static async changePassword(id, newPassword) {
    const passwordHash = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS) || 12);

    await query(
      `UPDATE users 
       SET password_hash = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [passwordHash, id]
    );

    // Update security table
    await query(
      `UPDATE user_security 
       SET password_changed_at = CURRENT_TIMESTAMP
       WHERE user_id = $1`,
      [id]
    );

    return true;
  }

  /**
   * Update last login
   */
  static async updateLastLogin(id) {
    await query(
      `UPDATE users 
       SET last_login_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id]
    );
  }

  /**
   * Update user status
   */
  static async updateStatus(id, status) {
    const result = await query(
      `UPDATE users 
       SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, status`,
      [status, id]
    );

    return result.rows[0];
  }

  /**
   * Check if email exists
   */
  static async emailExists(email) {
    const result = await query(
      'SELECT COUNT(*) FROM users WHERE email = $1 AND deleted_at IS NULL',
      [email]
    );

    return parseInt(result.rows[0].count) > 0;
  }

  /**
   * Check if username exists
   */
  static async usernameExists(username) {
    const result = await query(
      'SELECT COUNT(*) FROM users WHERE username = $1 AND deleted_at IS NULL',
      [username]
    );

    return parseInt(result.rows[0].count) > 0;
  }

  /**
   * Soft delete user
   */
  static async softDelete(id) {
    await query(
      `UPDATE users 
       SET deleted_at = CURRENT_TIMESTAMP, status = 'closed'
       WHERE id = $1`,
      [id]
    );

    return true;
  }

  /**
   * Get user profile with extended info
   */
  static async getProfile(id) {
    const result = await query(
      `SELECT 
        u.id, u.email, u.username, u.first_name, u.last_name, u.phone, 
        u.date_of_birth, u.status, u.email_verified, u.phone_verified,
        u.created_at, u.last_login_at,
        p.address_line1, p.address_line2, p.city, p.state, p.postal_code,
        p.country, p.citizenship, p.employment_status, p.employer_name,
        p.occupation, p.annual_income, p.net_worth, p.investment_experience,
        p.risk_tolerance,
        k.status as kyc_status, k.verification_level
      FROM users u
      LEFT JOIN user_profiles p ON u.id = p.user_id
      LEFT JOIN user_kyc k ON u.id = k.user_id
      WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [id]
    );

    return result.rows[0] || null;
  }

  /**
   * Search users (admin function)
   */
  static async search(filters, limit = 20, offset = 0) {
    let whereClause = 'WHERE deleted_at IS NULL';
    const values = [];
    let paramCount = 1;

    if (filters.email) {
      whereClause += ` AND email ILIKE $${paramCount}`;
      values.push(`%${filters.email}%`);
      paramCount++;
    }

    if (filters.status) {
      whereClause += ` AND status = $${paramCount}`;
      values.push(filters.status);
      paramCount++;
    }

    values.push(limit, offset);

    const result = await query(
      `SELECT 
        id, email, username, first_name, last_name, status, 
        email_verified, created_at, last_login_at
      FROM users
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
      values
    );

    return result.rows;
  }
}

module.exports = User;
