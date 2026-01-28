/**
 * VAM-RGB Validation Module - Test Suite
 *
 * Tests the two-observer model with:
 * 1. Synthetic images with known physics properties
 * 2. Canned AI responses with known verbalization patterns
 * 3. Cross-validation integration tests
 *
 * Run: node test/validation/validation-test.js
 *
 * v1.0 - 2026-01-28
 */

'use strict';

const PhysicsAnalyzer = require('../../src/validation/PhysicsAnalyzer');
const VerbalizationAnalyzer = require('../../src/validation/VerbalizationAnalyzer');
const CrossValidator = require('../../src/validation/CrossValidator');

// ============================================
// Test Utilities
// ============================================

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

function assertApprox(actual, expected, tolerance, message) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) {
    passed++;
    console.log(`  PASS: ${message} (${actual} ≈ ${expected})`);
  } else {
    failed++;
    console.error(`  FAIL: ${message} (got ${actual}, expected ~${expected} ±${tolerance})`);
  }
}

// ============================================
// Synthetic Image Generators
// ============================================

/**
 * Create a synthetic ImageData-like object.
 * @param {number} width
 * @param {number} height
 * @param {function} pixelFn - (x, y) => { r, g, b }
 * @returns {object} { data: Uint8ClampedArray, width, height }
 */
function createImage(width, height, pixelFn) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const { r, g, b } = pixelFn(x, y);
      const idx = (y * width + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }
  return { data, width, height };
}

/**
 * Static scene: R=G=B (gray). No motion.
 */
function createStaticImage(width = 100, height = 100) {
  return createImage(width, height, (x, y) => {
    const v = 128;
    return { r: v, g: v, b: v };
  });
}

/**
 * Rightward motion: object shifts right between Past(R) and Future(B).
 * Simulated by shifting a bright bar: R-channel bar at left, B-channel bar at right.
 */
function createRightwardMotionImage(width = 100, height = 100, shift = 10) {
  return createImage(width, height, (x, y) => {
    // Background gray
    const bg = 80;
    // Bright bar at center ±15px
    const barCenter = width / 2;
    const barHalf = 15;

    // R channel: bar shifted LEFT by `shift` (past position)
    const rBarX = barCenter - shift;
    const r = (x >= rBarX - barHalf && x <= rBarX + barHalf) ? 220 : bg;

    // G channel: bar at center (present)
    const g = (x >= barCenter - barHalf && x <= barCenter + barHalf) ? 220 : bg;

    // B channel: bar shifted RIGHT by `shift` (future position)
    const bBarX = barCenter + shift;
    const b = (x >= bBarX - barHalf && x <= bBarX + barHalf) ? 220 : bg;

    return { r, g, b };
  });
}

/**
 * Downward motion: object shifts down between Past(R) and Future(B).
 */
function createDownwardMotionImage(width = 100, height = 100, shift = 10) {
  return createImage(width, height, (x, y) => {
    const bg = 80;
    const barCenter = height / 2;
    const barHalf = 15;

    // R channel: bar shifted UP (past)
    const rBarY = barCenter - shift;
    const r = (y >= rBarY - barHalf && y <= rBarY + barHalf) ? 220 : bg;

    // G channel: bar at center (present)
    const g = (y >= barCenter - barHalf && y <= barCenter + barHalf) ? 220 : bg;

    // B channel: bar shifted DOWN (future)
    const bBarY = barCenter + shift;
    const b = (y >= bBarY - barHalf && y <= bBarY + barHalf) ? 220 : bg;

    return { r, g, b };
  });
}

/**
 * Maximum divergence: pure R, pure G, pure B all different.
 */
function createMaxDivergenceImage(width = 100, height = 100) {
  return createImage(width, height, () => {
    return { r: 255, g: 0, b: 128 };
  });
}

// ============================================
// Canned AI Responses
// ============================================

const AI_RESPONSE_ACCURATE_RIGHTWARD = `
この動画のグリッドを分析しました。

0:00 - タイトル画面。静止しています。
0:15 - 被写体が画面右方向に移動しています。速い動きが確認できます。
0:30 - 同じ方向への移動が継続。RGBフリンジが右側に青く見えます。
0:45 - 動きが停止。静止状態に戻りました。
1:00 - シーン変わり。静止。
`;

