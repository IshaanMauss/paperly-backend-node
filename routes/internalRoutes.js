// File: routes/internalRoutes.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// ⚠️ IMPORTANT: Apne Question model ka exact path yahan daal dena
const Question = require('../models/Question'); 
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


// ── DATA VERIFICATION ──────────────────────────────────────────────────────

// GET /api/v1/internal/verify-pairing (To check QP and MS pairing visually)
router.get('/verify-pairing', async (req, res) => {
    try {
        const { board, year, paper_number } = req.query;

        // Query filter banate hain
        let query = {};
        if (board) query.board = board;
        if (year) query.year = year;
        if (paper_number) query.paper_number = paper_number;

        // Sirf 5 questions uthate hain test karne ke liye taaki load na pade
        const questions = await Question.find(query).limit(5);

        if (!questions || questions.length === 0) {
            return res.status(404).json({ success: false, message: "No questions found matching this filter." });
        }

        // Data ko clean format mein map karte hain taaki padhne mein aasani ho
        const verificationData = questions.map(q => ({
            question_id: q.question_number || q._id,
            board_details: `${q.board} - ${q.year} - Paper ${q.paper_number}`,
            QUESTION_PART: q.question_text || "Text missing",
            QUESTION_IMAGES: q.diagram_urls || [],
            PAIRED_ANSWER: q.answer_text || q.marking_scheme_text || "Answer missing", // Adjust DB field name if needed
            MARKS: q.marks || "N/A"
        }));

        res.status(200).json({
            success: true,
            total_checked: verificationData.length,
            data: verificationData
        });

    } catch (error) {
        console.error("❌ Verification Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});


// ── CACHE MANAGEMENT ───────────────────────────────────────────────────────

router.post('/cache/clear', async (req, res) => {
    try {
        // Clear Node.js caches
        const nodeCacheResult = clearCaches();
        
        // Clear Python engine caches
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