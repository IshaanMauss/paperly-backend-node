// File: controllers/ingestionController.js
const Question = require('../models/Question');
const IGCSEQuestion = require('../models/IGCSEQuestion');
const IBQuestion = require('../models/IBQuestion');
const IGCSEMarkingScheme = require('../models/IGCSEMarkingScheme');
const IBMarkingScheme = require('../models/IBMarkingScheme');
const PaperRegistry = require('../models/PaperRegistry');
const { sendToPythonEngine } = require('../services/pythonEngine');
const cloudinary = require('../utils/cloudinary');

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------
const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';
const normalizeString = (v) => (isBlank(v) ? '' : String(v).trim());

const sanitizeSubjectCode = (v) => {
    const s = normalizeString(v);
    return s.replace(/:/g, '').replace(/\s+/g, ' ').trim();
};

const sanitizeBoard = (v) => {
    const s = normalizeString(v).toUpperCase();
    if (s.includes('IGCSE') || s.includes('CAMBRIDGE')) return 'IGCSE';
    if (s.includes('IB') || s.includes('INTERNATIONAL BACCALAUREATE')) return 'IB';
    return normalizeString(v); // preserve original if no match
};

const normalizeOptionalNumber = (v) => {
    if (isBlank(v)) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
};

// Resolve question text from whichever field the AI used.
const resolveQuestionLatex = (q) =>
    q.question_latex || q.latex || q.question || q.text || q.content || '';

const resolveMarkingScheme = (q) =>
    q.official_marking_scheme_latex || q.marking_scheme_latex || '';

// ---------------------------------------------------------------------------
// Reference key normalization - core logic for fixing QP/MS pairing
// ---------------------------------------------------------------------------
async function normalizeReferenceKey(rawKey) {
    const key = rawKey.trim();
    if (key.startsWith("igcse")) {
        // Rule: If the code starts with 'igcse', strip ONLY the '_qp' or '_ms' parts.
        // Expected Base Key output: "igcse_0607_m25_22".
        return key.replace(/_(qp|ms)/i, "");
    }
    // Existing logic for non-IGCSE keys (or if IGCSE rule doesn't apply)
    return key
        .replace(/[/_].*/, "")   // Remove session/tier info
        .replace(/[A-Z]$/, "")   // Remove suffix
        .trim();
}

// ---------------------------------------------------------------------------
// paper_reference_key generator (mirrors Python logic — used as a safety net
// when the Python engine returns an empty key)
// ---------------------------------------------------------------------------
const generatePaperReferenceKey = (fileName = '') => {
    if (!fileName) return '';
    // Pattern: <subject>_<season><YY>_<type>_<paper><variant>
    // e.g. 0607_s18_ms_22  →  2018_0607_2_22
    const match = fileName.match(/(\d{4})_[smwSMW](\d{2})_(?:ms|qp|er|gt)_(\d)(\d)/i);
    if (match) {
        const [, subjectCode, yearSuffix, paperNumber, variant] = match;
        return `20${yearSuffix}_${subjectCode}_${paperNumber}_${variant}`;
    }
    // Fallback: year + subject only
    const match2 = fileName.match(/(\d{4})_[smwSMW](\d{2})/i);
    if (match2) {
        const [, subjectCode, yearSuffix] = match2;
        return `20${yearSuffix}_${subjectCode}`;
    }
    return '';
};

// ---------------------------------------------------------------------------
// Normalize method_steps into [{ type, description }]
// ---------------------------------------------------------------------------
const normalizeMethodSteps = (raw) => {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter(s => s && typeof s === 'object')
        .map(s => ({
            type:        normalizeString(s.type        || s.mark_type || ''),
            description: normalizeString(s.description || s.desc      || ''),
        }));
};

