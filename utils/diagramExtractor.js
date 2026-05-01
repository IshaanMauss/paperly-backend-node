const pdf2pic = require("pdf2pic");

/**
 * Extract diagrams from file buffer with robust error handling for unsupported formats
 *
 * @param {Buffer|String} fileBuffer - The file buffer or base64 string to extract diagrams from
 * @param {Object} options - Configuration options
 * @param {boolean} [options.setNeedsReview=false] - Whether to return needs_review flag
 * @returns {Object} - Object with diagrams array and needs_review flag if requested
 */
async function extractDiagrams(fileBuffer, options = {}) {
  try {
    // Default options
    const defaultOptions = {
      maxDiagrams: 5,
      minDiagramSize: 1024,      // 1 KB (Ab chote diagrams bhi pass honge)
      maxDiagramSize: 5 * 1024 * 1024,
      minWidth: 200,
      minHeight: 200,
      setNeedsReview: false
    };

    const config = { ...defaultOptions, ...options };

    const result = {
      diagrams: [],
      needs_review: false
    };

    let diagrams = [];

    if (typeof fileBuffer === "string") {
      // CRITICAL FIX: Guard clause for "[NEEDS_CROP]" placeholder or unusually short strings
      if (fileBuffer.includes("[NEEDS_CROP]") || fileBuffer.length < 100) {
        result.needs_review = true;
        console.error("Detected invalid base64 string (either \"[NEEDS_CROP]\" placeholder or too short). Skipping upload.");
        // Return an empty array for diagrams, as specified
        return config.setNeedsReview ? result : [];
      }
      
      // Ensure the base64 string is a proper Data URI
      const base64Data = fileBuffer.replace(/^data:image\/\w+;base64,/, "");
      const finalBase64 = "data:image/png;base64," + base64Data;
      console.log("Successfully formatted base64 string to Data URI");
      diagrams.push(finalBase64);
    } else {
      // Assume it's a Buffer for PDF processing
      // %PDF magic bytes: 0x25 0x50 0x44 0x46
      const isPdf =
        fileBuffer.length >= 4 &&
        fileBuffer[0] === 0x25 &&
        fileBuffer[1] === 0x50 &&
        fileBuffer[2] === 0x44 &&
        fileBuffer[3] === 0x46;

      if (isPdf) {
        // PDF extraction
        const converter = new pdf2pic.fromBuffer(fileBuffer, {
          width: 2000,
          height: 2000,
          density: 300,
          savePath: "./temp_diagrams",
          format: "png"
        });

        const pages = await converter.bulk(-1, true);
        diagrams = pages.map(page => page.path);
      } else {
        // If it's not a PDF and not a base64 string, it's an unsupported format
        result.needs_review = true;
        console.error("Unsupported file format received for diagram extraction.");
      }
    }

    // Limit number of diagrams
    result.diagrams = diagrams.slice(0, config.maxDiagrams);

    return config.setNeedsReview ? result : result.diagrams;
  } catch (error) {
    console.error("Diagram extraction error:", error);

    const result = {
      diagrams: [],
      needs_review: true
    };

    return config.setNeedsReview ? result : result.diagrams;
  }
}

module.exports = {
  extractDiagrams
};