/**
 * Test script for GroundTruthValidator
 *
 * Run: node src/validation/test-ground-truth.js
 */

'use strict';

const { GradientComputer } = require('./GradientComputer');
const { GroundTruthValidator } = require('./GroundTruthValidator');

// Create synthetic VAM-RGB image data for testing
function createTestImage(width, height, pattern = 'gradient') {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;

      switch (pattern) {
        case 'gradient':
          // R increases left to right (past)
          data[i] = Math.floor(x / width * 255);
          // G is mid-range (present)
          data[i + 1] = 128;
          // B increases top to bottom (future)
          data[i + 2] = Math.floor(y / height * 255);
          break;

        case 'skin':
          // Skin-like colors in center
          if (x > width * 0.3 && x < width * 0.7 && y > height * 0.3 && y < height * 0.7) {
            data[i] = 180;      // R: skin-like
            data[i + 1] = 140;  // G
            data[i + 2] = 120;  // B
          } else {
            data[i] = 50;       // R: dark background
            data[i + 1] = 50;   // G
            data[i + 2] = 50;   // B
          }
          break;

        case 'motion':
          // Strong R-B difference in diagonal
          if (Math.abs(x - y) < 20) {
            data[i] = 200;      // R: high past
            data[i + 1] = 128;  // G
            data[i + 2] = 50;   // B: low future (moving left)
          } else {
            data[i] = 100;      // Static region
            data[i + 1] = 100;
            data[i + 2] = 100;
          }
          break;

        default:
          data[i] = 128;
          data[i + 1] = 128;
          data[i + 2] = 128;
      }

      data[i + 3] = 255; // Alpha
    }
  }

  return { data, width, height };
}

// Test GradientComputer
function testGradientComputer() {
  console.log('=== GradientComputer Tests ===\n');

  const computer = new GradientComputer({ blockSize: 4 });

  // Test 1: Gradient image
  console.log('[Test 1] Gradient image');
  const gradImg = createTestImage(32, 32, 'gradient');
  const gradResult = computer.compute(gradImg);
  console.log(`  Blocks: ${gradResult.blocks.length}`);
  console.log(`  Stats: avgDRB=${gradResult.stats.avgDRB}, motion=${gradResult.stats.motionBlocks}`);
  console.log(`  Sample block[0]: R=${gradResult.blocks[0].R}, G=${gradResult.blocks[0].G}, B=${gradResult.blocks[0].B}`);
  console.log('');

  // Test 2: Motion image
  console.log('[Test 2] Motion regions');
  const motionImg = createTestImage(32, 32, 'motion');
  const motionResult = computer.compute(motionImg);
  const motionBlocks = computer.findMotion(motionResult.blocks, 0.1);
  console.log(`  Total blocks: ${motionResult.blocks.length}`);
  console.log(`  Motion blocks: ${motionBlocks.length}`);
  console.log(`  Sample motion: idx=${motionBlocks[0]?.idx}, dRB=${motionBlocks[0]?.dRB}`);
  console.log('');

  // Test 3: Skin regions
  console.log('[Test 3] Skin regions');
  const skinImg = createTestImage(32, 32, 'skin');
  const skinResult = computer.compute(skinImg);
  const skinBlocks = computer.findSkinRegions(skinResult.blocks);
  console.log(`  Total blocks: ${skinResult.blocks.length}`);
  console.log(`  Skin blocks: ${skinBlocks.length}`);
  console.log('');

  return true;
}