const AI_RESPONSE_HALLUCINATED = `
動画を確認しました。

0:00 - タイトル画面。
0:15 - 被写体が激しく左方向に移動しています。高速な動きです。
0:30 - 大きな動きが確認できます。上方向への移動。
0:45 - 右方向への急激な動き。
1:00 - 静止。
`;

const AI_RESPONSE_SUPPRESSED = `
動画を確認しました。

0:00 - タイトル画面が表示されています。
0:15 - 人物が映っています。
0:30 - 同じシーンが続いています。
0:45 - 別のシーンに切り替わりました。
1:00 - 終了画面。
`;

const AI_RESPONSE_ENGLISH = `
Video analysis complete.

0:00 - Title screen. Static.
0:15 - Subject moving right across the frame. Fast motion visible.
0:30 - Continued rightward movement. Blue fringe on right side.
0:45 - Motion stopped. Static scene.
1:00 - Scene change. No movement.
`;

// ============================================
// Test: PhysicsAnalyzer
// ============================================

function testPhysicsAnalyzer() {
  console.log('\n=== PhysicsAnalyzer Tests ===\n');
  const analyzer = new PhysicsAnalyzer();

  // Test 1: Static image → colorSeparation ≈ 0
  {
    const img = createStaticImage();
    const result = analyzer.analyze(img, 0, 0);
    assertApprox(result.colorSeparation, 0, 0.01, 'Static image: colorSeparation ≈ 0');
    assertApprox(result.physicsIntensity, 0, 0.01, 'Static image: physicsIntensity ≈ 0');
    assert(result.hasMotion === false, 'Static image: hasMotion = false');
    assertApprox(result.directionalFringe.magnitude, 0, 0.01, 'Static image: fringe magnitude ≈ 0');
  }

  // Test 2: Rightward motion → colorSeparation > 0, direction ≈ 0°
  {
    const img = createRightwardMotionImage();
    const result = analyzer.analyze(img, 1, 15);
    assert(result.colorSeparation > 0.05, `Rightward motion: colorSeparation > 0.05 (got ${result.colorSeparation})`);
    assert(result.physicsIntensity > 0.05, `Rightward motion: physicsIntensity > 0.05 (got ${result.physicsIntensity})`);
    assert(result.hasMotion === true, 'Rightward motion: hasMotion = true');
    // B-centroid should be right of R-centroid → angle ≈ 0° (rightward)
    assert(result.directionalFringe.dx > 0, `Rightward motion: dx > 0 (got ${result.directionalFringe.dx})`);
    assertApprox(result.directionalFringe.angleDeg, 0, 30, 'Rightward motion: angle ≈ 0°');
  }

  // Test 3: Downward motion → direction ≈ 90°
  {
    const img = createDownwardMotionImage();
    const result = analyzer.analyze(img, 2, 30);
    assert(result.hasMotion === true, 'Downward motion: hasMotion = true');
    assert(result.directionalFringe.dy > 0, `Downward motion: dy > 0 (got ${result.directionalFringe.dy})`);
    assertApprox(result.directionalFringe.angleDeg, 90, 30, 'Downward motion: angle ≈ 90°');
  }

  // Test 4: Max divergence → high colorSeparation
  {
    const img = createMaxDivergenceImage();
    const result = analyzer.analyze(img, 3, 45);
    assert(result.colorSeparation > 0.5, `Max divergence: colorSeparation > 0.5 (got ${result.colorSeparation})`);
    assert(result.hasMotion === true, 'Max divergence: hasMotion = true');
  }

  // Test 5: Regional motion map size
  {
    const img = createRightwardMotionImage();
    const result = analyzer.analyze(img, 0, 0);
    assert(result.regionalMotion.length === 16, 'Regional motion: 4x4 = 16 regions');
  }

  // Test 6: Determinism — same input → same output
  {
    const img = createRightwardMotionImage();
    const r1 = analyzer.analyze(img, 0, 0);
    const r2 = analyzer.analyze(img, 0, 0);
    assert(r1.colorSeparation === r2.colorSeparation, 'Determinism: same colorSeparation');
    assert(r1.physicsIntensity === r2.physicsIntensity, 'Determinism: same physicsIntensity');
    assert(r1.directionalFringe.dx === r2.directionalFringe.dx, 'Determinism: same dx');
  }
}

