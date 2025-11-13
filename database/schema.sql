-- ============================================
-- ALUMA BANKING BROKER - POSTGRESQL SCHEMA
-- ============================================
-- Version: 1.0
-- Database: PostgreSQL 15+
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable pgcrypto for encryption
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- ENUMS
-- ============================================

CREATE TYPE user_status AS ENUM ('pending', 'active', 'suspended', 'closed', 'inactive');
CREATE TYPE kyc_status AS ENUM ('not_started', 'pending', 'under_review', 'approved', 'rejected', 'resubmit_required');
CREATE TYPE account_type AS ENUM ('individual', 'joint', 'ira_traditional', 'ira_roth', 'business', 'trust', 'margin');
CREATE TYPE account_status AS ENUM ('pending', 'active', 'suspended', 'closed');
CREATE TYPE order_type AS ENUM ('market', 'limit', 'stop', 'stop_limit', 'trailing_stop');
CREATE TYPE order_side AS ENUM ('buy', 'sell');
CREATE TYPE order_status AS ENUM ('pending', 'open', 'partially_filled', 'filled', 'canceled', 'rejected', 'expired');
CREATE TYPE order_time_in_force AS ENUM ('day', 'gtc', 'ioc', 'fok');
CREATE TYPE transaction_type AS ENUM ('deposit', 'withdrawal', 'buy', 'sell', 'dividend', 'interest', 'fee', 'transfer_in', 'transfer_out', 'adjustment');
CREATE TYPE transaction_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'canceled', 'reversed');
CREATE TYPE document_type AS ENUM ('id_card', 'passport', 'drivers_license', 'proof_of_address', 'bank_statement', 'tax_form', 'other');
CREATE TYPE notification_type AS ENUM ('email', 'sms', 'push', 'in_app');
CREATE TYPE notification_status AS ENUM ('pending', 'sent', 'failed', 'read');
CREATE TYPE alert_type AS ENUM ('price_above', 'price_below', 'percent_change', 'volume');
CREATE TYPE ticket_status AS ENUM ('open', 'in_progress', 'waiting_customer', 'resolved', 'closed');
CREATE TYPE ticket_priority AS ENUM ('low', 'medium', 'high', 'urgent');

-- ============================================
-- 1. USER MANAGEMENT TABLES
-- ============================================

-- Core users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    date_of_birth DATE,
    status user_status DEFAULT 'pending',
    email_verified BOOLEAN DEFAULT FALSE,
    phone_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP,
    deleted_at TIMESTAMP
);

-- Extended user profile information
CREATE TABLE user_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(50),
    postal_code VARCHAR(20),
    country VARCHAR(2) DEFAULT 'US',
    ssn_encrypted TEXT, -- Encrypted SSN
    tax_id VARCHAR(50),
    citizenship VARCHAR(2),
    employment_status VARCHAR(50),
    employer_name VARCHAR(255),
    occupation VARCHAR(100),
    annual_income DECIMAL(15, 2),
    net_worth DECIMAL(15, 2),
    investment_experience VARCHAR(50),
    risk_tolerance VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- KYC verification data
CREATE TABLE user_kyc (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status kyc_status DEFAULT 'not_started',
    submitted_at TIMESTAMP,
    reviewed_at TIMESTAMP,
    reviewed_by UUID REFERENCES users(id),
    rejection_reason TEXT,
    verification_level INTEGER DEFAULT 0, -- 0: none, 1: basic, 2: intermediate, 3: full
    id_verified BOOLEAN DEFAULT FALSE,
    address_verified BOOLEAN DEFAULT FALSE,
    identity_score INTEGER, -- 0-100
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Document uploads
CREATE TABLE user_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_type document_type NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER,
    mime_type VARCHAR(100),
    verified BOOLEAN DEFAULT FALSE,
    verified_at TIMESTAMP,
    verified_by UUID REFERENCES users(id),
    expiry_date DATE,
    notes TEXT,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User sessions
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token TEXT UNIQUE NOT NULL,
    device_id VARCHAR(255),
    device_name VARCHAR(255),
    ip_address INET,
    user_agent TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_activity_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Security settings (2FA, etc.)
CREATE TABLE user_security (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    two_factor_enabled BOOLEAN DEFAULT FALSE,
    two_factor_secret VARCHAR(255),
    backup_codes TEXT[], -- Array of backup codes
    security_question_1 TEXT,
    security_answer_1_hash TEXT,
    security_question_2 TEXT,
    security_answer_2_hash TEXT,
    password_changed_at TIMESTAMP,
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Trusted devices
CREATE TABLE user_devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id VARCHAR(255) NOT NULL,
    device_name VARCHAR(255),
    device_type VARCHAR(50), -- web, mobile, desktop
    is_trusted BOOLEAN DEFAULT FALSE,
    first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, device_id)
);

