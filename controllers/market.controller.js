// ============================================
// controllers/market.controller.js
// ============================================

const { pool } = require('../config/database');
const logger = require('../utils/logger');
const marketDataService = require('../services/marketData.service');

// Search securities
exports.searchSecurities = async (req, res, next) => {
  try {
    const { q, type, limit = 20 } = req.query;

    if (!q || q.length < 1) {
      return res.status(400).json({
        success: false,
        message: 'Search query required (minimum 1 character)'
      });
    }

    let query = `
      SELECT id, symbol, name, exchange, security_type, last_price, 
             change_amount, change_percent, volume, market_cap, is_tradable
      FROM securities
      WHERE (symbol ILIKE $1 OR name ILIKE $1)
      AND is_tradable = true
    `;
    const params = [`%${q}%`];

    if (type) {
      params.push(type);
      query += ` AND security_type = $${params.length}`;
    }

    query += ` ORDER BY 
      CASE 
        WHEN symbol ILIKE $1 THEN 1
        WHEN symbol ILIKE ${q}% THEN 2
        ELSE 3
      END,
      market_cap DESC NULLS LAST
      LIMIT $${params.length + 1}`;
    
    params.push(parseInt(limit));

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    logger.error('Error searching securities:', error);
    next(error);
  }
};

// Get security by symbol
exports.getSecurityBySymbol = async (req, res, next) => {
  try {
    const { symbol } = req.params;

    const result = await pool.query(
      `SELECT * FROM securities WHERE symbol = $1`,
      [symbol.toUpperCase()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Security not found'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Error fetching security:', error);
    next(error);
  }
};

// Get real-time quote
exports.getQuote = async (req, res, next) => {
  try {
    const { symbol } = req.params;

    // First check if security exists in database
    const securityResult = await pool.query(
      'SELECT * FROM securities WHERE symbol = $1',
      [symbol.toUpperCase()]
    );

    if (securityResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Security not found'
      });
    }

    // Fetch real-time data from external API
    const quote = await marketDataService.getQuote(symbol);

    // Update database with latest price
    if (quote) {
      await pool.query(
        `UPDATE securities 
         SET last_price = $1,
             previous_close = $2,
             change_amount = $3,
             change_percent = $4,
             volume = $5,
             updated_at = CURRENT_TIMESTAMP
         WHERE symbol = $6`,
        [
          quote.price,
          quote.previousClose,
          quote.change,
          quote.changePercent,
          quote.volume,
          symbol.toUpperCase()
        ]
      );
    }

    res.json({
      success: true,
      data: quote || securityResult.rows[0]
    });
  } catch (error) {
    logger.error('Error fetching quote:', error);
    next(error);
  }
};

// Get multiple quotes
exports.getQuotes = async (req, res, next) => {
  try {
    const { symbols } = req.query;

    if (!symbols) {
      return res.status(400).json({
        success: false,
        message: 'Symbols parameter required (comma-separated)'
      });
    }

    const symbolArray = symbols.split(',').map(s => s.trim().toUpperCase());

    if (symbolArray.length > 50) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 50 symbols allowed'
      });
    }

    const result = await pool.query(
      `SELECT id, symbol, name, last_price, previous_close, 
              change_amount, change_percent, volume, updated_at
       FROM securities 
       WHERE symbol = ANY($1)`,
      [symbolArray]
    );

    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    logger.error('Error fetching quotes:', error);
    next(error);
  }
};

// Get market movers (top gainers, losers, most active)
exports.getMarketMovers = async (req, res, next) => {
  try {
    const { type = 'gainers', limit = 10 } = req.query;

    let orderBy;
    switch (type) {
      case 'gainers':
        orderBy = 'change_percent DESC';
        break;
      case 'losers':
        orderBy = 'change_percent ASC';
        break;
      case 'active':
        orderBy = 'volume DESC';
        break;
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid type. Use: gainers, losers, or active'
        });
    }

    const result = await pool.query(
      `SELECT symbol, name, last_price, previous_close, 
              change_amount, change_percent, volume, market_cap
       FROM securities
       WHERE is_tradable = true 
       AND last_price IS NOT NULL
       AND change_percent IS NOT NULL
       ORDER BY ${orderBy}
       LIMIT $1`,
      [parseInt(limit)]
    );

    res.json({
      success: true,
      type,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    logger.error('Error fetching market movers:', error);
    next(error);
  }
};

