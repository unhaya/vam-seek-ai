/**
 * Thaw Decoder Test Suite
 *
 * Tests the mathematical inverse of _mergeRGB().
 * Uses synthetic VAM-RGB cells with known properties.
 *
 * Run: node test/thaw/thaw-test.js
 *
 * v1.0 - 2026-01-28
 * Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
 * License: CC BY-NC 4.0
 */

'use strict';

const ChannelSeparator = require('../../src/thaw/ChannelSeparator');

// ─── Test Utilities ───

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.log(`  FAIL: ${message}`);
    failed++;
  }
}

function assertApprox(actual, expected, tolerance, message) {
  const diff = Math.abs(actual - expected);
  if (diff <= tolerance) {
    console.log(`  PASS: ${message} (${actual} ≈ ${expected})`);
    passed++;
  } else {
    console.log(`  FAIL: ${message} (${actual} ≠ ${expected}, diff=${diff})`);
    failed++;
  }
}

// ─── Synthetic Image Factories ───

/**
 * Create ImageData-like object from pixel function.
 */
function createImage(width, height, pixelFn) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const { r, g, b } = pixelFn(x, y);
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }
  return { data, width, height };
}

/**
 * Static scene: R=G=B=128. No motion.
 * _mergeRGB() of three identical gray frames produces this.
 */
function createStaticGray() {
  return createImage(16, 16, () => ({ r: 128, g: 128, b: 128 }));
}

/**
 * Static scene with color: R=200, G=100, B=50.
 * Since the scene is static, all three temporal frames are identical,
 * so _mergeRGB() preserves the original color.
 */
function createStaticColor() {
  return createImage(16, 16, () => ({ r: 200, g: 100, b: 50 }));
}

/**
 * Maximum divergence: R=255, G=0, B=128.
 * Channels fully separated → high motion, low confidence.
 */
function createMaxDivergence() {
  return createImage(16, 16, () => ({ r: 255, g: 0, b: 128 }));
}

/**
 * Simulate _mergeRGB() output from known Past/Present/Future frames.
 * This is the ground truth for round-trip testing.
 *
 * Past:    bright bar at x=[10,20), value 220, bg 80
 * Present: bright bar at x=[15,25), value 220, bg 80
 * Future:  bright bar at x=[20,30), value 220, bg 80
 *
 * After _mergeRGB():
 *   R = past.R    → bar at x=[10,20)
 *   G = present.G → bar at x=[15,25)
 *   B = future.B  → bar at x=[20,30)
 */
function createRightwardMotionCell(width = 64, height = 16) {
  return createImage(width, height, (x) => {
    const pastBar = (x >= 10 && x < 20) ? 220 : 80;
    const presentBar = (x >= 15 && x < 25) ? 220 : 80;
    const futureBar = (x >= 20 && x < 30) ? 220 : 80;
    return { r: pastBar, g: presentBar, b: futureBar };
  });
}

/**
 * Mixed scene: left half static (R=G=B=100), right half moving (R=200, G=100, B=50).
 */
function createHalfMotionCell() {
  return createImage(32, 16, (x) => {
    if (x < 16) {
      return { r: 100, g: 100, b: 100 }; // static
    } else {
      return { r: 200, g: 100, b: 50 };   // motion
    }
  });
}


// ═══════════════════════════════════════════════════════════
//  Level 1: ChannelSeparator Tests
// ═══════════════════════════════════════════════════════════

console.log('\n═══ Level 1: ChannelSeparator ═══\n');

const separator = new ChannelSeparator();

// --- Test 1: Static gray round-trip ---
console.log('--- Test 1: Static gray separation ---');
{
  const cell = createStaticGray();
  const { past, present, future, confidenceMap } = separator.separate(cell);

  // All channels should be 128
  assert(past.data[0] === 128 && past.data[1] === 128 && past.data[2] === 128,
    'Past frame: R channel replicated to grayscale (128,128,128)');
  assert(present.data[0] === 128 && present.data[1] === 128 && present.data[2] === 128,
    'Present frame: G channel replicated to grayscale (128,128,128)');
  assert(future.data[0] === 128 && future.data[1] === 128 && future.data[2] === 128,
    'Future frame: B channel replicated to grayscale (128,128,128)');

  // All three frames should be identical for static content
  let allSame = true;
  for (let i = 0; i < past.data.length; i += 4) {
    if (past.data[i] !== present.data[i] || present.data[i] !== future.data[i]) {
      allSame = false;
      break;
    }
  }
  assert(allSame, 'All three temporal frames are identical for static scene');

  // Confidence should be 1.0 everywhere
  let minConf = 1.0;
  for (let i = 0; i < confidenceMap.length; i++) {
    if (confidenceMap[i] < minConf) minConf = confidenceMap[i];
  }
  assertApprox(minConf, 1.0, 0.001, 'Confidence map: all pixels = 1.0 for static gray');
}

