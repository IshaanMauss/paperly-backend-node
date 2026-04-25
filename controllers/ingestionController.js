// File: controllers/ingestionController.js
const Question = require('../models/Question'); 
const { sendToPythonEngine } = require('../services/pythonEngine');
const { uploadBase64Image } = require('../utils/cloudinary');

const BOARD_ENUM = ['IGCSE', 'IB', 'A-Level', 'O-Level'];
const TIER_ENUM = ['Core', 'Extended', 'SL', 'HL', 'N/A'];
const DOCUMENT_TYPE_ENUM = ['Question Paper', 'Marking Scheme'];

const isBlank = (value) => value === undefined || value === null || String(value).trim() === '';

const normalizeString = (value) => (isBlank(value) ? '' : String(value).trim());
const normalizeOptionalNumber = (value) => {
    if (value === undefined || value === null || String(value).trim() === '') return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
};

const preflightValidateQuestionEnums = (question, index) => {
    const board = normalizeString(question.board);
    const tier = normalizeString(question.tier_level || question.tier); // Fallback for frontend mismatch
    const documentType = normalizeString(question.document_type);
    const paperNumber = normalizeOptionalNumber(question.paper_number || question.paper);
    const questionType = normalizeString(question.question_type) || 'SUBJECTIVE';
    const hasValidQuestionLatex = !isBlank(question.question_latex) || !isBlank(question.latex);
    const hasValidQuestionText = !isBlank(question.question);
    const hasMcqOptions = Array.isArray(question.options) && question.options.some((opt) => !isBlank(opt));
    const hasValidQuestionContent =
        hasValidQuestionLatex ||
        hasValidQuestionText ||
        (questionType === 'MCQ' && hasMcqOptions);

    if (!BOARD_ENUM.includes(board)) {
        return `Question ${index + 1}: Invalid or missing board. Allowed values: ${BOARD_ENUM.join(', ')}`;
    }
    if (!TIER_ENUM.includes(tier)) {
        return `Question ${index + 1}: Invalid or missing tier_level. Allowed values: ${TIER_ENUM.join(', ')}`;
    }
    if (!DOCUMENT_TYPE_ENUM.includes(documentType)) {
        return `Question ${index + 1}: Invalid or missing document_type. Allowed values: ${DOCUMENT_TYPE_ENUM.join(', ')}`;
    }
    if (paperNumber !== undefined && ![1, 2, 3, 4, 5, 6].includes(paperNumber)) {
        return `Question ${index + 1}: Invalid paper_number. Allowed values: 1, 2, 3, 4, 5, 6`;
    }
    if (!hasValidQuestionContent) {
        return `Question ${index + 1}: Missing question content (question_latex/latex/question/options).`;
    }
    return null;
};

const persistDiagramUrls = async (diagramImagesBase64, index) => {
    if (!Array.isArray(diagramImagesBase64) || diagramImagesBase64.length === 0) return [];
    try {
        return await Promise.all(
            diagramImagesBase64
                .filter((imageBase64) => !isBlank(imageBase64))
                .map((imageBase64) => uploadBase64Image(imageBase64))
        );
    } catch (error) {
        throw new Error(`Diagram upload failed for question ${index + 1}: ${error.message}`);
    }
};

/**
 * @desc    Process a single page (Image + Metadata)
 * @route   POST /api/v1/internal/process-page
 */
