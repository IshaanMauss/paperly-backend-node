// File: models/PaperRegistry.js
const mongoose = require('mongoose');

const paperRegistrySchema = new mongoose.Schema(
    {
        // Unique reference key for the paper
        paper_reference_key: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            index: true,
        },

        // Reference key for the paired paper (QP paired with MS or vice versa)
        paired_key: {
            type: String,
            default: "",
            trim: true,
            index: true,
        },

        // Education board
        board: {
            type: String,
            required: true,
            enum: ['IGCSE', 'IB'],
            index: true,
        },

        // Status of the paper
        status: {
            type: String,
            required: true,
            enum: ['qp_only', 'ms_only', 'paired', 'conflict'],
            default: 'qp_only',
        },

        // Reference to the question paper document (if available)
        qp_document_id: {
            type: mongoose.Schema.Types.ObjectId,
            refPath: function() {
                return this.board === 'IGCSE' ? 'IGCSEQuestion' : 'IBQuestion';
            },
            default: null,
        },

        // Reference to the marking scheme document (if available)
        ms_document_id: {
            type: mongoose.Schema.Types.ObjectId,
            refPath: function() {
                return this.board === 'IGCSE' ? 'IGCSEMarkingScheme' : 'IBMarkingScheme';
            },
            default: null,
        },

        // Timestamp for when the paper was uploaded
        uploaded_at: {
            type: Date,
            default: Date.now,
        },

        // Timestamp for when the paper was last validated
        last_validated_at: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

// Compound index for faster lookups
paperRegistrySchema.index({ board: 1, status: 1 });
paperRegistrySchema.index({ board: 1, paired_key: 1 }, { sparse: true });

module.exports = mongoose.model('PaperRegistry', paperRegistrySchema);