// --- Test 2: Correct channel extraction ---
console.log('\n--- Test 2: Channel extraction correctness ---');
{
  const cell = createMaxDivergence(); // R=255, G=0, B=128
  const { past, present, future } = separator.separate(cell);

  // Past = R channel = 255 as grayscale
  assert(past.data[0] === 255 && past.data[1] === 255 && past.data[2] === 255,
    'Past frame = R channel = (255,255,255)');

  // Present = G channel = 0 as grayscale
  assert(present.data[0] === 0 && present.data[1] === 0 && present.data[2] === 0,
    'Present frame = G channel = (0,0,0)');

  // Future = B channel = 128 as grayscale
  assert(future.data[0] === 128 && future.data[1] === 128 && future.data[2] === 128,
    'Future frame = B channel = (128,128,128)');

  // Alpha always 255
  assert(past.data[3] === 255 && present.data[3] === 255 && future.data[3] === 255,
    'Alpha = 255 on all frames');
}

// --- Test 3: Confidence map for divergent pixels ---
console.log('\n--- Test 3: Confidence map for motion ---');
{
  const cell = createMaxDivergence(); // R=255, G=0, B=128
  const { confidenceMap } = separator.separate(cell);

  // maxDiv = max(|255-0|, |0-128|, |255-128|) = 255
  // confidence = 1 - 255/255 = 0.0
  assertApprox(confidenceMap[0], 0.0, 0.001,
    'Max divergence pixel: confidence = 0.0');
}

// --- Test 4: Dimensions preserved ---
console.log('\n--- Test 4: Output dimensions ---');
{
  const cell = createImage(37, 23, () => ({ r: 50, g: 100, b: 150 }));
  const { past, present, future, confidenceMap } = separator.separate(cell);

  assert(past.width === 37 && past.height === 23, 'Past frame dimensions match input');
  assert(present.width === 37 && present.height === 23, 'Present frame dimensions match input');
  assert(future.width === 37 && future.height === 23, 'Future frame dimensions match input');
  assert(past.data.length === 37 * 23 * 4, 'Past frame buffer size correct');
  assert(confidenceMap.length === 37 * 23, 'Confidence map size = pixelCount');
}

// --- Test 5: Rightward motion cell separation ---
console.log('\n--- Test 5: Rightward motion bar positions ---');
{
  const cell = createRightwardMotionCell();
  const { past, present, future } = separator.separate(cell);

  // At x=12 (inside past bar, outside present/future bar):
  //   R=220, G=80, B=80
  //   past[12] = 220, present[12] = 80, future[12] = 80
  const idx12 = 12 * 4;
  assert(past.data[idx12] === 220, 'Past bar at x=12: value=220 (inside past bar)');
  assert(present.data[idx12] === 80, 'Present at x=12: value=80 (outside present bar)');
  assert(future.data[idx12] === 80, 'Future at x=12: value=80 (outside future bar)');

  // At x=22 (inside present+future bar, outside past bar):
  //   R=80, G=220, B=220
  //   past[22] = 80, present[22] = 220, future[22] = 220
  const idx22 = 22 * 4;
  assert(past.data[idx22] === 80, 'Past at x=22: value=80 (outside past bar)');
  assert(present.data[idx22] === 220, 'Present bar at x=22: value=220 (inside present bar)');
  assert(future.data[idx22] === 220, 'Future bar at x=22: value=220 (inside future bar)');

  // At x=25 (inside future bar only):
  //   R=80, G=80, B=220
  const idx25 = 25 * 4;
  assert(past.data[idx25] === 80, 'Past at x=25: value=80 (outside past bar)');
  assert(present.data[idx25] === 80, 'Present at x=25: value=80 (outside present bar)');
  assert(future.data[idx25] === 220, 'Future bar at x=25: value=220 (inside future bar)');
}

