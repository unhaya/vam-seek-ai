/**
 * Test script for DeSemanticizer and QueryRouter
 *
 * Run: node src/quarantine/test-quarantine.js
 */

'use strict';

const { DeSemanticizer } = require('./DeSemanticizer');
const { QueryRouter } = require('./QueryRouter');

// Test DeSemanticizer
function testDeSemanticizer() {
  console.log('=== DeSemanticizer Tests ===\n');

  const ds = new DeSemanticizer({ debug: true });

  const testQueries = [
    'パンツはどこにある？',
    'Where is the underwear?',
    '人物の顔を探して',
    '動きがあるシーンはどこ？',
    '赤い服を着ている人',
    '何が起きている？'  // Generic query
  ];

  for (const query of testQueries) {
    console.log(`\nQuery: "${query}"`);
    const result = ds.quarantine(query);
    console.log(`Type: ${result.queryType.type}`);
    console.log(`Features: ${result.features.map(f => f.name).join(', ') || '(generic)'}`);
    console.log('Physics Query (excerpt):');
    console.log(result.physicsQuery.substring(0, 200) + '...\n');
    console.log('-'.repeat(60));
  }
}

// Test QueryRouter
function testQueryRouter() {
  console.log('\n=== QueryRouter Tests ===\n');

  const router = new QueryRouter({ debug: true });

  const testQueries = [
    { query: 'パンツはどこ？', expected: true },
    { query: '全体の動きを教えて', expected: false },
    { query: 'タイムスタンプを確認して', expected: false },
    { query: '裸のシーン', expected: true },
    { query: '明るさの変化', expected: false },
    { query: '顔が映っている場所', expected: true }
  ];

  for (const test of testQueries) {
    const shouldQ = router.shouldQuarantine(test.query);
    const result = shouldQ === test.expected ? 'PASS' : 'FAIL';
    console.log(`[${result}] "${test.query}" → quarantine=${shouldQ} (expected=${test.expected})`);
  }
}

// Test Physics Query Generation
function testPhysicsQueryGeneration() {
  console.log('\n=== Physics Query Generation ===\n');

  const ds = new DeSemanticizer();

  const query = 'パンツはどのセルにある？';
  const result = ds.quarantine(query);

  console.log('Original Query:', query);
  console.log('\nGenerated Physics Query:');
  console.log('=' .repeat(60));
  console.log(result.physicsQuery);
  console.log('=' .repeat(60));
}

// Test Reconstruction
function testReconstruction() {
  console.log('\n=== Reconstruction Test ===\n');

  const ds = new DeSemanticizer();

  const query = 'パンツはどこ？';
  const quarantineResult = ds.quarantine(query);

  // Simulated AI physics response
  const mockPhysicsResponse = `
[
  {"idx": 12, "x": 4, "y": 1, "R": 180, "G": 150, "B": 170, "dRB": 0.04, "dir": "→"},
  {"idx": 27, "x": 3, "y": 3, "R": 175, "G": 145, "B": 165, "dRB": 0.03, "dir": "←"},
  {"idx": 45, "x": 5, "y": 5, "R": 190, "G": 160, "B": 180, "dRB": 0.04, "dir": "→"}
]
`;

  const reconstructed = ds.reconstruct(mockPhysicsResponse, quarantineResult);

  console.log('Original Query:', query);
  console.log('Query Type:', quarantineResult.queryType.type);
  console.log('\nMock Physics Response (what AI returns):');
  console.log(mockPhysicsResponse.trim());
  console.log('\nReconstructed Semantic Answer:');
  console.log(reconstructed.semanticAnswer);
  console.log('Confidence:', reconstructed.confidence);
  console.log('Blocks found:', reconstructed.blocks.length);
}

// Test Cell Isolation Query
function testCellIsolation() {
  console.log('\n=== Cell Isolation Query ===\n');

  const ds = new DeSemanticizer();

  const query = 'パンツはどこ？';
  const quarantineResult = ds.quarantine(query);

  console.log('Cell 42 Isolation Query:');
  console.log('=' .repeat(60));
  console.log(ds.getCellIsolationQuery(42, quarantineResult.physicsQuery));
  console.log('=' .repeat(60));
}

// Run all tests
console.log('VAM-RGB ψ4.0 De-semantification Test Suite\n');
console.log('「画像を殺さず、質問を殺す」\n');

testDeSemanticizer();
testQueryRouter();
testPhysicsQueryGeneration();
testReconstruction();
testCellIsolation();

console.log('\n✓ All tests completed');