// ============================================
// Test: VerbalizationAnalyzer
// ============================================

function testVerbalizationAnalyzer() {
  console.log('\n=== VerbalizationAnalyzer Tests ===\n');
  const analyzer = new VerbalizationAnalyzer({ secondsPerCell: 15 });

  // Test 1: Timestamp extraction (Japanese)
  {
    const ts = analyzer.extractMentionedTimestamps(AI_RESPONSE_ACCURATE_RIGHTWARD);
    assert(ts.length === 5, `Timestamp extraction: found ${ts.length} timestamps (expected 5)`);
    assert(ts[0].seconds === 0, 'First timestamp: 0:00 = 0 seconds');
    assert(ts[1].seconds === 15, 'Second timestamp: 0:15 = 15 seconds');
    assert(ts[4].seconds === 60, 'Fifth timestamp: 1:00 = 60 seconds');
  }

  // Test 2: Motion claims extraction (Japanese - accurate)
  {
    const ts = analyzer.extractMentionedTimestamps(AI_RESPONSE_ACCURATE_RIGHTWARD);
    const claims = analyzer.extractMotionClaims(AI_RESPONSE_ACCURATE_RIGHTWARD, ts);
    assert(claims.length === 5, `Motion claims: ${claims.length} claims for 5 timestamps`);
    // 0:15 should have motion (右方向に移動)
    assert(claims[1].claimsMotion === true, '0:15 claims motion');
    assert(claims[1].directionClaim === 'right', '0:15 claims rightward');
    // 0:00 should have no motion (静止)
    assert(claims[0].claimsMotion === false, '0:00 no motion claim');
    // 0:45 should have no motion (静止状態)
    assert(claims[3].claimsMotion === false, '0:45 no motion claim (停止)');
  }

  // Test 3: Motion claims extraction (English)
  {
    const ts = analyzer.extractMentionedTimestamps(AI_RESPONSE_ENGLISH);
    const claims = analyzer.extractMotionClaims(AI_RESPONSE_ENGLISH, ts);
    assert(claims[1].claimsMotion === true, 'English 0:15 claims motion');
    assert(claims[1].directionClaim === 'right', 'English 0:15 claims rightward');
  }

  // Test 4: Hallucinated response — claims motion everywhere
  {
    const ts = analyzer.extractMentionedTimestamps(AI_RESPONSE_HALLUCINATED);
    const claims = analyzer.extractMotionClaims(AI_RESPONSE_HALLUCINATED, ts);
    const motionCount = claims.filter(c => c.claimsMotion).length;
    assert(motionCount >= 3, `Hallucinated: ${motionCount} motion claims (expected ≥3)`);
  }

  // Test 5: Suppressed response — claims no motion
  {
    const ts = analyzer.extractMentionedTimestamps(AI_RESPONSE_SUPPRESSED);
    const claims = analyzer.extractMotionClaims(AI_RESPONSE_SUPPRESSED, ts);
    const motionCount = claims.filter(c => c.claimsMotion).length;
    assert(motionCount <= 1, `Suppressed: ${motionCount} motion claims (expected ≤1)`);
  }

  // Test 6: V computation — all motion verbalized
  // V now returns intensity-weighted average (same scale as P)
  {
    const physicsProfiles = [
      { hasMotion: false, timestamp: 0 },
      { hasMotion: true, timestamp: 15, physicsIntensity: 0.3 },
      { hasMotion: true, timestamp: 30, physicsIntensity: 0.25 },
      { hasMotion: false, timestamp: 45 },
      { hasMotion: false, timestamp: 60 }
    ];

    const ts = analyzer.extractMentionedTimestamps(AI_RESPONSE_ACCURATE_RIGHTWARD);
    const claims = analyzer.extractMotionClaims(AI_RESPONSE_ACCURATE_RIGHTWARD, ts);
    const V = analyzer.computeVerbalizationWillingness(physicsProfiles, claims);
    // Both motion cells mentioned → V = (0.3 + 0.25) / 2 = 0.275
    assert(V > 0.1, `V with accurate response > 0.1 (got ${V})`);
  }

  // Test 7: V computation — motion suppressed
  {
    const physicsProfiles = [
      { hasMotion: false, timestamp: 0 },
      { hasMotion: true, timestamp: 15, physicsIntensity: 0.3 },
      { hasMotion: true, timestamp: 30, physicsIntensity: 0.25 },
      { hasMotion: false, timestamp: 45 },
      { hasMotion: false, timestamp: 60 }
    ];

    const ts = analyzer.extractMentionedTimestamps(AI_RESPONSE_SUPPRESSED);
    const claims = analyzer.extractMotionClaims(AI_RESPONSE_SUPPRESSED, ts);
    const V = analyzer.computeVerbalizationWillingness(physicsProfiles, claims);
    assert(V === 0, `V with suppressed response = 0 (got ${V})`);
  }

  // Test 8: V computation — no motion cells → V = 0 (nothing to verbalize)
  {
    const physicsProfiles = [
      { hasMotion: false, timestamp: 0 },
      { hasMotion: false, timestamp: 15 },
    ];
    const V = analyzer.computeVerbalizationWillingness(physicsProfiles, []);
    assert(V === 0, `V with no motion cells = 0 (got ${V})`);
  }
}

