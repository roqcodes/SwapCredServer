const express = require('express');
const router = express.Router();
const { db, admin } = require('../utils/firebaseAdmin');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

// Sessions collection to store active sessions
const SESSIONS_COLLECTION = 'sessions';
const USERS_COLLECTION = 'users';

// Generate a random session token
const generateSessionToken = () => {
  return crypto.randomBytes(64).toString('hex');
};

// Session token middleware
const sessionAuthMiddleware = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized - No token provided' });
    }
    
    const token = authHeader.split('Bearer ')[1];
    
    // Verify token in sessions collection
    const sessionSnapshot = await db.collection(SESSIONS_COLLECTION)
      .where('token', '==', token)
      .limit(1)
      .get();
    
    if (sessionSnapshot.empty) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token' });
    }
    
    const sessionDoc = sessionSnapshot.docs[0];
    const session = sessionDoc.data();
    
    // Check if session is expired
    if (session.expiresAt && session.expiresAt.toDate() < new Date()) {
      // Delete expired session
      await db.collection(SESSIONS_COLLECTION).doc(sessionDoc.id).delete();
      return res.status(401).json({ error: 'Unauthorized - Session expired' });
    }

    // Check if session needs rotation (past the refresh deadline)
    const now = new Date();
    if (session.refreshDeadline && session.refreshDeadline.toDate() < now) {
      // Create new token and update session
      const newToken = generateSessionToken();
      
      // Set new expiration dates
      const newExpiresAt = new Date();
      newExpiresAt.setDate(newExpiresAt.getDate() + 7);
      
      const newRefreshDeadline = new Date();
      newRefreshDeadline.setDate(newRefreshDeadline.getDate() + 6);
      
      // Update session with new token and expiration
      await db.collection(SESSIONS_COLLECTION).doc(sessionDoc.id).update({
        token: newToken,
        expiresAt: newExpiresAt,
        refreshDeadline: newRefreshDeadline,
        lastRotatedAt: now
      });
      
      // Set the new token in the response
      res.setHeader('X-New-Token', newToken);
    }
    
    // Get user from the session
    const userDoc = await db.collection(USERS_COLLECTION).doc(session.userId).get();
    
    if (!userDoc.exists) {
      return res.status(401).json({ error: 'Unauthorized - User not found' });
    }
    
    // Set user in request object
    req.user = {
      uid: userDoc.id,
      email: userDoc.data().email,
      ...userDoc.data(),
      sessionId: sessionDoc.id
    };
    
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Admin middleware
const adminMiddleware = (req, res, next) => {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: 'Forbidden - Admin access required' });
  }
  next();
};

