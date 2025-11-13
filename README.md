# Aluma Banking Broker - Backend API

Complete backend system for a modern banking and brokerage platform with real-time trading, market data, and comprehensive financial services.

## 🚀 Features

### Core Features
- ✅ **User Authentication & Authorization** (JWT-based)
- ✅ **Two-Factor Authentication** (2FA with Speakeasy)
- ✅ **KYC Document Upload & Management** (Multer)
- ✅ **Real-time Market Data** (Alpha Vantage Integration)
- ✅ **WebSocket Support** (Real-time quotes, orders, alerts)
- ✅ **Trading Engine** (Market, Limit, Stop orders)
- ✅ **Account Management** (Multiple account types)
- ✅ **Funding Operations** (Deposits, Withdrawals, Transfers)
- ✅ **Portfolio Management** (Positions, Performance tracking)
- ✅ **Price Alerts** (Email notifications)
- ✅ **Background Jobs** (Bull Queue with Redis)
- ✅ **Email Service** (SendGrid integration)
- ✅ **Watchlists** (Track favorite securities)
- ✅ **Reports & Statements** (Monthly statements, tax documents)
- ✅ **Audit Logging** (Complete activity tracking)
- ✅ **Rate Limiting** (API protection)
- ✅ **Security** (Helmet, CORS, input validation)

## 📋 Prerequisites

- Node.js >= 16.0.0
- PostgreSQL >= 13
- Redis >= 6.0
- npm or yarn

## 🔧 Installation

### 1. Clone the repository
```bash
git clone <repository-url>
cd aluma-banking-backend
```

### 2. Install dependencies
```bash
npm install
```

### 3. Configure environment variables
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
- Database credentials
- JWT secrets (generate secure random strings)
- SendGrid API key
- Alpha Vantage API key
- Redis connection details

### 4. Set up the database

Create PostgreSQL database:
```sql
CREATE DATABASE aluma_db;
```

Run migrations:
```bash
npm run migrate
```

Seed initial data (optional):
```bash
npm run seed
```

### 5. Start Redis server
```bash
redis-server
```

### 6. Start the application

Development mode:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

## 📁 Project Structure

```
aluma-banking-backend/
├── config/
│   ├── database.js          # PostgreSQL configuration
│   └── jwt.js               # JWT token management
├── controllers/
│   ├── auth.controller.js   # Authentication logic
│   ├── trading.controller.js # Trading operations
│   └── ...
├── middleware/
│   ├── auth.js              # Authentication middleware
│   ├── rateLimiter.js       # Rate limiting
│   ├── upload.js            # File upload handling
│   ├── validate.js          # Input validation (Joi)
│   └── errorHandler.js      # Error handling
├── models/
│   └── User.js              # User model
├── routes/
│   ├── index.js             # Route aggregator
│   ├── auth.routes.js       # Auth endpoints
│   ├── trading.routes.js    # Trading endpoints
│   └── ...
├── services/
│   ├── email.service.js     # SendGrid email service
│   ├── marketData.service.js # Market data API
│   └── twoFactor.service.js # 2FA service
├── websocket/
│   └── handler.js           # WebSocket management
├── jobs/
│   └── index.js             # Background jobs (Bull)
├── utils/
│   └── logger.js            # Winston logger
├── uploads/                 # File uploads directory
├── logs/                    # Application logs
├── server.js                # Main entry point
├── package.json
└── .env
```

## 🔌 API Endpoints

### Authentication
```
POST   /api/v1/auth/register          Register new user
POST   /api/v1/auth/login             Login user
POST   /api/v1/auth/refresh           Refresh access token
POST   /api/v1/auth/logout            Logout user
POST   /api/v1/auth/forgot-password   Request password reset
POST   /api/v1/auth/reset-password    Reset password
POST   /api/v1/auth/verify-email      Verify email
```

### User Management
```
GET    /api/v1/users/me               Get current user profile
PUT    /api/v1/users/me               Update profile
PUT    /api/v1/users/me/password      Change password
POST   /api/v1/users/2fa/setup        Setup 2FA
POST   /api/v1/users/2fa/enable       Enable 2FA
POST   /api/v1/users/2fa/disable      Disable 2FA
POST   /api/v1/users/2fa/verify       Verify 2FA code
```

### KYC
```
POST   /api/v1/kyc/upload             Upload KYC documents
GET    /api/v1/kyc/status             Get KYC status
POST   /api/v1/kyc/submit             Submit for review
```

### Accounts
```
GET    /api/v1/accounts               List accounts
POST   /api/v1/accounts               Create account
GET    /api/v1/accounts/:id           Get account details
GET    /api/v1/accounts/:id/balance   Get balance
GET    /api/v1/accounts/:id/positions Get positions
GET    /api/v1/accounts/:id/activity  Get activity
```

### Trading
```
POST   /api/v1/trading/orders         Place order
GET    /api/v1/trading/orders         Get orders
GET    /api/v1/trading/orders/:id     Get order details
PUT    /api/v1/trading/orders/:id     Modify order
DELETE /api/v1/trading/orders/:id     Cancel order
GET    /api/v1/trading/positions      Get positions
```

