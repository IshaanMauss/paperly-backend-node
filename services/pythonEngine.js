// File: services/pythonEngine.js
const crypto = require('crypto');
const NodeCache = require('node-cache');

// Local extraction cache to reduce duplicate calls
// TTL of 3hrs, check expiry every 10 minutes
const extractionCache = new NodeCache({ 
    stdTTL: 10800, // 3 hours
    checkperiod: 600 // 10 minutes
});

// In-progress requests tracking to avoid duplicates
const pendingRequests = new Map();

const normalizeBase64Image = (base64Image) => {
    if (typeof base64Image !== 'string') {
        throw new TypeError('imageBase64 must be a base64 string');
    }

    const trimmed = base64Image.trim();
    if (!trimmed) {
        throw new TypeError('imageBase64 cannot be empty');
    }

    // Accept both Data URL and raw base64 inputs, always forward raw payload.
    return trimmed.includes(',') ? trimmed.split(',', 2)[1] : trimmed;
};

// Read Python Engine URL from environment variables with fallback
const buildPythonEngineUrl = () => {
    // Ensure URL points to the correct endpoint, without duplicating '/api/extract'
    const baseUrl = process.env.PYTHON_ENGINE_URL || 'http://127.0.0.1:8000';
    return `${baseUrl}/api/extract`;
};

// Generate a cache key from request parameters
const generateCacheKey = (image, documentType, board) => {
    // Use only the first 2000 chars of image for faster hashing
    const imagePreview = image.substring(0, 2000);
    const dataToHash = `${imagePreview}|${documentType}|${board}`;
    return crypto.createHash('md5').update(dataToHash).digest('hex');
};

// Create a deduplication key for in-progress requests
const generateDedupKey = (documentType, fileName, board) => {
    return `${documentType}|${fileName}|${board}`;
};

// Handle job status checking
const checkJobStatus = async (jobId) => {
    try {
        // Extract base URL without the '/api/extract' path
        const baseUrl = process.env.PYTHON_ENGINE_URL || 'http://127.0.0.1:8000';
        const pythonUrl = `${baseUrl}/api/extract/job/${jobId}`;
        
        const response = await fetch(pythonUrl, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });
        
        if (!response.ok) {
            throw new Error(`Failed to check job status: ${response.statusText}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error('[Job Status Check Error]:', error);
        return { status: 'unknown', error: error.message };
    }
};

// Poll job status until complete or timeout
const waitForJobCompletion = async (jobId, timeoutMs = 300000) => { // 5 minute timeout
    const startTime = Date.now();
    const pollIntervalMs = 2000; // 2 second polling interval
    
    while (Date.now() - startTime < timeoutMs) {
        const status = await checkJobStatus(jobId);
        
        if (status.status === 'completed') {
            return status;
        }
        
        if (status.status === 'failed') {
            throw new Error(`Job failed: ${status.error || 'Unknown error'}`);
        }
        
        // Wait before polling again
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
    
    throw new Error('Job timed out while waiting for completion');
};

const sendToPythonEngine = async (
    base64Image,
    documentType = "Question Paper",
    mimeType = "image/png",
    fileName = "",
    board = "IGCSE",
    page1Image = null
) => {
    try {
        const pythonUrl = buildPythonEngineUrl();
        const normalizedImage = normalizeBase64Image(base64Image);
        
        // Check cache first
        const cacheKey = generateCacheKey(normalizedImage, documentType, board);
        const cachedResult = extractionCache.get(cacheKey);
        
        if (cachedResult) {
            console.log('🔄 [Cache Hit] Using cached extraction result');
            return cachedResult;
        }
        
        // Check for duplicate in-progress requests
        const dedupKey = generateDedupKey(documentType, fileName, board);
        
        if (pendingRequests.has(dedupKey)) {
            console.log('⏳ [Duplicate Request] Waiting for existing extraction to complete');
            try {
                // Wait for the pending request to complete and return its result
                return await pendingRequests.get(dedupKey);
            } catch (error) {
                console.error('❌ [Pending Request Failed]:', error.message);
                // Continue with a fresh request if the pending one failed
            }
        }
        
        // Create a promise for this request and store it in the pending map
        const requestPromise = (async () => {
            const requestBody = {
                image: normalizedImage,
                mime_type: mimeType || "image/png",
                document_type: documentType,
                file_name: fileName,
                board: board,
                page1_image: page1Image
            };
    
            console.log(`📤 [Python Engine] Sending ${mimeType} to extraction service: ${fileName}`);
            
            const response = await fetch(pythonUrl, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });
    
            if (!response.ok) {
                let errorPayload = null;
                const textResponse = await response.text();
    
                try {
                    errorPayload = JSON.parse(textResponse);
                } catch (parseError) {
                    errorPayload = { detail: textResponse };
                }
    
                console.error('❌ Python Engine Error Response:', {
                    status: response.status,
                    url: pythonUrl,
                    error: errorPayload
                });
    
                const error = new Error(
                    errorPayload?.detail?.error?.message ||
                    errorPayload?.detail ||
                    'Python Engine Processing Failed'
                );
                error.name = 'PythonEngineError';
                error.statusCode = response.status;
                error.details = errorPayload?.detail || errorPayload;
                error.stage = errorPayload?.detail?.error?.stage || errorPayload?.error?.stage || null;
                throw error;
            }
    
            const data = await response.json();
            
            // Cache the successful result
            extractionCache.set(cacheKey, data);
            
            console.log(`📥 [Python Engine] Received extraction results: ${data?.questions_array?.length || 0} items`);
            return data;
        })();
        
        // Store the promise in the pending requests map
        pendingRequests.set(dedupKey, requestPromise);
        
        try {
            // Wait for the promise to resolve
            const result = await requestPromise;
            return result;
        } finally {
            // Clean up the pending request regardless of success/failure
            pendingRequests.delete(dedupKey);
        }
        
    } catch (error) {
        console.error('[Python Engine Service Error]:', {
            message: error.message,
            code: error.code || (error.cause && error.cause.code),
            cause: error.cause,
            statusCode: error.statusCode,
            details: error.details,
        });
        throw error;
    }
};

// Clear the local cache (useful for testing or when models are updated)
const clearExtractionCache = () => {
    extractionCache.flushAll();
    console.log('🧹 Extraction cache cleared');
    return { success: true, message: 'Extraction cache cleared' };
};

module.exports = { 
    sendToPythonEngine, 
    clearExtractionCache,
    checkJobStatus
};
