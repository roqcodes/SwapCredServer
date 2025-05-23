/**
 * Utility to ensure required Firestore collections exist
 * This prevents 404 collection not found errors
 */
const { db } = require('./firebaseAdmin');

/**
 * Ensure that a collection exists by adding a temporary document if it's empty
 * @param {string} collectionName - The name of the collection to check
 */
async function ensureCollectionExists(collectionName) {
  try {
    console.log(`Ensuring collection exists: ${collectionName}`);
    
    // Check if collection has any documents
    const snapshot = await db.collection(collectionName).limit(1).get();
    
    if (snapshot.empty) {
      console.log(`Collection ${collectionName} is empty, creating placeholder document`);
      
      // Create a temporary document with a placeholder flag
      const tempDoc = {
        _placeholder: true,
        _created: new Date(),
        _description: `Placeholder document to ensure ${collectionName} collection exists`
      };
      
      // Add document with auto-generated ID
      await db.collection(collectionName).add(tempDoc);
      console.log(`Created placeholder document in ${collectionName}`);
    } else {
      console.log(`Collection ${collectionName} already exists with data`);
    }
  } catch (error) {
    console.error(`Error ensuring collection ${collectionName} exists:`, error);
  }
}

/**
 * Initialize all required collections for the application
 */
async function initializeCollections() {
  const requiredCollections = [
    'exchange_requests',
    'users',
    'credit_history',
    'warehouses'
  ];
  
  for (const collection of requiredCollections) {
    await ensureCollectionExists(collection);
  }
  
  console.log('All required collections initialized');
}

module.exports = {
  ensureCollectionExists,
  initializeCollections
}; 