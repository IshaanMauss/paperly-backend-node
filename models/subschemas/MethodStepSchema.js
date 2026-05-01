// File: models/subschemas/MethodStepSchema.js
const mongoose = require('mongoose');

// ---------------------------------------------------------------------------
// Sub-schema: a single mark-point in a Marking Scheme entry
// ---------------------------------------------------------------------------
const methodStepSchema = new mongoose.Schema(
    {
        type:        { type: String, default: '' }, // M1, A1, B1, ft, oe, dep, allow, accept …
        description: { type: String, default: '' }, // What earns this mark (LaTeX if math)
    },
    { _id: false }
);

module.exports = methodStepSchema;