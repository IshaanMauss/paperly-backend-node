// File: models/Question.js
const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
    // 1. Board & Subject Code (From PDF)
    board: {
        type: String,
        required: false,
        trim: true,
    },
    subject_code: {
        type: String,
        required: false,
        // IGCSE examples: '0580', '0606', '0607'
        // IB examples: 'AA', 'AI'
    },

    // 2. Academic Tier & Paper Details (Crucial Updates)
    tier_level: {
        type: String,
        required: false,
        // IGCSE: 'Core', 'Extended'
        // IB: 'SL', 'HL'
        // 'N/A' for subjects like 0606 which might not have tier splits
        trim: true,
    },
    paper_number: {
        type: Number,
        required: false,
        // IGCSE: 1, 2, 3, 4, 5, 6
        // IB: 1, 2, 3
    },
    variant: {
        type: String,
        required: false, // e.g., '22' or 'TZ1' (Timezones for IB)
    },
    calculator_allowed: {
        type: Boolean,
        required: false, // This is directly mapped from the PDF paper structures
    },
    document_type: {
        type: String,
        required: true,
        default: 'Question Paper',
        trim: true,
    },
    year: {
        type: Number,
        required: false,
    },

    // 3. Question Metadata
    topic: {
        type: String,
        required: false, // AI will fill this (e.g., 'Trigonometry')
    },
    difficulty: {
        type: String,
        required: false,
    },
    question_type: {
        type: String,
        default: 'SUBJECTIVE',
    },
    options: {
        type: [String],
        default: [],
    },

    // 4. The Core Data (Phase 1)
    question_latex: {
        type: String,
        required: true, 
    },
    official_marking_scheme_latex: {
        type: String,
        required: false,
    },
    diagram_url: {
        type: String,
        default: null,
    },

    // 5. System Flags (Phase 3)
    is_template: {
        type: Boolean,
        default: true, 
    },
    needs_review: {
        type: Boolean,
        default: false, 
    }
}, { 
    timestamps: true 
});

// Compound Index for blazing fast SaaS Filtering
questionSchema.index({ board: 1, subject_code: 1, tier_level: 1, paper_number: 1 });

module.exports = mongoose.model('Question', questionSchema);