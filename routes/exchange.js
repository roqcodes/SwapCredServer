const express = require('express');
const router = express.Router();
const { db } = require('../utils/firebaseAdmin');
const { authMiddleware } = require('../middleware/auth');

/**
 * Create a new exchange request
 * @route POST /api/exchange
 * @access Authenticated users
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { uid, email } = req.user;
    const { productName, description, brand, condition, images = [] } = req.body;
    
    // Validate required fields
    if (!productName || !description || !brand || !condition) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Create new exchange request
    const exchangeRequest = {
      userId: uid,
      userEmail: email,
      productName,
      description,
      brand,
      condition,
      images, // Array of image URLs
      status: 'pending', // Initial status is 'pending'
      creditAmount: 0,
      adminFeedback: '',
      shippingDetails: null, // Will be added after approval
      transitStatus: null, // Will be set after shipping details are provided
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    // Save to Firestore
    const docRef = await db.collection('exchange_requests').add(exchangeRequest);
    
    // Return the created request with ID
    res.status(201).json({
      id: docRef.id,
      ...exchangeRequest
    });
  } catch (error) {
    console.error('Error creating exchange request:', error);
    res.status(500).json({ error: 'Failed to create exchange request' });
  }
});

/**
 * Get all exchange requests for the current user
 * @route GET /api/exchange
 * @access Authenticated users
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { uid } = req.user;
    
    let exchangeRequests = [];
    
    try {
      // First try with the composite index query
      const snapshot = await db.collection('exchange_requests')
        .where('userId', '==', uid)
        .orderBy('createdAt', 'desc')
        .get();
        
      // Format data
      exchangeRequests = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt.toDate(),
        updatedAt: doc.data().updatedAt.toDate()
      }));
    } catch (indexError) {
      console.warn('Index error, falling back to basic query:', indexError.message);
      
      // If the composite index doesn't exist yet, fallback to a basic query
      // and handle the sorting in-memory
      if (indexError.code === 9 || (indexError.message && indexError.message.includes('index'))) {
        const snapshot = await db.collection('exchange_requests')
          .where('userId', '==', uid)
          .get();
          
        // Format data and sort manually
        exchangeRequests = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt.toDate(),
          updatedAt: doc.data().updatedAt.toDate()
        }));
        
        // Sort manually in descending order by createdAt
        exchangeRequests.sort((a, b) => b.createdAt - a.createdAt);
      } else {
        // If it's not an indexing error, rethrow
        throw indexError;
      }
    }
    
    res.status(200).json(exchangeRequests);
  } catch (error) {
    console.error('Error getting exchange requests:', error);
    res.status(500).json({ error: 'Failed to get exchange requests' });
  }
});

/**
 * Get a specific exchange request by ID
 * @route GET /api/exchange/:id
 * @access Authenticated users (own requests only)
 */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { uid } = req.user;
    const { id } = req.params;
    
    // Get document
    const doc = await db.collection('exchange_requests').doc(id).get();
    
    // Check if document exists
    if (!doc.exists) {
      return res.status(404).json({ error: 'Exchange request not found' });
    }
    
    const exchangeRequest = {
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt.toDate(),
      updatedAt: doc.data().updatedAt.toDate()
    };
    
    // Check if user owns this exchange request
    if (exchangeRequest.userId !== uid) {
      return res.status(403).json({ error: 'Not authorized to access this exchange request' });
    }
    
    res.status(200).json(exchangeRequest);
  } catch (error) {
    console.error('Error getting exchange request:', error);
    res.status(500).json({ error: 'Failed to get exchange request' });
  }
});

/**
 * Update an exchange request (only if pending or approved)
 * @route PUT /api/exchange/:id
 * @access Authenticated users (own requests only)
 */
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { uid } = req.user;
    const { id } = req.params;
    const updateData = req.body;
    
    // Get document
    const docRef = db.collection('exchange_requests').doc(id);
    const doc = await docRef.get();
    
    // Check if document exists
    if (!doc.exists) {
      return res.status(404).json({ error: 'Exchange request not found' });
    }
    
    const exchangeRequest = doc.data();
    
    // Check if user owns this exchange request
    if (exchangeRequest.userId !== uid) {
      return res.status(403).json({ error: 'Not authorized to update this exchange request' });
    }
    
    // If adding shipping details, ensure the request is approved
    if (updateData.shippingDetails && exchangeRequest.status !== 'approved') {
      return res.status(400).json({ error: 'Cannot add shipping details to a request that is not approved' });
    }
    
    // Don't allow critical field changes by users
    delete updateData.status;
    delete updateData.creditAmount;
    delete updateData.adminFeedback;
    delete updateData.userId;
    delete updateData.userEmail;
    delete updateData.transitStatus;
    
    // If adding shipping details, set transit status to 'shipping'
    const updates = {
      ...updateData,
      updatedAt: new Date()
    };
    
    // If shipping details are provided, update the transit status
    if (updateData.shippingDetails) {
      updates.transitStatus = 'shipping';
    }
    
    // Update document
    await docRef.update(updates);
    
    // Get updated document
    const updatedDoc = await docRef.get();
    
    res.status(200).json({
      id,
      ...updatedDoc.data(),
      createdAt: updatedDoc.data().createdAt.toDate(),
      updatedAt: updatedDoc.data().updatedAt.toDate()
    });
  } catch (error) {
    console.error('Error updating exchange request:', error);
    res.status(500).json({ error: 'Failed to update exchange request' });
  }
});

