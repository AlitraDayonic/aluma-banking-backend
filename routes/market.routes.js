// ============================================
// routes/market.routes.js
// ============================================
const express6 = require('express');
const router6 = express6.Router();
const { optionalAuth } = require('../middleware/auth');
const { marketDataLimiter } = require('../middleware/rateLimiter');
const marketDataService = require('../services/marketData.service');
const { asyncHandler } = require('../middleware/errorHandler');

router6.get('/securities/:symbol', optionalAuth, marketDataLimiter, asyncHandler(async (req, res) => {
  const { symbol } = req.params;
  const overview = await marketDataService.getCompanyOverview(symbol);
  res.json({ success: true, data: { security: overview } });
}));

router6.get('/securities/:symbol/quote', optionalAuth, marketDataLimiter, asyncHandler(async (req, res) => {
  const { symbol } = req.params;
  const quote = await marketDataService.getQuote(symbol);
  res.json({ success: true, data: { quote } });
}));

router6.get('/securities/:symbol/chart', optionalAuth, marketDataLimiter, asyncHandler(async (req, res) => {
  const { symbol } = req.params;
  const { interval = '5min', period = 'intraday' } = req.query;
  
  const data = period === 'daily' 
    ? await marketDataService.getDailyData(symbol)
    : await marketDataService.getIntradayData(symbol, interval);
    
  res.json({ success: true, data: { chart: data } });
}));

router6.get('/securities/search', optionalAuth, asyncHandler(async (req, res) => {
  const { q } = req.query;
  if (!q) {
    return res.status(400).json({ success: false, message: 'Search query required' });
  }
  const results = await marketDataService.searchSymbols(q);
  res.json({ success: true, data: { results } });
}));

router6.get('/status', asyncHandler(async (req, res) => {
  const status = marketDataService.getMarketStatus();
  res.json({ success: true, data: { marketStatus: status } });
}));

module.exports = router6;