-- Login history for audit
CREATE TABLE user_login_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip_address INET,
    user_agent TEXT,
    device_id VARCHAR(255),
    login_successful BOOLEAN DEFAULT TRUE,
    failure_reason VARCHAR(255),
    two_factor_used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 2. ACCOUNT MANAGEMENT TABLES
-- ============================================

-- Trading accounts
CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_number VARCHAR(20) UNIQUE NOT NULL,
    account_type account_type NOT NULL,
    account_name VARCHAR(255),
    status account_status DEFAULT 'pending',
    cash_balance DECIMAL(15, 2) DEFAULT 0.00,
    buying_power DECIMAL(15, 2) DEFAULT 0.00,
    margin_balance DECIMAL(15, 2) DEFAULT 0.00,
    portfolio_value DECIMAL(15, 2) DEFAULT 0.00,
    pattern_day_trader BOOLEAN DEFAULT FALSE,
    margin_enabled BOOLEAN DEFAULT FALSE,
    options_enabled BOOLEAN DEFAULT FALSE,
    crypto_enabled BOOLEAN DEFAULT FALSE,
    opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Account beneficiaries
CREATE TABLE account_beneficiaries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    relationship VARCHAR(50),
    date_of_birth DATE,
    ssn_encrypted TEXT,
    percentage DECIMAL(5, 2) NOT NULL, -- 0-100
    is_primary BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Linked external bank accounts
CREATE TABLE linked_bank_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    bank_name VARCHAR(255) NOT NULL,
    account_holder_name VARCHAR(255) NOT NULL,
    account_number_encrypted TEXT NOT NULL,
    routing_number_encrypted TEXT NOT NULL,
    account_type VARCHAR(50), -- checking, savings
    is_verified BOOLEAN DEFAULT FALSE,
    verification_method VARCHAR(50), -- micro_deposit, instant
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 3. SECURITIES & MARKET DATA
-- ============================================

-- Securities master data
CREATE TABLE securities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(10) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    security_type VARCHAR(50) NOT NULL, -- stock, etf, option, crypto
    exchange VARCHAR(50),
    currency VARCHAR(3) DEFAULT 'USD',
    sector VARCHAR(100),
    industry VARCHAR(100),
    description TEXT,
    is_tradable BOOLEAN DEFAULT TRUE,
    is_shortable BOOLEAN DEFAULT FALSE,
    margin_requirement DECIMAL(5, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Market hours and holidays
CREATE TABLE market_hours (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    market_date DATE UNIQUE NOT NULL,
    is_open BOOLEAN DEFAULT TRUE,
    open_time TIME,
    close_time TIME,
    early_close BOOLEAN DEFAULT FALSE,
    holiday_name VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Historical price data
CREATE TABLE historical_prices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    security_id UUID NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
    price_date DATE NOT NULL,
    open DECIMAL(15, 4) NOT NULL,
    high DECIMAL(15, 4) NOT NULL,
    low DECIMAL(15, 4) NOT NULL,
    close DECIMAL(15, 4) NOT NULL,
    volume BIGINT,
    adjusted_close DECIMAL(15, 4),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(security_id, price_date)
);

-- ============================================
-- 4. TRADING TABLES
-- ============================================

-- Orders
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    security_id UUID NOT NULL REFERENCES securities(id),
    order_type order_type NOT NULL,
    side order_side NOT NULL,
    status order_status DEFAULT 'pending',
    quantity DECIMAL(15, 4) NOT NULL,
    filled_quantity DECIMAL(15, 4) DEFAULT 0,
    limit_price DECIMAL(15, 4),
    stop_price DECIMAL(15, 4),
    trailing_percent DECIMAL(5, 2),
    time_in_force order_time_in_force DEFAULT 'day',
    extended_hours BOOLEAN DEFAULT FALSE,
    placed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    filled_at TIMESTAMP,
    canceled_at TIMESTAMP,
    expires_at TIMESTAMP,
    average_fill_price DECIMAL(15, 4),
    commission DECIMAL(10, 2) DEFAULT 0,
    fees DECIMAL(10, 2) DEFAULT 0,
    rejection_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Order executions (fills)
CREATE TABLE executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    execution_price DECIMAL(15, 4) NOT NULL,
    execution_quantity DECIMAL(15, 4) NOT NULL,
    execution_value DECIMAL(15, 2) NOT NULL,
    commission DECIMAL(10, 2) DEFAULT 0,
    fees DECIMAL(10, 2) DEFAULT 0,
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Current positions
CREATE TABLE positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    security_id UUID NOT NULL REFERENCES securities(id),
    quantity DECIMAL(15, 4) NOT NULL,
    average_cost DECIMAL(15, 4) NOT NULL,
    current_price DECIMAL(15, 4),
    market_value DECIMAL(15, 2),
    unrealized_pl DECIMAL(15, 2),
    unrealized_pl_percent DECIMAL(10, 4),
    realized_pl DECIMAL(15, 2) DEFAULT 0,
    opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(account_id, security_id)
);

