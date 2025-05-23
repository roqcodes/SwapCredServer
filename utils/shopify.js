const axios = require('axios');
const path = require('path');
const { logger } = require('./logger');
const { getSecret } = require('./secretsManager');
const { sanitizeId, sanitizeEmail } = require('./sanitizer');

// Initialize credentials - these will be loaded lazily when needed
let SHOP_URL = null;
let ACCESS_TOKEN = null;

/**
 * Initialize Shopify configuration by loading secrets
 * @returns {Promise<void>}
 */
async function initializeShopifyConfig() {
  try {
    SHOP_URL = await getSecret('shopify:store_url');
    ACCESS_TOKEN = await getSecret('shopify:access_token');
    
    logger.info('Shopify configuration initialized successfully');
    return { SHOP_URL, ACCESS_TOKEN };
  } catch (error) {
    logger.error('Failed to initialize Shopify configuration', {
      error: error.message
    });
    
    // Fallback to environment variables for backward compatibility
    logger.warn('Falling back to environment variables for Shopify credentials');
    SHOP_URL = process.env.SHOPIFY_STORE_URL;
    ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
    
    return { SHOP_URL, ACCESS_TOKEN };
  }
}

// Initialize in the background
(async () => {
  await initializeShopifyConfig();
})();

// Common error types for standardized handling
const ShopifyErrorTypes = {
  CUSTOMER_NOT_FOUND: 'SHOPIFY_CUSTOMER_NOT_FOUND',
  API_ERROR: 'SHOPIFY_API_ERROR',
  RATE_LIMIT: 'SHOPIFY_RATE_LIMIT',
  AUTHENTICATION: 'SHOPIFY_AUTHENTICATION_ERROR',
  NOT_FOUND: 'SHOPIFY_RESOURCE_NOT_FOUND',
  VALIDATION: 'SHOPIFY_VALIDATION_ERROR'
};

// Simple in-memory cache for customer lookups to prevent duplicate API calls
// Cache structure: { email => { timestamp, data } }
const customerCache = new Map();
const CACHE_TTL = 60 * 1000; // 60 seconds in milliseconds

// Base Shopify Admin API URL
const API_VERSION = '2023-07';

/**
 * Get the base URL for Shopify API calls
 * @returns {string} Base URL
 */
function getBaseUrl() {
  if (!SHOP_URL) {
    throw new Error('Shopify store URL not initialized');
  }
  return `${SHOP_URL}/admin/api/${API_VERSION}`;
}

/**
 * Get headers for Shopify API requests
 * @returns {Object} Headers object
 */
function getHeaders() {
  if (!ACCESS_TOKEN) {
    throw new Error('Shopify access token not initialized');
  }
  
  return {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': ACCESS_TOKEN
  };
};

/**
 * Standardized error handler for Shopify API errors
 * @param {Error} error - The caught error
 * @param {string} operation - Description of the operation being performed
 * @param {Object} context - Additional context about the error
 * @throws {Error} Standardized error object
 */
function handleShopifyError(error, operation, context = {}) {
  // Default error object
  const shopifyError = new Error(`Shopify ${operation} failed`);
  
  // Add standardized properties
  shopifyError.isShopifyError = true;
  shopifyError.operation = operation;
  shopifyError.originalError = error;
  
  // Process based on error type
  if (error.response) {
    const status = error.response.status;
    const data = error.response.data;
    
    shopifyError.statusCode = status;
    shopifyError.responseData = data;
    
    // Map HTTP status to error type
    if (status === 404) {
      shopifyError.code = ShopifyErrorTypes.NOT_FOUND;
      shopifyError.message = `Resource not found: ${operation}`;
    } else if (status === 401 || status === 403) {
      shopifyError.code = ShopifyErrorTypes.AUTHENTICATION;
      shopifyError.message = 'Authentication or permission error';
    } else if (status === 422) {
      shopifyError.code = ShopifyErrorTypes.VALIDATION;
      shopifyError.message = data.errors || 'Validation error';
    } else if (status === 429) {
      shopifyError.code = ShopifyErrorTypes.RATE_LIMIT;
      shopifyError.message = 'Rate limit exceeded';
    } else {
      shopifyError.code = ShopifyErrorTypes.API_ERROR;
    }
    
    // Log the error with sanitized context
    logger.error(`Shopify ${operation} error: ${shopifyError.message}`, {
      code: shopifyError.code,
      status,
      ...context
    });
  } else {
    // Network or other errors
    shopifyError.code = ShopifyErrorTypes.API_ERROR;
    shopifyError.message = error.message || 'Unknown Shopify API error';
    
    logger.error(`Shopify ${operation} network error: ${error.message}`, {
      code: shopifyError.code,
      ...context
    });
  }
  
  throw shopifyError;
}

