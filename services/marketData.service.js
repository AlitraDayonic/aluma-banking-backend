// ============================================
// services/marketData.service.js
// Market Data Integration with Alpha Vantage
// ============================================

const axios = require('axios');
const NodeCache = require('node-cache');
const logger = require('../utils/logger');

// Cache for market data (TTL: 60 seconds for quotes, 3600 for fundamentals)
const quoteCache = new NodeCache({ stdTTL: 60, checkperiod: 120 });
const fundamentalCache = new NodeCache({ stdTTL: 3600, checkperiod: 7200 });

const ALPHA_VANTAGE_KEY = process.env.ALPHA_VANTAGE_API_KEY;
const BASE_URL = 'https://www.alphavantage.co/query';

// Request queue to handle rate limiting (5 requests per minute for free tier)
class RequestQueue {
  constructor(maxPerMinute = 5) {
    this.queue = [];
    this.processing = false;
    this.maxPerMinute = maxPerMinute;
    this.requests = [];
  }

  async add(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.process();
    });
  }

  async process() {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    
    // Clean old requests (older than 1 minute)
    const oneMinuteAgo = Date.now() - 60000;
    this.requests = this.requests.filter(time => time > oneMinuteAgo);
    
    // Check rate limit
    if (this.requests.length >= this.maxPerMinute) {
      const oldestRequest = Math.min(...this.requests);
      const waitTime = 60000 - (Date.now() - oldestRequest);
      
      logger.debug(`Rate limit reached, waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.requests = [];
    }
    
    const { fn, resolve, reject } = this.queue.shift();
    this.requests.push(Date.now());
    
    try {
      const result = await fn();
      resolve(result);
    } catch (error) {
      reject(error);
    }
    
    this.processing = false;
    
    // Process next in queue
    if (this.queue.length > 0) {
      setTimeout(() => this.process(), 100);
    }
  }
}

const requestQueue = new RequestQueue();

/**
 * Make API request with rate limiting
 */
const makeRequest = async (params) => {
  return requestQueue.add(async () => {
    try {
      const response = await axios.get(BASE_URL, {
        params: {
          ...params,
          apikey: ALPHA_VANTAGE_KEY
        },
        timeout: 10000
      });

      // Check for API errors
      if (response.data['Error Message']) {
        throw new Error(response.data['Error Message']);
      }

      if (response.data['Note']) {
        throw new Error('API rate limit exceeded');
      }

      return response.data;
    } catch (error) {
      logger.error('Alpha Vantage API error:', error.message);
      throw error;
    }
  });
};

/**
 * Get real-time quote for a symbol
 */
const getQuote = async (symbol) => {
  const cacheKey = `quote_${symbol}`;
  const cached = quoteCache.get(cacheKey);
  
  if (cached) {
    return cached;
  }

  try {
    const data = await makeRequest({
      function: 'GLOBAL_QUOTE',
      symbol: symbol.toUpperCase()
    });

    const quote = data['Global Quote'];
    
    if (!quote || Object.keys(quote).length === 0) {
      throw new Error(`No data found for symbol: ${symbol}`);
    }

    const formattedQuote = {
      symbol: quote['01. symbol'],
      price: parseFloat(quote['05. price']),
      change: parseFloat(quote['09. change']),
      changePercent: quote['10. change percent'],
      volume: parseInt(quote['06. volume']),
      open: parseFloat(quote['02. open']),
      high: parseFloat(quote['03. high']),
      low: parseFloat(quote['04. low']),
      previousClose: parseFloat(quote['08. previous close']),
      latestTradingDay: quote['07. latest trading day'],
      timestamp: new Date().toISOString()
    };

    quoteCache.set(cacheKey, formattedQuote);
    return formattedQuote;

  } catch (error) {
    logger.error(`Error fetching quote for ${symbol}:`, error.message);
    throw error;
  }
};

/**
 * Get quotes for multiple symbols
 */
const getQuotes = async (symbols) => {
  const promises = symbols.map(symbol => 
    getQuote(symbol).catch(error => {
      logger.warn(`Failed to fetch quote for ${symbol}:`, error.message);
      return null;
    })
  );

  const results = await Promise.all(promises);
  return results.filter(quote => quote !== null);
};

/**
 * Get intraday chart data
 */
const getIntradayData = async (symbol, interval = '5min') => {
  const cacheKey = `intraday_${symbol}_${interval}`;
  const cached = quoteCache.get(cacheKey);
  
  if (cached) {
    return cached;
  }

  try {
    const data = await makeRequest({
      function: 'TIME_SERIES_INTRADAY',
      symbol: symbol.toUpperCase(),
      interval,
      outputsize: 'compact'
    });

    const timeSeries = data[`Time Series (${interval})`];
    
    if (!timeSeries) {
      throw new Error(`No intraday data found for symbol: ${symbol}`);
    }

    const chartData = Object.entries(timeSeries).map(([timestamp, values]) => ({
      timestamp,
      open: parseFloat(values['1. open']),
      high: parseFloat(values['2. high']),
      low: parseFloat(values['3. low']),
      close: parseFloat(values['4. close']),
      volume: parseInt(values['5. volume'])
    })).reverse();

    quoteCache.set(cacheKey, chartData);
    return chartData;

  } catch (error) {
    logger.error(`Error fetching intraday data for ${symbol}:`, error.message);
    throw error;
  }
};

/**
 * Get daily chart data
 */
const getDailyData = async (symbol, outputsize = 'compact') => {
  const cacheKey = `daily_${symbol}_${outputsize}`;
  const cached = fundamentalCache.get(cacheKey);
  
  if (cached) {
    return cached;
  }

  try {
    const data = await makeRequest({
      function: 'TIME_SERIES_DAILY',
      symbol: symbol.toUpperCase(),
      outputsize
    });

    const timeSeries = data['Time Series (Daily)'];
    
    if (!timeSeries) {
      throw new Error(`No daily data found for symbol: ${symbol}`);
    }

    const chartData = Object.entries(timeSeries).map(([date, values]) => ({
      date,
      open: parseFloat(values['1. open']),
      high: parseFloat(values['2. high']),
      low: parseFloat(values['3. low']),
      close: parseFloat(values['4. close']),
      volume: parseInt(values['5. volume'])
    })).reverse();

    fundamentalCache.set(cacheKey, chartData);
    return chartData;

  } catch (error) {
    logger.error(`Error fetching daily data for ${symbol}:`, error.message);
    throw error;
  }
};

/**
 * Get company overview
 */
const getCompanyOverview = async (symbol) => {
  const cacheKey = `overview_${symbol}`;
  const cached = fundamentalCache.get(cacheKey);
  
  if (cached) {
    return cached;
  }

  try {
    const data = await makeRequest({
      function: 'OVERVIEW',
      symbol: symbol.toUpperCase()
    });

    if (!data.Symbol) {
      throw new Error(`No overview data found for symbol: ${symbol}`);
    }

    const overview = {
      symbol: data.Symbol,
      name: data.Name,
      description: data.Description,
      exchange: data.Exchange,
      currency: data.Currency,
      country: data.Country,
      sector: data.Sector,
      industry: data.Industry,
      marketCap: data.MarketCapitalization,
      peRatio: data.PERatio,
      pegRatio: data.PEGRatio,
      bookValue: data.BookValue,
      dividendPerShare: data.DividendPerShare,
      dividendYield: data.DividendYield,
      eps: data.EPS,
      profitMargin: data.ProfitMargin,
      operatingMarginTTM: data.OperatingMarginTTM,
      returnOnAssetsTTM: data.ReturnOnAssetsTTM,
      returnOnEquityTTM: data.ReturnOnEquityTTM,
      revenueTTM: data.RevenueTTM,
      grossProfitTTM: data.GrossProfitTTM,
      analystTargetPrice: data.AnalystTargetPrice,
      week52High: data['52WeekHigh'],
      week52Low: data['52WeekLow'],
      movingAverage50: data['50DayMovingAverage'],
      movingAverage200: data['200DayMovingAverage']
    };

    fundamentalCache.set(cacheKey, overview);
    return overview;

  } catch (error) {
    logger.error(`Error fetching overview for ${symbol}:`, error.message);
    throw error;
  }
};

/**
 * Search symbols
 */
const searchSymbols = async (keywords) => {
  try {
    const data = await makeRequest({
      function: 'SYMBOL_SEARCH',
      keywords
    });

    const matches = data.bestMatches || [];
    
    return matches.map(match => ({
      symbol: match['1. symbol'],
      name: match['2. name'],
      type: match['3. type'],
      region: match['4. region'],
      currency: match['8. currency'],
      matchScore: match['9. matchScore']
    }));

  } catch (error) {
    logger.error(`Error searching symbols for "${keywords}":`, error.message);
    throw error;
  }
};

/**
 * Get market status (US markets)
 */
const getMarketStatus = () => {
  const now = new Date();
  const eastern = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  
  const hour = eastern.getHours();
  const minute = eastern.getMinutes();
  const day = eastern.getDay();
  
  // Weekend check
  if (day === 0 || day === 6) {
    return {
      status: 'closed',
      reason: 'weekend',
      nextOpen: getNextMarketOpen(eastern)
    };
  }
  
  // Market hours: 9:30 AM - 4:00 PM ET
  const currentMinutes = hour * 60 + minute;
  const marketOpen = 9 * 60 + 30; // 9:30 AM
  const marketClose = 16 * 60; // 4:00 PM
  
  if (currentMinutes >= marketOpen && currentMinutes < marketClose) {
    return {
      status: 'open',
      openTime: '09:30 ET',
      closeTime: '16:00 ET'
    };
  }
  
  return {
    status: 'closed',
    reason: currentMinutes < marketOpen ? 'pre-market' : 'after-hours',
    nextOpen: getNextMarketOpen(eastern)
  };
};

/**
 * Calculate next market open time
 */
const getNextMarketOpen = (currentDate) => {
  const nextDay = new Date(currentDate);
  nextDay.setDate(nextDay.getDate() + 1);
  nextDay.setHours(9, 30, 0, 0);
  
  // Skip weekends
  while (nextDay.getDay() === 0 || nextDay.getDay() === 6) {
    nextDay.setDate(nextDay.getDate() + 1);
  }
  
  return nextDay.toISOString();
};

/**
 * Clear cache (useful for testing)
 */
const clearCache = () => {
  quoteCache.flushAll();
  fundamentalCache.flushAll();
  logger.info('Market data cache cleared');
};

module.exports = {
  getQuote,
  getQuotes,
  getIntradayData,
  getDailyData,
  getCompanyOverview,
  searchSymbols,
  getMarketStatus,
  clearCache
};