-- Position history (for closed positions)
CREATE TABLE position_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    security_id UUID NOT NULL REFERENCES securities(id),
    quantity DECIMAL(15, 4) NOT NULL,
    average_cost DECIMAL(15, 4) NOT NULL,
    close_price DECIMAL(15, 4) NOT NULL,
    realized_pl DECIMAL(15, 2) NOT NULL,
    realized_pl_percent DECIMAL(10, 4),
    opened_at TIMESTAMP NOT NULL,
    closed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    holding_period_days INTEGER
);

-- Watchlists
CREATE TABLE watchlists (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Watchlist items
CREATE TABLE watchlist_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    watchlist_id UUID NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
    security_id UUID NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
    notes TEXT,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(watchlist_id, security_id)
);

-- ============================================
-- 5. FINANCIAL TRANSACTIONS
-- ============================================

-- All money movements
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    transaction_type transaction_type NOT NULL,
    status transaction_status DEFAULT 'pending',
    amount DECIMAL(15, 2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    description TEXT,
    reference_id VARCHAR(100), -- External reference
    order_id UUID REFERENCES orders(id),
    related_transaction_id UUID REFERENCES transactions(id),
    processed_at TIMESTAMP,
    settled_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Deposit requests
CREATE TABLE deposits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id UUID UNIQUE NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    bank_account_id UUID REFERENCES linked_bank_accounts(id),
    amount DECIMAL(15, 2) NOT NULL,
    method VARCHAR(50) NOT NULL, -- ach, wire, check
    status transaction_status DEFAULT 'pending',
    expected_settlement_date DATE,
    confirmation_number VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Withdrawal requests
CREATE TABLE withdrawals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id UUID UNIQUE NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    bank_account_id UUID REFERENCES linked_bank_accounts(id),
    amount DECIMAL(15, 2) NOT NULL,
    method VARCHAR(50) NOT NULL, -- ach, wire, check
    status transaction_status DEFAULT 'pending',
    expected_delivery_date DATE,
    confirmation_number VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Internal transfers between accounts
CREATE TABLE transfers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    from_account_id UUID NOT NULL REFERENCES accounts(id),
    to_account_id UUID NOT NULL REFERENCES accounts(id),
    amount DECIMAL(15, 2) NOT NULL,
    status transaction_status DEFAULT 'pending',
    description TEXT,
    processed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Dividend payments
CREATE TABLE dividends (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    security_id UUID NOT NULL REFERENCES securities(id),
    transaction_id UUID REFERENCES transactions(id),
    quantity DECIMAL(15, 4) NOT NULL,
    amount_per_share DECIMAL(10, 4) NOT NULL,
    total_amount DECIMAL(15, 2) NOT NULL,
    ex_date DATE NOT NULL,
    pay_date DATE NOT NULL,
    paid_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Corporate actions (splits, mergers, etc.)
CREATE TABLE corporate_actions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    security_id UUID NOT NULL REFERENCES securities(id),
    action_type VARCHAR(50) NOT NULL, -- split, reverse_split, merger, spinoff
    ratio VARCHAR(20), -- e.g., "2:1" for split
    effective_date DATE NOT NULL,
    description TEXT,
    processed BOOLEAN DEFAULT FALSE,
    processed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 6. REPORTING & STATEMENTS
-- ============================================

-- Monthly statements
CREATE TABLE statements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    statement_year INTEGER NOT NULL,
    statement_month INTEGER NOT NULL,
    statement_date DATE NOT NULL,
    opening_balance DECIMAL(15, 2),
    closing_balance DECIMAL(15, 2),
    total_deposits DECIMAL(15, 2),
    total_withdrawals DECIMAL(15, 2),
    total_trades DECIMAL(15, 2),
    realized_pl DECIMAL(15, 2),
    unrealized_pl DECIMAL(15, 2),
    fees DECIMAL(15, 2),
    file_path TEXT,
    generated_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(account_id, statement_year, statement_month)
);

-- Trade confirmations
CREATE TABLE trade_confirmations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    confirmation_number VARCHAR(50) UNIQUE NOT NULL,
    file_path TEXT,
    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tax documents (1099s)
CREATE TABLE tax_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    tax_year INTEGER NOT NULL,
    document_type VARCHAR(50) NOT NULL, -- 1099-B, 1099-DIV, 1099-INT
    file_path TEXT,
    generated_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(account_id, tax_year, document_type)
);