/**
 * Search for customer by email
 * @param {string} email - Customer email
 * @param {Object} [options] - Optional parameters
 * @param {Object} [options.requestLogger] - Request-specific logger
 * @param {boolean} [options.bypassCache=false] - If true, bypass cache and force a fresh lookup
 * @returns {Promise<Object|null>} Customer data or null if not found
 */
async function findCustomerByEmail(email, options = {}) {
  const { requestLogger, bypassCache = false } = options;
  const log = requestLogger || logger; // Use request logger if provided, otherwise use global logger

  try {
    // Check cache first (unless bypass is requested)
    if (!bypassCache && customerCache.has(email)) {
      const cached = customerCache.get(email);
      const now = Date.now();
      
      // If cache is still valid
      if (now - cached.timestamp < CACHE_TTL) {
        log.info(`Using cached Shopify customer data for ${email}`, { cached: true });
        return cached.data;
      } else {
        // Cache expired, remove it
        customerCache.delete(email);
        log.debug(`Cache expired for customer ${email}`);
      }
    }

    // No valid cache found, make API call
    if (requestLogger) {
      requestLogger.shopify(email);
      requestLogger.api('Shopify', 'customers/search', { email });
    } else {
      log.info(`Looking up Shopify customer`, { email });
    }

    const response = await axios.get(
      `${getBaseUrl()}/customers/search.json`,
      { 
        headers: getHeaders(),
        params: { query: `email:${email}` }
      }
    );
    
    if (response.data.customers && response.data.customers.length > 0) {
      const customer = response.data.customers[0];
      log.info(`Found Shopify customer for ${email}`, { 
        customerId: customer.id,
        customerEmail: customer.email
      });
      
      // Save to cache
      customerCache.set(email, {
        timestamp: Date.now(),
        data: customer
      });
      
      return customer;
    }
    
    // Customer not found with this email
    log.warn(`No Shopify customer found with email ${email}`);
    const error = new Error(`Shopify customer with email ${email} not found`);
    error.code = ShopifyErrorTypes.CUSTOMER_NOT_FOUND;
    error.email = sanitizeEmail(email);
    
    // Log the not found error
    log.warn(`Customer not found in Shopify`, {
      email: sanitizeEmail(email),
      code: error.code
    });
    
    throw error;
  } catch (error) {
    // Handle specific case for non-existent customers
    if (error.response && error.response.status === 404) {
      const notFoundError = new Error(`Shopify customer with email ${email} not found`);
      notFoundError.code = ShopifyErrorTypes.CUSTOMER_NOT_FOUND;
      notFoundError.email = sanitizeEmail(email);
      
      // Log the not found error
      log.warn(`Customer not found in Shopify`, {
        email: sanitizeEmail(email),
        code: notFoundError.code
      });
      
      throw notFoundError;
    }
    
    // For other errors, use the standard handler
    handleShopifyError(error, 'customer lookup', { 
      email: sanitizeEmail(email),
      operation: 'findCustomerByEmail'
    });
  }
};

/**
 * Update customer metafields
 * @param {number|string} customerId - Shopify customer ID
 * @param {number} creditAmount - Credit amount to add
 * @returns {Promise<Object>} Updated metafield data
 */
