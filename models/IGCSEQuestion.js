// File: models/IGCSEQuestion.js
const mongoose = require('mongoose');
const { sanitizeDiagramUrls, isValidUrl } = require('../utils/diagramUrlSanitizer');
const methodStepSchema = require('./subschemas/MethodStepSchema');

// ---------------------------------------------------------------------------
// IGCSE Question schema
// ---------------------------------------------------------------------------
const igcseQuestionSchema = new mongoose.Schema(
    {
        // ── Document classification ──────────────────────────────────────────
        document_type: {
            type:     String,
            required: true,
            enum:     ['Question Paper'],
            default:  'Question Paper',
        },

        // ── Paper metadata ───────────────────────────────────────────────────
        curriculum: {
            type:     String,
            required: true,
            enum:     ['IGCSE'],
            default:  'IGCSE',
        },
        program: {
            type:     String,
            required: false,
        },
        subjectCode: {
            type:     String,
            required: true,
            trim:     true,
        },
        tier: {
            type:     String,
            required: false,
        },
        paperNumber: {
            type:     Number,
            required: false,
        },
        session: {
            type:     String,
            required: false,
        },
        year: {
            type:     Number,
            required: true,
        },

        // ── Fingerprint — links QP ↔ MS ──────────────────────────────────────
        paper_reference_key: {
            type:     String,
            required: true,
            trim:     true,
        },

        // ── QP fields ────────────────────────────────────────────────────────
        isTemplatizable: {
            type:    Boolean,
            default: false,
        },
        variables: {
            type:    [String],
            default: [],
        },
        question_latex: {
            type:     String,
            required: true,
        },
        official_marking_scheme_latex: {
            type:     String,
            required: false,
        },
  diagram_urls: {
    type: [String],
    default: [],
    validate: {
      validator: function(urls) {
        // Ensure it's an array of strings
        if (!Array.isArray(urls)) return false;
        
        // Sanitize to be sure
        const sanitized = sanitizeDiagramUrls(urls);
        
        // Check if every item is a valid string URL
        return sanitized.every(url => typeof url === 'string' && url.trim() !== '');
      },
      message: 'diagram_urls must be a flat array of valid URL strings'
    },
    // Pre-save sanitization
    set: function(urls) {
      return sanitizeDiagramUrls(urls);
    }
  },
        needs_review: {
            type:    Boolean,
            default: false,
        },
    },
    {
        timestamps: true,
    }
);

// Compound index for fast SaaS filtering
igcseQuestionSchema.index({
    curriculum:          1,
    program:             1,
    subjectCode:         1,
    paperNumber:         1,
    session:             1,
    year:                1,
    tier:                1,
    paper_reference_key: 1,
});

// Fast lookup: find the MS that belongs to a given QP (or vice-versa)
igcseQuestionSchema.index({ paper_reference_key: 1 });

module.exports = mongoose.model('IGCSEQuestion', igcseQuestionSchema);