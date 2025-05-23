const sharp = require('sharp');
const { logger } = require('./logger');

/**
 * Validates and sanitizes an uploaded image
 * This helps prevent malicious image uploads that could contain embedded code
 * 
 * @param {Buffer} buffer - Image buffer from multer
 * @param {Object} options - Validation options
 * @returns {Promise<{valid: boolean, buffer: Buffer, format: string, width: number, height: number, error: string}>}
 */
async function validateImage(buffer, options = {}) {
  const {
    maxWidth = 4000,
    maxHeight = 4000, 
    minWidth = 10,
    minHeight = 10,
    maxSizeInBytes = 5 * 1024 * 1024, // 5MB
    allowedFormats = ['jpeg', 'jpg', 'png', 'webp']
  } = options;
  
  // Check file size
  if (buffer.length > maxSizeInBytes) {
    return {
      valid: false,
      error: `Image exceeds maximum allowed size of ${maxSizeInBytes / (1024 * 1024)}MB`
    };
  }
  
  try {
    // Use sharp to analyze the image
    const metadata = await sharp(buffer).metadata();
    
    // Check image format
    const format = metadata.format.toLowerCase();
    if (!allowedFormats.includes(format)) {
      return {
        valid: false,
        error: `Unsupported image format. Allowed formats: ${allowedFormats.join(', ')}`
      };
    }
    
    // Check dimensions
    if (metadata.width > maxWidth || metadata.height > maxHeight) {
      return {
        valid: false,
        error: `Image dimensions exceed maximum allowed (${maxWidth}x${maxHeight})`
      };
    }
    
    if (metadata.width < minWidth || metadata.height < minHeight) {
      return {
        valid: false,
        error: `Image dimensions are below minimum required (${minWidth}x${minHeight})`
      };
    }
    
    // Process the image to sanitize it (removes potential embedded malicious code)
    // This re-encodes the image which removes any embedded code
    const sanitizedBuffer = await sharp(buffer)
      .toFormat(format)
      .toBuffer();
    
    return {
      valid: true,
      buffer: sanitizedBuffer,
      format,
      width: metadata.width,
      height: metadata.height
    };
    
  } catch (error) {
    logger.error('Image validation error:', {
      error: error.message,
      stack: error.stack
    });
    
    return {
      valid: false,
      error: 'Invalid image file or format'
    };
  }
}

module.exports = { validateImage };