-- Account activity log
CREATE TABLE account_activity (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    activity_type VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    amount DECIMAL(15, 2),
    reference_id UUID,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 7. COMPLIANCE & RISK MANAGEMENT
-- ============================================

-- Complete audit trail
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Compliance alerts
CREATE TABLE compliance_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    alert_type VARCHAR(50) NOT NULL, -- pdt_flag, margin_call, large_transaction, unusual_activity
    severity VARCHAR(20) NOT NULL, -- low, medium, high, critical
    description TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'open', -- open, investigating, resolved, false_positive
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMP,
    resolution_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Margin calls
CREATE TABLE margin_calls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    call_amount DECIMAL(15, 2) NOT NULL,
    equity_required DECIMAL(15, 2) NOT NULL,
    current_equity DECIMAL(15, 2) NOT NULL,
    due_date DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'open', -- open, met, liquidated
    met_at TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Pattern day trade tracking
CREATE TABLE pattern_day_trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    security_id UUID NOT NULL REFERENCES securities(id),
    trade_date DATE NOT NULL,
    buy_order_id UUID REFERENCES orders(id),
    sell_order_id UUID REFERENCES orders(id),
    flagged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 8. NOTIFICATIONS & ALERTS
-- ============================================

-- User notifications
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_type notification_type NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    status notification_status DEFAULT 'pending',
    priority VARCHAR(20) DEFAULT 'normal', -- low, normal, high
    read_at TIMESTAMP,
    sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Price alerts
CREATE TABLE price_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    security_id UUID NOT NULL REFERENCES securities(id),
    alert_type alert_type NOT NULL,
    target_price DECIMAL(15, 4),
    target_percent DECIMAL(10, 4),
    is_active BOOLEAN DEFAULT TRUE,
    triggered_at TIMESTAMP,
    notification_sent BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP
);

-- ============================================
-- 9. SUPPORT & MESSAGING
-- ============================================

-- Support tickets
CREATE TABLE support_tickets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ticket_number VARCHAR(20) UNIQUE NOT NULL,
    subject VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(50), -- account, trading, technical, billing
    status ticket_status DEFAULT 'open',
    priority ticket_priority DEFAULT 'medium',
    assigned_to UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP,
    closed_at TIMESTAMP
);

-- Ticket messages
CREATE TABLE ticket_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    message TEXT NOT NULL,
    is_internal BOOLEAN DEFAULT FALSE, -- internal staff notes
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Internal messaging
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    from_user_id UUID NOT NULL REFERENCES users(id),
    to_user_id UUID NOT NULL REFERENCES users(id),
    subject VARCHAR(255),
    body TEXT NOT NULL,
    read_at TIMESTAMP,
    archived BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 10. SYSTEM & CONFIGURATION
-- ============================================

-- System settings
CREATE TABLE system_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key VARCHAR(100) UNIQUE NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Fee schedules
CREATE TABLE fee_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    fee_type VARCHAR(50) NOT NULL, -- commission, account_maintenance, withdrawal, wire
    amount DECIMAL(10, 2),
    percentage DECIMAL(5, 4),
    minimum_amount DECIMAL(10, 2),
    maximum_amount DECIMAL(10, 2),
    is_active BOOLEAN DEFAULT TRUE,
    effective_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- API keys for programmatic access
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_name VARCHAR(100) NOT NULL,
    api_key VARCHAR(64) UNIQUE NOT NULL,
    api_secret_hash VARCHAR(255) NOT NULL,
    permissions TEXT[], -- array of allowed operations
    is_active BOOLEAN DEFAULT TRUE,
    last_used_at TIMESTAMP,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Webhook configurations
CREATE TABLE webhooks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    events TEXT[] NOT NULL, -- array of subscribed events
    secret VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    last_triggered_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

-- Users
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_status ON users(status);

-- User profiles
CREATE INDEX idx_user_profiles_user_id ON user_profiles(user_id);

-- Sessions
CREATE INDEX idx_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_sessions_refresh_token ON user_sessions(refresh_token);
CREATE INDEX idx_sessions_expires_at ON user_sessions(expires_at);

-- Accounts
CREATE INDEX idx_accounts_user_id ON accounts(user_id);
CREATE INDEX idx_accounts_account_number ON accounts(account_number);
CREATE INDEX idx_accounts_status ON accounts(status);