async function updateCustomerCredit(customerId, creditAmount) {
  try {
    // Format credit amount to 2 decimal places
    const formattedAmount = Number(creditAmount).toFixed(2);
    
    // Ensure customerId is a string
    const customerIdStr = String(customerId);

    // First check if the metafield exists
    const metafieldsResponse = await axios.get(
      `${getBaseUrl()}/customers/${customerIdStr}/metafields.json`,
      { headers: getHeaders() }
    );
    
    let metafieldId = null;
    let currentCredit = 0;
    
    if (metafieldsResponse.data.metafields) {
      const existingMetafield = metafieldsResponse.data.metafields.find(
        m => m.namespace === 'loyalty' && m.key === 'points'
      );
      if (existingMetafield) {
        metafieldId = existingMetafield.id;
        currentCredit = parseFloat(existingMetafield.value) || 0;
        console.log(`Found existing credit: ₹${currentCredit}, adding ₹${formattedAmount}`);
      }
    }

    // Calculate new total credit by adding to existing credit
    const newTotalCredit = (currentCredit + parseFloat(formattedAmount)).toFixed(2);
    console.log(`New total credit: ₹${newTotalCredit}`);

    // If metafield exists, update it. Otherwise, create new one
    if (metafieldId) {
      const response = await axios.put(
        `${getBaseUrl()}/customers/${customerIdStr}/metafields/${metafieldId}.json`,
        {
          metafield: {
            id: metafieldId,
            value: newTotalCredit.toString(),
            type: "number_decimal",
            value_type: 'string'
          }
        },
        { headers: getHeaders() }
      );
      return response.data.metafield;
    } else {
      const response = await axios.post(
        `${getBaseUrl()}/customers/${customerIdStr}/metafields.json`,
        {
          metafield: {
            namespace: 'loyalty',
            key: 'points',
            value: newTotalCredit.toString(),
            type: "number_decimal",
            value_type: 'string',
            description: 'Store credit from SwapCred exchanges (INR)'
          }
        },
        { headers: getHeaders() }
      );
      return response.data.metafield;
    }
  } catch (error) {
    handleShopifyError(error, 'update customer credit', { 
      customerId: sanitizeId(customerId),
      operation: 'updateCustomerCredit'
    });
  }
};

/**
 * Get customer credit amount
 * @param {number|string} customerIdOrEmail - Shopify customer ID or email
 * @returns {Promise<{amount: number, currency: string}>} Credit amount and currency
 */
async function getCustomerCredit(customerIdOrEmail) {
  try {
    let customerId = customerIdOrEmail;
    
    // If an email is provided, find the customer first
    if (typeof customerIdOrEmail === 'string' && customerIdOrEmail.includes('@')) {
      try {
        const customer = await findCustomerByEmail(customerIdOrEmail);
        if (!customer) {
          const error = new Error(`No Shopify account found for ${customerIdOrEmail}`);
          error.code = ShopifyErrorTypes.CUSTOMER_NOT_FOUND;
          error.email = customerIdOrEmail;
          throw error;
        }
        customerId = customer.id;
      } catch (error) {
        if (error.code === ShopifyErrorTypes.CUSTOMER_NOT_FOUND) {
          // This is a known error, just return 0 credit with error info
          return { 
            amount: 0, 
            currency: 'INR',
            error: error.message,
            code: error.code,
            email: error.email
          };
        }
        throw error; // re-throw other errors
      }
    }
    
    // Ensure customerId is a string
    const customerIdStr = String(customerId);
    
    // Get the metafields for the customer
    const response = await axios.get(
      `${getBaseUrl()}/customers/${customerIdStr}/metafields.json`,
      { 
        headers: getHeaders(),
        params: {
          namespace: 'loyalty',
          key: 'points'
        }
      }
    );
    
    if (response.data.metafields && response.data.metafields.length > 0) {
      return {
        amount: parseFloat(response.data.metafields[0].value) || 0,
        currency: 'INR'
      };
    }
    return { amount: 0, currency: 'INR' };
  } catch (error) {
    handleShopifyError(error, 'get customer credit', { 
      customerId: sanitizeId(customerIdOrEmail),
      operation: 'getCustomerCredit'
    });
  }
};

