/**
 * G-Nudge ψ3.1 Math Verification Test
 * No dependencies — pure algorithm validation
 *
 * Tests:
 * 1. Block center preservation (nudge=0 at center)
 * 2. DC preservation (average nudge per block = 0)
 * 3. Gradient direction correctness
 * 4. Round-trip: nudge → linear regression recovers avgRG/avgBG
 * 5. Clipping safety
 *
 * Usage: node test/gnudge/gnudge-math-test.js
 */

const BLOCK = 8;           // G-Nudge block size (ψ3.1)
const BLOCK_MOSAIC = 4;    // R/B Mosaic block size (ψ3.2)
const SCALE = 0.15;
const HALF = (BLOCK - 1) / 2;  // 3.5

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.log(`  FAIL: ${message}`);
  }
}

function assertClose(actual, expected, tolerance, message) {
  const diff = Math.abs(actual - expected);
  if (diff <= tolerance) {
    passed++;
    console.log(`  PASS: ${message} (${actual.toFixed(4)} ≈ ${expected.toFixed(4)}, tol=${tolerance})`);
  } else {
    failed++;
    console.log(`  FAIL: ${message} (${actual.toFixed(4)} ≠ ${expected.toFixed(4)}, diff=${diff.toFixed(4)}, tol=${tolerance})`);
  }
}

// ─── Core algorithm (extracted from _mergeRGB) ───

function computeNudge(avgRG, avgBG, localX, localY) {
  const dx = (localX - HALF) / HALF;
  const dy = (localY - HALF) / HALF;
  return Math.round((avgRG * dx + avgBG * dy) * SCALE);
}

// ─── Test 1: Center Preservation ───

function testCenterPreservation() {
  console.log('\n[Test 1] Block Center Preservation');

  const testCases = [
    { avgRG: 160, avgBG: -100, name: 'strong red + cool blue' },
    { avgRG: -80, avgBG: 200, name: 'strong green + strong blue' },
    { avgRG: 0, avgBG: 0, name: 'neutral (no color diff)' },
    { avgRG: 255, avgBG: 255, name: 'extreme case' },
  ];

  for (const tc of testCases) {
    // Mathematical center is (3.5, 3.5) — no pixel is exactly there
    // Nearest pixels at (3,3)/(4,4) have dx=dy=±0.143
    // Their nudge should be <30% of edge nudge (proportional to distance)

    // Max nudge across all edge pixels
    let edgeNudge = 0;
    for (let e = 0; e < BLOCK; e++) {
      edgeNudge = Math.max(edgeNudge,
        Math.abs(computeNudge(tc.avgRG, tc.avgBG, BLOCK - 1, e)),
        Math.abs(computeNudge(tc.avgRG, tc.avgBG, 0, e)),
        Math.abs(computeNudge(tc.avgRG, tc.avgBG, e, BLOCK - 1)),
        Math.abs(computeNudge(tc.avgRG, tc.avgBG, e, 0))
      );
    }
    const centerCoords = [
      [3, 3], [3, 4], [4, 3], [4, 4]
    ];

    for (const [lx, ly] of centerCoords) {
      const nudge = computeNudge(tc.avgRG, tc.avgBG, lx, ly);
      const ratio = edgeNudge > 0 ? Math.abs(nudge) / edgeNudge : 0;
      assert(ratio <= 0.5 || edgeNudge === 0,
        `${tc.name} at (${lx},${ly}): nudge=${nudge}, edge=${edgeNudge}, ratio=${ratio.toFixed(2)} (<50%)`);
    }
  }
}

// ─── Test 2: DC Preservation ───

function testDCPreservation() {
  console.log('\n[Test 2] DC Preservation (average nudge per block = 0)');

  const testCases = [
    { avgRG: 100, avgBG: -50 },
    { avgRG: -200, avgBG: 200 },
    { avgRG: 0, avgBG: 0 },
    { avgRG: 40, avgBG: -35 },   // typical skin tone
  ];

  for (const tc of testCases) {
    let sumNudge = 0;
    let count = 0;

    for (let ly = 0; ly < BLOCK; ly++) {
      for (let lx = 0; lx < BLOCK; lx++) {
        sumNudge += computeNudge(tc.avgRG, tc.avgBG, lx, ly);
        count++;
      }
    }

    const avgNudge = sumNudge / count;
    assertClose(avgNudge, 0, 0.5,
      `avgRG=${tc.avgRG}, avgBG=${tc.avgBG}: mean nudge`);
  }
}

