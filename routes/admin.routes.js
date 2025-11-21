const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const { authenticate } = require('../middleware/auth');
const { checkRole } = require('../middleware/roleCheck');
const { asyncHandler } = require('../middleware/errorHandler');

// Dashboard
router.get('/dashboard/stats',
  authenticate,
  checkRole(['admin', 'super_admin']),
  asyncHandler(adminController.getDashboardStats)
);

router.get('/analytics',
  authenticate,
  checkRole(['admin', 'super_admin']),
  asyncHandler(adminController.getPlatformAnalytics)
);

// User Management
router.get('/users',
  authenticate,
  checkRole(['admin', 'super_admin']),
  asyncHandler(adminController.getAllUsers)
);

router.get('/users/:id',
  authenticate,
  checkRole(['admin', 'super_admin']),
  asyncHandler(adminController.getUserDetails)
);

router.patch('/users/:id/status',
  authenticate,
  checkRole(['admin', 'super_admin']),
  asyncHandler(adminController.updateUserStatus)
);

// Account Management
router.get('/accounts',
  authenticate,
  checkRole(['admin', 'super_admin']),
  asyncHandler(adminController.getAllAccounts)
);

router.post('/accounts/:account_id/credit',
  authenticate,
  checkRole(['admin', 'super_admin']),
  asyncHandler(adminController.creditAccount)
);

router.post('/accounts/:account_id/debit',
  authenticate,
  checkRole(['admin', 'super_admin']),
  asyncHandler(adminController.debitAccount)
);

router.get('/accounts/:account_id/adjustments',
  authenticate,
  checkRole(['admin', 'super_admin']),
  asyncHandler(adminController.getBalanceAdjustments)
);

// KYC Management
router.get('/kyc/pending',
  authenticate,
  checkRole(['admin', 'super_admin']),
  asyncHandler(adminController.getPendingKYC)
);

router.post('/kyc/:id/review',
  authenticate,
  checkRole(['admin', 'super_admin']),
  asyncHandler(adminController.reviewKYC)
);

// Transactions
router.get('/transactions',
  authenticate,
  checkRole(['admin', 'super_admin']),
  asyncHandler(adminController.getAllTransactions)
);

// Support Tickets
router.get('/tickets',
  authenticate,
  checkRole(['admin', 'super_admin']),
  asyncHandler(adminController.getAllTickets)
);

router.patch('/tickets/:id/assign',
  authenticate,
  checkRole(['admin', 'super_admin']),
  asyncHandler(adminController.assignTicket)
);

// Audit Logs
router.get('/audit-logs',
  authenticate,
  checkRole(['admin', 'super_admin']),
  asyncHandler(adminController.getAuditLogs)
);

module.exports = router;
