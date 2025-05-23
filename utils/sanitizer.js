/**
 * Utility for sanitizing sensitive data from logs and error messages
 */

// List of field names that should be masked in logs
const SENSITIVE_FIELDS = [
  'password',
  'token',
  'secret',
  'key',
  'authorization',
  'accessToken',
  'refreshToken',
  'apiKey',
  'api_key',
  'private_key',
  'privateKey',
  'credentials',
  'credit_card',
  'creditCard',
  'ssn',
  'social_security',
  'socialSecurity'
];

/**
 * Sanitizes sensitive data from objects for logging
 * Recursively inspects objects and masks sensitive data
 * 
 * @param {Object} data - The data to sanitize
 * @returns {Object} Sanitized copy of the data
 */
function sanitizeData(data) {
  if (!data || typeof data !== 'object') {
    return data;
  }
  
  // Handle arrays
  if (Array.isArray(data)) {
    return data.map(item => sanitizeData(item));
  }
  
  // Create a deep copy to avoid modifying the original
  const sanitized = { ...data };
  
  // Recursively sanitize each property
  for (const key in sanitized) {
    // Check if this is a sensitive field that should be masked
    const isSensitive = SENSITIVE_FIELDS.some(field => 
      key.toLowerCase().includes(field.toLowerCase())
    );
    
    if (isSensitive) {
      // Mask sensitive values based on type
      if (typeof sanitized[key] === 'string') {
        if (sanitized[key].length > 6) {
          sanitized[key] = `${sanitized[key].substring(0, 2)}***${sanitized[key].substring(sanitized[key].length - 2)}`;
        } else {
          sanitized[key] = '******';
        }
      } else if (sanitized[key] !== null && sanitized[key] !== undefined) {
        sanitized[key] = '[REDACTED]';
      }
    } 
    // Recursively sanitize nested objects
    else if (sanitized[key] && typeof sanitized[key] === 'object') {
      sanitized[key] = sanitizeData(sanitized[key]);
    }
  }
  
  return sanitized;
}

/**
 * Sanitizes email addresses for logging (partial masking)
 * 
 * @param {string} email - Email address to sanitize
 * @returns {string} Sanitized email address
 */
function sanitizeEmail(email) {
  if (!email || typeof email !== 'string') {
    return email;
  }
  
  const parts = email.split('@');
  if (parts.length !== 2) {
    return email;
  }
  
  const name = parts[0];
  const domain = parts[1];
  
  // Mask username portion of email
  let maskedName;
  if (name.length <= 2) {
    maskedName = '*'.repeat(name.length);
  } else if (name.length <= 5) {
    maskedName = name.charAt(0) + '*'.repeat(name.length - 1);
  } else {
    maskedName = name.charAt(0) + '*'.repeat(name.length - 3) + name.slice(-2);
  }
  
  return `${maskedName}@${domain}`;
}

/**
 * Sanitizes a Shopify ID or other numeric identifier
 * 
 * @param {string|number} id - ID to sanitize
 * @returns {string} Sanitized ID
 */
function sanitizeId(id) {
  if (!id) return id;
  
  const strId = String(id);
  if (strId.length <= 4) {
    return '*'.repeat(strId.length);
  }
  
  return strId.substring(0, 2) + '*'.repeat(strId.length - 4) + strId.slice(-2);
}

module.exports = {
  sanitizeData,
  sanitizeEmail,
  sanitizeId
};