// Get market sectors
exports.getMarketSectors = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT 
        sector,
        COUNT(*) as security_count,
        AVG(change_percent) as avg_change,
        SUM(volume) as total_volume,
        SUM(market_cap) as total_market_cap
       FROM securities
       WHERE sector IS NOT NULL 
       AND is_tradable = true
       GROUP BY sector
       ORDER BY total_market_cap DESC NULLS LAST`
    );

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    logger.error('Error fetching sectors:', error);
    next(error);
  }
};

// Get historical data (chart data)
exports.getHistoricalData = async (req, res, next) => {
  try {
    const { symbol } = req.params;
    const { interval = '1d', range = '1m' } = req.query;

    // Validate security exists
    const securityCheck = await pool.query(
      'SELECT id FROM securities WHERE symbol = $1',
      [symbol.toUpperCase()]
    );

    if (securityCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Security not found'
      });
    }

    // Fetch historical data from external API
    const historicalData = await marketDataService.getHistoricalData(
      symbol, 
      interval, 
      range
    );

    res.json({
      success: true,
      symbol: symbol.toUpperCase(),
      interval,
      range,
      data: historicalData
    });
  } catch (error) {
    logger.error('Error fetching historical data:', error);
    next(error);
  }
};

// Get market news
exports.getMarketNews = async (req, res, next) => {
  try {
    const { symbol, limit = 10 } = req.query;

    const news = await marketDataService.getNews(symbol, parseInt(limit));

    res.json({
      success: true,
      data: news,
      count: news.length
    });
  } catch (error) {
    logger.error('Error fetching news:', error);
    next(error);
  }
};

// Get market summary/overview
exports.getMarketSummary = async (req, res, next) => {
  try {
    // Get major indices (if you have them)
    const indices = await pool.query(
      `SELECT symbol, name, last_price, change_amount, change_percent
       FROM securities
       WHERE symbol IN ('SPY', 'QQQ', 'DIA', 'IWM')
       AND is_tradable = true`
    );

    // Get market statistics
    const stats = await pool.query(
      `SELECT 
        COUNT(*) FILTER (WHERE change_percent > 0) as advancing,
        COUNT(*) FILTER (WHERE change_percent < 0) as declining,
        COUNT(*) FILTER (WHERE change_percent = 0) as unchanged,
        AVG(change_percent) as avg_change,
        SUM(volume) as total_volume
       FROM securities
       WHERE is_tradable = true
       AND last_price IS NOT NULL`
    );

    res.json({
      success: true,
      data: {
        indices: indices.rows,
        market_stats: stats.rows[0],
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Error fetching market summary:', error);
    next(error);
  }
};

// Add new security (admin only)
exports.addSecurity = async (req, res, next) => {
  try {
    const {
      symbol,
      name,
      exchange,
      security_type,
      sector,
      industry
    } = req.body;

    // Check if already exists
    const existsCheck = await pool.query(
      'SELECT id FROM securities WHERE symbol = $1',
      [symbol.toUpperCase()]
    );

    if (existsCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Security already exists'
      });
    }

    const result = await pool.query(
      `INSERT INTO securities 
       (symbol, name, exchange, security_type, sector, industry, is_tradable)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       RETURNING *`,
      [symbol.toUpperCase(), name, exchange, security_type, sector, industry]
    );

    logger.info('Security added', { 
      symbol: symbol.toUpperCase(), 
      addedBy: req.user.id 
    });

    res.status(201).json({
      success: true,
      message: 'Security added successfully',
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Error adding security:', error);
    next(error);
  }
};

// Update security (admin only)
exports.updateSecurity = async (req, res, next) => {
  try {
    const { symbol } = req.params;
    const updates = req.body;

    const allowedFields = ['name', 'exchange', 'sector', 'industry', 'is_tradable'];
    const setClause = [];
    const values = [];
    let paramCount = 1;

    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key)) {
        setClause.push(`${key} = $${paramCount}`);
        values.push(updates[key]);
        paramCount++;
      }
    });

    if (setClause.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields to update'
      });
    }

    values.push(symbol.toUpperCase());

    const result = await pool.query(
      `UPDATE securities 
       SET ${setClause.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE symbol = $${paramCount}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Security not found'
      });
    }

    logger.info('Security updated', { 
      symbol: symbol.toUpperCase(), 
      updatedBy: req.user.id 
    });

    res.json({
      success: true,
      message: 'Security updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Error updating security:', error);
    next(error);
  }
};