const processDualUpload = async (req, res) => {
    try {
        const { imageBase64, metadata, mime_type } = req.body;

        if (!imageBase64 || !metadata) {
            return res.status(400).json({ 
                success: false, 
                message: 'Missing required data: imageBase64 or paper metadata' 
            });
        }

        console.log(`📦 [Ingestion] Processing ${metadata.board} ${metadata.subject_code} - Tier: ${metadata.tier_level}`);
        
        // 1. Send to Python Engine
        const structuredArray = await sendToPythonEngine(
            imageBase64,
            metadata.document_type,
            mime_type || 'image/png'
        );

        // 2. Inject Metadata into AI results
        const finalizedArray = structuredArray.map(question => ({
            question: question.question || '',
            latex: question.latex || '',
            question_type: question.question_type || 'SUBJECTIVE',
            options: Array.isArray(question.options) ? question.options : [],
            marking_scheme_latex: question.marking_scheme_latex || '',
            board: metadata.board,
            subject_code: metadata.subject_code,
            tier_level: metadata.tier_level,
            paper_number: metadata.paper_number,
            calculator_allowed: metadata.calculator_allowed,
            variant: metadata.variant || 'N/A',
            year: metadata.year || null,
            document_type: metadata.document_type || "Question Paper",
        }));

        return res.status(200).json({
            success: true,
            message: 'Page processed successfully. Metadata injected.',
            data: finalizedArray
        });

    } catch (error) {
        console.error('[Ingestion Process Error]:', {
            message: error.message,
            statusCode: error.statusCode,
            details: error.details
        });
        return res.status(error.statusCode || 500).json({ 
            success: false, 
            message: 'Server error during extraction', 
            error: error.message,
            details: error.details || null,
            stage: error.stage || error.details?.error?.stage || null
        });
    }
};

/**
 * @desc    Save the human-verified batch of questions to MongoDB
 * @route   POST /api/v1/internal/save-batch
 */
const saveVerifiedBatch = async (req, res) => {
    try {
        // Handle payload depending on what frontend sends (questionsArray or verifiedQuestionsArray)
        const verifiedQuestionsArray = req.body.verifiedQuestionsArray || req.body.questionsArray;

        // 1. Validation: Array check
        if (!verifiedQuestionsArray || !Array.isArray(verifiedQuestionsArray) || verifiedQuestionsArray.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid data format. Please provide a non-empty array of questions.' 
            });
        }

        console.log(`🗄️ [Database] Storing ${verifiedQuestionsArray.length} verified questions...`);

        // 2. Validation + Data Cleaning
        for (let i = 0; i < verifiedQuestionsArray.length; i += 1) {
            const validationMessage = preflightValidateQuestionEnums(verifiedQuestionsArray[i], i);
            if (validationMessage) {
                return res.status(400).json({
                    success: false,
                    message: validationMessage,
                });
            }
        }

        const questionsToSave = await Promise.all(verifiedQuestionsArray.map(async (q, index) => {
            // Remove raw base64 payload and upload all diagram images to Cloudinary.
            const { diagram_images_base64, diagram_image_base64, ...restOfQuestionData } = q; 
            
            const normalizedDiagramImages = Array.isArray(diagram_images_base64)
                ? diagram_images_base64
                : (diagram_image_base64 ? [diagram_image_base64] : []);
            const diagramUrls = await persistDiagramUrls(normalizedDiagramImages, index);
            
            return {
                ...restOfQuestionData, // Base64 is removed from here!
                board: normalizeString(q.board),
                tier_level: normalizeString(q.tier_level || q.tier),
                document_type: normalizeString(q.document_type) || 'Question Paper',
                question_type: normalizeString(q.question_type) || 'SUBJECTIVE',
                options: Array.isArray(q.options) ? q.options : [],
                paper_number: normalizeOptionalNumber(q.paper_number || q.paper),
                year: normalizeOptionalNumber(q.year),
                question_latex: q.question_latex || q.latex || q.question || '',
                official_marking_scheme_latex: q.official_marking_scheme_latex || q.marking_scheme_latex || '',
                diagram_urls: diagramUrls,
                is_template: true,  
                needs_review: false,
            };
        }));

        // 3. Execution: Bulk Insert (Blazing Fast now because no heavy images!)
        const savedQuestions = await Question.insertMany(questionsToSave);

        return res.status(201).json({
            success: true,
            message: `Successfully saved ${savedQuestions.length} questions to the database!`,
            count: savedQuestions.length
        });

    } catch (error) {
        console.error('❌ [Database Save Error]:', error.message);

        if (error.name === 'ValidationError') {
            const firstError = Object.values(error.errors || {})[0];
            return res.status(400).json({ 
                success: false, 
                message: firstError?.message || 'Schema Validation Failed.',
                error: error.message 
            });
        }

        return res.status(500).json({ 
            success: false, 
            message: 'Failed to save batch to database', 
            error: error.message 
        });
    }
};

module.exports = {
    processDualUpload,
    saveVerifiedBatch
};