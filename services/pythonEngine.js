// File: services/pythonEngine.js
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

const buildPythonEngineUrl = () => {
    const baseUrl = process.env.PYTHON_ENGINE_URL?.trim();
    if (!baseUrl) {
        throw new Error('PYTHON_ENGINE_URL is not configured');
    }

    return `${baseUrl.replace(/\/+$/, '')}/api/extract`;
};

const sendToPythonEngine = async (
    base64Image,
    documentType = "Question Paper",
    mimeType = "image/png"
) => {
    try {
        const pythonUrl = buildPythonEngineUrl();
        const normalizedImage = normalizeBase64Image(base64Image);

        const response = await fetch(pythonUrl, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                image: normalizedImage,
                mime_type: mimeType || "image/png",
                document_type: documentType
            })
        });

        if (!response.ok) {
            let errorPayload = null;

            try {
                errorPayload = await response.json();
            } catch (parseError) {
                errorPayload = { detail: await response.text() };
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
        return Array.isArray(data?.questions_array) ? data.questions_array : [];
    } catch (error) {
        console.error('[Python Engine Service Error]:', {
            message: error.message,
            statusCode: error.statusCode,
            details: error.details
        });
        throw error;
    }
};

module.exports = { sendToPythonEngine };