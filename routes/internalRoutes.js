const express = require('express');
const router = express.Router();
const { clearExtractionCache } = require('../services/pythonEngine');

const { 
    processDualUpload, 
    saveVerifiedBatch, 
    getQuestionCounts,
    trackRequestTime,
    clearCaches,
    manualPairDocuments
} = require('../controllers/ingestionController');

// Apply performance tracking middleware to all routes
router.use(trackRequestTime);

// POST /api/v1/internal/process-page
router.post('/process-page', processDualUpload);

// POST /api/v1/internal/save-batch
router.post('/save-batch', saveVerifiedBatch);

// GET /api/v1/internal/counts
router.get('/counts', getQuestionCounts);

// POST /api/v1/internal/papers/manual-pair
router.post('/papers/manual-pair', manualPairDocuments);

// Cache management routes
router.post('/cache/clear', async (req, res) => {
    try {
        // Clear Node.js caches
        const nodeCacheResult = clearCaches();
        
        // Clear Python engine caches
        const pythonCacheResult = clearExtractionCache();
        
        return res.status(200).json({
            success: true,
            message: 'All caches cleared successfully',
            node: nodeCacheResult,
            python: pythonCacheResult
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Failed to clear caches',
            error: error.message
        });
    }
});

// System status endpoints
router.get('/status', (req, res) => {
    const status = {
        success: true,
        system: {
            status: 'operational',
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            node_version: process.version,
            timestamp: new Date().toISOString()
        },
        services: {
            node_api: 'online',
            python_engine: 'online', // We should check this dynamically in a real implementation
            database: 'connected',
            cloudinary: 'connected'
        },
        performance: {
            request_time_ms: Date.now() - req.startTime
        }
    };
    
    return res.status(200).json(status);
});

module.exports = router;
