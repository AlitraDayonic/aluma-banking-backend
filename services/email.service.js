// ============================================
// services/email.service.js
// Email Service using SendGrid
// ============================================

const sgMail = require('@sendgrid/mail');
const logger = require('../utils/logger');

// Initialize SendGrid
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@aluma.com';
const FROM_NAME = process.env.FROM_NAME || 'Aluma Banking';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3001';

/**
 * Send email via SendGrid
 */
const sendEmail = async ({ to, subject, html, text }) => {
  try {
    const msg = {
      to,
      from: {
        email: FROM_EMAIL,
        name: FROM_NAME
      },
      subject,
      text: text || stripHtml(html),
      html
    };

    await sgMail.send(msg);
    logger.info(`Email sent to: ${to}, Subject: ${subject}`);
    return { success: true };

  } catch (error) {
    logger.error(`Failed to send email to ${to}:`, error);
    
    if (error.response) {
      logger.error('SendGrid error details:', error.response.body);
    }
    
    throw error;
  }
};

/**
 * Send verification email
 */
const sendVerificationEmail = async (email, token) => {
  const verificationUrl = `${FRONTEND_URL}/verify-email?token=${token}`;
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #1a73e8; color: white; padding: 20px; text-align: center; }
        .content { padding: 30px; background: #f9f9f9; }
        .button { 
          display: inline-block; 
          padding: 12px 30px; 
          background: #1a73e8; 
          color: white; 
          text-decoration: none; 
          border-radius: 5px;
          margin: 20px 0;
        }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Welcome to Aluma Banking</h1>
        </div>
        <div class="content">
          <h2>Verify Your Email Address</h2>
          <p>Thank you for registering with Aluma Banking. To complete your registration, please verify your email address by clicking the button below:</p>
          <center>
            <a href="${verificationUrl}" class="button">Verify Email Address</a>
          </center>
          <p>Or copy and paste this link into your browser:</p>
          <p style="word-break: break-all; color: #1a73e8;">${verificationUrl}</p>
          <p><strong>This link will expire in 24 hours.</strong></p>
          <p>If you didn't create an account with Aluma Banking, you can safely ignore this email.</p>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} Aluma Banking. All rights reserved.</p>
          <p>This is an automated email. Please do not reply.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: email,
    subject: 'Verify Your Aluma Banking Account',
    html
  });
};

/**
 * Send password reset email
 */
const sendPasswordResetEmail = async (email, token) => {
  const resetUrl = `${FRONTEND_URL}/reset-password?token=${token}`;
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #1a73e8; color: white; padding: 20px; text-align: center; }
        .content { padding: 30px; background: #f9f9f9; }
        .button { 
          display: inline-block; 
          padding: 12px 30px; 
          background: #1a73e8; 
          color: white; 
          text-decoration: none; 
          border-radius: 5px;
          margin: 20px 0;
        }
        .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Password Reset Request</h1>
        </div>
        <div class="content">
          <h2>Reset Your Password</h2>
          <p>We received a request to reset your Aluma Banking account password. Click the button below to create a new password:</p>
          <center>
            <a href="${resetUrl}" class="button">Reset Password</a>
          </center>
          <p>Or copy and paste this link into your browser:</p>
          <p style="word-break: break-all; color: #1a73e8;">${resetUrl}</p>
          <div class="warning">
            <strong>⚠️ Security Notice:</strong>
            <p>This link will expire in 1 hour. If you didn't request a password reset, please ignore this email and your password will remain unchanged.</p>
          </div>
          <p>For security reasons, we recommend:</p>
          <ul>
            <li>Using a strong, unique password</li>
            <li>Enabling two-factor authentication</li>
            <li>Never sharing your password with anyone</li>
          </ul>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} Aluma Banking. All rights reserved.</p>
          <p>This is an automated email. Please do not reply.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: email,
    subject: 'Reset Your Aluma Banking Password',
    html
  });
};


/**
 * Send support ticket confirmation email
 */
const sendSupportTicketConfirmation = async (email, ticketData) => {
  const { ticketNumber, subject, name } = ticketData;
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #1a73e8; color: white; padding: 20px; text-align: center; }
        .content { padding: 30px; background: #f9f9f9; }
        .ticket-box { background: white; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #1a73e8; }
        .ticket-number { font-size: 24px; font-weight: bold; color: #1a73e8; }
        .button { 
          display: inline-block; 
          padding: 12px 30px; 
          background: #1a73e8; 
          color: white; 
          text-decoration: none; 
          border-radius: 5px;
          margin: 20px 0;
        }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Support Ticket Created</h1>
        </div>
        <div class="content">
          <h2>Hi ${name},</h2>
          <p>Thank you for contacting Aluma Banking support. We've received your request and our team will review it shortly.</p>
          
          <div class="ticket-box">
            <p>Your Ticket Number:</p>
            <p class="ticket-number">${ticketNumber}</p>
            <p><strong>Subject:</strong> ${subject}</p>
          </div>
          
          <p>Please save this ticket number for your reference. You can use it to track the status of your request or add additional information.</p>
          
          <center>
            <a href="${FRONTEND_URL}/support/tickets/${ticketNumber}" class="button">View Ticket</a>
          </center>
          
          <p><strong>What happens next?</strong></p>
          <ul>
            <li>Our support team will review your ticket within 24 hours</li>
            <li>You'll receive email updates when we respond</li>
            <li>You can reply to add more information anytime</li>
          </ul>
          
          <p>We typically respond to tickets within 1-2 business days, depending on complexity and priority.</p>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} Aluma Banking. All rights reserved.</p>
          <p>This is an automated email. Please do not reply.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: email,
    subject: `Support Ticket Created: ${ticketNumber}`,
    html
  });
};

