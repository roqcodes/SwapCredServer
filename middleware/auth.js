// Import sessionAuthMiddleware and adminMiddleware from the auth route file
const { sessionAuthMiddleware, adminMiddleware } = require('../routes/auth');

// Export the middleware for use in other routes
module.exports = {
  authMiddleware: sessionAuthMiddleware,
  adminMiddleware
}; 