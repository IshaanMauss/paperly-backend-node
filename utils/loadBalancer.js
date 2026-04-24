// File: utils/loadBalancer.js

// Fetch keys from environment variables
const simpletexKeys = [
    process.env.SIMPLETEX_KEY_1,
    process.env.SIMPLETEX_KEY_2,
    process.env.SIMPLETEX_KEY_3
].filter(Boolean); // Filters out any undefined or empty keys

let currentIndex = 0;

const getNextSimpleTexKey = () => {
    if (simpletexKeys.length === 0) {
        throw new Error('CRITICAL: No SimpleTex API keys found in .env file!');
    }

    // Get the current key
    const keyToUse = simpletexKeys[currentIndex];

    // Move to the next index using modulo math (rotates back to 0 when it hits the end)
    currentIndex = (currentIndex + 1) % simpletexKeys.length;

    console.log(`[Load Balancer] Using SimpleTex Key Index: ${currentIndex}`);
    
    return keyToUse;
};

module.exports = { getNextSimpleTexKey };