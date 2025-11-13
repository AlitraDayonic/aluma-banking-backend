// ============================================
// routes/kyc.routes.js
// ============================================
const express2 = require('express');
const router2 = express2.Router();
const kycController = require('../controllers/kyc.controller');
const { authenticate: auth2 } = require('../middleware/auth');
const { handleKycUpload } = require('../middleware/upload');
const { uploadLimiter } = require('../middleware/rateLimiter');

router2.post('/upload', auth2, uploadLimiter, handleKycUpload('documents'), kycController.uploadDocuments);
router2.get('/status', auth2, kycController.getKycStatus);
router2.post('/submit', auth2, kycController.submitForReview);
router2.get('/documents/:id', auth2, kycController.getDocument);

module.exports = router2;