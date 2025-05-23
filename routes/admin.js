const express = require('express');
const router = express.Router();
const { db, admin } = require('../utils/firebaseAdmin');
const { findCustomerByEmail, updateCustomerLoyaltyPoints } = require('../utils/shopify');
const { authMiddleware } = require('../middleware/auth');
const { adminMiddleware } = require('../middleware/admin');
const { sendApprovalEmail, sendCreditAssignedEmail } = require('../utils/email');

/**
 * Get all exchange requests (for admin)
 * @route GET /api/admin/exchange-requests
 * @access Admin only
 */
router.get('/exchange-requests', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { limit = 100 } = req.query;
    
    // Get all exchange requests sorted by date without filtering
    // This allows client-side filtering for better UX
    let query = db.collection('exchange_requests').orderBy('createdAt', 'desc');
    
    if (limit) {
      query = query.limit(parseInt(limit));
    }
    
    const snapshot = await query.get();
    
    // Format data efficiently
    const exchangeRequests = snapshot.docs.map(doc => {
      const data = doc.data();
      const formatted = {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date()
      };
      
      // Only transform shipping details if they exist
      if (data.shippingDetails) {
        formatted.shippingDetails = {
          ...data.shippingDetails,
          shippingDate: data.shippingDetails.shippingDate?.toDate(),
          submittedAt: data.shippingDetails.submittedAt?.toDate()
        };
      }
      
      return formatted;
    });
    
    res.status(200).json(exchangeRequests);
  } catch (error) {
    console.error('Error getting exchange requests:', error);
    res.status(500).json({ error: 'Failed to get exchange requests' });
  }
});

/**
 * Get a specific exchange request by ID (for admin)
 * @route GET /api/admin/exchange-requests/:id
 * @access Admin only
 */
router.get('/exchange-requests/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get document
    const doc = await db.collection('exchange_requests').doc(id).get();
    
    // Check if document exists
    if (!doc.exists) {
      return res.status(404).json({ error: 'Exchange request not found' });
    }
    
    const data = doc.data();
    const exchangeRequest = {
      id: doc.id,
      ...data,
      createdAt: data.createdAt?.toDate() || new Date(),
      updatedAt: data.updatedAt?.toDate() || new Date()
    };
    
    // Only format shipping details if they exist
    if (data.shippingDetails) {
      exchangeRequest.shippingDetails = {
        ...data.shippingDetails,
        shippingDate: data.shippingDetails.shippingDate?.toDate(),
        submittedAt: data.shippingDetails.submittedAt?.toDate()
      };
    }
    
    res.status(200).json(exchangeRequest);
  } catch (error) {
    console.error('Error getting exchange request:', error);
    res.status(500).json({ error: 'Failed to get exchange request' });
  }
});

/**
 * Update exchange request status (approve/decline/complete)
 * @route PUT /api/admin/exchange-requests/:id/status
 * @access Admin only
 */
