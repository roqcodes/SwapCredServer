const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

let serviceAccount;
try {
  // Try to load service account file
  const serviceAccountPath = path.join(__dirname, '../../firebase-service-account.json');
  if (fs.existsSync(serviceAccountPath)) {
    serviceAccount = require(serviceAccountPath);
    console.log('Loaded Firebase service account from file');
  } else {
    console.log('Service account file not found, using environment variables');
    
    if (!process.env.FIREBASE_PRIVATE_KEY || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PROJECT_ID) {
      throw new Error('Missing required Firebase configuration. Please set FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL, and FIREBASE_PROJECT_ID environment variables');
    }

    // Handle the private key string properly
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;
    
    // Debug logging (without exposing the key)
    console.log('Private key format check:');
    console.log('- Starts with correct header:', privateKey.startsWith('-----BEGIN PRIVATE KEY-----'));
    console.log('- Ends with correct footer:', privateKey.endsWith('-----END PRIVATE KEY-----'));
    
    // Remove any quotes from the start and end if present
    privateKey = privateKey.replace(/^["']|["']$/g, '');
    
    // Ensure proper line breaks
    if (!privateKey.includes('\n')) {
      // If no actual line breaks, try to fix the format
      privateKey = privateKey
        .replace(/\\n/g, '\n') // Replace \n string with actual line breaks
        .replace(/-----BEGIN PRIVATE KEY-----/, '-----BEGIN PRIVATE KEY-----\n') // Ensure break after header
        .replace(/-----END PRIVATE KEY-----/, '\n-----END PRIVATE KEY-----\n'); // Ensure breaks around footer
    }
    
    // Verify the key format
    if (!privateKey.includes('-----BEGIN PRIVATE KEY-----') || !privateKey.includes('-----END PRIVATE KEY-----')) {
      throw new Error('Invalid private key format: Missing header or footer');
    }
    
    serviceAccount = {
      "type": "service_account",
      "project_id": process.env.FIREBASE_PROJECT_ID,
      "private_key": privateKey,
      "client_email": process.env.FIREBASE_CLIENT_EMAIL
    };

    // Debug logging of the final structure (without exposing the key)
    console.log('Service account configuration:');
    console.log('- Project ID:', serviceAccount.project_id);
    console.log('- Client Email:', serviceAccount.client_email);
    console.log('- Private Key Format Valid:', 
      serviceAccount.private_key.includes('-----BEGIN PRIVATE KEY-----') && 
      serviceAccount.private_key.includes('-----END PRIVATE KEY-----'));
  }
} catch (error) {
  console.error('Error loading service account:', error);
  console.error('Details:', error.message);
  process.exit(1);
}

// Initialize Firebase Admin
try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('Firebase Admin SDK initialized successfully');
} catch (error) {
  console.error('Failed to initialize Firebase Admin:', error);
  console.error('Details:', error.message);
  process.exit(1);
}

// Only export Firestore database and admin
const db = admin.firestore();

// Export admin for utility features but not auth
module.exports = { admin, db }; 