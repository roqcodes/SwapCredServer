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
    
    // Try to get collection reference first
    const collectionRef = db.collection(collectionName);
    
    // Basic write test to ensure permissions
    const testDoc = collectionRef.doc('_test');
    await testDoc.set({ 
      _test: true,
      _timestamp: new Date().toISOString()
    });
    await testDoc.delete();
    
    console.log(`Collection ${collectionName} is accessible`);
    return true;
  } catch (error) {
    console.error(`Error ensuring collection ${collectionName} exists:`, error);
    // Don't throw error to allow other collections to initialize
    return false;
  }
}

/**
 * Initialize all required collections for the application
 */
async function initializeCollections() {
  try {
    const requiredCollections = [
      'exchange_requests',
      'users',
      'credit_history',
      'warehouses'
    ];
    
    const results = await Promise.all(
      requiredCollections.map(collection => 
        ensureCollectionExists(collection)
        .catch(err => {
          console.error(`Failed to initialize collection ${collection}:`, err);
          return false;
        })
      )
    );
    
    const allSuccessful = results.every(result => result === true);
    if (allSuccessful) {
      console.log('All required collections initialized successfully');
    } else {
      console.warn('Some collections failed to initialize');
    }
    
    return allSuccessful;
  } catch (error) {
    console.error('Fatal error during collection initialization:', error);
    return false;
  }
}

module.exports = {
  ensureCollectionExists,
  initializeCollections
}; 