/**
 * Update customer store credit using the Shopify GraphQL API
 * This will show up properly in Shopify admin if the API version and plan support it
 * @param {string|number} customerId - Shopify customer ID
 * @param {number} creditAmount - Credit amount to add
 * @returns {Promise<Object>} Updated store credit data
 */
async function updateStoreCreditAccount(customerId, creditAmount) {
  try {
    // Ensure customerId is a string
    const customerIdStr = String(customerId);
    
    console.log(`Updating store credit for customer ${customerIdStr} by adding ₹${creditAmount}`);
    
    // Format credit amount to 2 decimal places
    const formattedAmount = Number(creditAmount).toFixed(2);
    
    // First query to check if the feature is available
    const featureQuery = `
      {
        __type(name: "CustomerCreditInput") {
          name
          inputFields {
            name
          }
        }
      }
    `;

    // Execute feature detection query
    const featureResponse = await axios.post(
      `${getBaseUrl()}/graphql.json`,
      { query: featureQuery },
      { headers: getHeaders() }
    );

    // Check if the type exists in the schema
    const typeExists = featureResponse.data?.data?.__type?.name === 'CustomerCreditInput';
    
    if (!typeExists) {
      console.log('Store Credit API not available in your Shopify version or plan. Using legacy approach only.');
      throw new Error('Store Credit API not available');
    }

    // Construct the GraphQL mutation
    // This uses the newer CustomerCreditCreate mutation that is more widely available
    const mutation = `
      mutation customerCreditCreate($input: CustomerCreditInput!) {
        customerCreditCreate(input: $input) {
          customerCredit {
            id
            amount {
              amount
              currencyCode
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      input: {
        customerId: customerIdStr.includes('gid://') ? customerIdStr : `gid://shopify/Customer/${customerIdStr}`,
        amount: {
          amount: formattedAmount,
          currencyCode: 'INR'
        },
        reason: 'SwapCred Exchange Credit'
      }
    };

    // Execute the mutation
    const response = await axios.post(
      `${getBaseUrl()}/graphql.json`,
      { query: mutation, variables },
      { headers: getHeaders() }
    );

    if (response.data.errors) {
      console.log('GraphQL API Error Details:', JSON.stringify(response.data.errors, null, 2));
      throw new Error(`GraphQL Error: ${JSON.stringify(response.data.errors)}`);
    }

    const result = response.data.data.customerCreditCreate;
    if (result.userErrors && result.userErrors.length > 0) {
      throw new Error(`Store Credit Update Error: ${JSON.stringify(result.userErrors)}`);
    }

    return {
      id: result.customerCredit.id,
      amount: result.customerCredit.amount,
      balance: {
        amount: result.customerCredit.amount.amount,
        currencyCode: result.customerCredit.amount.currencyCode
      }
    };
  } catch (error) {
    handleShopifyError(error, 'update store credit account', { 
      customerId: sanitizeId(customerId),
      operation: 'updateStoreCreditAccount'
    });
  }
};

/**
 * Update customer loyalty points using custom metafield
 * @param {number|string} customerId - Shopify customer ID
 * @param {number} points - Loyalty points to add
 * @returns {Promise<Object>} Updated metafield data
 */
