const winston = require('winston');
const path = require('path');
const fs = require('fs');
const { sanitizeData, sanitizeEmail, sanitizeId } = require('./sanitizer');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Add a format to sanitize sensitive data
const sanitizeFormat = winston.format((info) => {
  // Sanitize all metadata
  const sanitized = sanitizeData(info);
  
  // Extra sanitization for common fields
  if (sanitized.email) {
    sanitized.email = sanitizeEmail(sanitized.email);
  }
  
  if (sanitized.shopifyId) {
    sanitized.shopifyId = sanitizeId(sanitized.shopifyId);
  }
  
  // Keep the original level and message
  sanitized.level = info.level;
  sanitized.message = info.message;
  
  return sanitized;
})();

// Define simplified log format for better readability
const simpleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  sanitizeFormat,
  winston.format.printf((info) => {
    const { timestamp, level, message, requestId, action, ...meta } = info;
    
    // Create a user-friendly message
    let actionStr = action ? `${action}: ` : '';
    // Email already sanitized by sanitizeFormat
    let userStr = meta.email ? `for ${meta.email}` : '';
    let resultStr = '';
    
    if (meta.cached) {
      return `${timestamp} | Using cached data ${userStr}`;
    }
    
    if (meta.apiCall) {
      return `${timestamp} | API Call to ${meta.service || 'external service'}`;
    }
    
    if (meta.userId && meta.created) {
      return `${timestamp} | Created new user account for ${meta.email}`;
    }
    
    if (meta.userId && !meta.created) {
      return `${timestamp} | Found existing user ${userStr}`;
    }
    
    if (meta.responseTime) {
      return `${timestamp} | Request completed with status ${meta.status || 200} in ${Math.round(meta.responseTime)}ms`;
    }
    
    // Default format
    return `${timestamp} | ${actionStr}${message} ${userStr}`.trim();
  })
);

// Create a Winston logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    sanitizeFormat,
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' })
  ),
  transports: [
    // Console transport - simple human-readable format
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        simpleFormat
      )
    }),
    // File transport - for all logs, keep more detailed info in files
    new winston.transports.File({ 
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        sanitizeFormat,
        winston.format.json()
      )
    }),
    // File transport - for error logs only
    new winston.transports.File({ 
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        sanitizeFormat,
        winston.format.json()
      )
    })
  ]
});

// Create a request-scoped logger with user-friendly action types
const createRequestLogger = (requestId) => {
  return {
    debug: (message, meta = {}) => logger.debug(message, { requestId, ...meta }),
    info: (message, meta = {}) => logger.info(message, { requestId, ...meta }),
    warn: (message, meta = {}) => logger.warn(message, { requestId, ...meta }),
    error: (message, meta = {}) => logger.error(message, { requestId, ...meta }),
    
    // User-friendly action loggers
    login: (email, meta = {}) => {
      logger.info(`User login`, { requestId, action: 'Login', email, ...meta });
    },
    found: (email, userId, meta = {}) => {
      logger.info(`Found user`, { requestId, email, userId, ...meta });
    },
    created: (email, userId, meta = {}) => {
      logger.info(`Created user`, { requestId, email, userId, created: true, ...meta });
    },
    shopify: (email, meta = {}) => {
      logger.info(`Shopify lookup`, { requestId, action: 'Shopify', email, ...meta });
    },
    success: (message, meta = {}) => {
      logger.info(message, { requestId, action: 'Success', ...meta });
    },
    fail: (message, meta = {}) => {
      logger.warn(message, { requestId, action: 'Failed', ...meta });
    },
    
    // Track API calls in a simplified way
    api: (service, endpoint, meta = {}) => {
      logger.info(`Calling ${service}`, { 
        requestId, 
        apiCall: true, 
        service, 
        endpoint, 
        ...meta 
      });
    }
  };
};

module.exports = {
  logger,
  createRequestLogger
};
