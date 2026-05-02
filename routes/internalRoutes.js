// File: routes/internalRoutes.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose'); // Added to check DB status dynamically
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

// ── CORE PIPELINE ROUTES ───────────────────────────────────────────────────

// POST /api/v1/internal/process-page
router.post('/process-page', processDualUpload);

// POST /api/v1/internal/save-batch
router.post('/save-batch', saveVerifiedBatch);

// GET /api/v1/internal/counts
router.get('/counts', getQuestionCounts);

// POST /api/v1/internal/papers/manual-pair
router.post('/papers/manual-pair', manualPairDocuments);

// ── CACHE MANAGEMENT ───────────────────────────────────────────────────────

router.post('/cache/clear', async (req, res) => {
    try {
        // Clear Node.js caches
        const nodeCacheResult = clearCaches();
        
        // Clear Python engine caches (Added await assuming it's an async HTTP call)
        const pythonCacheResult = await clearExtractionCache(); 
        
        return res.status(200).json({
            success: true,
            message: 'All caches cleared successfully',
            node: nodeCacheResult,
            python: pythonCacheResult
        });
    } catch (error) {
        console.error("❌ Cache Clear Error:", error);
        return res.status(500).json({
            success: false,
            message: 'Failed to clear caches',
            error: error.message
        });
    }
});

// ── SYSTEM STATUS & HEALTH ─────────────────────────────────────────────────

// GET /api/v1/internal/health (Quick Router Health Check)
router.get('/health', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'Internal API router is fully operational 🚀',
        timestamp: new Date().toISOString()
    });
});

// GET /api/v1/internal/status (Detailed System Status)
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
            python_engine: 'online', // Note: Can be upgraded later to actively ping the Python URL
            database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected', // Dynamic check
            cloudinary: 'connected'
        },
        performance: {
            // Added fallback to 0 in case trackRequestTime middleware is skipped
            request_time_ms: req.startTime ? Date.now() - req.startTime : 0 
        }
    };
    
    return res.status(200).json(status);
});

module.exports = router;