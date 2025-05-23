require('dotenv').config();
const { sendApprovalEmail, sendCreditAssignedEmail } = require('./utils/email');

// Sample exchange data for testing
const sampleExchange = {
  id: 'test-exchange-id',
  productName: 'Test Product',
  brand: 'Sample Brand',
  condition: 'Like New',
  userEmail: 'delivered@resend.dev', // Resend's testing email address
  warehouseInfo: {
    name: 'Main Warehouse',
    addressLine1: '123 Shipping Lane',
    addressLine2: 'Floor 2',
    city: 'Mumbai',
    state: 'Maharashtra',
    postalCode: '400001',
    country: 'India',
    contactPerson: 'Warehouse Manager',
    contactPhone: '+91 9876543210'
  },
  creditAmount: 1500,
  totalLoyaltyPoints: 3000
};

async function testEmails() {
  try {
    console.log('Testing approval email...');
    const approvalResult = await sendApprovalEmail(sampleExchange.userEmail, sampleExchange);
    console.log('Approval email sent successfully:', approvalResult);
    
    console.log('\nTesting credit assignment email...');
    const creditResult = await sendCreditAssignedEmail(sampleExchange.userEmail, sampleExchange);
    console.log('Credit email sent successfully:', creditResult);
    
    console.log('\nAll emails sent successfully!');
  } catch (error) {
    console.error('Error testing emails:', error);
  }
}

// Run the test
testEmails(); 