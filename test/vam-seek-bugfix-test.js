/**
 * VAM Seek v1.3.3 Bugfix Verification Test
 *
 * Tests for:
 * 1. _scrollToMarker() uses markerY (not targetY) - fixes center-scroll oscillation
 * 2. rebuild() cancels ongoing animations - fixes video switch oscillation
 */

const fs = require('fs');
const path = require('path');

// Read the vam-seek.js source
const vamSeekPath = path.join(__dirname, '..', 'src', 'renderer', 'lib', 'vam-seek.js');
const source = fs.readFileSync(vamSeekPath, 'utf8');

console.log('='.repeat(60));
console.log('VAM Seek v1.3.3 Bugfix Verification Test');
console.log('='.repeat(60));
console.log('');

let allPassed = true;

// Test 1: _scrollToMarker uses markerY (not targetY)
console.log('Test 1: _scrollToMarker() uses markerY instead of targetY');
console.log('-'.repeat(60));

// Find the _scrollToMarker function
const scrollToMarkerMatch = source.match(/_scrollToMarker\(\)\s*\{[\s\S]*?const\s+(\w+)\s*=\s*this\.state\.(\w+);/);

if (scrollToMarkerMatch) {
    const varName = scrollToMarkerMatch[1];
    const stateProperty = scrollToMarkerMatch[2];

    console.log(`  Found: const ${varName} = this.state.${stateProperty};`);

    if (stateProperty === 'markerY') {
        console.log('  ✓ PASS: Uses markerY (current animated position)');
    } else if (stateProperty === 'targetY') {
        console.log('  ✗ FAIL: Uses targetY (causes oscillation)');
        allPassed = false;
    } else {
        console.log(`  ? UNKNOWN: Uses ${stateProperty}`);
        allPassed = false;
    }
} else {
    console.log('  ✗ FAIL: Could not find _scrollToMarker pattern');
    allPassed = false;
}

// Also check no targetY reference in scroll calculation
const targetYInScroll = source.match(/_scrollToMarker\(\)\s*\{[\s\S]*?targetY[\s\S]*?\}/);
if (targetYInScroll && targetYInScroll[0].includes('this.state.targetY')) {
    console.log('  ✗ FAIL: Found targetY reference in _scrollToMarker');
    allPassed = false;
}

console.log('');

// Test 2: rebuild() cancels scrollAnimationId
console.log('Test 2: rebuild() cancels scrollAnimationId');
console.log('-'.repeat(60));

const rebuildCancelsScroll = source.includes('rebuild()') &&
    source.match(/rebuild\(\)\s*\{[\s\S]*?this\.state\.scrollAnimationId[\s\S]*?cancelAnimationFrame/);

if (rebuildCancelsScroll) {
    console.log('  ✓ PASS: rebuild() cancels scrollAnimationId');
} else {
    console.log('  ✗ FAIL: rebuild() does not cancel scrollAnimationId');
    allPassed = false;
}

console.log('');

// Test 3: rebuild() cancels animationId (marker animation)
console.log('Test 3: rebuild() cancels animationId (marker animation)');
console.log('-'.repeat(60));

const rebuildCancelsMarker = source.match(/rebuild\(\)\s*\{[\s\S]*?this\.state\.animationId[\s\S]*?cancelAnimationFrame/);

if (rebuildCancelsMarker) {
    console.log('  ✓ PASS: rebuild() cancels animationId');
} else {
    console.log('  ✗ FAIL: rebuild() does not cancel animationId');
    allPassed = false;
}

console.log('');

// Test 4: rebuild() resets isAnimating flag
console.log('Test 4: rebuild() resets isAnimating flag');
console.log('-'.repeat(60));

const rebuildResetsAnimating = source.match(/rebuild\(\)\s*\{[\s\S]*?this\.state\.isAnimating\s*=\s*false/);

if (rebuildResetsAnimating) {
    console.log('  ✓ PASS: rebuild() sets isAnimating = false');
} else {
    console.log('  ✗ FAIL: rebuild() does not reset isAnimating');
    allPassed = false;
}

console.log('');

// Test 5: Version check
console.log('Test 5: Version is 1.3.3');
console.log('-'.repeat(60));

const versionMatch = source.match(/version:\s*['"]([^'"]+)['"]/);
if (versionMatch) {
    const version = versionMatch[1];
    console.log(`  Found version: ${version}`);
    if (version === '1.3.3') {
        console.log('  ✓ PASS: Version is 1.3.3');
    } else {
        console.log(`  ✗ FAIL: Expected 1.3.3, got ${version}`);
        allPassed = false;
    }
} else {
    console.log('  ✗ FAIL: Could not find version');
    allPassed = false;
}

console.log('');
console.log('='.repeat(60));
if (allPassed) {
    console.log('ALL TESTS PASSED ✓');
    console.log('');
    console.log('Bug fixes verified:');
    console.log('  1. Center-scroll oscillation fix (markerY instead of targetY)');
    console.log('  2. Video switch oscillation fix (animations cancelled in rebuild)');
    process.exit(0);
} else {
    console.log('SOME TESTS FAILED ✗');
    process.exit(1);
}