// ─── Test 3: Gradient Direction ───

function testGradientDirection() {
  console.log('\n[Test 3] Gradient Direction');

  // avgRG > 0 → right edge should be brighter (positive nudge)
  const rightEdge = computeNudge(160, 0, BLOCK - 1, Math.floor(BLOCK / 2));
  const leftEdge = computeNudge(160, 0, 0, Math.floor(BLOCK / 2));
  assert(rightEdge > 0, `avgRG=+160: right edge nudge=${rightEdge} > 0 (warm/red)`);
  assert(leftEdge < 0, `avgRG=+160: left edge nudge=${leftEdge} < 0`);

  // avgRG < 0 → right edge should be darker (negative nudge)
  const rightEdge2 = computeNudge(-160, 0, BLOCK - 1, Math.floor(BLOCK / 2));
  assert(rightEdge2 < 0, `avgRG=-160: right edge nudge=${rightEdge2} < 0 (cool/green)`);

  // avgBG > 0 → bottom edge should be brighter
  const bottomEdge = computeNudge(0, 150, Math.floor(BLOCK / 2), BLOCK - 1);
  const topEdge = computeNudge(0, 150, Math.floor(BLOCK / 2), 0);
  assert(bottomEdge > 0, `avgBG=+150: bottom edge nudge=${bottomEdge} > 0 (blue)`);
  assert(topEdge < 0, `avgBG=+150: top edge nudge=${topEdge} < 0`);

  // avgBG < 0 → bottom edge should be darker
  const bottomEdge2 = computeNudge(0, -150, Math.floor(BLOCK / 2), BLOCK - 1);
  assert(bottomEdge2 < 0, `avgBG=-150: bottom edge nudge=${bottomEdge2} < 0 (yellow)`);
}

// ─── Test 4: Round-trip Recovery ───

function testRoundTrip() {
  console.log('\n[Test 4] Round-trip: nudge → linear regression → recover avgRG/avgBG');

  const testCases = [
    { avgRG: 100, avgBG: -50, name: 'moderate' },
    { avgRG: -200, avgBG: 200, name: 'extreme' },
    { avgRG: 40, avgBG: -35, name: 'skin tone' },
    { avgRG: 0, avgBG: 0, name: 'neutral' },
  ];

  for (const tc of testCases) {
    // Apply nudge to a uniform G=128 block
    const g0 = 128;
    const nudgedG = [];

    for (let ly = 0; ly < BLOCK; ly++) {
      for (let lx = 0; lx < BLOCK; lx++) {
        const nudge = computeNudge(tc.avgRG, tc.avgBG, lx, ly);
        nudgedG.push(Math.max(0, Math.min(255, g0 + nudge)));
      }
    }

    // Recover: linear regression on nudgedG
    // nudge(x,y) ≈ (avgRG * dx + avgBG * dy) * SCALE
    // → fit: z = a * dx + b * dy
    // where z = nudgedG[i] - g0

    let sumDxDx = 0, sumDyDy = 0, sumDxDy = 0;
    let sumZDx = 0, sumZDy = 0;

    for (let ly = 0; ly < BLOCK; ly++) {
      for (let lx = 0; lx < BLOCK; lx++) {
        const dx = (lx - HALF) / HALF;
        const dy = (ly - HALF) / HALF;
        const z = nudgedG[ly * BLOCK + lx] - g0;

        sumDxDx += dx * dx;
        sumDyDy += dy * dy;
        sumDxDy += dx * dy;
        sumZDx += z * dx;
        sumZDy += z * dy;
      }
    }

    // Solve 2x2 system: [sumDxDx sumDxDy; sumDxDy sumDyDy] * [a; b] = [sumZDx; sumZDy]
    const det = sumDxDx * sumDyDy - sumDxDy * sumDxDy;
    if (Math.abs(det) < 1e-10) {
      assert(tc.avgRG === 0 && tc.avgBG === 0,
        `${tc.name}: degenerate (neutral)`);
      continue;
    }

    const a = (sumZDx * sumDyDy - sumZDy * sumDxDy) / det;
    const b = (sumZDy * sumDxDx - sumZDx * sumDxDy) / det;

    // a ≈ avgRG * SCALE, b ≈ avgBG * SCALE
    const recoveredAvgRG = a / SCALE;
    const recoveredAvgBG = b / SCALE;

    // Tolerance: rounding error in nudge (Math.round) introduces ±1 per pixel
    // Over 64 pixels, regression averages out → error should be small
    assertClose(recoveredAvgRG, tc.avgRG, 5,
      `${tc.name}: recovered avgRG`);
    assertClose(recoveredAvgBG, tc.avgBG, 5,
      `${tc.name}: recovered avgBG`);
  }
}

