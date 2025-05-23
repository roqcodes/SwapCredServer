const { v4: uuidv4 } = require('uuid');
const { createRequestLogger } = require('../utils/logger');

// Middleware to generate request ID and attach logger to request object
const requestTracker = (req, res, next) => {
  // Generate a unique request ID
  const requestId = uuidv4();
  
  // Attach request ID to response headers
  res.setHeader('X-Request-Id', requestId);
  
  // Create a request-scoped logger and attach to request object
  req.logger = createRequestLogger(requestId);
  
  // Log the incoming request in a simple way
  req.logger.info(`Request: ${req.method} ${req.originalUrl.split('?')[0]}`);
  
  // Log response when it's sent
  const originalSend = res.send;
  res.send = function(body) {
    // Log the response with a simplified format
    const responseTime = Date.now() - req.startTime;
    req.logger.info(`Response completed`, {
      status: res.statusCode,
      responseTime,
      path: req.originalUrl.split('?')[0]
    });
    
    return originalSend.call(this, body);
  };
  
  // Record start time
  req.startTime = Date.now();
  
  next();
};

module.exports = requestTracker;
