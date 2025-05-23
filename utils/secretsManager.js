const vault = require('node-vault');
const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');

// In-memory cache for secrets to avoid frequent calls to the vault
const secretsCache = new Map();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes in milliseconds

// Fallback to environment variables if vault is not available
let vaultClient = null;

/**
 * Initialize the vault client
 * @returns {Promise<Boolean>} True if vault was initialized successfully
 */
async function initializeVault() {
  try {
    // Check if Vault is enabled in environment
    if (!process.env.VAULT_ADDR) {
      logger.warn('Vault address not found in environment variables, using fallback method');
      return false;
    }

    // Initialize vault client
    vaultClient = vault({
      endpoint: process.env.VAULT_ADDR,
      token: process.env.VAULT_TOKEN
    });

    // Test the connection
    await vaultClient.status();
    logger.info('Successfully connected to Vault server');
    return true;
  } catch (error) {
    logger.error('Failed to initialize Vault client, using fallback method', {
      error: error.message
    });
    vaultClient = null;
    return false;
  }
}

/**
 * Get a secret from the vault or fallback
 * @param {string} key - The secret key to retrieve
 * @param {Object} options - Options
 * @param {boolean} options.forceFresh - If true, bypass cache and get fresh secret
 * @returns {Promise<string>} The secret value
 */
async function getSecret(key, options = {}) {
  const { forceFresh = false } = options;

  try {
    // Check cache first (unless forced fresh)
    if (!forceFresh && secretsCache.has(key)) {
      const { value, timestamp } = secretsCache.get(key);
      
      // Return cached value if not expired
      if (Date.now() - timestamp < CACHE_TTL) {
        return value;
      }
      
      // Remove expired cache entry
      secretsCache.delete(key);
    }

    // Try to get from Vault if available
    if (vaultClient) {
      try {
        // Extract path and key from the provided key
        // Format: path/to/secret:key
        let secretPath = 'swapcred';
        let secretKey = key;
        
        if (key.includes(':')) {
          const parts = key.split(':');
          secretPath = parts[0];
          secretKey = parts[1];
        }

        // Read from Vault
        const result = await vaultClient.read(`secret/data/${secretPath}`);
        
        if (result && result.data && result.data.data) {
          const secretValue = result.data.data[secretKey];
          
          // Cache the result
          secretsCache.set(key, {
            value: secretValue,
            timestamp: Date.now()
          });
          
          return secretValue;
        }
      } catch (vaultError) {
        logger.warn(`Failed to read secret ${key} from Vault, falling back to environment`, {
          error: vaultError.message
        });
      }
    }

    // Fallback to environment variable
    // Convert key format from vault style (path/to/secret:key) to env var style (PATH_TO_SECRET_KEY)
    const envKey = key.replace(/[:\/]/g, '_').toUpperCase();
    const value = process.env[envKey];

    if (value === undefined) {
      throw new Error(`Secret ${key} not found in Vault or environment variables`);
    }

    // Cache the environment value
    secretsCache.set(key, {
      value,
      timestamp: Date.now()
    });

    return value;
  } catch (error) {
    logger.error(`Error retrieving secret ${key}`, {
      error: error.message
    });
    throw error;
  }
}

// Initialize vault client in the background
(async () => {
  await initializeVault();
})();

module.exports = {
  getSecret,
  initializeVault
};