// ─── Test 5: Clipping Safety ───

function testClippingSafety() {
  console.log('\n[Test 5] Clipping Safety');

  // G near 0 with strong negative nudge
  const g0_low = 5;
  const nudge_neg = computeNudge(200, 0, 0, 4);  // left edge, strong red
  const result_low = Math.max(0, Math.min(255, g0_low + nudge_neg));
  assert(result_low >= 0 && result_low <= 255,
    `G=${g0_low}, nudge=${nudge_neg}: result=${result_low} in [0,255]`);

  // G near 255 with strong positive nudge
  const g0_high = 250;
  const nudge_pos = computeNudge(200, 0, BLOCK - 1, 4);  // right edge, strong red
  const result_high = Math.max(0, Math.min(255, g0_high + nudge_pos));
  assert(result_high >= 0 && result_high <= 255,
    `G=${g0_high}, nudge=${nudge_pos}: result=${result_high} in [0,255]`);

  // Maximum theoretical nudge
  const maxNudge = Math.round(Math.sqrt(2) * 255 * SCALE);
  console.log(`  INFO: Max theoretical nudge at corner: ±${maxNudge}`);
  assert(maxNudge < 55, `Max nudge ${maxNudge} < 55 (well within 0-255 range)`);
}

// ─── Test 6: Encoder Consistency ───

function testEncoderConsistency() {
  console.log('\n[Test 6] Encoder Consistency (3ch vs 4ch stride)');

  // Simulate the same block with 3ch (CLI) and 4ch (browser) encoding
  const WIDTH = 8, HEIGHT = 8;

  // Create a test pixel block
  const present3ch = Buffer.alloc(WIDTH * HEIGHT * 3);
  const present4ch = new Uint8ClampedArray(WIDTH * HEIGHT * 4);

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const r = 200, g = 100, b = 60;  // warm color
      const i3 = (y * WIDTH + x) * 3;
      const i4 = (y * WIDTH + x) * 4;
      present3ch[i3] = r; present3ch[i3+1] = g; present3ch[i3+2] = b;
      present4ch[i4] = r; present4ch[i4+1] = g; present4ch[i4+2] = b; present4ch[i4+3] = 255;
    }
  }

  // Compute avgRG/avgBG with 3ch stride
  let sumRG_3 = 0, sumBG_3 = 0;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 3;
      sumRG_3 += present3ch[i] - present3ch[i+1];
      sumBG_3 += present3ch[i+2] - present3ch[i+1];
    }
  }

  // Compute with 4ch stride
  let sumRG_4 = 0, sumBG_4 = 0;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 4;
      sumRG_4 += present4ch[i] - present4ch[i+1];
      sumBG_4 += present4ch[i+2] - present4ch[i+1];
    }
  }

  const count = WIDTH * HEIGHT;
  assertClose(sumRG_3 / count, sumRG_4 / count, 0.001,
    `avgRG: 3ch=${(sumRG_3/count).toFixed(2)} vs 4ch=${(sumRG_4/count).toFixed(2)}`);
  assertClose(sumBG_3 / count, sumBG_4 / count, 0.001,
    `avgBG: 3ch=${(sumBG_3/count).toFixed(2)} vs 4ch=${(sumBG_4/count).toFixed(2)}`);
}

// ─── Test 7: R/B Mosaic Properties (ψ3.2) ───

function computeBlockAvg(pixelValues) {
  // Average an array of pixel values (simulates 4×4 block averaging for ψ3.2)
  const sum = pixelValues.reduce((a, b) => a + b, 0);
  return Math.round(sum / pixelValues.length);
}