router.put('/exchange-requests/:id/status', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminFeedback, warehouseId } = req.body;
    
    if (!status || !['approved', 'declined', 'completed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status value. Must be "approved", "declined" or "completed"' });
    }
    
    // Get document reference
    const docRef = db.collection('exchange_requests').doc(id);
    const doc = await docRef.get();
    
    // Check if document exists
    if (!doc.exists) {
      return res.status(404).json({ error: 'Exchange request not found' });
    }
    
    const exchangeRequest = doc.data();
    
    // Special validation rules based on status
    if (status === 'approved' && exchangeRequest.status !== 'pending') {
      return res.status(400).json({ error: 'Can only approve pending exchange requests' });
    }
    
    if (status === 'completed' && exchangeRequest.status !== 'approved') {
      return res.status(400).json({ error: 'Can only complete approved exchange requests' });
    }
    
    if (status === 'completed' && (!exchangeRequest.creditAmount || exchangeRequest.creditAmount <= 0)) {
      return res.status(400).json({ error: 'Cannot complete exchange request without assigning credit' });
    }
    
    // Validate warehouse selection for approval
    if (status === 'approved' && !warehouseId) {
      return res.status(400).json({ error: 'Warehouse selection is required for approval' });
    }
    
    // Update document with new status
    const updates = {
      status,
      adminFeedback: adminFeedback ? 
        `${exchangeRequest.adminFeedback || ''}\n${adminFeedback}`.trim() : 
        exchangeRequest.adminFeedback,
      updatedAt: new Date()
    };
    
    // Add warehouse information when approving
    if (status === 'approved' && warehouseId) {
      // Get warehouse information
      const warehouseDoc = await db.collection('warehouses').doc(warehouseId).get();
      
      if (!warehouseDoc.exists) {
        return res.status(404).json({ error: 'Selected warehouse not found' });
      }
      
      const warehouseData = warehouseDoc.data();
      
      // Store the warehouse information with the exchange request
      updates.warehouseId = warehouseId;
      updates.warehouseInfo = {
        name: warehouseData.name,
        addressLine1: warehouseData.addressLine1,
        addressLine2: warehouseData.addressLine2 || '',
        city: warehouseData.city,
        state: warehouseData.state,
        postalCode: warehouseData.postalCode,
        country: warehouseData.country,
        contactPerson: warehouseData.contactPerson || '',
        contactPhone: warehouseData.contactPhone || ''
      };
    }
    
    // Set transit status to completed when the entire exchange is completed
    if (status === 'completed') {
      updates.transitStatus = 'completed';
    }
    
    await docRef.update(updates);
    
    // Send notifications based on status
    if (status === 'approved') {
      try {
        // Send approval email with warehouse information
        const updatedExchangeData = {
          ...exchangeRequest,
          ...updates
        };
        await sendApprovalEmail(exchangeRequest.userEmail, updatedExchangeData);
        console.log(`Email sent to ${exchangeRequest.userEmail} about exchange approval`);
      } catch (emailError) {
        console.error('Error sending approval email:', emailError);
        // Don't stop the process if email fails
      }
    }
    
    // Get updated document
    const updatedDoc = await docRef.get();
    const updatedData = updatedDoc.data();
    
    // Format the response
    const response = {
      id,
      ...updatedData,
      createdAt: updatedData.createdAt?.toDate() || new Date(),
      updatedAt: updatedData.updatedAt?.toDate() || new Date()
    };
    
    // Only format shipping details if they exist
    if (updatedData.shippingDetails) {
      response.shippingDetails = {
        ...updatedData.shippingDetails,
        shippingDate: updatedData.shippingDetails.shippingDate?.toDate(),
        submittedAt: updatedData.shippingDetails.submittedAt?.toDate()
      };
    }
    
    res.status(200).json(response);
  } catch (error) {
    console.error('Error updating exchange request status:', error);
    res.status(500).json({ error: 'Failed to update exchange request status' });
  }
});

/**
 * Update exchange request transit status
 * @route PUT /api/admin/exchange-requests/:id/transit
 * @access Admin only
 */
