const path = require('path');
const fs = require('fs');

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
  'FIREBASE_PRIVATE_KEY'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
  console.error('\u26A0\uFE0F Missing required environment variables:', missingVars.join(', '));
  console.error('Please add these to your .env file');
}

const express = require('express');
const cors = require('cors');

// Initialize Express
const app = express();
const PORT = process.env.PORT || 5000;

// Initialize Firebase collections
const { initializeCollections } = require('../utils/ensureCollections');
// Run in the background to avoid blocking server startup
(async () => {
  try {
    await initializeCollections();
    console.log('Firebase collections successfully initialized');
  } catch (error) {
    console.error('Error initializing collections:', error);
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

// Middleware
app.use(cors({
  // In production, allow requests from anywhere (will be same origin anyway)
  // In development, restrict to localhost
  origin: process.env.NODE_ENV === 'production' 
    ? true // Allow requests from any origin in production
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json());

// Add request tracking middleware - should be after basic middleware but before routes
app.use(requestTracker);

// Apply general rate limiting to all routes
app.use(generalLimiter);

// Import routes
const { router: authRouter } = require('../routes/auth');
const exchangeRoutes = require('../routes/exchange');
const adminRoutes = require('../routes/admin');
const shopifyRoutes = require('../routes/shopify');
const uploadRoutes = require('../routes/upload');

// Use routes
// Apply stricter rate limiting to auth routes
app.use('/api/auth', authLimiter, authRouter);
app.use('/api/exchange', exchangeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/shopify', shopifyRoutes);
app.use('/api/upload', uploadRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date() });
});

// Serve static files from the React app in production
if (process.env.NODE_ENV === 'production') {
  // Serve client build files in production
  app.use(express.static(path.join(__dirname, '../client/dist')));
  
  app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, '../client', 'dist', 'index.html'));
  });
}

// Error handler middleware
app.use((err, req, res, next) => {
  // Log error details to our structured logger
  if (req.logger) {
    req.logger.error(`Server error: ${err.message}`, { 
      stack: err.stack,
      path: req.originalUrl,
      method: req.method
    });
  } else {
    logger.error(`Server error: ${err.message}`, {
      stack: err.stack,
      path: req.originalUrl,
      method: req.method
    });
  }
  
  // Don't expose error details in production
  if (process.env.NODE_ENV === 'production') {
    res.status(500).send({ error: 'Server error occurred' });
  } else {
    res.status(500).send({ error: err.message || 'Server error', stack: err.stack });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Server environment: ${process.env.NODE_ENV || 'development'}`);
}); 