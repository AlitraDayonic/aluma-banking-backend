
// ============================================
// middleware/validate.js
// Request Validation using Joi
// ============================================

const Joi = require('joi');
const { AppError } = require('./errorHandler');
const logger = require('../utils/logger');

/**
 * Validation middleware factory
 */
const validate = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const errorMessage = error.details.map(detail => detail.message).join(', ');
      logger.debug('Validation error:', errorMessage);
      return next(new AppError(errorMessage, 400));
    }

    // Replace req.body with validated value
    req.body = value;
    next();
  };
};

/**
 * Validation Schemas
 */
const schemas = {
  // Auth schemas
  register: Joi.object({
    email: Joi.string().email().required().messages({
      'string.email': 'Please provide a valid email address',
      'any.required': 'Email is required'
    }),
    username: Joi.string().alphanum().min(3).max(30).required().messages({
      'string.alphanum': 'Username must contain only letters and numbers',
      'string.min': 'Username must be at least 3 characters',
      'string.max': 'Username cannot exceed 30 characters',
      'any.required': 'Username is required'
    }),
    password: Joi.string()
      .min(8)
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .required()
      .messages({
        'string.min': 'Password must be at least 8 characters',
        'string.pattern.base': 'Password must contain uppercase, lowercase, number, and special character',
        'any.required': 'Password is required'
      }),
    firstName: Joi.string().min(2).max(50).required(),
    lastName: Joi.string().min(2).max(50).required(),
    phone: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).optional(),
    dateOfBirth: Joi.date().max('now').required().messages({
      'date.max': 'Date of birth cannot be in the future'
    })
  }),

  login: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
    deviceId: Joi.string().optional(),
    deviceName: Joi.string().optional()
  }),

  forgotPassword: Joi.object({
    email: Joi.string().email().required()
  }),

  resetPassword: Joi.object({
    token: Joi.string().required(),
    newPassword: Joi.string()
      .min(8)
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .required()
  }),

  // Trading schemas
  placeOrder: Joi.object({
    accountId: Joi.string().uuid().required(),
    symbol: Joi.string().uppercase().min(1).max(10).required(),
    side: Joi.string().valid('buy', 'sell').required(),
    orderType: Joi.string().valid('market', 'limit', 'stop', 'stop_limit').required(),
    quantity: Joi.number().integer().positive().required(),
    limitPrice: Joi.number().positive().when('orderType', {
      is: Joi.string().valid('limit', 'stop_limit'),
      then: Joi.required(),
      otherwise: Joi.optional()
    }),
    stopPrice: Joi.number().positive().when('orderType', {
      is: Joi.string().valid('stop', 'stop_limit'),
      then: Joi.required(),
      otherwise: Joi.optional()
    }),
    timeInForce: Joi.string().valid('day', 'gtc', 'ioc').default('day'),
    extendedHours: Joi.boolean().default(false)
  }),

  // Account schemas
  createAccount: Joi.object({
    accountType: Joi.string().valid('individual', 'joint', 'ira', 'corporate').required(),
    accountName: Joi.string().min(3).max(100).optional()
  }),

  // Funding schemas
  deposit: Joi.object({
    accountId: Joi.string().uuid().required(),
    amount: Joi.number().positive().precision(2).required(),
    bankAccountId: Joi.string().uuid().required(),
    notes: Joi.string().max(500).optional()
  }),

  withdrawal: Joi.object({
    accountId: Joi.string().uuid().required(),
    amount: Joi.number().positive().precision(2).required(),
    bankAccountId: Joi.string().uuid().required(),
    notes: Joi.string().max(500).optional()
  }),

  // Profile update schema
  updateProfile: Joi.object({
    firstName: Joi.string().min(2).max(50).optional(),
    lastName: Joi.string().min(2).max(50).optional(),
    phone: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).optional(),
    addressLine1: Joi.string().max(200).optional(),
    addressLine2: Joi.string().max(200).optional(),
    city: Joi.string().max(100).optional(),
    state: Joi.string().max(50).optional(),
    postalCode: Joi.string().max(20).optional(),
    country: Joi.string().length(2).uppercase().optional()
  }),

  // Change password schema
  changePassword: Joi.object({
    currentPassword: Joi.string().required(),
    newPassword: Joi.string()
      .min(8)
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .required()
      .invalid(Joi.ref('currentPassword'))
      .messages({
        'any.invalid': 'New password must be different from current password'
      })
  }),