async function updateCustomerLoyaltyPoints(customerId, points) {
  try {
    // Format points amount as an integer by rounding to whole number
    const formattedPoints = Math.round(Number(points));
    
    // Ensure customerId is a string
    const customerIdStr = String(customerId);

    // First check if the metafield exists
    const metafieldsResponse = await axios.get(
      `${getBaseUrl()}/customers/${customerIdStr}/metafields.json`,
      { headers: getHeaders() }
    );
    
    let metafieldId = null;
    let currentPoints = 0;
    
    if (metafieldsResponse.data.metafields) {
      const existingMetafield = metafieldsResponse.data.metafields.find(
        m => m.namespace === 'loyalty' && m.key === 'points'
      );
      if (existingMetafield) {
        metafieldId = existingMetafield.id;
        currentPoints = parseInt(existingMetafield.value) || 0;
        console.log(`Found existing loyalty points: ${currentPoints}, adding ${formattedPoints}`);
      }
    }

    // Calculate new total points by adding to existing points - ensure it's an integer
    const newTotalPoints = currentPoints + formattedPoints;
    console.log(`New total loyalty points: ${newTotalPoints}`);

    // If metafield exists, update it. Otherwise, create new one
    if (metafieldId) {
      const response = await axios.put(
        `${getBaseUrl()}/customers/${customerIdStr}/metafields/${metafieldId}.json`,
        {
          metafield: {
            id: metafieldId,
            value: newTotalPoints.toString(),
            type: "number_integer",
            value_type: 'string'
          }
        },
        { headers: getHeaders() }
      );
      return response.data.metafield;
    } else {
      const response = await axios.post(
        `${getBaseUrl()}/customers/${customerIdStr}/metafields.json`,
        {
          metafield: {
            namespace: 'loyalty',
            key: 'points',
            value: newTotalPoints.toString(),
            type: "number_integer",
            value_type: 'string',
            description: 'Loyalty points from SwapCred exchanges'
          }
        },
        { headers: getHeaders() }
      );
      return response.data.metafield;
    }
  } catch (error) {
    handleShopifyError(error, 'update customer loyalty points', { 
      customerId: sanitizeId(customerId),
      operation: 'updateCustomerLoyaltyPoints'
    });
  }
};

/**
 * Get customer loyalty points amount
 * @param {number|string} customerIdOrEmail - Shopify customer ID or email
 * @returns {Promise<{amount: number, currency: string}>} Loyalty points amount and currency
 */
async function getCustomerLoyaltyPoints(customerIdOrEmail) {
  try {
    let customerId = customerIdOrEmail;
    
    // If an email is provided, find the customer first
    if (typeof customerIdOrEmail === 'string' && customerIdOrEmail.includes('@')) {
      try {
        const customer = await findCustomerByEmail(customerIdOrEmail);
        if (!customer) {
          const error = new Error(`No Shopify account found for ${customerIdOrEmail}`);
          error.code = ShopifyErrorTypes.CUSTOMER_NOT_FOUND;
          error.email = customerIdOrEmail;
          throw error;
        }
        customerId = customer.id;
      } catch (error) {
        if (error.code === ShopifyErrorTypes.CUSTOMER_NOT_FOUND) {
          // This is a known error, just return 0 points with error info
          return { 
            amount: 0, 
            currency: 'INR',
            error: error.message,
            code: error.code,
            email: error.email
          };
        }
        throw error; // re-throw other errors
      }
    }
    
    // Ensure customerId is a string
    const customerIdStr = String(customerId);
    
    // Get the metafields for the customer
    const response = await axios.get(
      `${getBaseUrl()}/customers/${customerIdStr}/metafields.json`,
      { 
        headers: getHeaders(),
        params: {
          namespace: 'loyalty',
          key: 'points'
        }
      }
    );
    
    if (response.data.metafields && response.data.metafields.length > 0) {
      return {
        amount: parseInt(response.data.metafields[0].value) || 0,
        currency: 'INR'
      };
    }
    return { amount: 0, currency: 'INR' };
  } catch (error) {
    handleShopifyError(error, 'get customer loyalty points', { 
      customerId: sanitizeId(customerIdOrEmail),
      operation: 'getCustomerLoyaltyPoints'
    });
  }
};

module.exports = {
  findCustomerByEmail,
  updateCustomerCredit,
  getCustomerCredit,
  updateStoreCreditAccount,
  updateCustomerLoyaltyPoints,
  getCustomerLoyaltyPoints,
  ShopifyErrorTypes,
  initializeShopifyConfig
};