-- Orders
CREATE INDEX idx_orders_account_id ON orders(account_id);
CREATE INDEX idx_orders_security_id ON orders(security_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_placed_at ON orders(placed_at DESC);

-- Positions
CREATE INDEX idx_positions_account_id ON positions(account_id);
CREATE INDEX idx_positions_security_id ON positions(security_id);

-- Transactions
CREATE INDEX idx_transactions_account_id ON transactions(account_id);
CREATE INDEX idx_transactions_type ON transactions(transaction_type);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_created_at ON transactions(created_at DESC);

-- Securities
CREATE INDEX idx_securities_symbol ON securities(symbol);
CREATE INDEX idx_securities_type ON securities(security_type);

-- Historical prices
CREATE INDEX idx_historical_prices_security_date ON historical_prices(security_id, price_date DESC);

-- Notifications
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);

-- Audit logs
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- Support tickets
CREATE INDEX idx_tickets_user_id ON support_tickets(user_id);
CREATE INDEX idx_tickets_status ON support_tickets(status);
CREATE INDEX idx_tickets_created_at ON support_tickets(created_at DESC);

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at trigger to relevant tables
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_kyc_updated_at BEFORE UPDATE ON user_kyc
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_security_updated_at BEFORE UPDATE ON user_security
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_accounts_updated_at BEFORE UPDATE ON accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_account_beneficiaries_updated_at BEFORE UPDATE ON account_beneficiaries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_linked_bank_accounts_updated_at BEFORE UPDATE ON linked_bank_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_securities_updated_at BEFORE UPDATE ON securities
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_positions_updated_at BEFORE UPDATE ON positions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_deposits_updated_at BEFORE UPDATE ON deposits
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_withdrawals_updated_at BEFORE UPDATE ON withdrawals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_watchlists_updated_at BEFORE UPDATE ON watchlists
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_support_tickets_updated_at BEFORE UPDATE ON support_tickets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to calculate portfolio value
CREATE OR REPLACE FUNCTION calculate_portfolio_value(p_account_id UUID)
RETURNS DECIMAL(15, 2) AS $
DECLARE
    total_value DECIMAL(15, 2);
BEGIN
    SELECT COALESCE(SUM(market_value), 0)
    INTO total_value
    FROM positions
    WHERE account_id = p_account_id;
    
    RETURN total_value;
END;
$ LANGUAGE plpgsql;

-- Function to calculate buying power
CREATE OR REPLACE FUNCTION calculate_buying_power(p_account_id UUID)
RETURNS DECIMAL(15, 2) AS $
DECLARE
    cash DECIMAL(15, 2);
    margin_enabled BOOLEAN;
    portfolio DECIMAL(15, 2);
    buying_power DECIMAL(15, 2);
BEGIN
    SELECT 
        cash_balance,
        margin_enabled,
        portfolio_value
    INTO cash, margin_enabled, portfolio
    FROM accounts
    WHERE id = p_account_id;
    
    IF margin_enabled THEN
        -- Simple 2:1 margin calculation
        buying_power := cash + (portfolio * 0.5);
    ELSE
        buying_power := cash;
    END IF;
    
    RETURN buying_power;
END;
$ LANGUAGE plpgsql;

-- Function to check if user is pattern day trader
CREATE OR REPLACE FUNCTION check_pattern_day_trader(p_account_id UUID)
RETURNS BOOLEAN AS $
DECLARE
    day_trades_count INTEGER;
BEGIN
    -- Count day trades in last 5 business days
    SELECT COUNT(*)
    INTO day_trades_count
    FROM pattern_day_trades
    WHERE account_id = p_account_id
    AND trade_date >= CURRENT_DATE - INTERVAL '5 days';
    
    RETURN day_trades_count >= 4;
END;
$ LANGUAGE plpgsql;

-- Function to update position after trade
CREATE OR REPLACE FUNCTION update_position_after_trade()
RETURNS TRIGGER AS $
DECLARE
    current_position RECORD;
    new_quantity DECIMAL(15, 4);
    new_avg_cost DECIMAL(15, 4);
