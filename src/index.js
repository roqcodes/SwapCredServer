const path = require('path');
const fs = require('fs');
const http = require('http');

// Load environment variables with better error handling
const envPath = path.resolve(__dirname, '../.env');

if (fs.existsSync(envPath)) {
  console.log(`Loading environment variables from ${envPath}`);
  require('dotenv').config({ path: envPath });
} else {
  console.error(`\u26A0\uFE0F Warning: .env file not found at ${envPath}`);
  console.error('Using existing environment variables. Some features may not work correctly.');
}

// Check required environment variables
const requiredEnvVars = [
  'SHOPIFY_STORE_URL', 
  'SHOPIFY_ACCESS_TOKEN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'NODE_ENV'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
  console.error('\u26A0\uFE0F Missing required environment variables:', missingVars.join(', '));
  console.error('Please add these to your .env file or your deployment environment');
  // In production, exit if required vars are missing
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

const express = require('express');
const cors = require('cors');

// Initialize Express
const app = express();
const PORT = process.env.PORT || 5000;

// Create HTTP server
const server = http.createServer(app);

// Initialize Firebase collections
const { initializeCollections } = require('../utils/ensureCollections');
// Run in the background to avoid blocking server startup
(async () => {
  try {
    await initializeCollections();
    console.log('Firebase collections successfully initialized');
  } catch (error) {
    console.error('Error initializing collections:', error);
    // In production, exit if Firebase initialization fails
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }
})();

// Import our new request tracking middleware and logger
const requestTracker = require('../middleware/requestTracker');
const { logger } = require('../utils/logger');
const { generalLimiter, authLimiter } = require('../middleware/rateLimiter');
const helmet = require('helmet');

// Security middleware
app.use(helmet());

// Set additional security headers
app.use((req, res, next) => {
  // Strict-Transport-Security for HTTPS enforcement
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  // Content-Security-Policy to prevent XSS and other attacks
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https://res.cloudinary.com; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://api.printersparekart.com;");
  // X-Content-Type-Options to prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // X-Frame-Options to prevent clickjacking
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  // X-XSS-Protection as an additional layer of XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block');
  // Referrer-Policy to control referrer information
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// Request body size limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.ALLOWED_ORIGINS?.split(',') || true
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400 // CORS preflight cache for 24 hours
}));

// Add request tracking middleware
app.use(requestTracker);

// Add timeout middleware
app.use((req, res, next) => {
  res.setTimeout(30000, () => {
    res.status(408).send('Request Timeout');
  });
  next();
});

// Apply general rate limiting to all routes
app.use(generalLimiter);

// Import routes
const { router: authRouter } = require('../routes/auth');
const exchangeRoutes = require('../routes/exchange');
const adminRoutes = require('../routes/admin');
const shopifyRoutes = require('../routes/shopify');
const uploadRoutes = require('../routes/upload');

// Use routes
app.use('/api/auth', authLimiter, authRouter);
app.use('/api/exchange', exchangeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/shopify', shopifyRoutes);
app.use('/api/upload', uploadRoutes);

// Health check endpoint with detailed status
app.get('/api/health', (req, res) => {
  const status = {
    status: 'ok',
    timestamp: new Date(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV
  };
  res.status(200).json(status);
});

// Serve static files from the React app in production
if (process.env.NODE_ENV === 'production') {
  // Serve static files
  app.use(express.static(path.join(__dirname, '../client/dist')));
  
  // Handle client-side routing - this must be AFTER API routes
  app.get('/*', (req, res) => {
    // Only handle non-API routes
    if (!req.path.startsWith('/api/')) {
      res.sendFile(path.join(__dirname, '../client/dist/index.html'));
    } else {
      res.status(404).json({ error: 'API endpoint not found' });
    }
  });
}

// Error handler middleware
app.use((err, req, res, next) => {
  const errorId = Date.now().toString(36) + Math.random().toString(36).substr(2);
  
  // Log error details
  if (req.logger) {
    req.logger.error(`Server error [${errorId}]: ${err.message}`, { 
      errorId,
      stack: err.stack,
      path: req.originalUrl,
      method: req.method,
      body: process.env.NODE_ENV === 'development' ? req.body : undefined
    });
  } else {
    logger.error(`Server error [${errorId}]: ${err.message}`, {
      errorId,
      stack: err.stack,
      path: req.originalUrl,
      method: req.method
    });
  }
  
  // Send error response
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' 
      ? 'Server error occurred' 
      : err.message,
    errorId,
    status: err.status || 500
  });
});

// Graceful shutdown handling
let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log(`\n${signal} received. Starting graceful shutdown...`);
  
  // Stop accepting new requests
  server.close(() => {
    console.log('HTTP server closed');
  });
  
  try {
    // Add any cleanup tasks here (e.g., closing database connections)
    console.log('Cleanup completed');
    process.exit(0);
  } catch (error) {
    console.error('Error during cleanup:', error);
    process.exit(1);
  }
}

// Handle different shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  gracefulShutdown('Uncaught Exception');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('Unhandled Rejection');
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Server environment: ${process.env.NODE_ENV || 'development'}`);
}); 