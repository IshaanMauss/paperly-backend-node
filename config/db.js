// File: config/db.js
const mongoose = require('mongoose');

// MongoDB Connection Options
const connectionOptions = {
    maxPoolSize: 10,       // maintain up to 10 socket connections
    socketTimeoutMS: 45000,    // close idle sockets after 45 seconds
    connectTimeoutMS: 30000,    // give up initial connection after 30 seconds
    readPreference: 'primaryPreferred',
    writeConcern: {
        w: 'majority',
        j: true,
    },
};

// Connection function with exponential backoff retry logic
const connectDB = async () => {
    let retries = 5;
    let backoff = 1000; // start at 1 second
    let connected = false;

    // Priority Check for the URI string
    const dbUri = process.env.MONGODB_URI || process.env.MONGO_URI;

    if (!dbUri) {
        console.error('❌ [Critical] No MongoDB connection string found in environment variables!');
        process.exit(1);
    }

    while (!connected && retries > 0) {
        try {
            const conn = await mongoose.connect(dbUri, connectionOptions);
            connected = true;
            console.log(
                `✅ MongoDB Connected: ${conn.connection.host} ` +
                `(Pool Size: ${connectionOptions.maxPoolSize})`
            );
        } catch (err) {
            const attempt = 6 - retries;
            console.error(`❌ Connection attempt failed (${attempt}/5): ${err.message}`);
            retries--;

            if (retries > 0) {
                console.log(`⏳ Retrying in ${backoff / 1000} seconds...`);
                await new Promise(resolve => setTimeout(resolve, backoff));
                backoff *= 2; // exponential backoff
            }
        }
    }

    if (!connected) {
        console.error('💥 Failed to connect to MongoDB after 5 attempts. Exiting.');
        process.exit(1);
    }

    // Connection event listeners for proactive monitoring
    mongoose.connection.on('error', (err) => {
        console.error(`🚨 MongoDB connection error: ${err.message}`);
    });

    mongoose.connection.on('disconnected', () => {
        console.warn('⚠️ MongoDB disconnected. Mongoose will attempt to reconnect...');
    });

    mongoose.connection.on('reconnected', () => {
        console.log('🔄 MongoDB reconnected successfully');
    });
};

// Returns true only when the connection is fully open (readyState 1)
const checkDBConnection = () => mongoose.connection.readyState === 1;

module.exports = { connectDB, checkDBConnection };