// --- Test 6: extractStaticColor on gray static image ---
// NOTE: extractStaticColor can only detect static regions where R≈G≈B.
// A colorful static scene (e.g. R=200, G=100, B=50) has divergent channels
// that are indistinguishable from motion in the VAM-RGB domain.
// Only near-gray pixels are provably static.
console.log('\n--- Test 6: Static color extraction (gray) ---');
{
  const cell = createStaticGray(); // R=G=B=128
  const { colorFrame, mask } = separator.extractStaticColor(cell);

  // All pixels R≈G≈B → all masked in
  assert(mask[0] === 1, 'Gray static pixel: mask = 1');
  assert(colorFrame.data[0] === 128 && colorFrame.data[1] === 128 && colorFrame.data[2] === 128,
    'Gray static pixel: original color (128,128,128) preserved');
  assert(colorFrame.data[3] === 255, 'Gray static pixel: alpha = 255');

  let allMasked = true;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 1) { allMasked = false; break; }
  }
  assert(allMasked, 'All gray pixels → entire mask = 1');
}

// --- Test 7: extractStaticColor on max divergence ---
console.log('\n--- Test 7: Motion pixel masking ---');
{
  const cell = createMaxDivergence(); // R=255, G=0, B=128
  const { colorFrame, mask } = separator.extractStaticColor(cell);

  // All pixels have high divergence → all masked out
  assert(mask[0] === 0, 'Motion pixel: mask = 0');
  assert(colorFrame.data[3] === 0, 'Motion pixel: alpha = 0 (transparent)');

  let allMaskedOut = true;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 0) { allMaskedOut = false; break; }
  }
  assert(allMaskedOut, 'All pixels divergent → entire mask = 0');
}

// --- Test 8: extractStaticColor on half-motion image ---
console.log('\n--- Test 8: Half-motion static extraction ---');
{
  const cell = createHalfMotionCell(); // left=static(100), right=motion(200,100,50)
  const { mask } = separator.extractStaticColor(cell);

  // Left half (x<16): static → mask=1
  // Right half (x>=16): motion → mask=0
  const firstRow = Array.from(mask).slice(0, 32); // 32 pixels in row 0
  const leftMask = firstRow.slice(0, 16);
  const rightMask = firstRow.slice(16, 32);

  assert(leftMask.every(m => m === 1), 'Left half (static): all mask = 1');
  assert(rightMask.every(m => m === 0), 'Right half (motion): all mask = 0');
}

// --- Test 9: Temporal delta ---
console.log('\n--- Test 9: Temporal delta (B - R) ---');
{
  // Static: R=G=B=128 → delta = (128-128)/255 = 0
  const staticCell = createStaticGray();
  const staticDelta = separator.computeTemporalDelta(staticCell);
  assertApprox(staticDelta[0], 0.0, 0.001, 'Static pixel: temporal delta = 0');

  // Max divergence: R=255, B=128 → delta = (128-255)/255 = -0.498
  const divCell = createMaxDivergence();
  const divDelta = separator.computeTemporalDelta(divCell);
  assertApprox(divDelta[0], -0.498, 0.01, 'R=255,B=128: temporal delta ≈ -0.498');

  // Rightward motion at x=12 (past bar): R=220, B=80 → delta = (80-220)/255 = -0.549
  const motionCell = createRightwardMotionCell();
  const motionDelta = separator.computeTemporalDelta(motionCell);
  assertApprox(motionDelta[12], -0.549, 0.01, 'Past bar pixel: negative delta (object was here, moved away)');

  // Rightward motion at x=25 (future bar only): R=80, B=220 → delta = (220-80)/255 = +0.549
  assertApprox(motionDelta[25], 0.549, 0.01, 'Future bar pixel: positive delta (object arriving)');
}

