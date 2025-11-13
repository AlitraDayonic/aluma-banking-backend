// ============================================
// routes/account.routes.js
// ============================================
const express3 = require('express');
const router3 = express3.Router();
const accountController = require('../controllers/account.controller');
const { authenticate: auth3 } = require('../middleware/auth');
const { validate: validate3, schemas: schemas3 } = require('../middleware/validate');

router3.get('/', auth3, accountController.getAccounts);
router3.post('/', auth3, validate3(schemas3.createAccount), accountController.createAccount);
router3.get('/:id', auth3, accountController.getAccountById);
router3.put('/:id', auth3, accountController.updateAccount);
router3.get('/:id/balance', auth3, accountController.getAccountBalance);
router3.get('/:id/positions', auth3, accountController.getAccountPositions);
router3.get('/:id/activity', auth3, accountController.getAccountActivity);
router3.post('/:id/close', auth3, accountController.closeAccount);

module.exports = router3;


