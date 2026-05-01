// File: models/IBMarkingScheme.js
const mongoose = require('mongoose');
const methodStepSchema = require('./subschemas/MethodStepSchema');

// ---------------------------------------------------------------------------
// IB Marking Scheme schema
// ---------------------------------------------------------------------------
const ibMarkingSchemeSchema = new mongoose.Schema(
    {
        // ── Document classification ──────────────────────────────────────────
        document_type: {
            type:     String,
            required: true,
            enum:     ['Marking Scheme'],
            default:  'Marking Scheme',
        },

        // ── Paper metadata ───────────────────────────────────────────────────
        curriculum: {
            type:     String,
            required: true,
            enum:     ['IB'],
            default:  'IB',
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

        // ── MS fields ────────────────────────────────────────────────────────
        question_latex: {
            type:     String,
            required: true,
        },
        question_id: {
            type:     String,
            required: false,
            default:  '',
        },
        final_answer: {
            type:     String,
            required: false,
            default:  '',
        },
        total_marks: {
            type:     Number,
            required: false,
            default:  0,
        },
        method_steps: {
            type:    [methodStepSchema],
            default: [],
        },
        official_marking_scheme_latex: {
            type:     String,
            required: false,
        },
        diagram_urls: {
            type:    [String],
            default: [],
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
ibMarkingSchemeSchema.index({
    curriculum:          1,
    program:             1,
    subjectCode:         1,
    paperNumber:         1,
    session:             1,
    year:                1,
    tier:                1,
    paper_reference_key: 1,
});



module.exports = mongoose.model('IBMarkingScheme', ibMarkingSchemeSchema);