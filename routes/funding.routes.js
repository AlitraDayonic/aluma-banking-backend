
// ============================================
// routes/funding.routes.js
// ============================================
const express5 = require('express');
const router5 = express5.Router();
const fundingController = require('../controllers/funding.controller');
const { authenticate: auth5, requireEmailVerified: requireEmail5 } = require('../middleware/auth');
const { validate: validate5, schemas: schemas5 } = require('../middleware/validate');

router5.post('/deposits', auth5, requireEmail5, validate5(schemas5.deposit), fundingController.initiateDeposit);
router5.post('/withdrawals', auth5, requireEmail5, validate5(schemas5.withdrawal), fundingController.requestWithdrawal);
router5.post('/transfers', auth5, requireEmail5, fundingController.internalTransfer);
router5.get('/transactions', auth5, fundingController.getFundingTransactions);
router5.get('/bank-accounts', auth5, fundingController.getBankAccounts);
router5.post('/bank-accounts', auth5, fundingController.linkBankAccount);
router5.delete('/bank-accounts/:id', auth5, fundingController.removeBankAccount);

module.exports = router5;