// Test reference key normalization

async function normalizeReferenceKey(rawKey) {
  // Normalize reference key to match Python engine's logic
  return rawKey
    .replace(/[/_].*/, '')   // Remove session/tier info
    .replace(/[A-Z]$/, '')   // Remove suffix
    .trim();
}

// Test cases
const testKeys = [
  '2225-7106M',         // Should normalize to 2225-7106
  '7106/1_HL_May_2025', // Should normalize to 7106
  '2225-7106',          // Already normalized
  '7106M',              // Should normalize to 7106
  '7106/1',             // Should normalize to 7106
];

async function runTests() {
  console.log("Testing reference key normalization:");
  for (const key of testKeys) {
    const normalized = await normalizeReferenceKey(key);
    console.log(`'${key}' -> '${normalized}'`);
  }
}

runTests();