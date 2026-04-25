const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        // Smart Fallback: Uses .env normally, but falls back to the exact string if local CLI wrapper destroys it
        let rawUri = process.env.MONGO_URI;
        
        if (!rawUri || rawUri.trim() === "") {
            console.log("⚠️ Local Override: Using hardcoded URI to bypass terminal bugs.");
            rawUri = "mongodb+srv://ishaandevwork555_db_user:paperly333@cluster0.yaqgs4q.mongodb.net/paperly_db?retryWrites=true&w=majority&appName=Cluster0";
        }

        // Clean up any accidental quotes or spaces
        const cleanUri = rawUri.replace(/^["']|["']$/g, '').trim();

        // Strict query setting for Mongoose 7+
        mongoose.set('strictQuery', false);
        
        const conn = await mongoose.connect(cleanUri);
        
        console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    } catch (error) {
        console.error(`❌ MongoDB Connection Error: ${error.message}`);
        process.exit(1); 
    }
};

module.exports = connectDB;