// ---------------------------------------------------------------------------
// Sanitize diagram_urls to ensure it's always a clean array of strings
// ---------------------------------------------------------------------------
const sanitizeDiagramUrls = (raw) => {
    // If not provided or not valid, return empty array
    if (!raw) return [];
    
    // Handle the case where it's a string (e.g., "[[ ]]" or "[NEEDS_CROP]")
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        // Special case: if it's a meaningful string like [NEEDS_CROP], keep it
        if (trimmed === '[NEEDS_CROP]') return [trimmed];
        // If it's JSON-like, try to parse it
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            try {
                const parsed = JSON.parse(trimmed);
                return sanitizeDiagramUrls(parsed); // Recursive call with parsed value
            } catch (e) {
                // Failed to parse, return empty array
                return [];
            }
        }
        // Otherwise, if it's a real URL, return it as a single-item array
        if (trimmed.startsWith('http') || trimmed.startsWith('data:image')) {
            return [trimmed];
        }
        // Default for strings that aren't special: empty array
        return [];
    }
    
    // If it's already an array, flatten and sanitize it
    if (Array.isArray(raw)) {
        const flattened = [];
        
        // Flatten any nested arrays and filter out invalid items
        const flattenAndFilter = (item) => {
            if (item === null || item === undefined) return;
            
            if (Array.isArray(item)) {
                // Recursively flatten nested arrays
                item.forEach(flattenAndFilter);
            } else if (typeof item === 'string') {
                const trimmed = item.trim();
                if (trimmed && (
                    trimmed.startsWith('http') || 
                    trimmed.startsWith('data:image') || 
                    trimmed === '[NEEDS_CROP]'
                )) {
                    flattened.push(trimmed);
                }
            }
        };
        
        raw.forEach(flattenAndFilter);
        return flattened;
    }
    
    // Default case: not a string or array
    return [];
};

// ---------------------------------------------------------------------------
// Upload diagram base64 strings → Cloudinary URLs
// ---------------------------------------------------------------------------
const persistDiagramUrls = async (diagramImagesBase64, index) => {
    if (!Array.isArray(diagramImagesBase64) || diagramImagesBase64.length === 0) return { diagramUrls: [], needs_review: false };
    
    try {
        const results = await Promise.all(
            diagramImagesBase64
                .filter(img => !isBlank(img))
                .map(img => cloudinary.uploadAndCropDiagrams(`question_${index}`, img, { setNeedsReview: true }))
        );
        
        // Combine results from multiple diagram uploads
        const combinedResult = {
            diagramUrls: [],
            needs_review: false
        };
        
        // Process results, flatten the URLs and check needs_review flags
        results.forEach(result => {
            // Add diagram URLs to our combined array
            if (Array.isArray(result.diagramUrls)) {
                combinedResult.diagramUrls.push(...result.diagramUrls);
            } else if (Array.isArray(result)) {
                // Handle legacy format for backward compatibility
                combinedResult.diagramUrls.push(...result);
            }
            
            // If any diagram had an issue requiring review, mark the question for review
            if (result.needs_review === true) {
                combinedResult.needs_review = true;
            }
        });
        
        return combinedResult;
    } catch (err) {
        console.error(`Diagram upload error for question ${index + 1}:`, err.message);
        // Return empty array but mark for review instead of throwing error
        return { diagramUrls: [], needs_review: true };
    }
};