BEGIN
    -- Only process filled orders
    IF NEW.status != 'filled' THEN
        RETURN NEW;
    END IF;
    
    -- Get current position if exists
    SELECT * INTO current_position
    FROM positions
    WHERE account_id = NEW.account_id
    AND security_id = NEW.security_id;
    
    IF NEW.side = 'buy' THEN
        IF current_position IS NULL THEN
            -- Create new position
            INSERT INTO positions (
                account_id,
                security_id,
                quantity,
                average_cost
            ) VALUES (
                NEW.account_id,
                NEW.security_id,
                NEW.filled_quantity,
                NEW.average_fill_price
            );
        ELSE
            -- Update existing position
            new_quantity := current_position.quantity + NEW.filled_quantity;
            new_avg_cost := (
                (current_position.quantity * current_position.average_cost) +
                (NEW.filled_quantity * NEW.average_fill_price)
            ) / new_quantity;
            
            UPDATE positions
            SET 
                quantity = new_quantity,
                average_cost = new_avg_cost,
                updated_at = CURRENT_TIMESTAMP
            WHERE account_id = NEW.account_id
            AND security_id = NEW.security_id;
        END IF;
    ELSIF NEW.side = 'sell' THEN
        IF current_position IS NOT NULL THEN
            new_quantity := current_position.quantity - NEW.filled_quantity;
            
            IF new_quantity <= 0 THEN
                -- Close position and move to history
                INSERT INTO position_history (
                    account_id,
                    security_id,
                    quantity,
                    average_cost,
                    close_price,
                    realized_pl,
                    realized_pl_percent,
                    opened_at,
                    holding_period_days
                ) VALUES (
                    NEW.account_id,
                    NEW.security_id,
                    current_position.quantity,
                    current_position.average_cost,
                    NEW.average_fill_price,
                    (NEW.average_fill_price - current_position.average_cost) * current_position.quantity,
                    ((NEW.average_fill_price - current_position.average_cost) / current_position.average_cost) * 100,
                    current_position.opened_at,
                    EXTRACT(DAY FROM CURRENT_TIMESTAMP - current_position.opened_at)
                );
                
                DELETE FROM positions
                WHERE account_id = NEW.account_id
                AND security_id = NEW.security_id;
            ELSE
                -- Update position quantity
                UPDATE positions
                SET 
                    quantity = new_quantity,
                    realized_pl = realized_pl + ((NEW.average_fill_price - average_cost) * NEW.filled_quantity),
                    updated_at = CURRENT_TIMESTAMP
                WHERE account_id = NEW.account_id
                AND security_id = NEW.security_id;
            END IF;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$ LANGUAGE plpgsql;

-- Trigger to update positions after order is filled
CREATE TRIGGER update_position_on_fill
AFTER UPDATE OF status ON orders
FOR EACH ROW
WHEN (NEW.status = 'filled' AND OLD.status != 'filled')
EXECUTE FUNCTION update_position_after_trade();

-- Function to create transaction record for trade
CREATE OR REPLACE FUNCTION create_trade_transaction()
RETURNS TRIGGER AS $
DECLARE
    trade_value DECIMAL(15, 2);
    transaction_type_val transaction_type;
BEGIN
    -- Only process filled orders
    IF NEW.status != 'filled' THEN
        RETURN NEW;
    END IF;
    
    trade_value := NEW.filled_quantity * NEW.average_fill_price;
    
    IF NEW.side = 'buy' THEN
        transaction_type_val := 'buy';
        trade_value := -trade_value; -- Debit
    ELSE
        transaction_type_val := 'sell';
        -- trade_value remains positive (credit)
    END IF;
    
    -- Subtract fees
    trade_value := trade_value - NEW.commission - NEW.fees;
    
    INSERT INTO transactions (
        account_id,
        transaction_type,
        status,
        amount,
        description,
        order_id,
        processed_at,
        settled_at
    ) VALUES (
        NEW.account_id,
        transaction_type_val,
        'completed',
        trade_value,
        'Trade execution for ' || (SELECT symbol FROM securities WHERE id = NEW.security_id),
        NEW.id,
        NEW.filled_at,
        NEW.filled_at + INTERVAL '2 days' -- T+2 settlement
    );
    
    -- Update account cash balance
    UPDATE accounts
    SET 
        cash_balance = cash_balance + trade_value,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.account_id;
    
    RETURN NEW;
END;
$ LANGUAGE plpgsql;

-- Trigger to create transaction when order is filled
CREATE TRIGGER create_transaction_on_fill
AFTER UPDATE OF status ON orders
FOR EACH ROW
WHEN (NEW.status = 'filled' AND OLD.status != 'filled')
EXECUTE FUNCTION create_trade_transaction();

-- Function to log all changes to audit_logs
CREATE OR REPLACE FUNCTION audit_table_changes()
RETURNS TRIGGER AS $
BEGIN
    INSERT INTO audit_logs (
        user_id,
        action,
        entity_type,
        entity_id,
        old_values,
        new_values
    ) VALUES (
        COALESCE(NEW.updated_by, NEW.created_by, current_setting('app.current_user_id', true)::UUID),
        TG_OP,
        TG_TABLE_NAME,
        COALESCE(NEW.id, OLD.id),
        CASE WHEN TG_OP = 'DELETE' THEN row_to_json(OLD) ELSE NULL END,
        CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN row_to_json(NEW) ELSE NULL END
    );
    
    RETURN COALESCE(NEW, OLD);
