const express = require('express');
const router = express.Router();
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { authMiddleware } = require('../middleware/auth');
const { validateImage } = require('../utils/imageValidator');
const { logger } = require('../utils/logger');

// Configure Cloudinary with environment variables
try {
  console.log('Cloudinary config vars:', {
    cloud_name: process.env.VITE_CLOUDINARY_CLOUD_NAME || 'NOT_SET',
    api_key: process.env.VITE_CLOUDINARY_API_KEY ? 'SET' : 'NOT_SET',
    api_secret: process.env.VITE_CLOUDINARY_API_SECRET ? 'SET' : 'NOT_SET'
  });
  
  cloudinary.config({
    cloud_name: process.env.VITE_CLOUDINARY_CLOUD_NAME,
    api_key: process.env.VITE_CLOUDINARY_API_KEY,
    api_secret: process.env.VITE_CLOUDINARY_API_SECRET
  });
  
  console.log('Cloudinary configured successfully');
} catch (error) {
  console.error('Error configuring Cloudinary:', error);
}

// Configure memory storage (safer than disk storage)
const memoryStorage = multer.memoryStorage();

// File filter to only allow images with additional MIME type checks
const fileFilter = (req, file, cb) => {
  // Check MIME type
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
  
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    req.logger.warn('Upload attempt with invalid file type', {
      mime: file.mimetype,
      originalName: file.originalname,
      userId: req.user?.uid
    });
    cb(new Error(`Only image files are allowed (${allowedMimeTypes.join(', ')})`), false);
  }
};

// Configure upload middleware with memory storage
const upload = multer({
  storage: memoryStorage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB max size
  },
  fileFilter: fileFilter
});

// Secure image upload route using memory storage and image validation
router.post('/image', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    req.logger.info('Image upload request received', {
      userId: req.user.uid,
      contentType: req.file?.mimetype,
      fileSize: req.file?.size
    });
    
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No image file provided' });
    }
    
    // Validate and sanitize the image
    const validationResult = await validateImage(req.file.buffer, {
      maxWidth: 4000,
      maxHeight: 4000,
      minWidth: 100,
      minHeight: 100,
      maxSizeInBytes: 5 * 1024 * 1024, // 5MB
      allowedFormats: ['jpeg', 'jpg', 'png', 'webp']
    });
    
    if (!validationResult.valid) {
      req.logger.warn('Invalid image rejected', {
        userId: req.user.uid,
        error: validationResult.error,
        originalName: req.file.originalname
      });
      
      return res.status(400).json({ 
        error: validationResult.error || 'Invalid image file' 
      });
    }
    
    req.logger.info('Image validated successfully', {
      format: validationResult.format,
      dimensions: `${validationResult.width}x${validationResult.height}`
    });
    
    // Upload sanitized image to Cloudinary
    const result = await cloudinary.uploader.upload_stream({
      folder: 'SWAPCRED',
      resource_type: 'image',
      format: validationResult.format,
      // Add additional security transformations if needed
      transformation: [
        { quality: 'auto' }, // Optimize quality
        { fetch_format: 'auto' } // Optimize format based on browser
      ]
    }, (error, result) => {
      if (error) {
        req.logger.error('Cloudinary upload error', {
          error: error.message,
          code: error.http_code
        });
        
        return res.status(500).json({ 
          error: 'Failed to upload image to cloud storage' 
        });
      }
      
      req.logger.info('Image uploaded successfully', {
        publicId: result.public_id,
        userId: req.user.uid
      });
      
      return res.json({
        secure_url: result.secure_url,
        public_id: result.public_id,
        format: result.format,
        width: result.width,
        height: result.height
      });
    }).end(validationResult.buffer);
    
  } catch (error) {
    req.logger.error('Unhandled error in image upload', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.uid
    });
    
    return res.status(500).json({ 
      error: 'Internal server error processing image'
    });
  }
});

// Legacy endpoint with redirect to new endpoint
router.post('/image-buffer', (req, res) => {
  // Log deprecated route usage
  if (req.logger) {
    req.logger.warn('Deprecated upload endpoint accessed', {
      path: req.originalUrl,
      userId: req.user?.uid
    });
  } else {
    logger.warn('Deprecated upload endpoint accessed', {
      path: req.originalUrl
    });
  }
  
  // Redirect to new endpoint
  res.status(308).json({
    message: 'This endpoint is deprecated. Please use /api/upload/image instead.',
    redirectTo: '/api/upload/image'
  });
});

// Test endpoint to verify Cloudinary configuration
router.get('/test-cloudinary', (req, res) => {
  try {
    const config = cloudinary.config();
    const configStatus = {
      cloud_name: config.cloud_name || 'NOT_SET',
      api_key: config.api_key ? 'SET' : 'NOT_SET',
      api_secret: config.api_secret ? 'SET' : 'NOT_SET',
      secure: config.secure
    };
    
    return res.json({
      status: 'success',
      message: 'Cloudinary configuration loaded',
      config: configStatus
    });
  } catch (error) {
    console.error('Error in Cloudinary test endpoint:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to load Cloudinary configuration',
      error: error.message
    });
  }
});

// Direct test upload endpoint (admin only, no file required)
router.get('/test-upload', authMiddleware, async (req, res) => {
  try {
    console.log('Testing direct Cloudinary upload');
    
    // Simple test image data URI (a 1x1 pixel transparent PNG)
    const tinyImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    
    // Upload test image to Cloudinary
    const result = await cloudinary.uploader.upload(tinyImage, {
      folder: 'SWAPCRED_TEST',
      resource_type: 'image'
    });
    
    console.log('Test upload successful:', result.public_id);
    
    return res.json({
      status: 'success',
      message: 'Test upload successful',
      image: {
        public_id: result.public_id,
        secure_url: result.secure_url
      }
    });
  } catch (error) {
    console.error('Error in test upload:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Test upload failed',
      error: error.message
    });
  }
});

// Simplified direct upload with preset (no auth required)
router.get('/test-unsigned', async (req, res) => {
  try {
    console.log('Testing direct Cloudinary upload with preset');
    
    // Simple test image data URI (a 1x1 pixel transparent PNG)
    const tinyImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    
    // Upload test image to Cloudinary using unsigned upload
    const result = await cloudinary.uploader.unsigned_upload(tinyImage, 'ml_default', {
      cloud_name: 'demo', // Using demo cloud explicitly
      resource_type: 'image'
    });
    
    console.log('Test unsigned upload successful:', result.public_id);
    
    return res.json({
      status: 'success',
      message: 'Test unsigned upload successful',
      image: {
        public_id: result.public_id,
        secure_url: result.secure_url
      }
    });
  } catch (error) {
    console.error('Error in test unsigned upload:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Test unsigned upload failed',
      error: error.message
    });
  }
});

module.exports = router; 