/**
 * Submit shipping details for an approved exchange request
 * @route POST /api/exchange/:id/shipping
 * @access Authenticated users (own requests only)
 */
router.post('/:id/shipping', authMiddleware, async (req, res) => {
  try {
    const { uid } = req.user;
    const { id } = req.params;
    const { 
      carrierName, 
      trackingNumber, 
      shippingDate,
      address,
      notes 
    } = req.body;
    
    console.log(`Processing shipping details for exchange ${id}`);
    
    // Validate required fields
    if (!carrierName || !trackingNumber || !shippingDate) {
      return res.status(400).json({ error: 'Missing required shipping details' });
    }
    
    // Get document
    const docRef = db.collection('exchange_requests').doc(id);
    const doc = await docRef.get();
    
    // Check if document exists
    if (!doc.exists) {
      return res.status(404).json({ error: 'Exchange request not found' });
    }
    
    const exchangeRequest = doc.data();
    console.log(`Exchange request status: ${exchangeRequest.status}`);
    
    // Check if user owns this exchange request
    if (exchangeRequest.userId !== uid) {
      return res.status(403).json({ error: 'Not authorized to update this exchange request' });
    }
    
    // Only allow adding shipping details if request is approved
    if (exchangeRequest.status !== 'approved') {
      return res.status(400).json({ error: 'Can only add shipping details to approved exchange requests' });
    }
    
    // Create shipping details object
    const shippingDetails = {
      carrierName,
      trackingNumber,
      shippingDate: new Date(shippingDate),
      address: address || '',
      notes: notes || '',
      submittedAt: new Date()
    };
    
    console.log('Adding shipping details:', JSON.stringify(shippingDetails));
    
    // Update document with shipping details and transit status
    await docRef.update({
      shippingDetails,
      transitStatus: 'shipping',
      updatedAt: new Date()
    });
    
    console.log(`Successfully updated exchange ${id} with shipping details`);
    
    // Get updated document
    const updatedDoc = await docRef.get();
    const updatedData = updatedDoc.data();
    
    // Format dates before returning
    const formattedResponse = {
      id,
      ...updatedData,
      createdAt: updatedData.createdAt?.toDate() || new Date(),
      updatedAt: updatedData.updatedAt?.toDate() || new Date()
    };
    
    // Format shipping dates if they exist
    if (updatedData.shippingDetails) {
      formattedResponse.shippingDetails = {
        ...updatedData.shippingDetails,
        shippingDate: updatedData.shippingDetails.shippingDate?.toDate(),
        submittedAt: updatedData.shippingDetails.submittedAt?.toDate()
      };
    }
    
    res.status(200).json(formattedResponse);
  } catch (error) {
    console.error('Error adding shipping details:', error);
    res.status(500).json({ error: 'Failed to add shipping details: ' + error.message });
  }
});

/**
 * Cancel an exchange request (only if pending)
 * @route DELETE /api/exchange/:id
 * @access Authenticated users (own requests only)
 */
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { uid } = req.user;
    const { id } = req.params;
    
    // Get document
    const docRef = db.collection('exchange_requests').doc(id);
    const doc = await docRef.get();
    
    // Check if document exists
    if (!doc.exists) {
      return res.status(404).json({ error: 'Exchange request not found' });
    }
    
    const exchangeRequest = doc.data();
    
    // Check if user owns this exchange request
    if (exchangeRequest.userId !== uid) {
      return res.status(403).json({ error: 'Not authorized to delete this exchange request' });
    }
    
    // Only allow cancellation if status is pending
    if (exchangeRequest.status !== 'pending') {
      return res.status(400).json({ error: 'Cannot cancel exchange request once it has been processed' });
    }
    
    // Delete document
    await docRef.delete();
    
    res.status(200).json({ message: 'Exchange request canceled successfully' });
  } catch (error) {
    console.error('Error canceling exchange request:', error);
    res.status(500).json({ error: 'Failed to cancel exchange request' });
  }
});

module.exports = router; 