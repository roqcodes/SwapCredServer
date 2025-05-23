const { Resend } = require('resend');
require('dotenv').config();

// Initialize Resend with API key or use a mock if not available
let resend;
if (process.env.RESEND_API_KEY) {
  resend = new Resend(process.env.RESEND_API_KEY);
} else {
  console.warn('WARNING: No Resend API key found. Email sending will be mocked.');
  // Create a mock Resend instance for development
  resend = {
    emails: {
      send: async (options) => {
        console.log('MOCK EMAIL SENT:', options);
        return { id: 'mock_email_id', success: true };
      }
    }
  };
}

/**
 * Send an email using Resend
 * @param {string} to Recipient email address
 * @param {string} subject Email subject
 * @param {string} html Email HTML content
 * @param {string} text Email plain text content (optional)
 * @returns {Promise} Promise resolving to send result
 */
async function sendEmail(to, subject, html, text) {
  try {
    const data = await resend.emails.send({
      from: 'SwapCred <onboarding@resend.dev>',
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, ''), // Strip HTML tags for plain text version
    });
    
    console.log('Email sent successfully:', data);
    return data;
  } catch (error) {
    console.error('Error sending email:', error);
    // Don't throw the error, just log it and return a mock success
    return { id: 'error_but_continuing', success: false, error: error.message };
  }
}

/**
 * Send an email notification when an exchange request is approved
 * @param {string} to Recipient email address
 * @param {object} exchangeData Exchange request data
 * @returns {Promise} Promise resolving to send result
 */
async function sendApprovalEmail(to, exchangeData) {
  const subject = 'Your Exchange Request Has Been Approved';
  
  // Extract warehouse info
  const warehouse = exchangeData.warehouseInfo || {};
  const warehouseAddress = [
    warehouse.addressLine1, 
    warehouse.addressLine2, 
    warehouse.city, 
    warehouse.state, 
    warehouse.postalCode, 
    warehouse.country
  ].filter(Boolean).join(', ');

  // Create email content
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Exchange Request Approved</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #4CAF50; color: white; padding: 15px; text-align: center; border-radius: 5px 5px 0 0; }
        .content { border: 1px solid #ddd; border-top: none; padding: 20px; border-radius: 0 0 5px 5px; }
        .product { margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid #eee; }
        .warehouse { background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
        .next-steps { background-color: #e8f5e9; padding: 15px; border-radius: 5px; }
        .button { display: inline-block; background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; }
        .footer { margin-top: 30px; font-size: 12px; color: #777; text-align: center; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Your Exchange Request is Approved!</h1>
      </div>
      <div class="content">
        <p>Hello,</p>
        <p>Great news! Your exchange request for the following item has been approved:</p>
        
        <div class="product">
          <h3>${exchangeData.productName}</h3>
          <p><strong>Brand:</strong> ${exchangeData.brand}</p>
          <p><strong>Condition:</strong> ${exchangeData.condition}</p>
        </div>
        
        <div class="warehouse">
          <h3>Where to Ship Your Item</h3>
          <p>Please ship your item to the following warehouse address:</p>
          <p><strong>${warehouse.name || 'SwapCred Warehouse'}</strong><br>
          ${warehouseAddress}</p>
          ${warehouse.contactPerson ? `<p><strong>Contact:</strong> ${warehouse.contactPerson}</p>` : ''}
          ${warehouse.contactPhone ? `<p><strong>Phone:</strong> ${warehouse.contactPhone}</p>` : ''}
        </div>
        
        <div class="next-steps">
          <h3>Next Steps</h3>
          <ol>
            <li>Package your item carefully</li>
            <li>Ship it to the warehouse address above</li>
            <li>Update your shipping details in your account</li>
            <li>Once we receive your item, we'll process your credit</li>
          </ol>
        </div>
        
        <p style="margin-top: 30px;">
          <a href="https://swapcred.com/dashboard" class="button">View Exchange Details</a>
        </p>
        
        <p>If you have any questions or need assistance, please don't hesitate to contact our support team.</p>
        
        <p>Thank you for choosing SwapCred!</p>
        
        <div class="footer">
          <p>© 2023 SwapCred. All rights reserved.</p>
          <p>This is an automated email, please do not reply directly to this message.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail(to, subject, html);
}

/**
 * Send an email notification when credit is assigned to a customer
 * @param {string} to Recipient email address
 * @param {object} exchangeData Exchange request data
 * @returns {Promise} Promise resolving to send result
 */
async function sendCreditAssignedEmail(to, exchangeData) {
  const subject = 'Your SwapCred Credit Has Been Approved';
  
  // Create email content
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Credit Assigned</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #3f51b5; color: white; padding: 15px; text-align: center; border-radius: 5px 5px 0 0; }
        .content { border: 1px solid #ddd; border-top: none; padding: 20px; border-radius: 0 0 5px 5px; }
        .credit-info { background-color: #e8eaf6; padding: 25px; border-radius: 5px; text-align: center; margin: 20px 0; }
        .amount { font-size: 36px; font-weight: bold; color: #3f51b5; margin: 10px 0; }
        .currency { font-size: 18px; }
        .product { margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid #eee; }
        .button { display: inline-block; background-color: #3f51b5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; }
        .how-to-use { background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .footer { margin-top: 30px; font-size: 12px; color: #777; text-align: center; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Your Credit Has Been Approved!</h1>
      </div>
      <div class="content">
        <p>Hello,</p>
        <p>Great news! We've processed your exchange request and approved credit for your account.</p>
        
        <div class="credit-info">
          <p>You've received</p>
          <div class="amount">₹${exchangeData.creditAmount}<span class="currency"></span></div>
          <p>in loyalty points</p>
          <p><strong>Total Balance: ₹${exchangeData.totalLoyaltyPoints || exchangeData.creditAmount}</strong></p>
        </div>
        
        <div class="product">
          <h3>Exchanged Item</h3>
          <p><strong>${exchangeData.productName}</strong></p>
          <p><strong>Brand:</strong> ${exchangeData.brand}</p>
          <p><strong>Condition:</strong> ${exchangeData.condition}</p>
        </div>
        
        <div class="how-to-use">
          <h3>How to Use Your Credit</h3>
          <p>Your loyalty points have been automatically added to your account. You can use them on your next purchase on our website.</p>
          <ol>
            <li>Shop for new products on our website</li>
            <li>Add items to cart</li>
            <li>During checkout, your available loyalty points will be displayed</li>
            <li>Apply your points to get a discount on your purchase</li>
          </ol>
        </div>
        
        <p style="margin-top: 30px; text-align: center;">
          <a href="https://swapcred.com/shop" class="button">Shop Now</a>
        </p>
        
        <p>If you have any questions about your credit or how to use it, please contact our support team.</p>
        
        <p>Thank you for choosing SwapCred for your sustainable shopping needs!</p>
        
        <div class="footer">
          <p>© 2023 SwapCred. All rights reserved.</p>
          <p>This is an automated email, please do not reply directly to this message.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail(to, subject, html);
}

module.exports = {
  sendEmail,
  sendApprovalEmail,
  sendCreditAssignedEmail
}; 