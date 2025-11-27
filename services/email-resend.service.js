const { Resend } = require('resend');
const logger = require('../utils/logger');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.FROM_EMAIL || 'onboarding@resend.dev';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3001';

const sendEmail = async ({ to, subject, html }) => {
  try {
    const data = await resend.emails.send({
      from: `Aluma Banking <${FROM_EMAIL}>`,
      to: [to],
      subject,
      html
    });
    
    logger.info(`✅ Email sent to: ${to}, Subject: ${subject}, ID: ${data.id}`);
    return { success: true, id: data.id };
  } catch (error) {
    logger.error(`❌ Failed to send email to ${to}:`, error);
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
        .header { background: #1a73e8; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { padding: 30px; background: #f9f9f9; }
        .ticket-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #1a73e8; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .ticket-number { font-size: 24px; font-weight: bold; color: #1a73e8; margin: 10px 0; }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; background: #f0f0f0; border-radius: 0 0 8px 8px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🎫 Support Ticket Created</h1>
        </div>
        <div class="content">
          <h2>Hi ${name},</h2>
          <p>Thank you for contacting Aluma Banking support. We've received your request and our team will review it shortly.</p>
          
          <div class="ticket-box">
            <p style="margin: 0; color: #666;">Your Ticket Number:</p>
            <p class="ticket-number">${ticketNumber}</p>
            <p style="margin: 10px 0 0 0;"><strong>Subject:</strong> ${subject}</p>
          </div>
          
          <p>Please save this ticket number for your reference. You can use it to track the status of your request.</p>
          
          <p><strong>What happens next?</strong></p>
          <ul>
            <li>Our support team will review your ticket within 24 hours</li>
            <li>You'll receive email updates when we respond</li>
            <li>You can reply to add more information anytime</li>
          </ul>
          
          <p>We typically respond to tickets within 1-2 business days, depending on complexity.</p>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} Aluma Banking. All rights reserved.</p>
          <p style="margin-top: 10px;">This is an automated email. Please do not reply directly to this email.</p>
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

const sendSupportReplyNotification = async (email, ticketData) => {
  const { ticketNumber, subject, message, name } = ticketData;
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #10b981; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { padding: 30px; background: #f9f9f9; }
        .message-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #10b981; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; background: #f0f0f0; border-radius: 0 0 8px 8px; }
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
          
          <p style="margin: 20px 0 10px 0;"><strong>Subject:</strong> ${subject}</p>
          
          <div class="message-box">
            <p style="margin: 0 0 10px 0; color: #666; font-weight: bold;">Support Team:</p>
            <p style="margin: 0;">${message}</p>
          </div>
          
          <p>If you have any additional questions or information to add, please reply to this ticket from your dashboard.</p>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} Aluma Banking. All rights reserved.</p>
          <p style="margin-top: 5px;">Ticket #${ticketNumber}</p>
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

const sendAccountApprovalEmail = async (email, userData) => {
  const { firstName } = userData;
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #10b981; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { padding: 30px; background: #f9f9f9; }
        .success-box { background: #d1fae5; border-left: 4px solid #10b981; padding: 20px; margin: 20px 0; border-radius: 8px; }
        .button { display: inline-block; padding: 12px 30px; background: #1a73e8; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; background: #f0f0f0; border-radius: 0 0 8px 8px; }
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
            <h3 style="margin-top: 0;">🎉 Great news!</h3>
            <p style="margin-bottom: 0;">Your Aluma Banking account has been approved and is now active.</p>
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

module.exports = {
  sendEmail,
  sendSupportTicketConfirmation,
  sendSupportReplyNotification,
  sendAccountApprovalEmail
};
