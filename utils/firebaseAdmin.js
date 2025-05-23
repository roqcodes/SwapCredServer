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
    console.log('- Original key length:', privateKey?.length);
    console.log('- Contains \\n:', privateKey?.includes('\\n'));
    console.log('- Contains actual newlines:', privateKey?.includes('\n'));
    
    try {
      // If the key is JSON stringified, parse it
      if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
        try {
          privateKey = JSON.parse(privateKey);
          console.log('Successfully parsed private key from JSON string');
        } catch (e) {
          console.log('Failed to parse as JSON string, using as is');
        }
      }
      
      // Replace escaped newlines with actual newlines if they exist
      if (privateKey.includes('\\n')) {
        privateKey = privateKey.replace(/\\n/g, '\n');
        console.log('Replaced escaped newlines with actual newlines');
      }
      
      // Clean up any existing headers/footers to prevent duplication
      privateKey = privateKey
        .replace(/-----BEGIN PRIVATE KEY-----/g, '')
        .replace(/-----END PRIVATE KEY-----/g, '')
        .replace(/\n/g, '')
        .trim();
      
      // Add proper PEM format
      privateKey = [
        '-----BEGIN PRIVATE KEY-----',
        ...privateKey.match(/.{1,64}/g) || [],
        '-----END PRIVATE KEY-----'
      ].join('\n');
      
      // Ensure final newline
      if (!privateKey.endsWith('\n')) {
        privateKey += '\n';
      }
      
      console.log('Key format after processing:');
      console.log('- Starts with correct header:', privateKey.startsWith('-----BEGIN PRIVATE KEY-----'));
      console.log('- Ends with correct footer:', privateKey.endsWith('-----END PRIVATE KEY-----\n'));
      console.log('- Contains newlines:', privateKey.includes('\n'));
      console.log('- Key is properly formatted in 64-character lines');
      
    } catch (error) {
      console.error('Error processing private key:', error);
      throw new Error('Failed to process private key format');
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
    console.log('- Private Key Length:', serviceAccount.private_key.length);
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