// ---------------------------------------------------------------------------
// Preflight enum validation (used before DB save)
// ---------------------------------------------------------------------------
const preflightValidateQuestion = (question, index) => {
    const BOARD_ENUM = ['IGCSE', 'IB', 'A-Level', 'O-Level'];
    const TIER_ENUM = ['Core', 'Extended', 'SL', 'HL', 'N/A'];
    const DOCUMENT_TYPE_ENUM = ['Question Paper', 'Marking Scheme'];

    const documentType = normalizeString(question.document_type);
    const isMS = documentType === 'Marking Scheme';

    const board = sanitizeBoard(question.curriculum || question.board);
    const tier = normalizeString(question.tier_level || question.tier);
    const paperNumber = normalizeOptionalNumber(question.paper_number || question.paperNumber || question.paper);
    const questionType = normalizeString(question.question_type) || 'SUBJECTIVE';

    // For MS entries, question_latex holds the question number/label — it must be non-blank.
    const hasContent =
        !isBlank(question.question_latex) ||
        !isBlank(question.latex) ||
        !isBlank(question.question) ||
        (questionType === 'MCQ' && Array.isArray(question.options) && question.options.some(o => !isBlank(o)));

    if (!DOCUMENT_TYPE_ENUM.includes(documentType))
        return `Question ${index + 1}: Invalid document_type "${documentType}". Allowed: ${DOCUMENT_TYPE_ENUM.join(', ')}`;

    // Board/tier validation is only strict for Question Papers.
    if (!isMS) {
        if (!BOARD_ENUM.includes(board))
            return `Question ${index + 1}: Invalid board "${board}". Allowed: ${BOARD_ENUM.join(', ')}`;
        if (tier && !TIER_ENUM.includes(tier))
            return `Question ${index + 1}: Invalid tier "${tier}". Allowed: ${TIER_ENUM.join(', ')}`;
    }

    if (paperNumber !== undefined && ![1, 2, 3, 4, 5, 6].includes(paperNumber))
        return `Question ${index + 1}: Invalid paper_number ${paperNumber}. Allowed: 1–6`;

    if (!hasContent)
        return `Question ${index + 1}: Missing question content.`;

    return null;
};

