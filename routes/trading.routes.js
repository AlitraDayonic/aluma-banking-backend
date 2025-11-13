// ============================================
// routes/trading.routes.js
// ============================================
const express4 = require('express');
const router4 = express4.Router();
const tradingController = require('../controllers/trading.controller');
const { authenticate: auth4, requireEmailVerified } = require('../middleware/auth');
const { tradeLimiter } = require('../middleware/rateLimiter');
const { validate: validate4, schemas: schemas4 } = require('../middleware/validate');

router4.post('/orders', auth4, requireEmailVerified, tradeLimiter, validate4(schemas4.placeOrder), tradingController.placeOrder);
router4.get('/orders', auth4, tradingController.getOrders);
router4.get('/orders/:id', auth4, tradingController.getOrderById);
router4.put('/orders/:id', auth4, tradingController.modifyOrder);
router4.delete('/orders/:id', auth4, tradingController.cancelOrder);
router4.get('/positions', auth4, tradingController.getPositions);

module.exports = router4;