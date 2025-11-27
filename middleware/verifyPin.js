const { query } = require('../config/database');
const { AppError } = require('./errorHandler');

const verifyTransactionPin = async (req, res, next) => {
  try {
    const { pin } = req.body;
    const userId = req.user.id;

    if (!pin) {
      throw new AppError('Transaction PIN is required', 400);
    }

    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      throw new AppError('PIN must be exactly 4 digits', 400);
    }

    // Get user's PIN from database
    const result = await query(
      'SELECT transaction_pin FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      throw new AppError('User not found', 404);
    }

    const user = result.rows[0];

    if (!user.transaction_pin) {
      throw new AppError('Please set up your transaction PIN first', 400);
    }

    // Compare PIN
    if (pin !== user.transaction_pin) {
      throw new AppError('Invalid transaction PIN', 401);
    }

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = { verifyTransactionPin };
