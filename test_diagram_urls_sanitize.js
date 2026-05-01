const { sanitizeDiagramUrls, isValidUrl } = require('./utils/diagramUrlSanitizer');

// Test cases for sanitizeDiagramUrls
console.log('TEST CASES FOR DIAGRAM URL SANITIZATION');
console.log('=======================================');

// Test case 1: Already valid array of strings
const test1 = ['https://example.com/img1.jpg', 'https://example.com/img2.jpg'];
console.log('Test 1 (Valid array of strings):', 
  JSON.stringify(sanitizeDiagramUrls(test1)));

// Test case 2: Nested array (the bug case)
const test2 = [ [] ];
console.log('Test 2 (Nested empty array):', 
  JSON.stringify(sanitizeDiagramUrls(test2)));

// Test case 3: Deeply nested array
const test3 = [[['https://example.com/img1.jpg']]];
console.log('Test 3 (Deeply nested array):', 
  JSON.stringify(sanitizeDiagramUrls(test3)));

// Test case 4: Mixed types
const test4 = ['https://example.com/img1.jpg', null, undefined, '', 123, {}, []];
console.log('Test 4 (Mixed types):', 
  JSON.stringify(sanitizeDiagramUrls(test4)));

// Test case 5: Null/undefined
console.log('Test 5 (Null):', 
  JSON.stringify(sanitizeDiagramUrls(null)));
console.log('Test 6 (Undefined):', 
  JSON.stringify(sanitizeDiagramUrls(undefined)));

// Test case 7: Non-array
console.log('Test 7 (Object):', 
  JSON.stringify(sanitizeDiagramUrls({ url: 'https://example.com/img1.jpg' })));

// Test case 8: Single string
console.log('Test 8 (Single string):', 
  JSON.stringify(sanitizeDiagramUrls('https://example.com/img1.jpg')));

// Test cases for isValidUrl
console.log('\nTEST CASES FOR URL VALIDATION');
console.log('============================');

// Valid URLs
console.log('http://example.com:', isValidUrl('http://example.com'));
console.log('https://example.com:', isValidUrl('https://example.com'));
console.log('data:image/png;base64,...:', isValidUrl('data:image/png;base64,abc123'));

// Invalid URLs
console.log('ftp://example.com:', isValidUrl('ftp://example.com'));
console.log('example.com (no protocol):', isValidUrl('example.com'));
console.log('Empty string:', isValidUrl(''));
console.log('Non-string (number):', isValidUrl(123));
console.log('Non-string (object):', isValidUrl({}));
console.log('Non-string (null):', isValidUrl(null));
console.log('Non-string (undefined):', isValidUrl(undefined));