// --- Test 10: Round-trip identity (mergeRGB → separate → verify) ---
console.log('\n--- Test 10: Round-trip identity for static content ---');
{
  // For a static scene, mergeRGB produces R=G=B,
  // and separating gives three identical grayscale frames.
  // Re-merging should give back the original.
  const original = createStaticGray(); // R=G=B=128
  const { past, present, future } = separator.separate(original);

  // Simulate re-merge: take R from past, G from present, B from future
  let roundTripMatch = true;
  for (let i = 0; i < original.data.length; i += 4) {
    const reR = past.data[i];     // past.R = original.R
    const reG = present.data[i + 1]; // present.G = original.G (but present is grayscale G,G,G)
    const reB = future.data[i + 2];  // future.B = original.B (but future is grayscale B,B,B)

    // For static: past=(128,128,128), so past.R=128=original.R ✓
    // present=(128,128,128), so present.G=128=original.G ✓
    // future=(128,128,128), so future.B=128=original.B ✓
    if (reR !== original.data[i] || reG !== original.data[i + 1] || reB !== original.data[i + 2]) {
      roundTripMatch = false;
      break;
    }
  }
  assert(roundTripMatch, 'Static round-trip: separate → re-merge = original');
}

// --- Test 11: Determinism ---
console.log('\n--- Test 11: Determinism ---');
{
  const cell = createRightwardMotionCell();
  const result1 = separator.separate(cell);
  const result2 = separator.separate(cell);

  let identical = true;
  for (let i = 0; i < result1.past.data.length; i++) {
    if (result1.past.data[i] !== result2.past.data[i] ||
        result1.present.data[i] !== result2.present.data[i] ||
        result1.future.data[i] !== result2.future.data[i]) {
      identical = false;
      break;
    }
  }
  assert(identical, 'Same input → same output (deterministic)');

  let confIdentical = true;
  for (let i = 0; i < result1.confidenceMap.length; i++) {
    if (result1.confidenceMap[i] !== result2.confidenceMap[i]) {
      confIdentical = false;
      break;
    }
  }
  assert(confIdentical, 'Confidence map is deterministic');
}