/**
 * Send support reply notification
 */
const sendSupportReplyNotification = async (email, ticketData) => {
  const { ticketNumber, subject, message, name } = ticketData;
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #10b981; color: white; padding: 20px; text-align: center; }
        .content { padding: 30px; background: #f9f9f9; }
        .message-box { background: white; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #10b981; }
        .button { 
          display: inline-block; 
          padding: 12px 30px; 
          background: #1a73e8; 
          color: white; 
          text-decoration: none; 
          border-radius: 5px;
          margin: 20px 0;
        }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>💬 New Response to Your Ticket</h1>
        </div>
        <div class="content">
          <h2>Hi ${name},</h2>
          <p>Our support team has responded to your ticket <strong>${ticketNumber}</strong>.</p>
          
          <p><strong>Subject:</strong> ${subject}</p>
          
          <div class="message-box">
            <p><strong>Support Team:</strong></p>
            <p>${message}</p>
          </div>
          
          <center>
            <a href="${FRONTEND_URL}/support/tickets/${ticketNumber}" class="button">View & Reply</a>
          </center>
          
          <p>If you have any additional questions or information to add, please reply to this ticket.</p>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} Aluma Banking. All rights reserved.</p>
          <p>Ticket #${ticketNumber}</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: email,
    subject: `Response to Ticket ${ticketNumber}`,
    html
  });
};



/**
 * Send trade confirmation email
 */
const sendTradeConfirmation = async (email, orderData) => {
  const { symbol, side, quantity, price, orderType, orderId, executedAt } = orderData;
  const totalValue = (quantity * price).toFixed(2);
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: ${side === 'buy' ? '#10b981' : '#ef4444'}; color: white; padding: 20px; text-align: center; }
        .content { padding: 30px; background: #f9f9f9; }
        .details { background: white; padding: 20px; border-radius: 5px; margin: 20px 0; }
        .detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
        .detail-label { font-weight: bold; }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Trade Confirmation</h1>
          <p>Order ${side.toUpperCase()} - ${symbol}</p>
        </div>
        <div class="content">
          <h2>Your Order Has Been Executed</h2>
          <p>This confirms that your ${side} order has been successfully executed.</p>
          
          <div class="details">
            <div class="detail-row">
              <span class="detail-label">Order ID:</span>
              <span>${orderId}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Symbol:</span>
              <span>${symbol}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Action:</span>
              <span style="color: ${side === 'buy' ? '#10b981' : '#ef4444'}; font-weight: bold;">${side.toUpperCase()}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Quantity:</span>
              <span>${quantity}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Price:</span>
              <span>$${price.toFixed(2)}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Order Type:</span>
              <span>${orderType}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Total Value:</span>
              <span style="font-weight: bold;">$${totalValue}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Executed At:</span>
              <span>${new Date(executedAt).toLocaleString()}</span>
            </div>
          </div>
          
          <p>You can view your complete order history and account details by logging into your Aluma Banking account.</p>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} Aluma Banking. All rights reserved.</p>
          <p>This is an automated email. Please do not reply.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: email,
    subject: `Trade Confirmation: ${side.toUpperCase()} ${quantity} ${symbol}`,
    html
  });
};

/**
 * Send account statement email
 */
const sendStatement = async (email, statement) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #1a73e8; color: white; padding: 20px; text-align: center; }
        .content { padding: 30px; background: #f9f9f9; }
        .button { 
          display: inline-block; 
          padding: 12px 30px; 
          background: #1a73e8; 
          color: white; 
          text-decoration: none; 
          border-radius: 5px;
          margin: 20px 0;
        }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Your Account Statement is Ready</h1>
        </div>
        <div class="content">
          <h2>Statement for ${statement.period}</h2>
          <p>Your account statement is now available for download.</p>
          <center>
            <a href="${FRONTEND_URL}/statements/${statement.id}" class="button">View Statement</a>
          </center>
          <p>You can access all your statements anytime by logging into your account and visiting the Reports section.</p>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} Aluma Banking. All rights reserved.</p>
          <p>This is an automated email. Please do not reply.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: email,
    subject: `Your Aluma Banking Statement - ${statement.period}`,
    html
  });
};

/**
 * Send price alert notification
 */
