const { db } = require('../utils/firebaseAdmin');

/**
 * Middleware to check if the user is an admin
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {function} next - Express next function
 */
const adminMiddleware = async (req, res, next) => {
  try {
    // User ID should be set by the auth middleware
    const { uid } = req.user;
    
    if (!uid) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    // Get user from Firestore
    const userDoc = await db.collection('users').doc(uid).get();
    
    if (!userDoc.exists) {
      return res.status(403).json({ error: 'User not found' });
    }
    
    const userData = userDoc.data();
    
    // Check if user is an admin
    if (!userData.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    // User is an admin, proceed
    next();
  } catch (error) {
    console.error('Admin middleware error:', error);
    res.status(500).json({ error: 'Server error during authorization check' });
  }
};

module.exports = {
  adminMiddleware
}; 