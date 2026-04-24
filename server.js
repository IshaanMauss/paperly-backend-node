// File: server.js
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const connectDB = require('./config/db');

// Load env vars
dotenv.config();

// Connect to database
connectDB();

const app = express();

// Middlewares
app.use(cors()); // Allows your React frontend to communicate with this backend
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Basic Health Check Route
app.get('/api/health', (req, res) => {
    res.status(200).json({ 
        success: true, 
        message: 'Paperly Node.js Engine is running flawlessly! 🚀' 
    });
});

// We will mount our routes here later
app.use('/api/v1/internal', require('./routes/internalRoutes'));
// app.use('/api/v1/saas', require('./routes/saasRoutes'));

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`⚡ Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});