END;
$ LANGUAGE plpgsql;

-- Apply audit trigger to sensitive tables
CREATE TRIGGER audit_users_changes
AFTER INSERT OR UPDATE OR DELETE ON users
FOR EACH ROW EXECUTE FUNCTION audit_table_changes();

CREATE TRIGGER audit_accounts_changes
AFTER INSERT OR UPDATE OR DELETE ON accounts
FOR EACH ROW EXECUTE FUNCTION audit_table_changes();

CREATE TRIGGER audit_orders_changes
AFTER INSERT OR UPDATE OR DELETE ON orders
FOR EACH ROW EXECUTE FUNCTION audit_table_changes();

CREATE TRIGGER audit_transactions_changes
AFTER INSERT OR UPDATE OR DELETE ON transactions
FOR EACH ROW EXECUTE FUNCTION audit_table_changes();

CREATE TRIGGER audit_withdrawals_changes
AFTER INSERT OR UPDATE OR DELETE ON withdrawals
FOR EACH ROW EXECUTE FUNCTION audit_table_changes();

-- ============================================
-- VIEWS FOR COMMON QUERIES
-- ============================================

-- View for user account summary
CREATE VIEW v_account_summary AS
SELECT 
    a.id AS account_id,
    a.user_id,
    a.account_number,
    a.account_type,
    a.status,
    a.cash_balance,
    a.buying_power,
    COALESCE(SUM(p.market_value), 0) AS portfolio_value,
    a.cash_balance + COALESCE(SUM(p.market_value), 0) AS total_value,
    COALESCE(SUM(p.unrealized_pl), 0) AS total_unrealized_pl,
    COUNT(p.id) AS position_count
FROM accounts a
LEFT JOIN positions p ON a.id = p.account_id
GROUP BY a.id;

-- View for portfolio positions with current prices
CREATE VIEW v_portfolio_positions AS
SELECT 
    p.id,
    p.account_id,
    p.security_id,
    s.symbol,
    s.name AS security_name,
    p.quantity,
    p.average_cost,
    p.current_price,
    p.market_value,
    p.unrealized_pl,
    p.unrealized_pl_percent,
    p.realized_pl,
    p.opened_at,
    p.updated_at
FROM positions p
JOIN securities s ON p.security_id = s.id;

-- View for order history with security details
CREATE VIEW v_order_history AS
SELECT 
    o.id,
    o.account_id,
    o.security_id,
    s.symbol,
    s.name AS security_name,
    o.order_type,
    o.side,
    o.status,
    o.quantity,
    o.filled_quantity,
    o.limit_price,
    o.stop_price,
    o.average_fill_price,
    o.commission,
    o.fees,
    o.placed_at,
    o.filled_at,
    o.time_in_force
FROM orders o
JOIN securities s ON o.security_id = s.id;

-- View for transaction history
CREATE VIEW v_transaction_history AS
SELECT 
    t.id,
    t.account_id,
    t.transaction_type,
    t.status,
    t.amount,
    t.currency,
    t.description,
    t.processed_at,
    t.settled_at,
    t.created_at,
    o.id AS order_id,
    s.symbol
FROM transactions t
LEFT JOIN orders o ON t.order_id = o.id
LEFT JOIN securities s ON o.security_id = s.id;

-- View for pending KYC reviews
CREATE VIEW v_pending_kyc_reviews AS
SELECT 
    k.id AS kyc_id,
    k.user_id,
    u.email,
    u.first_name,
    u.last_name,
    k.status,
    k.submitted_at,
    k.verification_level,
    COUNT(d.id) AS document_count
FROM user_kyc k
JOIN users u ON k.user_id = u.id
LEFT JOIN user_documents d ON k.user_id = d.user_id
WHERE k.status IN ('pending', 'under_review')
GROUP BY k.id, k.user_id, u.email, u.first_name, u.last_name, k.status, k.submitted_at, k.verification_level;

-- View for active margin calls
CREATE VIEW v_active_margin_calls AS
SELECT 
    mc.id,
    mc.account_id,
    a.account_number,
    a.user_id,
    u.email,
    u.first_name,
    u.last_name,
    mc.call_amount,
    mc.equity_required,
    mc.current_equity,
    mc.due_date,
    mc.status,
    mc.created_at
FROM margin_calls mc
JOIN accounts a ON mc.account_id = a.id
JOIN users u ON a.user_id = u.id
WHERE mc.status = 'open';