const sendPriceAlertEmail = async (email, alertData) => {
  const { symbol, targetPrice, currentPrice, condition } = alertData;
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #f59e0b; color: white; padding: 20px; text-align: center; }
        .content { padding: 30px; background: #f9f9f9; }
        .alert-box { background: #fff3cd; border-left: 4px solid #f59e0b; padding: 20px; margin: 20px 0; }
        .price { font-size: 32px; font-weight: bold; color: #1a73e8; }
        .button { 
          display: inline-block; 
          padding: 12px 30px; 
          background: #1a73e8; 
          color: white; 
          text-decoration: none; 
          border-radius: 5px;
          margin: 20px 0;
        }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🔔 Price Alert Triggered</h1>
        </div>
        <div class="content">
          <div class="alert-box">
            <h2>${symbol}</h2>
            <p class="price">$${currentPrice.toFixed(2)}</p>
            <p>Your price alert has been triggered! ${symbol} is now ${condition} your target price of $${targetPrice.toFixed(2)}.</p>
          </div>
          <center>
            <a href="${FRONTEND_URL}/trading/${symbol}" class="button">View ${symbol}</a>
          </center>
          <p><strong>Note:</strong> This alert has been automatically disabled. You can create a new alert anytime from your dashboard.</p>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} Aluma Banking. All rights reserved.</p>
          <p>This is an automated email. Please do not reply.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: email,
    subject: `🔔 Price Alert: ${symbol} is ${condition} $${targetPrice.toFixed(2)}`,
    html
  });
};

/**
 * Send welcome email
 */
const sendWelcomeEmail = async (email, firstName) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #1a73e8; color: white; padding: 20px; text-align: center; }
        .content { padding: 30px; background: #f9f9f9; }
        .button { 
          display: inline-block; 
          padding: 12px 30px; 
          background: #1a73e8; 
          color: white; 
          text-decoration: none; 
          border-radius: 5px;
          margin: 20px 0;
        }
        .features { background: white; padding: 20px; border-radius: 5px; margin: 20px 0; }
        .feature-item { padding: 10px 0; }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Welcome to Aluma Banking! 🎉</h1>
        </div>
        <div class="content">
          <h2>Hi ${firstName},</h2>
          <p>Welcome to Aluma Banking! We're excited to have you join our community of smart investors.</p>
          
          <div class="features">
            <h3>Get Started:</h3>
            <div class="feature-item">✅ Complete your profile and KYC verification</div>
            <div class="feature-item">💰 Fund your account</div>
            <div class="feature-item">📈 Start trading stocks and building your portfolio</div>
            <div class="feature-item">🔔 Set up price alerts</div>
            <div class="feature-item">📊 Track your performance</div>
          </div>
          
          <center>
            <a href="${FRONTEND_URL}/dashboard" class="button">Go to Dashboard</a>
          </center>
          
          <p>If you have any questions, our support team is here to help!</p>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} Aluma Banking. All rights reserved.</p>
          <p>This is an automated email. Please do not reply.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: email,
    subject: 'Welcome to Aluma Banking! 🎉',
    html
  });
};

/**
 * Helper: Strip HTML tags for plain text version
 */
const stripHtml = (html) => {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
};

/**
 * Send account approval email
 */
const sendAccountApprovalEmail = async (email, userData) => {
  const { firstName } = userData;
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #10b981; color: white; padding: 20px; text-align: center; }
        .content { padding: 30px; background: #f9f9f9; }
        .success-box { background: #d1fae5; border-left: 4px solid #10b981; padding: 20px; margin: 20px 0; }
        .button { 
          display: inline-block; 
          padding: 12px 30px; 
          background: #1a73e8; 
          color: white; 
          text-decoration: none; 
          border-radius: 5px;
          margin: 20px 0;
        }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>✅ Account Approved!</h1>
        </div>
        <div class="content">
          <h2>Hi ${firstName},</h2>
          
          <div class="success-box">
            <h3>🎉 Great news!</h3>
            <p>Your Aluma Banking account has been approved and is now active.</p>
          </div>
          
          <p>You can now access all features of your account:</p>
          <ul>
            <li>✅ Fund your account</li>
            <li>✅ Start trading stocks</li>
            <li>✅ Set up price alerts</li>
            <li>✅ View real-time market data</li>
            <li>✅ Track your portfolio performance</li>
          </ul>
          
          <center>
            <a href="${FRONTEND_URL}/dashboard" class="button">Go to Dashboard</a>
          </center>
          
          <p><strong>Next Steps:</strong></p>
          <ol>
            <li>Complete your profile setup</li>
            <li>Add funds to your account</li>
            <li>Explore our platform and start investing</li>
          </ol>
          
          <p>If you have any questions, our support team is here to help!</p>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} Aluma Banking. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: email,
    subject: '🎉 Your Aluma Banking Account is Approved!',
    html
  });
};

// Add these to your module.exports
module.exports = {
  sendEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendTradeConfirmation,
  sendStatement,
  sendPriceAlertEmail,
  sendWelcomeEmail,
  sendSupportTicketConfirmation,
  sendSupportReplyNotification,
  sendAccountApprovalEmail
};
