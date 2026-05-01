const cloudinary = require('cloudinary').v2;
const { extractDiagrams } = require('./diagramExtractor');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

/**
 * Upload and crop diagrams with enhanced error handling for image format issues
 * 
 * @param {string} documentId - The document ID
 * @param {Buffer} fileBuffer - The file buffer containing diagrams
 * @param {Object} options - Optional parameters
 * @returns {Object} - Object with diagram URLs and needs_review flag
 */
async function uploadAndCropDiagrams(documentId, fileBuffer, options = {}) {
  try {
    // Extract diagrams from document with needs_review flag
    const extractResult = await extractDiagrams(fileBuffer, { setNeedsReview: true });
    
    // Initialize result object
    const result = {
      diagramUrls: [],
      needs_review: extractResult.needs_review || false
    };
    
    // Get the diagrams array from the result
    const diagrams = extractResult.diagrams || [];
    
    if (diagrams.length === 0) {
      console.warn(`No diagrams found for document ${documentId}`);
      return result;
    }

    // Detailed logging of received files for debugging
    console.log(`Files received for Cloudinary: ${diagrams.length} diagrams for document ${documentId}`);

    // Upload and crop each diagram with individual error handling
    const diagramUrls = [];
    
    // Process each diagram separately with individual try/catch
    for (const diagram of diagrams) {
      try {
        const uploadResult = await cloudinary.uploader.upload(diagram, {
          folder: `paperly/diagrams/${documentId}`,
          crop: 'crop',
          quality: 'auto',
          timeout: 60000 // 60 second timeout
        });
        diagramUrls.push(uploadResult.secure_url);
      } catch (diagramError) {
        // Log individual diagram upload errors but continue with others
        console.error(`Error uploading individual diagram for ${documentId}:`, diagramError);
      }
    }

    console.log(`Successfully uploaded ${diagramUrls.length}/${diagrams.length} diagrams for document ${documentId}`);
    
    // If we had any errors or some diagrams failed to upload, set needs_review flag
    if (diagramUrls.length < diagrams.length) {
      result.needs_review = true;
    }
    
    result.diagramUrls = diagramUrls;
    return result;
  } catch (error) {
    // Comprehensive error logging
    console.error(`Cloudinary diagram upload critical error for ${documentId}:`, {
      message: error.message,
      stack: error.stack,
      name: error.name,
      document: documentId
    });
    
    // Never crash the pipeline - return structured result with empty array and needs_review=true
    return {
      diagramUrls: [],
      needs_review: true
    };
  }
}

async function getCroppedDiagrams(documentId) {
  try {
    // Implement logic to retrieve cropped diagram URLs for a specific document
    const resources = await cloudinary.api.resources({
      type: 'upload',
      prefix: `paperly/diagrams/${documentId}`,
      max_results: 100
    });

    return resources.resources.map(resource => resource.secure_url);
  } catch (error) {
    console.error('Error retrieving cropped diagrams:', error);
    return [];
  }
}

module.exports = {
  uploadAndCropDiagrams,
  getCroppedDiagrams
};