// Test GroundTruthValidator
function testGroundTruthValidator() {
  console.log('=== GroundTruthValidator Tests ===\n');

  const validator = new GroundTruthValidator({
    toleranceDRB: 0.05,
    toleranceRGB: 20
  });

  // Create test image
  const testImg = createTestImage(32, 32, 'motion');

  // Compute actual values for reference
  const computer = new GradientComputer({ blockSize: 4 });
  const groundTruth = computer.compute(testImg);
  console.log('[Reference] Ground truth computed');
  console.log(`  Blocks: ${groundTruth.blocks.length}`);
  console.log(`  Block[0]: idx=0, R=${groundTruth.blocks[0].R}, G=${groundTruth.blocks[0].G}, B=${groundTruth.blocks[0].B}, dRB=${groundTruth.blocks[0].dRB}`);
  console.log('');

  // Test 1: Perfect AI response (狐)
  console.log('[Test 1] Perfect AI response (should be 狐)');
  const perfectResponse = JSON.stringify([
    { idx: 0, R: groundTruth.blocks[0].R, G: groundTruth.blocks[0].G, B: groundTruth.blocks[0].B, dRB: groundTruth.blocks[0].dRB },
    { idx: 1, R: groundTruth.blocks[1].R, G: groundTruth.blocks[1].G, B: groundTruth.blocks[1].B, dRB: groundTruth.blocks[1].dRB }
  ]);
  const perfectResult = validator.validate(perfectResponse, testImg);
  console.log(`  R_groundTruth: ${perfectResult.R_groundTruth}`);
  console.log(`  Status: ${perfectResult.status}`);
  console.log(`  Message: ${perfectResult.message}`);
  console.log(`  Matches: ${perfectResult.matchCount}/${perfectResult.aiBlockCount}`);
  const perfectPass = perfectResult.R_groundTruth < 0.1;
  console.log(`  RESULT: ${perfectPass ? 'PASS' : 'FAIL'}`);
  console.log('');

  // Test 2: Hallucinated AI response (狸)
  console.log('[Test 2] Hallucinated AI response (should be 狸)');
  const hallucinatedResponse = JSON.stringify([
    { idx: 0, R: 255, G: 0, B: 0, dRB: 0.99 },  // Completely wrong values
    { idx: 1, R: 0, G: 255, B: 0, dRB: 0.88 },
    { idx: 999, R: 100, G: 100, B: 100, dRB: 0.5 }  // Non-existent block
  ]);
  const hallucinatedResult = validator.validate(hallucinatedResponse, testImg);
  console.log(`  R_groundTruth: ${hallucinatedResult.R_groundTruth}`);
  console.log(`  Status: ${hallucinatedResult.status}`);
  console.log(`  Message: ${hallucinatedResult.message}`);
  console.log(`  Matches: ${hallucinatedResult.matchCount}/${hallucinatedResult.aiBlockCount}`);
  console.log(`  Hallucinations: ${hallucinatedResult.hallucinations.length}`);
  const hallucinatedPass = hallucinatedResult.R_groundTruth > 0.5;
  console.log(`  RESULT: ${hallucinatedPass ? 'PASS' : 'FAIL'}`);
  console.log('');

  // Test 3: Parse failure
  console.log('[Test 3] Invalid AI response');
  const invalidResponse = 'This is not JSON, just some text about the video.';
  const invalidResult = validator.validate(invalidResponse, testImg);
  console.log(`  R_groundTruth: ${invalidResult.R_groundTruth}`);
  console.log(`  Status: ${invalidResult.status}`);
  const invalidPass = invalidResult.status === 'PARSE_FAIL';
  console.log(`  RESULT: ${invalidPass ? 'PASS' : 'FAIL'}`);
  console.log('');

  // Test 4: Query-specific validation (skin)
  console.log('[Test 4] Query-specific validation (skin regions)');
  const skinImg = createTestImage(32, 32, 'skin');
  const skinGT = computer.compute(skinImg);
  const actualSkinBlocks = computer.findSkinRegions(skinGT.blocks);

  // AI correctly identifies some skin blocks
  const skinResponse = JSON.stringify(
    actualSkinBlocks.slice(0, 5).map(b => ({ idx: b.idx, x: b.x, y: b.y }))
  );
  const skinResult = validator.validateQuery(skinResponse, skinImg, 'skin');
  console.log(`  Query type: ${skinResult.queryType}`);
  console.log(`  AI blocks: ${skinResult.aiBlockCount}`);
  console.log(`  Relevant GT blocks: ${skinResult.relevantBlockCount}`);
  console.log(`  Precision: ${skinResult.precision}`);
  console.log(`  Recall: ${skinResult.recall}`);
  console.log(`  F1: ${skinResult.f1}`);
  console.log(`  R_groundTruth: ${skinResult.R_groundTruth}`);
  console.log(`  Status: ${skinResult.status}`);
  console.log('');

  return perfectPass && hallucinatedPass && invalidPass;
}

// Test quick validation
function testQuickValidate() {
  console.log('=== Quick Validation Tests ===\n');

  const validator = new GroundTruthValidator();
  const testImg = createTestImage(32, 32, 'gradient');
  const computer = new GradientComputer({ blockSize: 4 });
  const gt = computer.compute(testImg);

  // Good response
  const goodResponse = JSON.stringify([
    { idx: 0, R: gt.blocks[0].R, G: gt.blocks[0].G, B: gt.blocks[0].B }
  ]);
  const goodResult = validator.quickValidate(goodResponse, testImg);
  console.log(`[Good] valid=${goodResult.valid}, R=${goodResult.R}, matches=${goodResult.matches}/${goodResult.total}`);

  // Bad response
  const badResponse = JSON.stringify([
    { idx: 0, R: 0, G: 0, B: 255 }  // Wrong values
  ]);
  const badResult = validator.quickValidate(badResponse, testImg);
  console.log(`[Bad]  valid=${badResult.valid}, R=${badResult.R}, matches=${badResult.matches}/${badResult.total}`);

  console.log('');
  return goodResult.valid && !badResult.valid;
}

// Run all tests
console.log('ψ4.0 Ground Truth Validation Test Suite\n');
console.log('「AIの計算結果を、俺らの計算結果と照合する」\n');
console.log('=' .repeat(60) + '\n');

const results = [];
results.push({ name: 'GradientComputer', pass: testGradientComputer() });
results.push({ name: 'GroundTruthValidator', pass: testGroundTruthValidator() });
results.push({ name: 'QuickValidate', pass: testQuickValidate() });

console.log('=' .repeat(60));
console.log('\nSummary:');
for (const r of results) {
  console.log(`  ${r.pass ? '✓' : '✗'} ${r.name}`);
}

const allPass = results.every(r => r.pass);
console.log(`\n${allPass ? '✓ All tests passed' : '✗ Some tests failed'}`);
