const Joi = require('joi');
const sanitizeHtml = require('sanitize-html');

/**
 * Factory function to create a validation middleware
 * @param {Object} schema - Joi validation schema
 * @param {String} source - Request property to validate ('body', 'query', 'params')
 * @returns {Function} Express middleware function
 */
const createValidator = (schema, source = 'body') => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true,
      errors: {
        wrap: {
          label: false
        }
      }
    });

    if (error) {
      const errorDetails = error.details.map(detail => ({
        path: detail.path.join('.'),
        message: detail.message
      }));

      if (req.logger) {
        req.logger.warn('Validation error', { 
          errors: errorDetails,
          path: req.originalUrl
        });
      }

      return res.status(400).json({
        error: 'Validation Error',
        details: errorDetails
      });
    }

    // Replace the request data with the validated data
    req[source] = value;
    next();
  };
};

/**
 * Custom Joi extension for sanitizing HTML
 */
const JoiSanitized = Joi.extend(joi => {
  return {
    type: 'string',
    base: joi.string(),
    rules: {
      sanitizeHtml: {
        validate(value, helpers) {
          return sanitizeHtml(value, {
            allowedTags: [], // No HTML tags allowed
            allowedAttributes: {},
            allowedIframeHostnames: []
          });
        }
      }
    }
  };
});

// Common validation schemas
const schemas = {
  // Login validation
  login: Joi.object({
    email: Joi.string().email().trim().lowercase().required()
      .messages({
        'string.email': 'Email must be a valid email address',
        'string.empty': 'Email is required',
        'any.required': 'Email is required'
      })
  }),

  // Profile update validation
  profileUpdate: Joi.object({
    name: JoiSanitized.string().trim().min(2).max(100).sanitizeHtml()
      .messages({
        'string.min': 'Name must be at least 2 characters',
        'string.max': 'Name cannot exceed 100 characters'
      }),
    phone: Joi.string().trim().pattern(/^[0-9+\s()-]{5,20}$/).allow('').optional()
      .messages({
        'string.pattern.base': 'Phone number format is invalid'
      })
  }),

  // Exchange item creation validation
  exchangeItem: Joi.object({
    title: JoiSanitized.string().trim().min(3).max(200).required().sanitizeHtml()
      .messages({
        'string.min': 'Title must be at least 3 characters',
        'string.max': 'Title cannot exceed 200 characters',
        'any.required': 'Title is required'
      }),
    description: JoiSanitized.string().trim().min(10).max(2000).required().sanitizeHtml()
      .messages({
        'string.min': 'Description must be at least 10 characters',
        'string.max': 'Description cannot exceed 2000 characters',
        'any.required': 'Description is required'
      }),
    condition: Joi.string().valid('new', 'likenew', 'good', 'fair', 'poor').required()
      .messages({
        'any.only': 'Condition must be one of: new, likenew, good, fair, poor',
        'any.required': 'Condition is required'
      }),
    category: Joi.string().valid(
      'printer', 'scanner', 'copier', 'plotter',
      'parts', 'cartridge', 'paper', 'other'
    ).required()
      .messages({
        'any.only': 'Category is invalid',
        'any.required': 'Category is required'
      }),
    images: Joi.array().items(
      Joi.object({
        url: Joi.string().uri().required(),
        publicId: Joi.string().required()
      })
    ).min(1).required()
      .messages({
        'array.min': 'At least one image is required',
        'any.required': 'Images are required'
      }),
    price: Joi.number().positive().max(1000000).required()
      .messages({
        'number.base': 'Price must be a number',
        'number.positive': 'Price must be positive',
        'number.max': 'Price cannot exceed 1,000,000',
        'any.required': 'Price is required'
      }),
    location: JoiSanitized.string().trim().min(2).max(200).required().sanitizeHtml()
      .messages({
        'string.min': 'Location must be at least 2 characters',
        'string.max': 'Location cannot exceed 200 characters',
        'any.required': 'Location is required'
      })
  }),

  // ID parameter validation
  idParam: Joi.object({
    id: Joi.string().trim().required()
      .messages({
        'string.empty': 'ID is required',
        'any.required': 'ID is required'
      })
  }),

  // Email verification validation
  emailVerification: Joi.object({
    email: Joi.string().email().trim().lowercase().required(),
    token: Joi.string().trim().required()
  })
};

module.exports = {
  validate: createValidator,
  schemas
};
