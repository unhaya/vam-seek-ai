/**
 * TanukiDetector テスト
 *
 * タヌキ（物語に逃げたAI）を検出できるかの検証
 *
 * v1.0 - 2026-01-31
 */

'use strict';

const { TanukiDetector } = require('../../src/validation/TanukiDetector');

// モック物理プロファイル
const mockPhysicsProfiles = [
  {
    cellIndex: 0,
    timestamp: 0,
    physicsIntensity: 0.02,  // 低い = 静止
    colorSeparation: 0.01,
    directionalFringe: { dx: 0, dy: 0, magnitude: 0.01, angleDeg: 0 },
    hasMotion: false
  },
  {
    cellIndex: 1,
    timestamp: 15,
    physicsIntensity: 0.25,  // 高い = 激しい動き
    colorSeparation: 0.18,
    directionalFringe: { dx: 5, dy: 0, magnitude: 0.15, angleDeg: 0 },  // 右方向
    hasMotion: true
  },
  {
    cellIndex: 2,
    timestamp: 30,
    physicsIntensity: 0.08,  // 中程度
    colorSeparation: 0.05,
    directionalFringe: { dx: -3, dy: 2, magnitude: 0.08, angleDeg: 150 },  // 左下方向
    hasMotion: true
  }
];

function runTests() {
  const detector = new TanukiDetector();
  let passed = 0;
  let failed = 0;

  // テスト1: 物理に根ざした記述（タヌキではない）
  console.log('\n=== テスト1: 物理ベースの記述 ===');
  const groundedText = `
    0:00 - 静止状態、動きなし
    0:15 - 激しい動き、右方向へ移動、大きなフリンジ
    0:30 - 中程度の動き、左下方向
  `;
  const result1 = detector.detect(groundedText, mockPhysicsProfiles);
  console.log('  tanukiScore:', result1.tanukiScore);
  console.log('  isTanuki:', result1.isTanuki);
  console.log('  claims:', result1.totalClaims);
  console.log('  violations:', result1.totalViolations);
  console.log('  interpretation:', result1.interpretation.description);

  if (!result1.isTanuki && result1.tanukiScore < 0.3) {
    console.log('  ✓ PASS: 物理ベースの記述を正しく認識');
    passed++;
  } else {
    console.log('  ✗ FAIL: 物理ベースの記述をタヌキと誤判定');
    failed++;
  }

  // テスト2: 物語に逃げた記述（タヌキ）
  console.log('\n=== テスト2: タヌキ記述（物語優位） ===');
  const tanukiText = `
    0:00 - 激しい動き、大きなフリンジ！
    0:15 - 静止状態、動きなし
    0:30 - 右方向へ激しく移動
  `;
  // 0:00は実際は静止なのに「激しい」と言っている → タヌキ
  // 0:15は実際は激しいのに「静止」と言っている → タヌキ
  // 0:30は実際は左下なのに「右」と言っている → タヌキ
  const result2 = detector.detect(tanukiText, mockPhysicsProfiles);
  console.log('  tanukiScore:', result2.tanukiScore);
  console.log('  isTanuki:', result2.isTanuki);
  console.log('  claims:', result2.totalClaims);
  console.log('  violations:', result2.totalViolations);
  console.log('  interpretation:', result2.interpretation.description);

  if (result2.violations.length > 0) {
    console.log('  ✓ PASS: タヌキを検出');
    console.log('    違反内容:');
    for (const v of result2.violations) {
      console.log(`      - ${v.type}: expected=${JSON.stringify(v.expected || v.expectedAngle)}, actual=${v.actual}`);
    }
    passed++;
  } else {
    console.log('  ✗ FAIL: タヌキを見逃した');
    failed++;
  }

  // テスト3: 数値を明示した記述
  console.log('\n=== テスト3: 数値の明示的主張 ===');
  const numericText = `
    0:15 - 色分離: 0.18、強度: 0.25
  `;
  const result3 = detector.detect(numericText, mockPhysicsProfiles);
  console.log('  tanukiScore:', result3.tanukiScore);
  console.log('  claims:', result3.totalClaims);
  console.log('  violations:', result3.totalViolations);

  const numericClaims = result3.claims.filter(c => c.type === 'numeric');
  if (numericClaims.length > 0 && numericClaims.every(c => c.matches)) {
    console.log('  ✓ PASS: 正確な数値は通過');
    passed++;
  } else {
    console.log('  ✗ FAIL: 数値検証が失敗');
    failed++;
  }

  // テスト4: 嘘の数値
  console.log('\n=== テスト4: 嘘の数値（タヌキ） ===');
  const fakNumericText = `
    0:15 - 色分離: 0.50、強度: 0.80
  `;
  // 実際は colorSeparation=0.18, physicsIntensity=0.25 なので大きく乖離
  const result4 = detector.detect(fakNumericText, mockPhysicsProfiles);
  console.log('  tanukiScore:', result4.tanukiScore);
  console.log('  violations:', result4.totalViolations);

  const numericViolations = result4.violations.filter(c => c.type === 'numeric');
  if (numericViolations.length > 0) {
    console.log('  ✓ PASS: 嘘の数値を検出');
    console.log('    違反内容:');
    for (const v of numericViolations) {
      console.log(`      - claimed=${v.claimed}, actual=${v.actual}, diff=${v.difference}`);
    }
    passed++;
  } else {
    console.log('  ✗ FAIL: 嘘の数値を見逃した');
    failed++;
  }

  // 結果サマリー
  console.log('\n=== テスト結果 ===');
  console.log(`  PASSED: ${passed}`);
  console.log(`  FAILED: ${failed}`);
  console.log(`  TOTAL:  ${passed + failed}`);

  return failed === 0;
}

// 実行
const success = runTests();
process.exit(success ? 0 : 1);