// DEBUG ROUTE - Secured with admin authorization
router.get('/debug-shopify', sessionAuthMiddleware, adminMiddleware, async (req, res) => {
  try {
    req.logger.info(`Admin access to debug endpoint`, {
      action: 'Admin',
      email: req.user.email,
      endpoint: '/debug-shopify'
    });
    const email = req.query.email;
    const { findCustomerByEmail } = require('../utils/shopify');
    
    console.log(`[DEBUG] Testing Shopify customer lookup with email: ${email}`);
    
    try {
      const customer = await findCustomerByEmail(email);
      console.log('[DEBUG] Shopify customer found:', customer.id, customer.email);
      res.json({ 
        success: true, 
        customerId: customer.id,
        email: customer.email
      });
    } catch (error) {
      console.error('[DEBUG] Shopify customer lookup error:', error);
      console.error('[DEBUG] Error code:', error.code);
      console.error('[DEBUG] Error message:', error.message);
      console.error('[DEBUG] Response data:', error.response?.data);
      res.status(422).json({ 
        error: error.message,
        code: error.code || 'UNKNOWN_ERROR',
        details: error.response?.data || 'No additional details'
      });
    }
  } catch (error) {
    console.error('[DEBUG] Route error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Login with email
 * @route POST /api/auth/login
 * @access Public
 */
router.post('/login', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      req.logger.fail('Login attempt missing email');
      return res.status(400).json({ error: 'Email is required' });
    }
    
    req.logger.login(email);
    
    // First check if the email exists in Shopify
    const { findCustomerByEmail } = require('../utils/shopify');
    
    try {
      // Find customer in Shopify by email (pass request logger to enable request tracking)
      const shopifyCustomer = await findCustomerByEmail(email, { requestLogger: req.logger });
      
      if (!shopifyCustomer) {
        req.logger.fail(`Email not found in Shopify`, { email });
        // If customer not found in Shopify, return a 422 status (Unprocessable Entity)
        return res.status(422).json({ 
          error: 'Email not found in Shopify. Only existing Shopify customers can login.',
          code: 'SHOPIFY_CUSTOMER_NOT_FOUND'
        });
      }
      
      req.logger.success(`Verified Shopify customer`, {
        email,
        shopifyId: shopifyCustomer.id
      });
      
      // Use the actual Shopify ID from the found customer
      const actualShopifyId = shopifyCustomer.id.toString();
      
      // Now check if user exists in our database
      let userId;
      let userProfile;
      
      // Look up user by email
      const userSnapshot = await db.collection(USERS_COLLECTION)
        .where('email', '==', email)
        .limit(1)
        .get();
      
      if (userSnapshot.empty) {
        // Create new user
        const newUser = {
          email,
          shopifyId: actualShopifyId,
          createdAt: new Date(),
          updatedAt: new Date(),
          isAdmin: false // Default to non-admin
        };
        
        const userRef = await db.collection(USERS_COLLECTION).add(newUser);
        userId = userRef.id;
        userProfile = { ...newUser, uid: userId };
        
        req.logger.created(email, userId, { shopifyId: actualShopifyId });
      } else {
        // Get existing user
        const userDoc = userSnapshot.docs[0];
        userId = userDoc.id;
        userProfile = { ...userDoc.data(), uid: userId };
        
        req.logger.found(email, userId);
        
        // Update shopifyId if changed
        if (userProfile.shopifyId !== actualShopifyId) {
          req.logger.info(`Updating Shopify ID for user`, {
            userId,
            oldShopifyId: userProfile.shopifyId,
            newShopifyId: actualShopifyId
          });
          
          await db.collection(USERS_COLLECTION).doc(userId).update({
            shopifyId: actualShopifyId,
            updatedAt: new Date()
          });
          
          userProfile.shopifyId = actualShopifyId;
          userProfile.updatedAt = new Date();
        }
      }
      
      // Create a new session
      const sessionToken = generateSessionToken();
      
      // Set session expiration date (7 days from now for better security)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      // Set refresh deadline (6 days from now - sessions will be refreshed if used after this time)
      const refreshDeadline = new Date();
      refreshDeadline.setDate(refreshDeadline.getDate() + 6);
      
      const sessionData = {
        userId,
        token: sessionToken,
        createdAt: new Date(),
        expiresAt,
        refreshDeadline,
        userAgent: req.headers['user-agent'],
        ip: req.ip
      };
      
      await db.collection(SESSIONS_COLLECTION).add(sessionData);
      
      // Return token and user profile
      res.status(200).json({
        sessionToken,
        expiresAt,
        userProfile
      });
      
    } catch (error) {
      // Check if this is a Shopify customer not found error
      if (error.code === 'SHOPIFY_CUSTOMER_NOT_FOUND') {
        req.logger.warn(`Login failed: Email not found in Shopify: ${email}`, { errorCode: error.code });
        return res.status(422).json({ 
          error: 'Email not found in Shopify. Only existing Shopify customers can login.',
          code: 'SHOPIFY_CUSTOMER_NOT_FOUND'
        });
      }
      
      // For other Shopify API errors
      req.logger.error(`Shopify API error during login for ${email || 'unknown email'}`, {
        error: error.message,
        stack: error.stack,
        code: error.code || 'UNKNOWN_ERROR'
      });
      
      return res.status(500).json({ 
        error: 'Error verifying customer with Shopify. Please try again later.',
        code: 'SHOPIFY_API_ERROR'
      });
    }
    
  } catch (error) {
    req.logger.error(`Unhandled error during login:`, {
      error: error.message,
      stack: error.stack,
      email: req.body?.email
    });
    
    res.status(500).json({ 
      error: 'Failed to login',
      code: 'INTERNAL_SERVER_ERROR'
    });
  }
});

/**
 * Get user profile
 * @route GET /api/auth/profile
 * @access Protected
 */
router.get('/profile', sessionAuthMiddleware, async (req, res) => {
  try {
    // User is already available in req.user from middleware
    const { uid, sessionId, ...userData } = req.user;
    
    res.status(200).json({
      uid,
      ...userData
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get user profile' });
  }
});

/**
 * Logout - Invalidate the current session
 * @route POST /api/auth/logout
 * @access Private - Requires valid session
 */
router.post('/logout', sessionAuthMiddleware, async (req, res) => {
  try {
    // Delete the current session
    await db.collection(SESSIONS_COLLECTION).doc(req.user.sessionId).delete();
    
    // Track successful logout
    req.logger.info(`User logged out`, {
      userId: req.user.uid,
      email: req.user.email
    });
    
    return res.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Failed to logout' });
  }
});

/**
 * Logout from all devices - Invalidate all user sessions
 * @route POST /api/auth/logout-all
 * @access Private - Requires valid session
 */
router.post('/logout-all', sessionAuthMiddleware, async (req, res) => {
  try {
    // Get all user sessions
    const sessionsSnapshot = await db.collection(SESSIONS_COLLECTION)
      .where('userId', '==', req.user.uid)
      .get();
    
    // Delete all sessions in a batch
    const batch = db.batch();
    sessionsSnapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    
    await batch.commit();
    
    // Track logout from all devices
    req.logger.info(`User logged out from all devices`, {
      userId: req.user.uid,
      email: req.user.email,
      sessionCount: sessionsSnapshot.size
    });
    
    return res.json({ 
      success: true,
      sessionsTerminated: sessionsSnapshot.size 
    });
  } catch (error) {
    console.error('Error in logout-all:', error);
    return res.status(500).json({ error: 'Failed to logout from all devices' });
  }
});

/**
 * Update user profile
 * @route PUT /api/auth/profile
 * @access Protected
 */
router.put('/profile', sessionAuthMiddleware, async (req, res) => {
  try {
    const { name, phone } = req.body;
    const userId = req.user.uid;
    
    // Update user profile
    const updateData = {
      updatedAt: new Date()
    };
    
    if (name) updateData.name = name;
    if (phone) updateData.phone = phone;
    
    await db.collection(USERS_COLLECTION).doc(userId).update(updateData);
    
    // Get updated user
    const updatedUser = await db.collection(USERS_COLLECTION).doc(userId).get();
    
    res.status(200).json({
      uid: userId,
      ...updatedUser.data()
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

/**
 * Make a user an admin (admin only)
 * @route POST /api/auth/make-admin
 * @access Admin only
 */
router.post('/make-admin', sessionAuthMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    
    // Check if user exists
    const userDoc = await db.collection(USERS_COLLECTION).doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Update user to be admin
    await db.collection(USERS_COLLECTION).doc(userId).update({
      isAdmin: true,
      updatedAt: new Date()
    });
    
    res.status(200).json({ message: 'User has been made an admin' });
  } catch (error) {
    console.error('Make admin error:', error);
    res.status(500).json({ error: 'Failed to make user an admin' });
  }
});

/**
 * Verify email and create or update user
 * @route POST /api/auth/verify-email
 * @access Public
 */
router.post('/verify-email', async (req, res) => {
  try {
    const { email, token } = req.body;
    
    if (!email || !token) {
      return res.status(400).json({ error: 'Email and token are required' });
    }
    
    // Verify token
    let validToken = false;
    try {
      // Token verification logic here
      // Assume token is valid for now or check against a stored token
      validToken = true; // Replace with actual verification
    } catch (tokenError) {
      console.error('Token verification error:', tokenError);
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    
    // Check if user exists
    const userQuery = await db.collection(USERS_COLLECTION)
      .where('email', '==', email)
      .limit(1)
      .get();
    
    let userId;
    let userProfile;
    
    if (userQuery.empty) {
      // Create new user
      const newUser = {
        email,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        isAdmin: false // Default to non-admin
      };
      
      const userRef = await db.collection(USERS_COLLECTION).add(newUser);
      userId = userRef.id;
      userProfile = { ...newUser, uid: userId };
      
      console.log(`Created new user with verified email: ${userId}`);
    } else {
      // Update existing user
      const userDoc = userQuery.docs[0];
      userId = userDoc.id;
      
      await db.collection(USERS_COLLECTION).doc(userId).update({
        emailVerified: true,
        updatedAt: new Date()
      });
      
      // Get updated user profile
      const updatedDoc = await db.collection(USERS_COLLECTION).doc(userId).get();
      userProfile = { ...updatedDoc.data(), uid: userId };
      
      console.log(`Verified email for existing user: ${userId}`);
    }
    
    // Create a new session (7 day validity)
    const sessionToken = generateSessionToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    
    const refreshDeadline = new Date();
    refreshDeadline.setDate(refreshDeadline.getDate() + 6);
    
    const sessionData = {
      userId,
      token: sessionToken,
      createdAt: new Date(),
      expiresAt,
      refreshDeadline,
      userAgent: req.headers['user-agent'],
      ip: req.ip
    };
    
    await db.collection(SESSIONS_COLLECTION).add(sessionData);
    
    // Return the session token and user profile
    res.status(200).json({
      message: 'Email verified successfully',
      sessionToken,
      expiresAt,
      userProfile
    });
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({ error: 'Failed to verify email' });
  }
});

module.exports = {
  router,
  sessionAuthMiddleware,
  adminMiddleware
}; 