console.log('\n═══════════════════════════════════════════════');
console.log(`  Level 1 Results: ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════════════════');

const level1Passed = passed;
const level1Failed = failed;


// ═══════════════════════════════════════════════════════════
//  Level 2: ColorEstimator Tests
// ═══════════════════════════════════════════════════════════

console.log('\n═══ Level 2: ColorEstimator ═══\n');

const ColorEstimator = require('../../src/thaw/ColorEstimator');
const estimator = new ColorEstimator();

// --- Test 12: Static gray → perfect color recovery ---
console.log('--- Test 12: Static gray color estimation ---');
{
  const cell = createStaticGray(); // R=G=B=128
  const separated = separator.separate(cell);
  const result = estimator.estimateAll(separated, cell);

  // Static pixels: quality = 1.0, color = original
  assertApprox(result.past.quality[0], 1.0, 0.001, 'Past quality = 1.0 for static');
  assertApprox(result.present.quality[0], 1.0, 0.001, 'Present quality = 1.0 for static');
  assertApprox(result.future.quality[0], 1.0, 0.001, 'Future quality = 1.0 for static');

  // Color should be exact original
  assert(result.past.frame.data[0] === 128 && result.past.frame.data[1] === 128 && result.past.frame.data[2] === 128,
    'Past frame: static color (128,128,128) exact');
  assert(result.present.frame.data[0] === 128 && result.present.frame.data[1] === 128 && result.present.frame.data[2] === 128,
    'Present frame: static color (128,128,128) exact');
  assert(result.future.frame.data[0] === 128 && result.future.frame.data[1] === 128 && result.future.frame.data[2] === 128,
    'Future frame: static color (128,128,128) exact');
}

// --- Test 13: Full divergence with no static regions → grayscale fallback ---
console.log('\n--- Test 13: No static regions → grayscale fallback ---');
{
  const cell = createMaxDivergence(); // R=255, G=0, B=128 — no static pixels
  const separated = separator.separate(cell);
  const result = estimator.estimateAll(separated, cell);

  // No static regions → no ratios → quality = 0.0 (grayscale fallback)
  assertApprox(result.past.quality[0], 0.0, 0.001, 'Past quality = 0.0 (no static refs)');

  // Past frame: known=R=255, fallback = grayscale (255,255,255)
  assert(result.past.frame.data[0] === 255 && result.past.frame.data[1] === 255 && result.past.frame.data[2] === 255,
    'Past frame: grayscale fallback (255,255,255)');

  // Present frame: known=G=0, fallback = (0,0,0)
  assert(result.present.frame.data[0] === 0 && result.present.frame.data[1] === 0 && result.present.frame.data[2] === 0,
    'Present frame: grayscale fallback (0,0,0)');

  // Future frame: known=B=128, fallback = (128,128,128)
  assert(result.future.frame.data[0] === 128 && result.future.frame.data[1] === 128 && result.future.frame.data[2] === 128,
    'Future frame: grayscale fallback (128,128,128)');
}

// --- Test 14: Half-motion → static exact, motion estimated ---
console.log('\n--- Test 14: Half-motion quality map ---');
{
  const cell = createHalfMotionCell(); // left=static(100), right=motion(200,100,50)
  const separated = separator.separate(cell);
  const result = estimator.estimate(separated.past, 'R', cell);

  // Left half (x<16): static → quality = 1.0
  assertApprox(result.quality[0], 1.0, 0.001, 'Static region: quality = 1.0');

  // Right half (x>=16): motion, but static regions exist → ratio estimation → quality = 0.5
  assertApprox(result.quality[16], 0.5, 0.001, 'Motion region with ratio data: quality = 0.5');
}

// --- Test 15: Ratio estimation preserves known channel ---
console.log('\n--- Test 15: Known channel preserved in estimation ---');
{
  const cell = createHalfMotionCell();
  const separated = separator.separate(cell);

  // Past frame: known = R
  const pastResult = estimator.estimate(separated.past, 'R', cell);
  // At x=16 (motion region): R=200 in VAM-RGB cell
  // Past grayscale = (200,200,200), known channel R = 200
  const motionIdx = 16 * 4;
  assert(pastResult.frame.data[motionIdx] === 200,
    'Past motion pixel: R channel = 200 (preserved)');

  // Present frame: known = G
  const presentResult = estimator.estimate(separated.present, 'G', cell);
  // At x=16: G=100 in VAM-RGB cell
  assert(presentResult.frame.data[motionIdx + 1] === 100,
    'Present motion pixel: G channel = 100 (preserved)');

  // Future frame: known = B
  const futureResult = estimator.estimate(separated.future, 'B', cell);
  // At x=16: B=50 in VAM-RGB cell
  assert(futureResult.frame.data[motionIdx + 2] === 50,
    'Future motion pixel: B channel = 50 (preserved)');
}

// --- Test 16: Ratio estimation uses static region color ratios ---
console.log('\n--- Test 16: Channel ratio from static regions ---');
{
  // Static region is R=G=B=100, so ratio R:G:B = 1:1:1
  // Motion region has R=200 → estimated G≈200, B≈200
  const cell = createHalfMotionCell();
  const separated = separator.separate(cell);
  const pastResult = estimator.estimate(separated.past, 'R', cell);

  // At x=16 (motion): R=200 known, ratio 1:1:1 from static region
  // So estimated G ≈ 200, B ≈ 200
  const motionIdx = 16 * 4;
  assertApprox(pastResult.frame.data[motionIdx + 1], 200, 1, 'Ratio estimate: G ≈ 200 (1:1 ratio)');
  assertApprox(pastResult.frame.data[motionIdx + 2], 200, 1, 'Ratio estimate: B ≈ 200 (1:1 ratio)');
}

// --- Test 17: estimateAll returns all three frames ---
console.log('\n--- Test 17: estimateAll structure ---');
{
  const cell = createStaticGray();
  const separated = separator.separate(cell);
  const result = estimator.estimateAll(separated, cell);

  assert(result.past && result.past.frame && result.past.quality, 'estimateAll: past has frame and quality');
  assert(result.present && result.present.frame && result.present.quality, 'estimateAll: present has frame and quality');
  assert(result.future && result.future.frame && result.future.quality, 'estimateAll: future has frame and quality');
  assert(result.past.frame.width === 16 && result.past.frame.height === 16, 'estimateAll: dimensions preserved');
}

// --- Test 18: Determinism ---
console.log('\n--- Test 18: ColorEstimator determinism ---');
{
  const cell = createHalfMotionCell();
  const separated = separator.separate(cell);
  const r1 = estimator.estimate(separated.past, 'R', cell);
  const r2 = estimator.estimate(separated.past, 'R', cell);

  let identical = true;
  for (let i = 0; i < r1.frame.data.length; i++) {
    if (r1.frame.data[i] !== r2.frame.data[i]) { identical = false; break; }
  }
  assert(identical, 'ColorEstimator: same input → same output');
}


const level2Passed = passed - level1Passed;
const level2Failed = failed - level1Failed;

console.log('\n═══════════════════════════════════════════════');
console.log(`  Level 1 Results: ${level1Passed} passed, ${level1Failed} failed`);
console.log(`  Level 2 Results: ${level2Passed} passed, ${level2Failed} failed`);
console.log('═══════════════════════════════════════════════');

const preLevel3Passed = passed;
const preLevel3Failed = failed;


// ═══════════════════════════════════════════════════════════
//  Level 3: ReconstructionValidator Tests
// ═══════════════════════════════════════════════════════════

console.log('\n═══ Level 3: ReconstructionValidator ═══\n');

const ReconstructionValidator = require('../../src/thaw/ReconstructionValidator');
const validator = new ReconstructionValidator();

// --- Test 19: Perfect round-trip (static gray) ---
console.log('--- Test 19: Perfect round-trip (static gray) ---');
{
  // Static gray: all frames identical → separation → re-encode = original
  const cell = createStaticGray(); // R=G=B=128
  const separated = separator.separate(cell);

  // Use grayscale frames directly as "reconstructed" frames
  // Past=(128,128,128), Present=(128,128,128), Future=(128,128,128)
  // re-mergeRGB: R=128, G=128, B=128 → identical to original
  const result = validator.validate(cell, separated.past, separated.present, separated.future);

  assertApprox(result.roundTripCoherence, 1.0, 0.001, 'Static gray: roundTripCoherence = 1.0');
  assertApprox(result.channelErrors.R, 0.0, 0.001, 'Static gray: R error = 0');
  assertApprox(result.channelErrors.G, 0.0, 0.001, 'Static gray: G error = 0');
  assertApprox(result.channelErrors.B, 0.0, 0.001, 'Static gray: B error = 0');
}

// --- Test 20: Perfect round-trip (motion cell, using original channels) ---
console.log('\n--- Test 20: Perfect round-trip (motion, original channels) ---');
{
  const cell = createRightwardMotionCell();
  const separated = separator.separate(cell);

  // separated.past = (R,R,R), present = (G,G,G), future = (B,B,B)
  // re-mergeRGB picks: R from past.R = R, G from present.G = G, B from future.B = B
  // Since grayscale frames replicate the channel: past=(R,R,R) → past.R = R ✓
  const result = validator.validate(cell, separated.past, separated.present, separated.future);

  assertApprox(result.roundTripCoherence, 1.0, 0.001, 'Motion cell: roundTripCoherence = 1.0 (original channels used)');
  assertApprox(result.pixelError, 0.0, 0.001, 'Motion cell: pixelError = 0.0');
}

// --- Test 21: Imperfect reconstruction ---
console.log('\n--- Test 21: Imperfect reconstruction ---');
{
  const cell = createRightwardMotionCell(64, 16); // R≠G≠B in motion areas

  // Simulate a poor reconstruction: all three frames = solid gray(128), same dimensions
  const badFrame = createImage(64, 16, () => ({ r: 128, g: 128, b: 128 }));
  const result = validator.validate(cell, badFrame, badFrame, badFrame);

  // re-mergeRGB of (128,128,128) × 3 = (128,128,128)
  // Original has values 80 and 220 → significant error
  assert(result.roundTripCoherence < 1.0, `Bad reconstruction: coherence < 1.0 (got ${result.roundTripCoherence})`);
  assert(result.pixelError > 0, `Bad reconstruction: pixelError > 0 (got ${result.pixelError})`);
}

// --- Test 22: Physics profile comparison ---
console.log('\n--- Test 22: Physics profile comparison ---');
{
  const cell = createStaticGray();
  const separated = separator.separate(cell);
  const result = validator.validate(cell, separated.past, separated.present, separated.future);

  assert(result.physicsMatch !== null, 'Physics match available');
  assertApprox(result.physicsMatch.colorSepError, 0.0, 0.001, 'Static: colorSep error = 0');
  assertApprox(result.physicsMatch.intensityError, 0.0, 0.001, 'Static: intensity error = 0');
  assertApprox(result.physicsMatch.fringeMagError, 0.0, 0.001, 'Static: fringe magnitude error = 0');
}

// --- Test 23: Physics comparison with motion ---
console.log('\n--- Test 23: Physics comparison (motion cell, perfect round-trip) ---');
{
  const cell = createRightwardMotionCell();
  const separated = separator.separate(cell);
  const result = validator.validate(cell, separated.past, separated.present, separated.future);

  assert(result.physicsMatch !== null, 'Physics match available for motion cell');
  assertApprox(result.physicsMatch.colorSepError, 0.0, 0.001, 'Perfect round-trip: colorSep error = 0');
  assertApprox(result.physicsMatch.fringeAngleError, 0.0, 0.1, 'Perfect round-trip: fringe angle error = 0');
}

// --- Test 24: Estimated frames round-trip ---
console.log('\n--- Test 24: ColorEstimator frames round-trip ---');
{
  const cell = createStaticGray();
  const separated = separator.separate(cell);
  const estimated = estimator.estimateAll(separated, cell);

  // Use ColorEstimator output (full-color frames) for validation
  const result = validator.validate(cell, estimated.past.frame, estimated.present.frame, estimated.future.frame);

  // For static gray, estimated = (128,128,128) → re-merge = (128,128,128) → perfect
  assertApprox(result.roundTripCoherence, 1.0, 0.001, 'Estimated static: roundTripCoherence = 1.0');
}

// --- Test 25: Half-motion estimated round-trip ---
console.log('\n--- Test 25: Half-motion estimated round-trip ---');
{
  const cell = createHalfMotionCell();
  const separated = separator.separate(cell);
  const estimated = estimator.estimateAll(separated, cell);

  const result = validator.validate(cell, estimated.past.frame, estimated.present.frame, estimated.future.frame);

  // Static half: perfect. Motion half: ratio-estimated, some error possible.
  // But known channels are always exact, so R error for past = 0, G error for present = 0, B error for future = 0
  // The OTHER channels in re-merge are: past.R (always correct), present.G (always correct), future.B (always correct)
  // So even with ratio estimation, the re-merged channels are exactly the known ones → coherence should be high
  assert(result.roundTripCoherence >= 0.9, `Half-motion estimated: coherence >= 0.9 (got ${result.roundTripCoherence})`);
}

// --- Test 26: Result structure ---
console.log('\n--- Test 26: Result structure ---');
{
  const cell = createStaticGray();
  const separated = separator.separate(cell);
  const result = validator.validate(cell, separated.past, separated.present, separated.future);

  assert(typeof result.roundTripCoherence === 'number', 'Has roundTripCoherence');
  assert(typeof result.channelErrors === 'object', 'Has channelErrors');
  assert(typeof result.channelErrors.R === 'number', 'Has channelErrors.R');
  assert(typeof result.channelErrors.G === 'number', 'Has channelErrors.G');
  assert(typeof result.channelErrors.B === 'number', 'Has channelErrors.B');
  assert(typeof result.pixelError === 'number', 'Has pixelError');
  assert(typeof result.pixelCount === 'number', 'Has pixelCount');
  assert(result.pixelCount === 16 * 16, 'pixelCount matches image');
  assert(result.physicsMatch !== null, 'Has physicsMatch');
}


// ═══════════════════════════════════════════════════════════
//  Final Summary
// ═══════════════════════════════════════════════════════════

const level3Passed = passed - preLevel3Passed;
const level3Failed = failed - preLevel3Failed;

console.log('\n═══════════════════════════════════════════════');
console.log(`  Level 1 (ChannelSeparator):       ${level1Passed} passed, ${level1Failed} failed`);
console.log(`  Level 2 (ColorEstimator):          ${level2Passed} passed, ${level2Failed} failed`);
console.log(`  Level 3 (ReconstructionValidator): ${level3Passed} passed, ${level3Failed} failed`);
console.log(`  Total:                             ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════════════════\n');

if (failed > 0) {
  process.exit(1);
}
