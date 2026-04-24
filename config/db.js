// File: config/db.js
const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        // Strict query setting for Mongoose 7+
        mongoose.set('strictQuery', false);
        
        const conn = await mongoose.connect(process.env.MONGO_URI);
        
        console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    } catch (error) {
        console.error(`❌ MongoDB Connection Error: ${error.message}`);
        // Exit process with failure if DB doesn't connect
        process.exit(1); 
    }
};

module.exports = connectDB;