router.put('/exchange-requests/:id/transit', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { transitStatus, adminNote } = req.body;
    
    // Validate transit status
    if (!transitStatus || !['shipping', 'received', 'completed'].includes(transitStatus)) {
      return res.status(400).json({ 
        error: 'Invalid transit status. Must be "shipping", "received", or "completed"' 
      });
    }
    
    // Get document reference
    const docRef = db.collection('exchange_requests').doc(id);
    const doc = await docRef.get();
    
    // Check if document exists
    if (!doc.exists) {
      return res.status(404).json({ error: 'Exchange request not found' });
    }
    
    const exchangeRequest = doc.data();
    
    // Basic validation - must be an approved request
    if (exchangeRequest.status !== 'approved') {
      return res.status(400).json({ error: 'Can only update transit status for approved exchange requests' });
    }
    
    // Validate shipping details for received status
    if (transitStatus === 'received' && !exchangeRequest.shippingDetails) {
      return res.status(400).json({ error: 'Cannot mark as received without shipping details' });
    }
    
    // Simple validation for status progression
    if (transitStatus === 'received' && exchangeRequest.transitStatus !== 'shipping') {
      // Change this validation to allow transitioning from any state to received
      // as long as shipping details exist
      if (!exchangeRequest.shippingDetails) {
        return res.status(400).json({ error: 'Item must have shipping details before it can be received' });
      }
    }
    
    if (transitStatus === 'completed' && (!exchangeRequest.creditAmount || exchangeRequest.creditAmount <= 0)) {
      return res.status(400).json({ error: 'Cannot complete exchange without assigning credit' });
    }
    
    // Update the transit status
    const updates = {
      transitStatus,
      updatedAt: new Date()
    };
    
    // Add admin note if provided
    if (adminNote) {
      updates.adminFeedback = `${exchangeRequest.adminFeedback || ''}\n${adminNote}`.trim();
    }
    
    // If transit status is completed, also update the overall status
    if (transitStatus === 'completed') {
      updates.status = 'completed';
    }
    
    await docRef.update(updates);
    
    // Send notifications based on transit status
    const emailSubjects = {
      'received': 'Your item has been received',
      'completed': 'Your exchange process is now complete'
    };
    
    if (emailSubjects[transitStatus]) {
      try {
        // Create simple plain text notification for receipt confirmation
        if (transitStatus === 'received') {
          const text = `We have received your item at our warehouse. Our team will inspect it and assign credit to your account soon. Thank you for your patience.`;
          const html = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #4CAF50;">Item Received</h2>
              <p>We have received your item at our warehouse.</p>
              <p>Our team will inspect it and assign credit to your account soon.</p>
              <p>Thank you for your patience.</p>
              <hr>
              <p style="font-size: 12px; color: #777;">This is an automated message from SwapCred.</p>
            </div>
          `;
          await require('../utils/email').sendEmail(
            exchangeRequest.userEmail, 
            emailSubjects[transitStatus], 
            html, 
            text
          );
        }
      } catch (emailError) {
        console.error(`Error sending ${transitStatus} email:`, emailError);
        // Don't stop the process if email fails
      }
    }
    
    // Get updated document
    const updatedDoc = await docRef.get();
    const updatedData = updatedDoc.data();
    
    // Format the response
    const response = {
      id,
      ...updatedData,
      createdAt: updatedData.createdAt?.toDate() || new Date(),
      updatedAt: updatedData.updatedAt?.toDate() || new Date()
    };
    
    // Only format shipping details if they exist
    if (updatedData.shippingDetails) {
      response.shippingDetails = {
        ...updatedData.shippingDetails,
        shippingDate: updatedData.shippingDetails.shippingDate?.toDate(),
        submittedAt: updatedData.shippingDetails.submittedAt?.toDate()
      };
    }
    
    res.status(200).json(response);
  } catch (error) {
    console.error('Error updating transit status:', error);
    res.status(500).json({ error: 'Failed to update transit status' });
  }
});

/**
 * Assign credit (points) to exchange request
 * @route PUT /api/admin/exchange-requests/:id/credit
 * @access Admin only
 */
router.put('/exchange-requests/:id/credit', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { findCustomerByEmail, updateCustomerLoyaltyPoints } = require('../utils/shopify');
    const { creditAmount, feedback } = req.body;

    // Validate credit amount and convert to integer
    const numericCreditAmount = Math.round(Number(creditAmount));
    if (!numericCreditAmount || numericCreditAmount <= 0 || isNaN(numericCreditAmount)) {
      return res.status(400).json({ error: 'Invalid loyalty points amount. Please provide a positive whole number.' });
    }

    // Get the exchange request
    const exchangeRequest = await db.collection('exchange_requests').doc(id).get();
    if (!exchangeRequest.exists) {
      return res.status(404).json({ error: 'Exchange request not found' });
    }

    const exchangeData = exchangeRequest.data();
    
    // Only assign credit if the request is approved and received
    if (exchangeData.status !== 'approved' || exchangeData.transitStatus !== 'received') {
      return res.status(400).json({ 
        error: 'Credit can only be assigned to approved and received exchange requests' 
      });
    }

    // First find the Shopify customer
    let shopifyCustomer;
    try {
      shopifyCustomer = await findCustomerByEmail(exchangeData.userEmail);
      if (!shopifyCustomer) {
        return res.status(404).json({ error: 'Customer not found in Shopify' });
      }
    } catch (error) {
      console.error('Error finding Shopify customer:', error);
      return res.status(500).json({ error: 'Failed to find customer in Shopify' });
    }

    // Update Shopify loyalty points
    let loyaltyPointsSuccess = false;
    let totalLoyaltyPoints = 0;

    try {
      // Update using custom metafield for loyalty points
      const updatedMetafield = await updateCustomerLoyaltyPoints(shopifyCustomer.id, numericCreditAmount);
      loyaltyPointsSuccess = true;
      totalLoyaltyPoints = parseFloat(updatedMetafield.value);
    } catch (error) {
      console.error('Error updating Shopify loyalty points:', error);
      return res.status(500).json({ error: 'Failed to update loyalty points in Shopify' });
    }

    // Update the exchange request with credit information
    const updateData = {
      creditAmount: numericCreditAmount,
      totalLoyaltyPoints,
      creditAssignedAt: admin.firestore.FieldValue.serverTimestamp(),
      creditAssignedBy: req.user.uid,
      feedback: feedback || '',
      loyaltyPointsSuccess,
      creditCurrency: 'INR',
      shopifyCustomerId: shopifyCustomer.id
    };

    await db.collection('exchange_requests').doc(id).update(updateData);

    // Create a credit history record
    await db.collection('credit_history').add({
      userId: exchangeData.userId,
      exchangeRequestId: id,
      amount: numericCreditAmount,
      currency: 'INR',
      type: 'exchange_credit',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      assignedBy: req.user.uid,
      loyaltyPointsSuccess,
      shopifyCustomerId: shopifyCustomer.id,
      totalLoyaltyPoints
    });

    // Send email to user about credit assignment
    try {
      const updatedRequestData = {
        ...exchangeData,
        creditAmount: numericCreditAmount,
        totalLoyaltyPoints
      };
      await sendCreditAssignedEmail(exchangeData.userEmail, updatedRequestData);
      console.log(`Email sent to ${exchangeData.userEmail} about credit assignment`);
    } catch (emailError) {
      console.error('Error sending credit assignment email:', emailError);
      // Don't stop the process if email fails
    }

    // Return the updated exchange request
    const updatedRequest = await db.collection('exchange_requests').doc(id).get();
    const responseData = {
      ...updatedRequest.data(),
      id: updatedRequest.id,
      shippingDetails: exchangeData.shippingDetails || null
    };

    res.json(responseData);
  } catch (error) {
    console.error('Error assigning loyalty points:', error);
    res.status(500).json({ error: 'Failed to assign loyalty points' });
  }
});

/**
 * Get all loyalty points history (admin)
 * @route GET /api/admin/credit-history
 * @access Admin only
 */
router.get('/credit-history', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId, limit = 50 } = req.query;
    
    let query = db.collection('credit_history').orderBy('createdAt', 'desc');
    
    if (userId) {
      query = query.where('userId', '==', userId);
    }
    
    if (limit) {
      query = query.limit(parseInt(limit));
    }
    
    const snapshot = await query.get();
    
    // Format data
    const pointsHistory = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate() || new Date()
    }));
    
    res.status(200).json(pointsHistory);
  } catch (error) {
    console.error('Error getting loyalty points history:', error);
    res.status(500).json({ error: 'Failed to get loyalty points history' });
  }
});

/**
 * Warehouse Management Routes
 */

/**
 * Get all warehouses
 * @route GET /api/admin/warehouses
 * @access Admin only
 */
router.get('/warehouses', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const snapshot = await db.collection('warehouses')
      .orderBy('name', 'asc')
      .get();
    
    const warehouses = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate(),
      updatedAt: doc.data().updatedAt?.toDate()
    }));
    
    res.status(200).json(warehouses);
  } catch (error) {
    console.error('Error getting warehouses:', error);
    res.status(500).json({ error: 'Failed to get warehouses' });
  }
});

/**
 * Get a specific warehouse
 * @route GET /api/admin/warehouses/:id
 * @access Admin only
 */
router.get('/warehouses/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    
    const doc = await db.collection('warehouses').doc(id).get();
    
    if (!doc.exists) {
      return res.status(404).json({ error: 'Warehouse not found' });
    }
    
    res.status(200).json({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate(),
      updatedAt: doc.data().updatedAt?.toDate()
    });
  } catch (error) {
    console.error('Error getting warehouse:', error);
    res.status(500).json({ error: 'Failed to get warehouse' });
  }
});

/**
 * Create a new warehouse
 * @route POST /api/admin/warehouses
 * @access Admin only
 */
router.post('/warehouses', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { name, addressLine1, addressLine2, city, state, postalCode, country, contactPerson, contactPhone, isActive = true } = req.body;
    
    // Validate required fields
    if (!name || !addressLine1 || !city || !state || !postalCode || !country) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Create new warehouse
    const warehouse = {
      name,
      addressLine1,
      addressLine2: addressLine2 || '',
      city,
      state,
      postalCode,
      country,
      contactPerson: contactPerson || '',
      contactPhone: contactPhone || '',
      isActive,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    // Save to Firestore
    const docRef = await db.collection('warehouses').add(warehouse);
    
    // Return the created warehouse with ID
    res.status(201).json({
      id: docRef.id,
      ...warehouse
    });
  } catch (error) {
    console.error('Error creating warehouse:', error);
    res.status(500).json({ error: 'Failed to create warehouse' });
  }
});

/**
 * Update a warehouse
 * @route PUT /api/admin/warehouses/:id
 * @access Admin only
 */
router.put('/warehouses/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    // Get document reference
    const docRef = db.collection('warehouses').doc(id);
    const doc = await docRef.get();
    
    // Check if document exists
    if (!doc.exists) {
      return res.status(404).json({ error: 'Warehouse not found' });
    }
    
    // Update document
    const updates = {
      ...updateData,
      updatedAt: new Date()
    };
    
    await docRef.update(updates);
    
    // Get updated document
    const updatedDoc = await docRef.get();
    
    res.status(200).json({
      id,
      ...updatedDoc.data(),
      createdAt: updatedDoc.data().createdAt?.toDate(),
      updatedAt: updatedDoc.data().updatedAt?.toDate()
    });
  } catch (error) {
    console.error('Error updating warehouse:', error);
    res.status(500).json({ error: 'Failed to update warehouse' });
  }
});

/**
 * Delete a warehouse
 * @route DELETE /api/admin/warehouses/:id
 * @access Admin only
 */
router.delete('/warehouses/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get document reference
    const docRef = db.collection('warehouses').doc(id);
    const doc = await docRef.get();
    
    // Check if document exists
    if (!doc.exists) {
      return res.status(404).json({ error: 'Warehouse not found' });
    }
    
    // Delete document
    await docRef.delete();
    
    res.status(200).json({ message: 'Warehouse deleted successfully' });
  } catch (error) {
    console.error('Error deleting warehouse:', error);
    res.status(500).json({ error: 'Failed to delete warehouse' });
  }
});

module.exports = router; 