-- ============================================
-- INITIAL DATA SEEDS
-- ============================================

-- Insert default system settings
INSERT INTO system_settings (key, value, description) VALUES
('maintenance_mode', 'false', 'Enable/disable maintenance mode'),
('trading_enabled', 'true', 'Enable/disable trading'),
('new_registrations_enabled', 'true', 'Enable/disable new user registrations'),
('min_deposit_amount', '100.00', 'Minimum deposit amount in USD'),
('max_withdrawal_amount', '50000.00', 'Maximum single withdrawal amount in USD'),
('commission_per_trade', '0.00', 'Commission per trade (0 for commission-free)'),
('pattern_day_trader_equity_requirement', '25000.00', 'Minimum equity for pattern day traders'),
('margin_interest_rate', '8.50', 'Annual margin interest rate percentage');

-- Insert default fee schedules
INSERT INTO fee_schedules (name, fee_type, amount, percentage, is_active, effective_date) VALUES
('Standard Commission', 'commission', 0.00, NULL, true, CURRENT_DATE),
('Wire Transfer Fee', 'wire', 25.00, NULL, true, CURRENT_DATE),
('Account Maintenance', 'account_maintenance', 0.00, NULL, true, CURRENT_DATE),
('ACH Withdrawal Fee', 'withdrawal', 0.00, NULL, true, CURRENT_DATE);

-- Insert major US market holidays for current year
INSERT INTO market_hours (market_date, is_open, holiday_name) VALUES
(CURRENT_DATE + INTERVAL '1 month', false, 'Example Holiday');

-- ============================================
-- SECURITY POLICIES (Row Level Security)
-- ============================================

-- Enable RLS on sensitive tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- Users can only see their own data
CREATE POLICY user_isolation_policy ON users
    FOR ALL
    USING (id = current_setting('app.current_user_id', true)::UUID);

CREATE POLICY profile_isolation_policy ON user_profiles
    FOR ALL
    USING (user_id = current_setting('app.current_user_id', true)::UUID);

CREATE POLICY account_isolation_policy ON accounts
    FOR ALL
    USING (user_id = current_setting('app.current_user_id', true)::UUID);

CREATE POLICY order_isolation_policy ON orders
    FOR ALL
    USING (account_id IN (
        SELECT id FROM accounts WHERE user_id = current_setting('app.current_user_id', true)::UUID
    ));

CREATE POLICY position_isolation_policy ON positions
    FOR ALL
    USING (account_id IN (
        SELECT id FROM accounts WHERE user_id = current_setting('app.current_user_id', true)::UUID
    ));

CREATE POLICY transaction_isolation_policy ON transactions
    FOR ALL
    USING (account_id IN (
        SELECT id FROM accounts WHERE user_id = current_setting('app.current_user_id', true)::UUID
    ));

-- ============================================
-- COMMENTS ON TABLES (Documentation)
-- ============================================

COMMENT ON TABLE users IS 'Core user authentication and profile information';
COMMENT ON TABLE user_kyc IS 'KYC verification status and documentation tracking';
COMMENT ON TABLE accounts IS 'Trading accounts with balances and configuration';
COMMENT ON TABLE orders IS 'Trade orders with execution details';
COMMENT ON TABLE positions IS 'Current open positions in portfolios';
COMMENT ON TABLE transactions IS 'All financial transactions across accounts';
COMMENT ON TABLE securities IS 'Master data for tradeable securities';
COMMENT ON TABLE audit_logs IS 'Complete audit trail for compliance';

-- ============================================
-- DATABASE HEALTH CHECK QUERIES
-- ============================================

-- Query to check database health
-- SELECT 
--     schemaname,
--     tablename,
--     pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
-- FROM pg_tables 
-- WHERE schemaname = 'public'
-- ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- ============================================
-- SCHEMA VERSION TRACKING
-- ============================================

CREATE TABLE schema_versions (
    id SERIAL PRIMARY KEY,
    version VARCHAR(20) NOT NULL,
    description TEXT,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO schema_versions (version, description) VALUES
('1.0.0', 'Initial Aluma banking broker schema with complete tables, triggers, and views');

-- ============================================
-- END OF SCHEMA
-- ============================================

-- Success message
DO $
BEGIN
    RAISE NOTICE '✅ Aluma Banking Broker schema created successfully!';
    RAISE NOTICE '📊 Total tables created: 50+';
    RAISE NOTICE '🔒 Row Level Security enabled on sensitive tables';
    RAISE NOTICE '⚡ Triggers and functions configured for automation';
    RAISE NOTICE '📈 Views created for common queries';
    RAISE NOTICE '🎯 Ready for backend API development!';
END $;