### Market Data
```
GET    /api/v1/market/securities/:symbol          Get security info
GET    /api/v1/market/securities/:symbol/quote    Get real-time quote
GET    /api/v1/market/securities/:symbol/chart    Get chart data
GET    /api/v1/market/securities/search           Search securities
GET    /api/v1/market/status                      Market status
```

### Funding
```
POST   /api/v1/funding/deposits       Initiate deposit
POST   /api/v1/funding/withdrawals    Request withdrawal
POST   /api/v1/funding/transfers      Internal transfer
GET    /api/v1/funding/transactions   Get transactions
GET    /api/v1/funding/bank-accounts  Get linked banks
POST   /api/v1/funding/bank-accounts  Link bank account
```

### Watchlists
```
GET    /api/v1/watchlists             Get watchlists
POST   /api/v1/watchlists             Create watchlist
POST   /api/v1/watchlists/:id/items   Add to watchlist
DELETE /api/v1/watchlists/:id/items/:symbol Remove from watchlist
```

### Alerts
```
GET    /api/v1/alerts                 Get price alerts
POST   /api/v1/alerts                 Create alert
DELETE /api/v1/alerts/:id             Delete alert
```

### Reports
```
GET    /api/v1/reports/statements     Get statements
GET    /api/v1/reports/confirmations  Get trade confirmations
GET    /api/v1/reports/tax-documents  Get tax documents
```

## 🔐 Authentication

The API uses JWT (JSON Web Tokens) for authentication:

1. **Access Token**: Short-lived (15 minutes), used for API requests
2. **Refresh Token**: Long-lived (7 days), used to get new access tokens

### Example Authentication Flow

```javascript
// 1. Register/Login
POST /api/v1/auth/login
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}

// Response
{
  "success": true,
  "data": {
    "user": { ... },
    "tokens": {
      "accessToken": "eyJhbGc...",
      "refreshToken": "eyJhbGc...",
      "expiresIn": "15m"
    }
  }
}

// 2. Use Access Token
GET /api/v1/accounts
Headers: {
  "Authorization": "Bearer eyJhbGc..."
}

// 3. Refresh Token
POST /api/v1/auth/refresh
{
  "refreshToken": "eyJhbGc..."
}
```

## 🌐 WebSocket Connection

Connect to real-time updates:

```javascript
const socket = io('http://localhost:3000', {
  auth: {
    token: 'your-access-token'
  }
});

// Subscribe to quotes
socket.emit('subscribe_quotes', ['AAPL', 'GOOGL', 'MSFT']);

// Listen for updates
socket.on('quote_update', (quote) => {
  console.log('New quote:', quote);
});

// Subscribe to order updates
socket.emit('subscribe_orders');

socket.on('order_update', (order) => {
  console.log('Order update:', order);
});
```

## 📊 Background Jobs

The system runs several background jobs:

- **Portfolio Valuations**: Daily at 4:30 PM ET (after market close)
- **Price Alerts**: Every 5 minutes
- **Session Cleanup**: Every hour
- **Monthly Statements**: 1st of each month
- **Data Cleanup**: Daily at 2 AM

## 🧪 Testing

Run tests:
```bash
npm test
```

Run tests with coverage:
```bash
npm run test:coverage
```

Watch mode:
```bash
npm run test:watch
```

## 📝 Logging

Logs are written to:
- `logs/application-YYYY-MM-DD.log` - All logs
- `logs/error-YYYY-MM-DD.log` - Errors only
- `logs/debug-YYYY-MM-DD.log` - Debug logs (development only)

Log levels: `error`, `warn`, `info`, `debug`

## 🔒 Security Features

- **Helmet**: Security headers
- **CORS**: Cross-origin resource sharing
- **Rate Limiting**: API abuse prevention
- **Input Validation**: Joi schemas
- **SQL Injection Protection**: Parameterized queries
- **XSS Protection**: Input sanitization
- **2FA**: Two-factor authentication
- **Password Hashing**: bcrypt (12 rounds)
- **JWT**: Secure token-based auth
- **File Upload Validation**: File type and size limits

## 🚀 Deployment

### Environment Setup
1. Set `NODE_ENV=production`
2. Use strong, random secrets for JWT
3. Configure proper CORS origins
4. Set up SSL/TLS certificates
5. Configure firewall rules
6. Set up monitoring (Sentry, New Relic)

### Production Checklist
- [ ] All environment variables configured
- [ ] Database migrations run
- [ ] Redis server running
- [ ] SSL certificates installed
- [ ] Rate limits configured
- [ ] Logging configured
- [ ] Backup strategy implemented
- [ ] Monitoring tools set up
- [ ] Load balancer configured (if applicable)

## 📚 API Documentation

Full API documentation available at:
```
http://localhost:3000/api/v1
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Write/update tests
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🆘 Support

For issues and questions:
- Email: support@aluma.com
- Documentation: [docs.aluma.com]
- GitHub Issues: [github.com/aluma/backend/issues]

## 🔄 Changelog

### Version 1.0.0 (Current)
- Initial release
- Complete authentication system
- Trading functionality
- Real-time market data
- WebSocket support
- Background jobs
- Email notifications
- 2FA support
- KYC document upload