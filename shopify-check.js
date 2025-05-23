require('dotenv').config({ path: '../.env' });
const fs = require('fs');
const path = require('path');

console.log('=== SHOPIFY CONFIGURATION CHECK ===');

// Check environment variables
console.log('\n1. Checking environment variables...');
console.log(`SHOPIFY_STORE_URL: ${process.env.SHOPIFY_STORE_URL || 'NOT SET'}`);
console.log(`SHOPIFY_ACCESS_TOKEN: ${process.env.SHOPIFY_ACCESS_TOKEN ? '*****' + process.env.SHOPIFY_ACCESS_TOKEN.slice(-4) : 'NOT SET'}`);

// Check .env file
console.log('\n2. Checking .env file...');
const envPath = path.resolve(__dirname, '../.env');

try {
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    console.log('✓ .env file exists');
    
    // Check for Shopify variables in .env file (without exposing values)
    const hasShopifyStoreUrl = /SHOPIFY_STORE_URL\s*=/.test(envContent);
    const hasShopifyToken = /SHOPIFY_ACCESS_TOKEN\s*=/.test(envContent);
    
    console.log(`SHOPIFY_STORE_URL in .env: ${hasShopifyStoreUrl ? 'YES' : 'NO'}`);
    console.log(`SHOPIFY_ACCESS_TOKEN in .env: ${hasShopifyToken ? 'YES' : 'NO'}`);
  } else {
    console.log('✗ .env file not found at:', envPath);
  }
} catch (error) {
  console.error('Error checking .env file:', error.message);
}

// Check for correct Shopify store URL format
console.log('\n3. Validating Shopify store URL format...');
const storeUrl = process.env.SHOPIFY_STORE_URL;

if (!storeUrl) {
  console.log('✗ SHOPIFY_STORE_URL is not set');
} else {
  // Normalize URL for checking
  let normalizedUrl = storeUrl;
  if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
    normalizedUrl = `https://${normalizedUrl}`;
  }
  
  try {
    const url = new URL(normalizedUrl);
    console.log('✓ URL format is valid');
    console.log(`Hostname: ${url.hostname}`);
    
    if (!url.hostname.includes('myshopify.com')) {
      console.log('⚠️ Warning: URL does not contain myshopify.com - should use your myshopify domain');
    }
    
    if (url.pathname !== '/' && url.pathname !== '') {
      console.log('⚠️ Warning: URL should not include paths, just the domain name');
    }
  } catch (error) {
    console.log('✗ URL format is invalid:', error.message);
  }
}

console.log('\nRECOMMENDED FORMAT:');
console.log('SHOPIFY_STORE_URL=your-store.myshopify.com');
console.log('SHOPIFY_ACCESS_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxx');

console.log('\nIMPORTANT: If these values are not correct, update your .env file and restart the server.'); 