// ============================================
// Test: CrossValidator (Integration)
// ============================================

function testCrossValidator() {
  console.log('\n=== CrossValidator Integration Tests ===\n');
  const physics = new PhysicsAnalyzer();
  const verbal = new VerbalizationAnalyzer({ secondsPerCell: 15 });
  const cross = new CrossValidator({ secondsPerCell: 15 });

  // Scenario 1: Static scene + accurate (no motion) response
  // Expected: R ≈ 0, Coherence high
  {
    console.log('  -- Scenario 1: Static + Accurate --');
    const staticImg = createStaticImage();
    const profiles = [
      physics.analyze(staticImg, 0, 0),
      physics.analyze(staticImg, 1, 15),
      physics.analyze(staticImg, 2, 30),
      physics.analyze(staticImg, 3, 45),
      physics.analyze(staticImg, 4, 60)
    ];

    const aiText = `0:00 - 静止。0:15 - 静止。0:30 - 静止。0:45 - 静止。1:00 - 静止。`;
    const vProfile = verbal.analyze(aiText, profiles);
    const report = cross.validate(profiles, vProfile);

    assertApprox(report.rIndex.rIndex, 0, 0.1, 'Static+Accurate: R ≈ 0');
    assert(report.rIndex.direction === 'no_motion', 'Static+Accurate: direction = no_motion');
    console.log(`    ${report.toSummary()}`);
  }

  // Scenario 2: Moving scene + accurate response
  // Expected: R ≈ 0, Coherence ≥ 0.7
  {
    console.log('  -- Scenario 2: Moving + Accurate --');
    const staticImg = createStaticImage();
    const movingImg = createRightwardMotionImage();
    const profiles = [
      physics.analyze(staticImg, 0, 0),
      physics.analyze(movingImg, 1, 15),
      physics.analyze(movingImg, 2, 30),
      physics.analyze(staticImg, 3, 45),
      physics.analyze(staticImg, 4, 60)
    ];

    const vProfile = verbal.analyze(AI_RESPONSE_ACCURATE_RIGHTWARD, profiles);
    const report = cross.validate(profiles, vProfile);

    // R should be ~0 when all motion is verbalized (V ≈ P)
    assert(report.rIndex.rIndex < 0.3, `Moving+Accurate: R < 0.3 (got ${report.rIndex.rIndex})`);
    assert(report.coherence.coherence >= 0.5, `Moving+Accurate: Coherence ≥ 0.5 (got ${report.coherence.coherence})`);
    assert(report.coherence.confusion.tp >= 1, `Moving+Accurate: TP ≥ 1 (got ${report.coherence.confusion.tp})`);
    console.log(`    ${report.toSummary()}`);
  }

  // Scenario 3: Static scene + hallucinated response
  // Expected: R not applicable (no motion), but coherence low due to FP
  {
    console.log('  -- Scenario 3: Static + Hallucinated --');
    const staticImg = createStaticImage();
    const profiles = [
      physics.analyze(staticImg, 0, 0),
      physics.analyze(staticImg, 1, 15),
      physics.analyze(staticImg, 2, 30),
      physics.analyze(staticImg, 3, 45),
      physics.analyze(staticImg, 4, 60)
    ];

    const vProfile = verbal.analyze(AI_RESPONSE_HALLUCINATED, profiles);
    const report = cross.validate(profiles, vProfile);

    assert(report.coherence.confusion.fp >= 2, `Static+Hallucinated: FP ≥ 2 (got ${report.coherence.confusion.fp})`);
    assert(report.coherence.precision < 0.5, `Static+Hallucinated: precision < 0.5 (got ${report.coherence.precision})`);
    console.log(`    ${report.toSummary()}`);
  }

  // Scenario 4: Moving scene + suppressed response
  // Expected: R > 0.5 (suppression), Coherence low
  {
    console.log('  -- Scenario 4: Moving + Suppressed --');
    const staticImg = createStaticImage();
    const movingImg = createRightwardMotionImage();
    const profiles = [
      physics.analyze(staticImg, 0, 0),
      physics.analyze(movingImg, 1, 15),
      physics.analyze(movingImg, 2, 30),
      physics.analyze(staticImg, 3, 45),
      physics.analyze(staticImg, 4, 60)
    ];

    const vProfile = verbal.analyze(AI_RESPONSE_SUPPRESSED, profiles);
    const report = cross.validate(profiles, vProfile);

    assert(report.rIndex.direction === 'suppression', `Moving+Suppressed: direction = suppression (got ${report.rIndex.direction})`);
    assert(report.coherence.recall < 0.5, `Moving+Suppressed: recall < 0.5 (got ${report.coherence.recall})`);
    assert(report.coherence.confusion.fn >= 1, `Moving+Suppressed: FN ≥ 1 (got ${report.coherence.confusion.fn})`);
    console.log(`    ${report.toSummary()}`);
  }

  // Scenario 5: ValidationReport structure
  {
    console.log('  -- Scenario 5: Report structure --');
    const staticImg = createStaticImage();
    const profiles = [physics.analyze(staticImg, 0, 0)];
    const vProfile = verbal.analyze('0:00 - 静止。', profiles);
    const report = cross.validate(profiles, vProfile);

    assert(report.version === '1.0', 'Report version = 1.0');
    assert(typeof report.timestamp === 'string', 'Report has timestamp');
    assert(report.cellCount === 1, 'Report cellCount = 1');

    const manifest = report.toManifest();
    assert(manifest.computed_independently === true, 'Manifest: computed_independently = true');
    assert(manifest.validator_version === '1.0', 'Manifest: validator_version = 1.0');
    assert(typeof manifest.r_index === 'number', 'Manifest: r_index is number');
    assert(typeof manifest.coherence_score === 'number', 'Manifest: coherence_score is number');

    const json = report.toJSON();
    assert(Array.isArray(json.physicsProfiles), 'JSON: physicsProfiles is array');
    assert(typeof json.verbalizationProfile.willingness === 'number', 'JSON: willingness is number');

    const summary = report.toSummary();
    assert(summary.includes('[Validation]'), 'Summary starts with [Validation]');
    console.log(`    ${summary}`);
  }

  // Scenario 6: Ordering score
  {
    console.log('  -- Scenario 6: Timestamp ordering --');
    const staticImg = createStaticImage();
    const profiles = [
      physics.analyze(staticImg, 0, 0),
      physics.analyze(staticImg, 1, 15),
      physics.analyze(staticImg, 2, 30)
    ];

    // Correct order
    const ordered = verbal.analyze('0:00 テスト 0:15 テスト 0:30 テスト', profiles);
    const reportOrdered = cross.validate(profiles, ordered);
    assert(reportOrdered.coherence.orderingScore === 1.0,
      `Ordered timestamps: ordering = 1.0 (got ${reportOrdered.coherence.orderingScore})`);

    // Reversed order
    const reversed = verbal.analyze('0:30 テスト 0:15 テスト 0:00 テスト', profiles);
    const reportReversed = cross.validate(profiles, reversed);
    assert(reportReversed.coherence.orderingScore < 1.0,
      `Reversed timestamps: ordering < 1.0 (got ${reportReversed.coherence.orderingScore})`);
  }
}

// ============================================
// Run All Tests
// ============================================

console.log('========================================');
console.log('VAM-RGB Validation Module - Test Suite');
console.log('========================================');

testPhysicsAnalyzer();
testVerbalizationAnalyzer();
testCrossValidator();

console.log('\n========================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('========================================');

process.exit(failed > 0 ? 1 : 0);
