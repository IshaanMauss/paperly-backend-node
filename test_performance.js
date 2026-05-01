/**
 * Performance Test Script for Paperly Backend
 * 
 * This script tests the following:
 * 1. Extraction speed with and without caching
 * 2. Multiple simultaneous users (concurrent requests)
 * 3. Continuous PDF upload and database storage
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

// Import the necessary modules
const mongoose = require('mongoose');
const { sendToPythonEngine, clearExtractionCache } = require('./services/pythonEngine');
const { connectDB } = require('./config/db');
const IGCSEQuestion = require('./models/IGCSEQuestion');
const PaperRegistry = require('./models/PaperRegistry');

// Sample PDF data (base64 string) - replace with an actual PDF in base64 format for real testing
// This is just a placeholder for the script structure
const SAMPLE_PDF_BASE64 = fs.readFileSync(
    path.join(__dirname, './test_data/sample.pdf.b64'), 
    'utf-8'
).trim();

// Connect to the database
connectDB().catch(err => {
    console.error('Database connection error:', err);
    process.exit(1);
});

// Test parameters
const NUM_CONCURRENT_REQUESTS = 3; // Simulate 3 users
const NUM_SEQUENTIAL_REQUESTS = 5; // Each user submits 5 PDFs in sequence
const TOTAL_REQUESTS = NUM_CONCURRENT_REQUESTS * NUM_SEQUENTIAL_REQUESTS;

// Utility to wait between operations
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Run a single extraction test
 * @param {string} testId Unique test identifier
 * @param {boolean} useCache Whether to use cached results if available
 * @returns {Promise<Object>} Test results
 */
async function runExtractionTest(testId, useCache = true) {
    const startTime = performance.now();
    
    try {
        // If testing without cache, clear it first
        if (!useCache) {
            await clearExtractionCache();
        }
        
        const metadata = {
            document_type: 'Question Paper',
            file_name: `test_${testId}.pdf`,
            board: 'IGCSE'
        };
        
        // Send the PDF to the Python engine
        const result = await sendToPythonEngine(
            SAMPLE_PDF_BASE64,
            metadata.document_type,
            'application/pdf',
            metadata.file_name,
            metadata.board
        );
        
        const endTime = performance.now();
        const duration = endTime - startTime;
        
        return {
            testId,
            success: true,
            questionCount: result?.questions_array?.length || 0,
            duration,
            useCache
        };
    } catch (error) {
        const endTime = performance.now();
        const duration = endTime - startTime;
        
        return {
            testId,
            success: false,
            error: error.message,
            duration,
            useCache
        };
    }
}

/**
 * Run tests with a single user submitting multiple PDFs sequentially
 */
async function testSequentialSubmissions() {
    console.log('\n=== Testing Sequential Submissions ===');
    
    // First run: No caching (cold start)
    console.log('Running without cache (cold start)...');
    const firstRunResult = await runExtractionTest('seq_first', false);
    console.log(`First run took ${firstRunResult.duration.toFixed(2)}ms`);
    
    // Second run: With caching
    console.log('Running with cache...');
    const secondRunResult = await runExtractionTest('seq_second', true);
    console.log(`Second run took ${secondRunResult.duration.toFixed(2)}ms`);
    
    // Calculate speed improvement
    const speedImprovement = firstRunResult.duration / secondRunResult.duration;
    console.log(`Cache speed improvement: ${speedImprovement.toFixed(2)}x faster\n`);
    
    return { firstRunResult, secondRunResult, speedImprovement };
}

/**
 * Run tests with multiple users submitting PDFs concurrently
 */
