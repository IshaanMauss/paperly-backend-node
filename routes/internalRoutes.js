// File: routes/internalRoutes.js
const express = require('express');
const router = express.Router();

// Import the controller (We will write this next)
const { processDualUpload, saveVerifiedBatch } = require('../controllers/ingestionController');

// Route 1: Receives the initial Base64 images (Question + Marking Scheme) from React
// Passes them to Python via the controller
router.post('/process-page', processDualUpload);

// Route 2: Receives the FINALLY VERIFIED array of questions from React
// Saves them to MongoDB
router.post('/save-batch', saveVerifiedBatch);

module.exports = router;