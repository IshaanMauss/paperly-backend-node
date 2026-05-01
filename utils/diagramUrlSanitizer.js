/**
 * Sanitizes diagram URLs to ensure they are a flat array of valid strings
 * Prevents MongoDB casting errors from nested arrays or invalid types
 * 
 * @param {any} diagramUrls - The diagram URLs to sanitize
 * @returns {Array<string>} - A flat array of valid diagram URL strings
 */
function sanitizeDiagramUrls(diagramUrls) {
  // Return empty array if null/undefined
  if (!diagramUrls) return [];
  
  // Handle single string value
  if (typeof diagramUrls === 'string') return [diagramUrls];
  
  // Not an array, return empty array
  if (!Array.isArray(diagramUrls)) return [];
  
  // Recursively flatten nested arrays and filter out invalid values
  const flattenDeep = (arr) => {
    return arr.reduce((acc, val) => 
      Array.isArray(val) 
        ? acc.concat(flattenDeep(val)) 
        : acc.concat(typeof val === 'string' && val.trim() !== '' ? val : []), 
      []
    );
  };

  const flatUrls = flattenDeep(diagramUrls);
  
  // Filter out any non-strings, empty strings, or null/undefined
  return flatUrls.filter(url => {
    return typeof url === 'string' && url.trim() !== '';
  });
}

/**
 * Validates if a string looks like a URL
 * Basic validation for HTTP/HTTPS URLs
 * 
 * @param {string} url - The URL to validate
 * @returns {boolean} - Whether the string looks like a URL
 */
function isValidUrl(url) {
  if (typeof url !== 'string') return false;
  // Basic URL validation - starts with http:// or https:// or data: for base64
  return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:');
}

module.exports = {
  sanitizeDiagramUrls,
  isValidUrl
};