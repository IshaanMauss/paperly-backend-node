// File: server.js
// ── ENVIRONMENT INITIALIZATION ─────────────────────────────────────────────
require('dotenv').config();

// Debug log to verify env loading early
if (process.env.NODE_ENV !== 'production') {
    console.log('🔍 [Debug] Environment Variables Loaded:', {
        PORT: process.env.PORT,
        MONGODB_URI: process.env.MONGODB_URI ? 'SET' : 'MISSING',
        NODE_ENV: process.env.NODE_ENV
    });
}

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const cluster = require('cluster');
const numCPUs = require('os').cpus().length;
const { connectDB, checkDBConnection } = require('./config/db');
const timeout = require('connect-timeout');

// ── CONFIGURATION ──────────────────────────────────────────────────────────
const REQUEST_TIMEOUT = '600s';
const WORKERS = process.env.WEB_CONCURRENCY || Math.min(numCPUs, 4);

// ── CLUSTER MANAGEMENT (Production Only) ───────────────────────────────────
if (cluster.isMaster && process.env.NODE_ENV === 'production') {
    console.log(`🚀 [Master] Process ${process.pid} is starting`);
    console.log(`👷 [Master] Spawning ${WORKERS} workers...`);

    for (let i = 0; i < WORKERS; i++) {
        cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
        console.error(`⚠️ [Master] Worker ${worker.process.pid} died (Code: ${code}, Signal: ${signal})`);
        console.log('♻️ [Master] Spinning up a replacement worker...');
        cluster.fork();
    });

} else {
    // ── WORKER PROCESS LOGIC ───────────────────────────────────────────────
    
    // Immediate DB Connection Attempt
    console.log(`🔌 [Worker ${process.pid}] Initializing database connection...`);
    connectDB();

    const app = express();

    // ── MIDDLEWARES ────────────────────────────────────────────────────────
    
    // Timeout Handling
    app.use(timeout(REQUEST_TIMEOUT));
    app.use((req, res, next) => {
        if (!req.timedout) next();
        else console.warn(`⏰ [Worker ${process.pid}] Request Timed Out: ${req.method} ${req.path}`);
    });

    // Rate Limiting
    const apiLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 100,
        message: { success: false, message: 'Too many requests, try again after 15 minutes' },
        standardHeaders: true,
        legacyHeaders: false,
    });

    // Smart Compression (Skips large binary files)
    app.use(compression({
        level: 6,
        filter: (req, res) => {
            const contentType = req.headers['content-type'] || '';
            if (contentType.includes('image') || contentType.includes('pdf')) return false;
            return compression.filter(req, res);
        },
    }));

    // Security & Parsing
    app.use(cors({
        origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        allowedHeaders: ['Content-Type', 'Authorization'],
    }));
    
    // High limits for Base64 image payloads
    app.use(express.json({ limit: '100mb' }));
    app.use(express.urlencoded({ limit: '100mb', extended: true }));

    // Apply limits to API routes
    app.use('/api/', apiLimiter);

    // ── ROUTES ─────────────────────────────────────────────────────────────

    // Proactive Health Check (Includes DB status)
    app.get('/api/health', (req, res) => {
        const dbStatus = checkDBConnection();
        res.status(200).json({
            success: true,
            server: { status: 'online', worker: process.pid, uptime: process.uptime() },
            database: { connected: dbStatus, status: dbStatus ? 'connected' : 'disconnected' }
        });
    });

    app.use('/api/v1/internal', require('./routes/internalRoutes'));

    // 404 Handler
    app.use((req, res) => {
        res.status(404).json({ success: false, message: 'Endpoint not found' });
    });

    // Global Error Handler with Stack Trace in Dev
    app.use((err, req, res, next) => {
        console.error(`❌ [Error] ${req.method} ${req.path}:`, err.message);
        const statusCode = err.statusCode || 500;
        res.status(statusCode).json({
            success: false,
            message: err.message || 'Internal Server Error',
            error: process.env.NODE_ENV === 'production' ? {} : err.stack,
        });
    });

    // ── SERVER START ───────────────────────────────────────────────────────
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
        console.log(`⚡ [Worker ${process.pid}] Server operational on port ${PORT}`);
    });

    // Graceful Shutdown listeners
    const shutdown = (signal) => {
        console.log(`🛑 [Worker ${process.pid}] ${signal} received. Closing connection...`);
        process.exit(0);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    module.exports = app;
}