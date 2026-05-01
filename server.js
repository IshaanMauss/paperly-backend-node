// Load environment variables
require('dotenv').config();

// File: server.js
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const cluster = require('cluster');
const numCPUs = require('os').cpus().length;
const { connectDB, checkDBConnection } = require('./config/db');

// Request timeout middleware - prevent hanging requests
const timeout = require('connect-timeout');
const REQUEST_TIMEOUT = '600s';

// Determine number of worker processes to create
const WORKERS = process.env.WEB_CONCURRENCY || Math.min(numCPUs, 4);

// Use cluster to create multiple worker processes
if (cluster.isMaster && process.env.NODE_ENV === 'production') {
    console.log(`Master process ${process.pid} is running`);
    console.log(`Setting up ${WORKERS} workers...`);

    // Create workers
    for (let i = 0; i < WORKERS; i++) {
        cluster.fork();
    }

    // Handle worker crashes
    cluster.on('exit', (worker, code, signal) => {
        console.error(
            `Worker ${worker.process.pid} died with code ${code} and signal ${signal}`
        );
        console.log('Starting a new worker...');
        cluster.fork();
    });

} else {
    // Worker process (or dev mode) — start the actual server

    // Connect to database
    connectDB();

    const app = express();

    // Apply timeout to all requests
    app.use(timeout(REQUEST_TIMEOUT));
    app.use((req, res, next) => {
        if (!req.timedout) next();
    });

    // Rate limiting to prevent abuse
    const apiLimiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100,                  // limit each IP to 100 requests per window
        message: {
            success: false,
            message: 'Too many requests, please try again after 15 minutes',
        },
        standardHeaders: true,
        legacyHeaders:  false,
    });

    // Compression middleware
    app.use(compression({
        level: 6, // balanced compression level
        filter: (req, res) => {
            // Skip compression for binary content
            if (
                req.headers['content-type'] &&
                (req.headers['content-type'].includes('image') ||
                 req.headers['content-type'].includes('pdf'))
            ) {
                return false;
            }
            return compression.filter(req, res);
        },
    }));

    // Core middlewares
    app.use(cors({
        origin:         process.env.ALLOWED_ORIGINS?.split(',') || '*',
        methods:        ['GET', 'POST', 'PUT', 'DELETE'],
        allowedHeaders: ['Content-Type', 'Authorization'],
    }));
    app.use(express.json({ limit: '100mb' }));
    app.use(express.urlencoded({ limit: '100mb', extended: true }));

    // Apply rate limiting to all API routes
    app.use('/api/', apiLimiter);

    // Health check
    app.get('/api/health', (req, res) => {
        const dbConnected = checkDBConnection();
        res.status(200).json({
            success: true,
            message: 'Paperly Node.js Engine is running!',
            server: {
                status: 'online',
                worker: process.pid,
                uptime: process.uptime(),
            },
            database: {
                connected: dbConnected,
                status:    dbConnected ? 'connected' : 'disconnected',
            },
            queue_status: 'operational',
        });
    });

    // Mount routes
    app.use('/api/v1/internal', require('./routes/internalRoutes'));

    // 404 handler
    app.use((req, res, next) => {
        res.status(404).json({
            success: false,
            message: 'Endpoint not found',
        });
    });

    // Global error handler
    app.use((err, req, res, next) => {
        console.error(`${req.method} ${req.path} error:`, err);
        const statusCode = err.statusCode || 500;
        res.status(statusCode).json({
            success: false,
            message: err.message || 'Something went wrong!',
            path:    req.path,
            error:   process.env.NODE_ENV === 'production' ? {} : err.stack,
        });
    });

    const PORT = process.env.PORT || 5000;

    app.listen(PORT, () => {
        console.log(`⚡ Worker ${process.pid} running on port ${PORT}`);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
        console.log(`Worker ${process.pid} received SIGTERM signal`);
        process.exit(0);
    });

    process.on('SIGINT', () => {
        console.log(`Worker ${process.pid} received SIGINT signal`);
        process.exit(0);
    });

    // ── Export for testing / other modules ──────────────────────────────────
    // Kept inside the else block so `app` is always defined when this line runs.
    module.exports = app;
}