// ---------------------------------------------------------------------------
// PaperRegistry upsert with key normalization
// ---------------------------------------------------------------------------
async function upsertPaperRegistry(documentData) {
    const MAX_RETRIES = 3;
    let retryCount = 0;
    let lastError = null;

    while (retryCount < MAX_RETRIES) {
        try {
            const normalizedKey = await normalizeReferenceKey(documentData.paper_reference_key);
            
            const updateData = {
                ...documentData,
                paper_reference_key: normalizedKey
            };

            // Use normalized key as the sole filter
            const result = await PaperRegistry.findOneAndUpdate(
                { paper_reference_key: normalizedKey },
                updateData,
                { 
                    upsert: true, 
                    new: true, 
                    setDefaultsOnInsert: true 
                }
            );

            // Check and update pairing status
            if (result.qp_document_id && result.ms_document_id) {
                result.status = 'paired';
                await result.save();
            }

            return result;
        } catch (error) {
            lastError = error;
            
            // Check if error is a write conflict or duplicate key error
            const isRetryableError = 
                error.name === 'MongoError' || 
                error.name === 'MongoServerError' || 
                error.code === 11000 || // Duplicate key error
                error.message.includes('WriteConflict');
                
            if (isRetryableError && retryCount < MAX_RETRIES - 1) {
                retryCount++;
                // Exponential backoff delay: 100ms, 200ms, 400ms
                const delay = Math.pow(2, retryCount) * 100;
                console.log(`Retry ${retryCount}/${MAX_RETRIES} for paper_reference_key ${documentData.paper_reference_key} after ${delay}ms`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            
            console.error(`Error in upsertPaperRegistry after ${retryCount} retries:`, error);
            throw error;
        }
    }
    
    throw lastError;
}

// ---------------------------------------------------------------------------
// Verify Cloudinary image cropping
// ---------------------------------------------------------------------------
async function verifyCloudinaryImageCropping(documentId) {
    try {
        const diagramUrls = await cloudinary.getCroppedDiagrams(documentId);
        console.log('Diagram URLs:', diagramUrls);
        return diagramUrls;
    } catch (error) {
        console.error('Cloudinary image cropping verification failed:', error);
        return [];
    }
}

// ---------------------------------------------------------------------------
// POST /api/v1/internal/process-page
// ---------------------------------------------------------------------------
const processDualUpload = async (req, res) => {
    try {
        const { imageBase64, metadata, mime_type, page1_image } = req.body;

        if (!imageBase64 || !metadata) {
            return res.status(400).json({
                success: false,
                message: 'Missing required data: imageBase64 or paper metadata',
            });
        }

        const docType = normalizeString(metadata.document_type || 'Question Paper');
        const fileName = normalizeString(metadata.file_name || '');
        const board = sanitizeBoard(metadata.board || 'IGCSE');

        console.log(`📦 [Ingestion] Processing | type: ${docType} | board: ${board} | file: ${fileName}`);

        // 1. Send to Python engine (passes board and page1_image for IB extraction)
        const ai_result = await sendToPythonEngine(
            imageBase64,
            docType,
            mime_type || 'image/png',
            fileName,
            board,
            page1_image
        );

        const rawQuestions = Array.isArray(ai_result)
            ? ai_result
            : (Array.isArray(ai_result?.questions_array) ? ai_result.questions_array : []);

        // paper_reference_key: prefer Python-generated value; fall back to Node-side generation
        const metaPRK = normalizeString(
            ai_result?.metadata?.paper_reference_key ||
            generatePaperReferenceKey(fileName)
        );

        console.log(`🔑 [Ingestion] paper_reference_key: "${metaPRK}" | ${rawQuestions.length} items`);

        // 2. Finalize each question/MS entry
        const finalizedArray = rawQuestions.map((q) => {
            const isMS = (normalizeString(q.document_type || docType)) === 'Marking Scheme';

            const prk = normalizeString(
                q.paper_reference_key ||
                metaPRK
            );

            let extractedSubjectCode = sanitizeSubjectCode(q.subjectCode || q.subject_code || metadata.subject_code);
            // If the incoming subjectCode is a full name, let it override a numeric code (like "2225")
            if (q.subject_name && isNaN(Number(sanitizeSubjectCode(q.subject_name)))) {
                extractedSubjectCode = sanitizeSubjectCode(q.subject_name);
            }

            return {
                // ── Preserve every AI field as-is ──────────────────────────
                ...q,

                // ── Document type (authoritative from pipeline) ─────────────
                document_type: isMS ? 'Marking Scheme' : 'Question Paper',

                // ── Fingerprint ─────────────────────────────────────────────
                paper_reference_key: prk,

                // ── Canonical question text ─────────────────────────────────
                question_latex: resolveQuestionLatex(q),

                // ── Canonical marking scheme ────────────────────────────────
                official_marking_scheme_latex: resolveMarkingScheme(q),

                // ── Metadata: prefer AI-extracted; fall back to request ──────
                board: sanitizeBoard(q.curriculum || q.board || metadata.board),
                curriculum: sanitizeBoard(q.curriculum || q.board || metadata.board),
                subject_code: extractedSubjectCode,
                subjectCode: extractedSubjectCode,
                tier_level: normalizeString(q.tier || q.tier_level || metadata.tier_level),
                tier: normalizeString(q.tier || metadata.tier_level),
                paper_number: normalizeOptionalNumber(q.paperNumber ?? q.paper_number ?? metadata.paper_number),
                paperNumber: normalizeOptionalNumber(q.paperNumber ?? metadata.paper_number),
                session: normalizeString(q.session || metadata.session || ''),
                variant: normalizeString(q.variant || metadata.variant || 'N/A'),
                year: normalizeOptionalNumber(q.year ?? metadata.year) ?? null,

                // ── Clean arrays ────────────────────────────────────────────
                options: Array.isArray(q.options) ? q.options : [],
                variables: Array.isArray(q.variables) ? q.variables : [],
                diagram_urls: sanitizeDiagramUrls(q.diagram_urls),

                // ── Booleans ────────────────────────────────────────────────
                isTemplatizable: q.isTemplatizable === true,
                needs_review: q.needs_review === true || (q.confidence !== undefined && q.confidence < 0.70) || !prk || !extractedSubjectCode || !normalizeOptionalNumber(q.year ?? metadata.year),
            };
        });

        return res.status(200).json({
            success: true,
            message: 'Page processed successfully.',
            data: {
                metadata: {
                    ...(ai_result?.metadata || {}),
                    paper_reference_key: metaPRK,
                    document_type: docType,
                },
                questions_array: finalizedArray,
            },
        });

    } catch (error) {
        console.error('[Ingestion Process Error]:', error.message, error.details || '');
        return res.status(error.statusCode || 500).json({
            success: false,
            message: 'Server error during extraction',
            error: error.message,
            details: error.details || null,
            stage: error.stage || error.details?.error?.stage || null,
        });
    }
};

// ---------------------------------------------------------------------------
// POST /api/v1/internal/save-batch
// ---------------------------------------------------------------------------
const saveVerifiedBatch = async (req, res) => {
    try {
        const verifiedQuestionsArray =
            req.body.verifiedQuestionsArray || req.body.questionsArray;

        if (!Array.isArray(verifiedQuestionsArray) || verifiedQuestionsArray.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid data: provide a non-empty questions array.',
            });
        }

        console.log(`🗄️ [Database] Storing ${verifiedQuestionsArray.length} verified items…`);

        // Preflight validation (parallel)
        const validationErrors = await Promise.all(
            verifiedQuestionsArray.map(async (q, i) => ({
                index: i,
                error: preflightValidateQuestion(q, i)
            }))
        );
        
        const firstError = validationErrors.find(item => item.error);
        if (firstError) {
            return res.status(400).json({ 
                success: false, 
                message: firstError.error 
            });
        }

        // Process diagrams in parallel
        const processedQuestions = await Promise.all(
            verifiedQuestionsArray.map(async (q, index) => {
                const { diagram_images_base64, diagram_image_base64, diagram_urls, ...rest } = q;

                // Support both old payload keys and the new `diagram_urls` array
                let rawDiagrams = [];
                if (Array.isArray(diagram_urls) && diagram_urls.length > 0) {
                    rawDiagrams = diagram_urls;
                } else if (Array.isArray(diagram_images_base64)) {
                    rawDiagrams = diagram_images_base64;
                } else if (diagram_image_base64) {
                    rawDiagrams = [diagram_image_base64];
                }

                // Sanitize diagram URLs to ensure proper format
                const sanitizedDiagrams = sanitizeDiagramUrls(rawDiagrams);
                
                // Process diagram uploads in parallel batches to avoid overwhelming Cloudinary
                const diagramResults = await persistDiagramUrls(sanitizedDiagrams, index);
                const finalDiagramUrls = diagramResults.diagramUrls || [];
                
                // Set needs_review flag if any diagram had issues
                const needsReviewForDiagrams = diagramResults.needs_review === true;

                const documentType = normalizeString(q.document_type) || 'Question Paper';
                const isMS = documentType === 'Marking Scheme';

                // paper_reference_key: required — generate from file_name if still blank
                const prk = normalizeString(q.paper_reference_key) ||
                            generatePaperReferenceKey(normalizeString(q.file_name || ''));
                const normalizedPrk = await normalizeReferenceKey(prk);

                let board = sanitizeBoard(q.curriculum || q.board);
                // Ensure board is strictly "IB", not "International Baccalaureate"
                if (board.toUpperCase().includes('INTERNATIONAL') || board.toUpperCase().includes('BACCALAUREATE')) {
                    board = 'IB';
                }

                return {
                    doc: {
                        ...rest,
                        // ── Classification ──────────────────────────────────────
                        document_type: documentType,
                        // ── Fingerprint ─────────────────────────────────────────
                        paper_reference_key: prk,
                        // ── Normalised metadata ─────────────────────────────────
                        board,
                        curriculum: board,
                        subjectCode: sanitizeSubjectCode(q.subjectCode || q.subject_code),
                        subject_code: sanitizeSubjectCode(q.subject_code || q.subjectCode),
                        tier_level: normalizeString(q.tier_level || q.tier),
                        tier: normalizeString(q.tier || q.tier_level),
                        document_type: documentType,
                        question_type: normalizeString(q.question_type) || 'SUBJECTIVE',
                        options: Array.isArray(q.options) ? q.options : [],
                        paper_number: normalizeOptionalNumber(q.paper_number || q.paperNumber || q.paper),
                        paperNumber: normalizeOptionalNumber(q.paperNumber || q.paper_number),
                        year: normalizeOptionalNumber(q.year),
                        question_latex: resolveQuestionLatex(q),
                        official_marking_scheme_latex: resolveMarkingScheme(q),
                        diagram_urls: finalDiagramUrls,
                        is_template: true,
                        needs_review: needsReviewForDiagrams || (prk && prk.startsWith('UNKNOWN_REF')) || false,
                        // ── MS Training fields ──────────────────────────────────
                        question_id: isMS ? normalizeString(q.question_id || resolveQuestionLatex(q)) : '',
                        final_answer: isMS ? normalizeString(q.final_answer || '') : '',
                        total_marks: isMS ? (Number.isFinite(Number(q.total_marks)) ? Number(q.total_marks) : 0) : 0,
                        method_steps: isMS ? normalizeMethodSteps(q.method_steps) : [],
                    },
                    isMS,
                    board,
                    normalizedPrk,
                    index
                };
            })
        );

        // Group documents by collection for bulk operations
        const igcseQuestions = [];
        const ibQuestions = [];
        const igcseMarkingSchemes = [];
        const ibMarkingSchemes = [];
        const legacyDocuments = [];
        const registryUpdates = [];

        // Organize documents by collection type
        processedQuestions.forEach(item => {
            const { doc, isMS, board } = item;
            
            if (board === 'IGCSE') {
                if (isMS) {
                    igcseMarkingSchemes.push(doc);
                } else {
                    igcseQuestions.push(doc);
                }
            } else if (board === 'IB') {
                if (isMS) {
                    ibMarkingSchemes.push(doc);
                } else {
                    ibQuestions.push(doc);
                }
            } else {
                // Fallback to legacy collection
                legacyDocuments.push(doc);
            }
        });

        // Perform bulk insertions in parallel
        const [
            savedIGCSEQuestions,
            savedIBQuestions,
            savedIGCSESchemes,
            savedIBSchemes,
            savedLegacy
        ] = await Promise.all([
            igcseQuestions.length > 0 ? IGCSEQuestion.insertMany(igcseQuestions, { ordered: false }) : [],
            ibQuestions.length > 0 ? IBQuestion.insertMany(ibQuestions, { ordered: false }) : [],
            igcseMarkingSchemes.length > 0 ? IGCSEMarkingScheme.insertMany(igcseMarkingSchemes, { ordered: false }) : [],
            ibMarkingSchemes.length > 0 ? IBMarkingScheme.insertMany(ibMarkingSchemes, { ordered: false }) : [],
            legacyDocuments.length > 0 ? Question.insertMany(legacyDocuments, { ordered: false }) : []
        ]);

        // Combine all saved documents
        const allSavedDocs = [
            ...(Array.isArray(savedIGCSEQuestions) ? savedIGCSEQuestions : []),
            ...(Array.isArray(savedIBQuestions) ? savedIBQuestions : []),
            ...(Array.isArray(savedIGCSESchemes) ? savedIGCSESchemes : []),
            ...(Array.isArray(savedIBSchemes) ? savedIBSchemes : []),
            ...(Array.isArray(savedLegacy) ? savedLegacy : [])
        ];

        // Map saved documents to their original processing info
        const savedDocsWithInfo = allSavedDocs.map(savedDoc => {
            const originalInfo = processedQuestions.find(
                q => q.doc.paper_reference_key === savedDoc.paper_reference_key &&
                    q.doc.document_type === savedDoc.document_type
            );
            return { savedDoc, ...originalInfo };
        });
        
        // Perform registry updates using bulk operations
        const bulkRegistryOps = savedDocsWithInfo.map(({ savedDoc, normalizedPrk, isMS, board }) => {
            const updateFields = { board };
            if (isMS) {
                updateFields.ms_document_id = savedDoc._id;
            } else {
                updateFields.qp_document_id = savedDoc._id;
            }

            return {
                updateOne: {
                    filter: { paper_reference_key: normalizedPrk },
                    update: { 
                        $set: updateFields, 
                        $setOnInsert: { paper_reference_key: normalizedPrk } 
                    },
                    upsert: true
                }
            };
        });

        if (bulkRegistryOps.length > 0) {
            await PaperRegistry.bulkWrite(bulkRegistryOps);
        }
        
        // Update status for all registry entries
        // Get all affected registry keys
        const registryKeys = [...new Set(savedDocsWithInfo.map(item => item.normalizedPrk))];
        
        // Find all affected registry documents
        const registryDocs = await PaperRegistry.find({ 
            paper_reference_key: { $in: registryKeys } 
        });
        
        // Update status based on presence of both IDs in a single operation
        const statusUpdateOps = registryDocs.map(reg => {
            let status;
            if (reg.qp_document_id && reg.ms_document_id) {

                status = 'paired';
            } else if (reg.ms_document_id) {
                status = 'ms_only';
            } else {
                status = 'qp_only';
            }
            
            return {
                updateOne: {
                    filter: { _id: reg._id },
                    update: { $set: { status } }
                }
            };
        });
        
        // Execute registry status updates if any
        if (statusUpdateOps.length > 0) {
            const updateResult = await PaperRegistry.bulkWrite(statusUpdateOps);
            console.log(`🔄 [Registry] Updated ${updateResult.modifiedCount} document statuses`);
            registryUpdates.push(...registryDocs);
        }

        // Performance metrics
        const elapsed = Date.now() - req.startTime;
        
        return res.status(201).json({
            success: true,
            message: `Successfully saved ${allSavedDocs.length} items with ${registryUpdates.length} registry updates.`,
            count: allSavedDocs.length,
            registry_updates: registryUpdates.length,
            performance: {
                total_ms: elapsed,
                ms_per_item: allSavedDocs.length > 0 ? Math.round(elapsed / allSavedDocs.length) : 0
            }
        });
    } catch (error) {
        console.error('❌ [Database Save Error]:', error.message);

        if (error.name === 'ValidationError') {
            const first = Object.values(error.errors || {})[0];
            return res.status(400).json({
                success: false,
                message: first?.message || 'Schema validation failed.',
                error: error.message,
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Failed to save batch.',
            error: error.message,
        });
    }
};

// ---------------------------------------------------------------------------
// GET /api/v1/internal/counts
// ---------------------------------------------------------------------------
const getQuestionCounts = async (req, res) => {
    try {
        // Count across all collections
        const [
            legacyQuestionPapers, 
            legacyMarkingSchemes,
            igcseQuestionPapers,
            ibQuestionPapers,
            igcseMarkingSchemes, 
            ibMarkingSchemes
        ] = await Promise.all([
            Question.countDocuments({ document_type: 'Question Paper' }),
            Question.countDocuments({ document_type: 'Marking Scheme' }),
            IGCSEQuestion.countDocuments({}),
            IBQuestion.countDocuments({}),
            IGCSEMarkingScheme.countDocuments({}),
            IBMarkingScheme.countDocuments({})
        ]);
        
        // Combined counts for the frontend
        const questionPapers = legacyQuestionPapers + igcseQuestionPapers + ibQuestionPapers;
        const markingSchemes = legacyMarkingSchemes + igcseMarkingSchemes + ibMarkingSchemes;
        
        // Also count registry entries
        const registryCount = await PaperRegistry.countDocuments({});
        const pairedCount = await PaperRegistry.countDocuments({ status: 'paired' });
        
        return res.status(200).json({ 
            questionPapers, 
            markingSchemes,
            registry: {
                total: registryCount,
                paired: pairedCount
            },
            details: {
                legacy: {
                    questionPapers: legacyQuestionPapers,
                    markingSchemes: legacyMarkingSchemes
                },
                igcse: {
                    questionPapers: igcseQuestionPapers,
                    markingSchemes: igcseMarkingSchemes
                },
                ib: {
                    questionPapers: ibQuestionPapers,
                    markingSchemes: ibMarkingSchemes
                }
            }
        });
    } catch (error) {
        console.error('❌ [Count Error]:', error.message);
        return res.status(500).json({ 
            questionPapers: 0, 
            markingSchemes: 0,
            registry: { total: 0, paired: 0 },
            details: {
                legacy: { questionPapers: 0, markingSchemes: 0 },
                igcse: { questionPapers: 0, markingSchemes: 0 },
                ib: { questionPapers: 0, markingSchemes: 0 }
            }
        });
    }
};

// ---------------------------------------------------------------------------
// Request performance tracking middleware
// ---------------------------------------------------------------------------
const trackRequestTime = (req, res, next) => {
    req.startTime = Date.now();
    next();
};

// Clear cache endpoint for development/testing
const clearCaches = (req, res) => {
    try {
        // Could clear any in-memory caches here
        return res.status(200).json({
            success: true,
            message: 'Caches cleared successfully',
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Failed to clear caches',
            error: error.message
        });
    }
};

// ---------------------------------------------------------------------------
// Manual pairing for documents
// ---------------------------------------------------------------------------
const manualPairDocuments = async (req, res) => {
    try {
        const { qp_id, ms_id, ref_code_override } = req.body;

        if (!qp_id && !ms_id) {
            return res.status(400).json({
                success: false,
                message: 'At least one ID (qp_id or ms_id) is required for manual pairing'
            });
        }

        // If ref_code_override is provided, use it directly
        // Otherwise, try to determine the reference key from one of the documents
        let referenceKey = ref_code_override;

        if (!referenceKey) {
            // Find documents to determine reference key
            let document;
            if (qp_id) {
                // Try IGCSE first, then IB, then legacy
                document = 
                    await IGCSEQuestion.findById(qp_id) ||
                    await IBQuestion.findById(qp_id) ||
                    await Question.findById(qp_id);
            }
            
            if (!document && ms_id) {
                // If QP not found or not provided, try MS
                document = 
                    await IGCSEMarkingScheme.findById(ms_id) ||
                    await IBMarkingScheme.findById(ms_id) ||
                    await Question.findById(ms_id);
            }

            if (!document) {
                return res.status(404).json({
                    success: false,
                    message: 'Could not find any document with the provided IDs'
                });
            }

            referenceKey = document.paper_reference_key;
            
            if (!referenceKey) {
                return res.status(400).json({
                    success: false,
                    message: 'Document exists but has no paper_reference_key. Please provide ref_code_override.'
                });
            }
        }

        // Normalize the reference key
        const normalizedKey = await normalizeReferenceKey(referenceKey);
        
        // Find or create registry entry
        const updateData = { paper_reference_key: normalizedKey };
        if (qp_id) updateData.qp_document_id = qp_id;
        if (ms_id) updateData.ms_document_id = ms_id;
        
        // Set status based on what we have
        if (qp_id && ms_id) {
            updateData.status = 'paired';
        } else if (qp_id) {
            updateData.status = 'qp_only';
        } else {
            updateData.status = 'ms_only';
        }

        // Use findOneAndUpdate with upsert to create if it doesn't exist
        const result = await PaperRegistry.findOneAndUpdate(
            { paper_reference_key: normalizedKey },
            { $set: updateData },
            { 
                upsert: true, 
                new: true, 
                setDefaultsOnInsert: true 
            }
        );

        return res.status(200).json({
            success: true,
            message: `Successfully ${result.status === 'paired' ? 'paired documents' : 'updated registry'}`,
            data: result
        });
    } catch (error) {
        console.error('Manual pairing error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to manually pair documents',
            error: error.message
        });
    }
};

module.exports = {
    processDualUpload,
    saveVerifiedBatch,
    getQuestionCounts,
    upsertPaperRegistry,
    verifyCloudinaryImageCropping,
    normalizeReferenceKey,
    trackRequestTime,
    clearCaches,
    manualPairDocuments
};