async function testConcurrentSubmissions() {
    console.log('\n=== Testing Concurrent Submissions ===');
    
    // Clear cache before concurrent test for accurate measurements
    await clearExtractionCache();
    
    const startTime = performance.now();
    
    // Create an array of concurrent request promises
    const concurrentPromises = Array(NUM_CONCURRENT_REQUESTS)
        .fill()
        .map((_, userIndex) => {
            return (async () => {
                const userResults = [];
                
                for (let i = 0; i < NUM_SEQUENTIAL_REQUESTS; i++) {
                    const testId = `user${userIndex + 1}_req${i + 1}`;
                    console.log(`User ${userIndex + 1} submitting request ${i + 1}...`);
                    
                    const result = await runExtractionTest(testId);
                    userResults.push(result);
                    
                    // Add a small delay between submissions from the same user
                    await wait(500);
                }
                
                return userResults;
            })();
        });
    
    // Wait for all concurrent user sessions to complete
    const allResults = await Promise.all(concurrentPromises);
    
    const endTime = performance.now();
    const totalDuration = endTime - startTime;
    const flatResults = allResults.flat();
    
    // Calculate statistics
    const averageDuration = flatResults.reduce((sum, r) => sum + r.duration, 0) / flatResults.length;
    const successCount = flatResults.filter(r => r.success).length;
    const failCount = flatResults.filter(r => !r.success).length;
    
    console.log(`\nAll ${TOTAL_REQUESTS} concurrent requests completed in ${totalDuration.toFixed(2)}ms`);
    console.log(`Average request duration: ${averageDuration.toFixed(2)}ms`);
    console.log(`Success rate: ${successCount}/${TOTAL_REQUESTS} (${(successCount/TOTAL_REQUESTS*100).toFixed(1)}%)`);
    
    if (failCount > 0) {
        console.log(`Failed requests: ${failCount}`);
        const errors = flatResults.filter(r => !r.success).map(r => r.error);
        console.log('Error summary:', [...new Set(errors)]);
    }
    
    return { 
        totalDuration,
        averageDuration,
        successCount,
        failCount,
        results: flatResults
    };
}

/**
 * Verify database synchronization by checking if questions were stored
 */
async function verifyDatabaseSync() {
    console.log('\n=== Verifying Database Synchronization ===');
    
    try {
        // Check if questions were saved to the database
        const questionCount = await IGCSEQuestion.countDocuments({});
        const registryCount = await PaperRegistry.countDocuments({});
        
        console.log(`Questions in database: ${questionCount}`);
        console.log(`Registry entries in database: ${registryCount}`);
        
        // Check a few recent questions to verify data integrity
        if (questionCount > 0) {
            const recentQuestions = await IGCSEQuestion.find({})
                .sort({ createdAt: -1 })
                .limit(3);
            
            console.log('\nSample of recently saved questions:');
            for (const q of recentQuestions) {
                console.log(`- ID: ${q._id}, PRK: ${q.paper_reference_key}, Created: ${q.createdAt}`);
            }
        }
        
        return { success: true, questionCount, registryCount };
    } catch (error) {
        console.error('Database verification error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Run all performance tests
 */
async function runAllTests() {
    console.log('=== Starting Performance Tests ===');
    console.log(`Testing with ${NUM_CONCURRENT_REQUESTS} concurrent users, each submitting ${NUM_SEQUENTIAL_REQUESTS} PDFs`);
    
    try {
        // Test 1: Sequential submissions with and without cache
        const sequentialResults = await testSequentialSubmissions();
        
        // Test 2: Concurrent submissions
        const concurrentResults = await testConcurrentSubmissions();
        
        // Test 3: Verify database sync
        const databaseResults = await verifyDatabaseSync();
        
        console.log('\n=== Performance Test Summary ===');
        console.log(`Cache speedup: ${sequentialResults.speedImprovement.toFixed(2)}x faster`);
        console.log(`Concurrent throughput: ${TOTAL_REQUESTS} requests in ${concurrentResults.totalDuration.toFixed(2)}ms`);
        console.log(`Success rate: ${concurrentResults.successCount}/${TOTAL_REQUESTS} (${(concurrentResults.successCount/TOTAL_REQUESTS*100).toFixed(1)}%)`);
        console.log(`Database sync: ${databaseResults.success ? 'Successful' : 'Failed'}`);
        
        console.log('\n=== Tests Completed ===');
    } catch (error) {
        console.error('Test execution error:', error);
    }
    
    // Close database connection when tests are complete
    try {
        await mongoose.connection.close();
        console.log('Database connection closed');
    } catch (e) {
        // Ignore disconnect errors
    }
}

// Run the tests
runAllTests();