‎// Add these to your existing schemas object in validate.js:
‎
‎setPin: Joi.object({
‎  pin: Joi.string().length(4).pattern(/^\d{4}$/).required().messages({
‎    'string.length': 'PIN must be exactly 4 digits',
‎    'string.pattern.base': 'PIN must contain only numbers',
‎    'any.required': 'PIN is required'
‎  }),
‎  confirmPin: Joi.string().length(4).pattern(/^\d{4}$/).required().valid(Joi.ref('pin')).messages({
‎    'string.length': 'PIN must be exactly 4 digits',
‎    'string.pattern.base': 'PIN must contain only numbers',
‎    'any.only': 'PINs do not match',
‎    'any.required': 'Confirm PIN is required'
‎  })
‎}),
‎
‎changePin: Joi.object({
‎  currentPin: Joi.string().length(4).pattern(/^\d{4}$/).required().messages({
‎    'string.length': 'Current PIN must be exactly 4 digits',
‎    'string.pattern.base': 'Current PIN must contain only numbers',
‎    'any.required': 'Current PIN is required'
‎  }),
‎  newPin: Joi.string().length(4).pattern(/^\d{4}$/).required().invalid(Joi.ref('currentPin')).messages({
‎    'string.length': 'New PIN must be exactly 4 digits',
‎    'string.pattern.base': 'New PIN must contain only numbers',
‎    'any.invalid': 'New PIN must be different from current PIN',
‎    'any.required': 'New PIN is required'
‎  }),
‎  confirmNewPin: Joi.string().length(4).pattern(/^\d{4}$/).required().valid(Joi.ref('newPin')).messages({
‎    'string.length': 'PIN must be exactly 4 digits',
‎    'string.pattern.base': 'PIN must contain only numbers',
‎    'any.only': 'PINs do not match',
‎    'any.required': 'Confirm new PIN is required'
‎  })
‎}),
‎
‎//

  // Watchlist schemas
  createWatchlist: Joi.object({
    name: Joi.string().min(1).max(100).required(),
    description: Joi.string().max(500).optional()
  }),

  addToWatchlist: Joi.object({
    symbol: Joi.string().uppercase().min(1).max(10).required()
  }),

  // Alert schema
  createPriceAlert: Joi.object({
    symbol: Joi.string().uppercase().min(1).max(10).required(),
    condition: Joi.string().valid('above', 'below').required(),
    targetPrice: Joi.number().positive().required(),
    notifyEmail: Joi.boolean().default(true),
    notifySms: Joi.boolean().default(false)
  }),

createSupportTicket: Joi.object({
  subject: Joi.string().min(5).max(255).required(),
  category: Joi.string().valid('account', 'trading', 'technical', 'billing', 'other').required(),
  message: Joi.string().min(10).max(5000).required(),
  priority: Joi.string().valid('low', 'normal', 'high', 'urgent').optional().default('normal'),
  email: Joi.string().email().optional().allow(''),
  name: Joi.string().min(2).max(100).optional().allow('')
}),

addTicketMessage: Joi.object({
  message: Joi.string().min(1).max(5000).required()
}),

updateTicketStatus: Joi.object({
  status: Joi.string().valid('open', 'in_progress', 'waiting', 'resolved', 'closed').required()
}),

  // 2FA schemas
  verify2FA: Joi.object({
    token: Joi.string().length(6).pattern(/^\d{6}$/).required().messages({
      'string.length': '2FA code must be 6 digits',
      'string.pattern.base': '2FA code must contain only numbers'
    })
  }),

  enable2FA: Joi.object({
    token: Joi.string().length(6).pattern(/^\d{6}$/).required()
  })
};

module.exports = {
  validate,
  schemas
};
