const express = require('express');
const router = express.Router();
const { findCustomerByEmail, getCustomerLoyaltyPoints } = require('../utils/shopify');
const { authMiddleware } = require('../middleware/auth');

/**
 * Handle preflight OPTIONS requests for CORS
 * Also useful as a health check endpoint
 */
router.options('/check-customer', (req, res) => {
  res.status(200).send('OK');
});

/**
 * Check if customer exists in Shopify by email
 * @route POST /api/shopify/check-customer
 * @access Public (needed for email validation during auth)
 */
router.post('/check-customer', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    console.log(`Checking customer email: ${email}`);
    
    const customer = await findCustomerByEmail(email);
    
    if (!customer) {
      console.log(`Customer with email ${email} not found in Shopify`);
      return res.status(404).json({ 
        exists: false,
        message: 'Customer not found in Shopify'
      });
    }
    
    console.log(`Customer found with ID: ${customer.id}`);
    
    // Don't return sensitive information, just the existence and ID
    return res.status(200).json({
      exists: true,
      shopifyId: customer.id,
      message: 'Customer found in Shopify'
    });
  } catch (error) {
    console.error('Error checking Shopify customer:', error);
    
    // Send more specific error messages
    if (error.response && error.response.status) {
      console.error(`Shopify API error: ${error.response.status}`);
      
      if (error.response.status === 401 || error.response.status === 403) {
        return res.status(500).json({ error: 'Authentication error with Shopify. Please check API credentials.' });
      }
    }
    
    res.status(500).json({ error: 'Failed to check Shopify customer' });
  }
});

/**
 * Get customer's loyalty points balance from Shopify
 * @route GET /api/shopify/credit
 * @access Authenticated users (own loyalty points only)
 */
router.get('/credit', authMiddleware, async (req, res) => {
  try {
    const { uid } = req.user;
    const { db } = require('../utils/firebaseAdmin');
    
    // Get user data from Firestore
    const userDoc = await db.collection('users').doc(uid).get();
    
    if (!userDoc.exists) {
      // Return zero loyalty points for users without a profile
      console.log(`User document not found for UID: ${uid}`);
      return res.status(200).json({ 
        creditAmount: 0,
        currency: 'INR',
        error: 'User profile not found in our system. Please contact support.'
      });
    }
    
    const userData = userDoc.data();
    
    // Try to get loyalty points
    try {
      let points = { amount: 0, currency: 'INR' };
      
      // If we have a Shopify ID, try that first
      if (userData.shopifyId) {
        points = await getCustomerLoyaltyPoints(userData.shopifyId);
      } 
      // If no result or no Shopify ID, try with email
      if ((points.amount === 0 || points.error) && userData.email) {
        points = await getCustomerLoyaltyPoints(userData.email);
        
        // Only try to update shopifyId if we found a customer without errors
        if (!points.error && points.amount >= 0) {
          try {
            const customer = await findCustomerByEmail(userData.email);
            if (customer && (!userData.shopifyId || userData.shopifyId !== customer.id.toString())) {
              await db.collection('users').doc(uid).update({
                shopifyId: customer.id.toString(),
                updatedAt: new Date()
              });
              console.log(`Updated user ${uid} with Shopify ID: ${customer.id}`);
            }
          } catch (customerError) {
            // We already have points info, so just log this error and continue
            console.error('Error finding/updating Shopify customer ID:', customerError);
          }
        }
      }
      
      // If we have a specific error about customer not found, return it with a user-friendly message
      if (points.code === 'SHOPIFY_CUSTOMER_NOT_FOUND') {
        console.log(`Returning Shopify customer not found error for email: ${points.email || userData.email}`);
        return res.status(200).json({
          creditAmount: 0,
          currency: 'INR',
          error: `No Shopify account found with email ${points.email || userData.email}. Please make sure you're using the same email address associated with your Shopify account.`,
          code: 'SHOPIFY_CUSTOMER_NOT_FOUND',
          shopifyId: userData.shopifyId || null
        });
      }
      
      // Return loyalty points information (keeping creditAmount name for backward compatibility)
      res.status(200).json({
        creditAmount: points.amount,
        currency: points.currency,
        shopifyId: userData.shopifyId || null,
        error: points.error // Pass through any other errors that might exist
      });
    } catch (shopifyError) {
      console.error('Error retrieving loyalty points from Shopify:', shopifyError);
      
      // Check for specific error types
      if (shopifyError.code === 'SHOPIFY_CUSTOMER_NOT_FOUND') {
        return res.status(200).json({
          creditAmount: 0,
          currency: 'INR',
          error: `No Shopify account found with email ${shopifyError.email || userData.email}. Please make sure you're using the same email address associated with your Shopify account.`,
          code: 'SHOPIFY_CUSTOMER_NOT_FOUND',
          shopifyId: userData.shopifyId || null
        });
      }
      
      // Return 0 points with error message
      res.status(200).json({
        creditAmount: 0,
        currency: 'INR',
        shopifyId: userData.shopifyId || null,
        error: 'Unable to retrieve loyalty points information from Shopify. Please try again later.'
      });
    }
  } catch (error) {
    console.error('Error getting customer loyalty points:', error);
    // Provide a fallback response
    res.status(200).json({ 
      creditAmount: 0, 
      currency: 'INR',
      error: 'Failed to get customer loyalty points. Please try again later.'
    });
  }
});

/**
 * Get loyalty points history for current user
 * @route GET /api/shopify/credit-history
 * @access Authenticated users (own history only)
 */
router.get('/credit-history', authMiddleware, async (req, res) => {
  try {
    const { uid } = req.user;
    const { limit = 10 } = req.query;
    
    // Get loyalty points history from Firestore
    const { db } = require('../utils/firebaseAdmin');
    
    try {
      // Try with ordering
      const snapshot = await db.collection('credit_history')
        .where('userId', '==', uid)
        .orderBy('createdAt', 'desc')
        .limit(parseInt(limit))
        .get();
      
      // Format data
      const pointsHistory = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt.toDate()
      }));
      
      res.status(200).json(pointsHistory);
    } catch (indexError) {
      // Handle index error fallback
      if (indexError.code === 9 || (indexError.message && indexError.message.includes('index'))) {
        console.warn('Index error in loyalty points history, falling back to basic query:', indexError.message);
        
        const snapshot = await db.collection('credit_history')
          .where('userId', '==', uid)
          .get();
          
        // Format and sort manually
        let pointsHistory = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt.toDate()
        }));
        
        // Sort manually and apply limit
        pointsHistory.sort((a, b) => b.createdAt - a.createdAt);
        pointsHistory = pointsHistory.slice(0, parseInt(limit));
        
        res.status(200).json(pointsHistory);
      } else {
        throw indexError;
      }
    }
  } catch (error) {
    console.error('Error getting loyalty points history:', error);
    // Return empty array instead of error
    res.status(200).json([]);
  }
});

module.exports = router; 