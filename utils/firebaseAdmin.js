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
    serviceAccount = {
      "type": "service_account",
      "project_id": process.env.FIREBASE_PROJECT_ID,
      "private_key": process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      "client_email": process.env.FIREBASE_CLIENT_EMAIL
    };
  }
} catch (error) {
  console.error('Error loading service account:', error);
  process.exit(1);
}

// Initialize Firebase Admin
try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('Firebase Admin SDK initialized successfully (Firestore only)');
} catch (error) {
  console.error('Failed to initialize Firebase Admin:', error);
  process.exit(1);
}

// Only export Firestore database and admin
const db = admin.firestore();

// Export admin for utility features but not auth
module.exports = { admin, db }; 