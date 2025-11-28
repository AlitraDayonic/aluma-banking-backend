// ============================================
// routes/user.routes.js
// ============================================
const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const { authenticate } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');

router.get('/me', authenticate, userController.getProfile);
router.put('/me', authenticate, validate(schemas.updateProfile), userController.updateProfile);
router.put('/me/password', authenticate, validate(schemas.changePassword), userController.changePassword);

router.post('/pin/set', authenticate, validate(schemas.setPin), userController.setPin);
‎router.post('/pin/change', authenticate, validate(schemas.changePin), userController.changePin);
‎router.get('/pin/status', authenticate, userController.checkPinStatus);
‎router.delete('/pin/reset', authenticate, userController.resetPin);

// 2FA routes   
router.post('/2fa/setup', authenticate, userController.setup2FA);
router.post('/2fa/enable', authenticate, validate(schemas.enable2FA), userController.enable2FA);
router.post('/2fa/disable', authenticate, validate(schemas.verify2FA), userController.disable2FA);
router.post('/2fa/verify', authenticate, validate(schemas.verify2FA), userController.verify2FA);
router.get('/2fa/status', authenticate, userController.get2FAStatus);
router.post('/2fa/regenerate-codes', authenticate, validate(schemas.verify2FA), userController.regenerateBackupCodes);

module.exports = router;





