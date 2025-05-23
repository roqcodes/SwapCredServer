const redis = require('redis');
const { RateLimiterRedis, RateLimiterMemory } = require('rate-limiter-flexible');
const { logger } = require('../utils/logger');

// Try to use Redis if available, fallback to memory store for easier development setup
let rateLimiter;

try {
  // Check if REDIS_URL is set in environment
  if (process.env.REDIS_URL) {
    const redisClient = redis.createClient({
      url: process.env.REDIS_URL,
      enable_offline_queue: false
    });

    redisClient.on('error', (err) => {
      logger.error('Redis error:', err);
    });

    // Create Redis rate limiter
    rateLimiter = new RateLimiterRedis({
      storeClient: redisClient,
      keyPrefix: 'ratelimit',
      points: 10, // 10 requests
      duration: 60, // per 1 minute by IP
    });

    logger.info('Using Redis-based rate limiter');
  } else {
    throw new Error('Redis URL not configured, using memory rate limiter instead');
  }
} catch (err) {
  // Fallback to memory store if Redis is not available
  logger.warn(`Fallback to memory rate limiter: ${err.message}`);
  
  rateLimiter = new RateLimiterMemory({
    points: 100, // 100 requests
    duration: 60, // per 1 minute
  });
}

// Configure more reasonable rate limits for authentication endpoints
const authRateLimiter = new RateLimiterMemory({
  points: 20, // 20 requests
  duration: 60, // per 1 minute
  blockDuration: 120, // Block for 2 minutes if exceeded
});

// Middleware function for regular endpoints
const generalLimiter = (req, res, next) => {
  // Get fingerprint from IP and user agent
  const key = req.ip + (req.headers['user-agent'] || '');
  
  rateLimiter.consume(key)
    .then(() => {
      next();
    })
    .catch((rejRes) => {
      if (rejRes instanceof Error) {
        logger.error('Rate limiter error:', rejRes);
        next(); // Allow the request in case of internal error
      } else {
        const secs = Math.round(rejRes.msBeforeNext / 1000) || 1;
        res.set('Retry-After', String(secs));
        res.status(429).json({
          error: 'Too many requests',
          retryAfter: secs
        });
        
        logger.warn(`Rate limit exceeded for ${req.ip}`, {
          path: req.originalUrl,
          remainingTime: secs
        });
      }
    });
};

// Middleware for auth endpoints with stricter limits
const authLimiter = (req, res, next) => {
  // Get fingerprint from IP
  const key = req.ip;
  
  authRateLimiter.consume(key)
    .then(() => {
      next();
    })
    .catch((rejRes) => {
      if (rejRes instanceof Error) {
        logger.error('Auth rate limiter error:', rejRes);
        next(); // Allow the request in case of internal error
      } else {
        const secs = Math.round(rejRes.msBeforeNext / 1000) || 1;
        res.set('Retry-After', String(secs));
        res.status(429).json({
          error: 'Too many authentication attempts, please try again later',
          retryAfter: secs
        });
        
        logger.warn(`Auth rate limit exceeded for ${req.ip}`, {
          path: req.originalUrl,
          remainingTime: secs
        });
      }
    });
};

module.exports = { generalLimiter, authLimiter };