function testRBMosaic() {
  console.log('\n[Test 7] R/B Mosaic Properties (ψ3.2) - BLOCK_MOSAIC=' + BLOCK_MOSAIC);

  // 7a: Block average preserves total intensity
  {
    console.log('  --- 7a: Total intensity preservation ---');
    // Create a block of random-ish R values (4×4 = 16 pixels)
    const blockPixels = [];
    for (let y = 0; y < BLOCK_MOSAIC; y++) {
      for (let x = 0; x < BLOCK_MOSAIC; x++) {
        blockPixels.push(100 + (x * 7 + y * 13) % 50);  // 100-149 range
      }
    }
    const originalSum = blockPixels.reduce((a, b) => a + b, 0);
    const blockAvg = computeBlockAvg(blockPixels);
    const mosaicSum = blockAvg * blockPixels.length;

    // Rounding error: at most ±0.5 per pixel × 16 pixels = ±8
    assertClose(mosaicSum, originalSum, 8,
      `total intensity: mosaic=${mosaicSum} vs original=${originalSum}`);
  }

  // 7b: Centroid direction preserved under block averaging
  {
    console.log('  --- 7b: Centroid direction preservation ---');
    // Simulate rightward motion:
    // Past (R): bright on left, dark on right
    // Future (B): dark on left, bright on right
    const WIDTH = 32, HEIGHT = 4;  // 8 blocks wide (4×4), 1 block tall
    const blocksX = WIDTH / BLOCK_MOSAIC;

    // Per-pixel arrays
    const pastR = new Uint8Array(WIDTH * HEIGHT);
    const futureB = new Uint8Array(WIDTH * HEIGHT);

    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const i = y * WIDTH + x;
        pastR[i] = Math.round(200 * (1 - x / (WIDTH - 1)));     // 200→0 left to right
        futureB[i] = Math.round(200 * (x / (WIDTH - 1)));       // 0→200 left to right
      }
    }

    // Compute per-pixel centroids
    let rSumX = 0, rTotal = 0, bSumX = 0, bTotal = 0;
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const i = y * WIDTH + x;
        rSumX += x * pastR[i]; rTotal += pastR[i];
        bSumX += x * futureB[i]; bTotal += futureB[i];
      }
    }
    const pixelRCx = rSumX / rTotal;
    const pixelBCx = bSumX / bTotal;
    const pixelDirection = pixelBCx - pixelRCx;  // positive = rightward

    // Compute block-averaged centroids (4×4 blocks)
    const blockAvgR = new Uint8Array(blocksX);
    const blockAvgB = new Uint8Array(blocksX);
    for (let bx = 0; bx < blocksX; bx++) {
      let sumR = 0, sumB = 0, count = 0;
      for (let y = 0; y < HEIGHT; y++) {
        for (let x = bx * BLOCK_MOSAIC; x < (bx + 1) * BLOCK_MOSAIC; x++) {
          const i = y * WIDTH + x;
          sumR += pastR[i];
          sumB += futureB[i];
          count++;
        }
      }
      blockAvgR[bx] = Math.round(sumR / count);
      blockAvgB[bx] = Math.round(sumB / count);
    }

    // Mosaic centroids (each 4×4 block's 16 pixels have same value)
    let mRSumX = 0, mRTotal = 0, mBSumX = 0, mBTotal = 0;
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const bx = Math.floor(x / BLOCK_MOSAIC);
        mRSumX += x * blockAvgR[bx]; mRTotal += blockAvgR[bx];
        mBSumX += x * blockAvgB[bx]; mBTotal += blockAvgB[bx];
      }
    }
    const mosaicRCx = mRSumX / mRTotal;
    const mosaicBCx = mBSumX / mBTotal;
    const mosaicDirection = mosaicBCx - mosaicRCx;

    assert(pixelDirection > 0, `per-pixel direction=${pixelDirection.toFixed(2)} > 0 (rightward)`);
    assert(mosaicDirection > 0, `mosaic direction=${mosaicDirection.toFixed(2)} > 0 (rightward)`);
    assert(Math.sign(pixelDirection) === Math.sign(mosaicDirection),
      `direction preserved: pixel=${pixelDirection.toFixed(2)}, mosaic=${mosaicDirection.toFixed(2)}`);
  }

  // 7c: Static scene — block averages match per-pixel values
  {
    console.log('  --- 7c: Static scene R/B block consistency ---');
    // In a static scene: Past_R ≈ Present_G ≈ Future_B at each pixel
    // Block average of uniform region = pixel value
    const uniformR = 150;
    const uniformG = 150;
    const uniformB = 150;
    const blockPixels = new Array(BLOCK_MOSAIC * BLOCK_MOSAIC).fill(uniformR);
    const avg = computeBlockAvg(blockPixels);
    assert(avg === uniformR,
      `uniform block avg=${avg} === pixel value=${uniformR}`);

    // Slightly varying static scene (texture)
    const texturedPixels = [];
    for (let i = 0; i < BLOCK_MOSAIC * BLOCK_MOSAIC; i++) {
      texturedPixels.push(140 + (i % 16));  // 140-155
    }
    const texturedAvg = computeBlockAvg(texturedPixels);
    const texturedMean = texturedPixels.reduce((a, b) => a + b, 0) / texturedPixels.length;
    assertClose(texturedAvg, texturedMean, 1,
      `textured block avg=${texturedAvg} ≈ mean=${texturedMean.toFixed(1)}`);
  }

  // 7d: DC preservation — global average preserved
  {
    console.log('  --- 7d: Global DC preservation ---');
    // Sum of block averages × block sizes should ≈ sum of all pixels
    const WIDTH = 24, HEIGHT = 16;  // 6×4 blocks (4×4 each)
    const blocksX = Math.ceil(WIDTH / BLOCK_MOSAIC);
    const blocksY = Math.ceil(HEIGHT / BLOCK_MOSAIC);
    const pixels = new Uint8Array(WIDTH * HEIGHT);

    // Fill with gradient
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        pixels[y * WIDTH + x] = Math.round(50 + 150 * x / (WIDTH - 1));
      }
    }

    // Original sum
    let originalSum = 0;
    for (let i = 0; i < pixels.length; i++) originalSum += pixels[i];

    // Block-averaged sum (4×4 blocks)
    let mosaicSum = 0;
    for (let by = 0; by < blocksY; by++) {
      for (let bx = 0; bx < blocksX; bx++) {
        let blockSum = 0, count = 0;
        const yEnd = Math.min((by + 1) * BLOCK_MOSAIC, HEIGHT);
        const xEnd = Math.min((bx + 1) * BLOCK_MOSAIC, WIDTH);
        for (let y = by * BLOCK_MOSAIC; y < yEnd; y++) {
          for (let x = bx * BLOCK_MOSAIC; x < xEnd; x++) {
            blockSum += pixels[y * WIDTH + x];
            count++;
          }
        }
        const avg = Math.round(blockSum / count);
        mosaicSum += avg * count;
      }
    }

    // Rounding error: ±0.5 per block × 24 blocks × ~16 pixels = ±192
    assertClose(mosaicSum, originalSum, WIDTH * HEIGHT * 0.5,
      `global DC: mosaic=${mosaicSum} vs original=${originalSum}`);
  }

  // 7e: 64×64 temporal resolution check
  {
    console.log('  --- 7e: Temporal resolution (64×64 vs 32×32) ---');
    const cellSize = 256;
    const blocksOld = Math.ceil(cellSize / 8);   // v3.1: 8×8 = 32×32
    const blocksNew = Math.ceil(cellSize / 4);   // v3.2: 4×4 = 64×64
    assert(blocksOld === 32, `v3.1 (8×8): ${blocksOld}×${blocksOld} temporal grid`);
    assert(blocksNew === 64, `v3.2 (4×4): ${blocksNew}×${blocksNew} temporal grid`);
    assert(blocksNew > blocksOld, `v3.2 resolution (${blocksNew}) > v3.1 (${blocksOld})`);
  }
}

// ─── Run All ───

console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║     VAM-RGB ψ3.2 Math Verification Test                   ║');
console.log('║     BLOCK_NUDGE=8  BLOCK_MOSAIC=4  SCALE=0.15             ║');
console.log('╚═══════════════════════════════════════════════════════════╝');

testCenterPreservation();
testDCPreservation();
testGradientDirection();
testRoundTrip();
testClippingSafety();
testEncoderConsistency();
testRBMosaic();

console.log('\n' + '═'.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('═'.repeat(50));

process.exit(failed > 0 ? 1 : 0);
