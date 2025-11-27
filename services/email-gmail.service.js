const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3001';
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_APP_PASSWORD
  }
});

transporter.verify((error, success) => {
  if (error) {
    logger.error('Gmail SMTP connection failed:', error);
  } else {
    logger.info('✅ Gmail SMTP ready to send emails');
  }
});

const sendEmail = async ({ to, subject, html, text }) => {
  try {
    const mailOptions = {
      from: `"Aluma Banking" <${GMAIL_USER}>`,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, '')
    };
    await transporter.sendMail(mailOptions);
    logger.info(`Email sent to: ${to}, Subject: ${subject}`);
    return { success: true };
  } catch (error) {
    logger.error(`Failed to send email to ${to}:`, error);
    throw error;
  }
};

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
          <p>Thank you for contacting Aluma Banking support. We've received your request.</p>
          <div class="ticket-box">
            <p>Your Ticket Number:</p>
            <p class="ticket-number">${ticketNumber}</p>
            <p><strong>Subject:</strong> ${subject}</p>
          </div>
          <p>Our team will respond within 24 hours.</p>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} Aluma Banking. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;
  return sendEmail({ to: email, subject: `Support Ticket Created: ${ticketNumber}`, html });
};

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
        .message-box { background: white; padding: 20px; border-radius: 5px; margin: 20px 0; }
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
          <p>Our support team responded to ticket <strong>${ticketNumber}</strong>.</p>
          <div class="message-box">
            <p><strong>Support Team:</strong></p>
            <p>${message}</p>
          </div>
        </div>
        <div class="footer">
          <p>Ticket #${ticketNumber}</p>
        </div>
      </div>
    </body>
    </html>
  `;
  return sendEmail({ to: email, subject: `Response to Ticket ${ticketNumber}`, html });
};

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
          <p>You can now:</p>
          <ul>
            <li>✅ Fund your account</li>
            <li>✅ Start trading stocks</li>
            <li>✅ Track your portfolio</li>
          </ul>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} Aluma Banking.</p>
        </div>
      </div>
    </body>
    </html>
  `;
  return sendEmail({ to: email, subject: '🎉 Your Aluma Banking Account is Approved!', html });
};

module.exports = {
  sendEmail,
  sendSupportTicketConfirmation,
  sendSupportReplyNotification,
  sendAccountApprovalEmail
};
