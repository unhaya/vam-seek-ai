/**
 * API Routing Test Script
 *
 * このテストは、設定されたAPIキーが正しいプロバイダーとモデルで使用されることを検証します。
 * ミスルーティングはユーザーのAPI利用料に直接影響するため、最重要テストです。
 *
 * テスト項目:
 * 1. プロバイダー切り替えが正しく動作するか
 * 2. 各プロバイダーで正しいAPIキーが使用されるか
 * 3. 各プロバイダーで正しいモデルが使用されるか
 * 4. 設定の保存・読み込みが正しく動作するか
 * 5. レガシー設定との後方互換性
 *
 * 注意: DeepSeekは現在Vision API未対応のため、UIでは無効化されています。
 * ただし、将来のVision API公開に備えてコードとテストは維持しています。
 *
 * 実行方法: node test/api-routing-test.js
 */

const path = require('path');
const fs = require('fs');

// Test data directory
const mockUserDataPath = path.join(__dirname, 'test-data');
if (!fs.existsSync(mockUserDataPath)) {
  fs.mkdirSync(mockUserDataPath, { recursive: true });
}

// ========================================
// Mock Setup - Must happen BEFORE requiring ai-service
// ========================================

// Track all SDK instantiations
const sdkCalls = {
  anthropic: [],
  openai: []
};

// Mock Anthropic SDK
class MockAnthropic {
  constructor(config) {
    this.config = config;
    sdkCalls.anthropic.push({ apiKey: config.apiKey, timestamp: Date.now() });
  }
}

// Mock OpenAI SDK
class MockOpenAI {
  constructor(config) {
    this.config = config;
    sdkCalls.openai.push({ apiKey: config.apiKey, baseURL: config.baseURL, timestamp: Date.now() });
  }
}

// Override require for SDKs BEFORE loading ai-service
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
  if (id === '@anthropic-ai/sdk') {
    return MockAnthropic;
  }
  if (id === 'openai') {
    return MockOpenAI;
  }
  if (id === 'electron') {
    return {
      app: {
        getPath: (name) => {
          if (name === 'userData') return mockUserDataPath;
          return '';
        }
      }
    };
  }
  return originalRequire.apply(this, arguments);
};

// Now load ai-service with mocks in place
const aiServicePath = path.resolve(__dirname, '../src/main/ai-service.js');

// Test results
let testsPassed = 0;
let testsFailed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    testsPassed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    testsFailed++;
    failures.push({ name, error: err.message });
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected "${expected}", got "${actual}"`);
  }
}

function assertNotNull(value, message) {
  if (value === null || value === undefined) {
    throw new Error(`${message}: expected non-null value`);
  }
}

function assertTrue(value, message) {
  if (!value) {
    throw new Error(`${message}: expected true`);
  }
}

function assertFalse(value, message) {
  if (value) {
    throw new Error(`${message}: expected false`);
  }
}

// Clean up test settings file
function cleanupSettings() {
  const settingsPath = path.join(mockUserDataPath, 'ai-settings.json');
  if (fs.existsSync(settingsPath)) {
    fs.unlinkSync(settingsPath);
  }
  sdkCalls.anthropic = [];
  sdkCalls.openai = [];
}

// Load fresh ai-service instance
function loadFreshService() {
  delete require.cache[aiServicePath];
  return require(aiServicePath);
}

console.log('\n========================================');
console.log('  API Routing Test Suite');
console.log('  V7.11 - Claude & DeepSeek Multi-Provider');
console.log('========================================\n');

// ========================================
// Test Group 1: Default State
// ========================================
console.log('▶ Default State Tests');
cleanupSettings();

test('Default provider should be "claude"', () => {
  const service = loadFreshService();
  assertEqual(service.getProvider(), 'claude', 'Default provider');
});

test('Default Claude model should be claude-sonnet-4-5-20250929', () => {
  const service = loadFreshService();
  service.setProvider('claude');
  assertEqual(service.getModel(), 'claude-sonnet-4-5-20250929', 'Default Claude model');
});

test('Default grid seconds should be 15 (luxury mode)', () => {
  const service = loadFreshService();
  assertEqual(service.getGridSecondsPerCell(), 15, 'Default grid seconds');
});

// ========================================
// Test Group 2: Claude Initialization
// ========================================
console.log('\n▶ Claude Initialization Tests');
cleanupSettings();

test('initClaude creates Anthropic client with correct key', () => {
  const service = loadFreshService();
  const testKey = 'sk-ant-test-claude-key-12345';

  service.initClaude(testKey, 'claude-sonnet-4-5-20250929');

  const lastCall = sdkCalls.anthropic[sdkCalls.anthropic.length - 1];
  assertNotNull(lastCall, 'Anthropic client created');
  assertEqual(lastCall.apiKey, testKey, 'Anthropic API key');
});

test('initClaude does NOT create OpenAI client', () => {
  const initialOpenAICalls = sdkCalls.openai.length;
  const service = loadFreshService();

  service.initClaude('sk-ant-test', 'claude-sonnet-4-5-20250929');

  assertEqual(sdkCalls.openai.length, initialOpenAICalls, 'No new OpenAI client');
});

test('initClaude sets correct model', () => {
  const service = loadFreshService();
  service.initClaude('sk-ant-test', 'claude-opus-4-5-20251101');

  service.setProvider('claude');
  assertEqual(service.getModel(), 'claude-opus-4-5-20251101', 'Claude model');
});

// ========================================
// Test Group 3: DeepSeek Initialization
// ========================================
console.log('\n▶ DeepSeek Initialization Tests');
cleanupSettings();

test('initDeepSeek creates OpenAI client with correct key', () => {
  const service = loadFreshService();
  const testKey = 'sk-deepseek-test-key-67890';

  service.initDeepSeek(testKey, 'deepseek-reasoner');

  const lastCall = sdkCalls.openai[sdkCalls.openai.length - 1];
  assertNotNull(lastCall, 'OpenAI client created');
  assertEqual(lastCall.apiKey, testKey, 'DeepSeek API key');
});

test('initDeepSeek uses correct baseURL (api.deepseek.com)', () => {
  const service = loadFreshService();

  service.initDeepSeek('sk-ds-test', 'deepseek-reasoner');

  const lastCall = sdkCalls.openai[sdkCalls.openai.length - 1];
  assertEqual(lastCall.baseURL, 'https://api.deepseek.com', 'DeepSeek baseURL');
});

test('initDeepSeek does NOT create Anthropic client', () => {
  const initialAnthropicCalls = sdkCalls.anthropic.length;
  const service = loadFreshService();

  service.initDeepSeek('sk-ds-test', 'deepseek-reasoner');

  assertEqual(sdkCalls.anthropic.length, initialAnthropicCalls, 'No new Anthropic client');
});

test('initDeepSeek sets correct model', () => {
  const service = loadFreshService();
  service.initDeepSeek('sk-ds-test', 'deepseek-chat');

  service.setProvider('deepseek');
  assertEqual(service.getModel(), 'deepseek-chat', 'DeepSeek model');
});

// ========================================
// Test Group 4: Provider Switching
// ========================================
console.log('\n▶ Provider Switching Tests');
cleanupSettings();

test('setProvider switches to deepseek', () => {
  const service = loadFreshService();
  service.setProvider('deepseek');
  assertEqual(service.getProvider(), 'deepseek', 'Provider is deepseek');
});

test('setProvider switches back to claude', () => {
  const service = loadFreshService();
  service.setProvider('deepseek');
  service.setProvider('claude');
  assertEqual(service.getProvider(), 'claude', 'Provider is claude');
});

test('getModel returns correct model after provider switch', () => {
  const service = loadFreshService();
  service.initClaude('sk-ant-test', 'claude-opus-4-5-20251101');
  service.initDeepSeek('sk-ds-test', 'deepseek-chat');

  service.setProvider('claude');
  assertEqual(service.getModel(), 'claude-opus-4-5-20251101', 'Claude model');

  service.setProvider('deepseek');
  assertEqual(service.getModel(), 'deepseek-chat', 'DeepSeek model');
});

// ========================================
// Test Group 5: isConfigured Checks
// ========================================
console.log('\n▶ isConfigured Tests');
cleanupSettings();

test('isConfigured returns false when no API key set', () => {
  const service = loadFreshService();
  service.setProvider('claude');
  assertFalse(service.isConfigured(), 'Claude not configured');

  service.setProvider('deepseek');
  assertFalse(service.isConfigured(), 'DeepSeek not configured');
});

test('isConfigured returns true only for configured provider', () => {
  const service = loadFreshService();
  service.initClaude('sk-ant-test', 'claude-sonnet-4-5-20250929');

  service.setProvider('claude');
  assertTrue(service.isConfigured(), 'Claude is configured');

  service.setProvider('deepseek');
  assertFalse(service.isConfigured(), 'DeepSeek still not configured');
});

test('isConfigured returns true after both providers configured', () => {
  const service = loadFreshService();
  service.initClaude('sk-ant-test', 'claude-sonnet-4-5-20250929');
  service.initDeepSeek('sk-ds-test', 'deepseek-reasoner');

  service.setProvider('claude');
  assertTrue(service.isConfigured(), 'Claude configured');

  service.setProvider('deepseek');
  assertTrue(service.isConfigured(), 'DeepSeek configured');
});

// ========================================
// Test Group 6: setModel Updates Correct Provider
// ========================================
console.log('\n▶ setModel Tests');
cleanupSettings();

test('setModel updates only active provider model', () => {
  const service = loadFreshService();
  service.initClaude('sk-ant-test', 'claude-sonnet-4-5-20250929');
  service.initDeepSeek('sk-ds-test', 'deepseek-reasoner');

  // Change Claude model
  service.setProvider('claude');
  service.setModel('claude-haiku-4-5-20251001');

  // Verify Claude changed
  assertEqual(service.getModel(), 'claude-haiku-4-5-20251001', 'Claude model changed');

  // Verify DeepSeek unchanged
  service.setProvider('deepseek');
  assertEqual(service.getModel(), 'deepseek-reasoner', 'DeepSeek model unchanged');
});

test('setModel for DeepSeek does not affect Claude', () => {
  const service = loadFreshService();
  service.initClaude('sk-ant-test', 'claude-opus-4-5-20251101');
  service.initDeepSeek('sk-ds-test', 'deepseek-reasoner');

  // Change DeepSeek model
  service.setProvider('deepseek');
  service.setModel('deepseek-chat');

  // Verify DeepSeek changed
  assertEqual(service.getModel(), 'deepseek-chat', 'DeepSeek model changed');

  // Verify Claude unchanged
  service.setProvider('claude');
  assertEqual(service.getModel(), 'claude-opus-4-5-20251101', 'Claude model unchanged');
});

// ========================================
// Test Group 7: API Key Security (getAllSettings)
// ========================================
console.log('\n▶ API Key Security Tests');
cleanupSettings();

test('getAllSettings masks API keys', () => {
  const service = loadFreshService();
  service.initClaude('sk-ant-REAL-SECRET-KEY-DO-NOT-EXPOSE', 'claude-sonnet-4-5-20250929');
  service.initDeepSeek('sk-ds-REAL-SECRET-KEY-DO-NOT-EXPOSE', 'deepseek-reasoner');

  const settings = service.getAllSettings();

  assertEqual(settings.claudeApiKey, '••••••••', 'Claude key masked');
  assertEqual(settings.deepseekApiKey, '••••••••', 'DeepSeek key masked');
});

test('getAllSettings returns null for unconfigured keys', () => {
  const service = loadFreshService();
  const settings = service.getAllSettings();

  assertEqual(settings.claudeApiKey, null, 'Claude key null');
  assertEqual(settings.deepseekApiKey, null, 'DeepSeek key null');
});

test('getAllSettings includes all settings correctly', () => {
  const service = loadFreshService();
  service.initClaude('sk-ant-test', 'claude-opus-4-5-20251101');
  service.initDeepSeek('sk-ds-test', 'deepseek-chat');
  service.setProvider('deepseek');
  service.setGridSecondsPerCell(25);

  const settings = service.getAllSettings();

  assertEqual(settings.provider, 'deepseek', 'Provider correct');
  assertEqual(settings.claudeModel, 'claude-opus-4-5-20251101', 'Claude model correct');
  assertEqual(settings.deepseekModel, 'deepseek-chat', 'DeepSeek model correct');
  assertEqual(settings.gridSecondsPerCell, 25, 'Grid seconds correct');
});

// ========================================
// Test Group 8: Settings Persistence
// ========================================
console.log('\n▶ Settings Persistence Tests');
cleanupSettings();

test('Settings are persisted to file', () => {
  const service = loadFreshService();
  service.initClaude('sk-ant-persist-test', 'claude-opus-4-5-20251101');
  service.initDeepSeek('sk-ds-persist-test', 'deepseek-chat');
  service.setProvider('deepseek');
  service.setGridSecondsPerCell(20);

  // Read settings file directly
  const settingsPath = path.join(mockUserDataPath, 'ai-settings.json');
  assertTrue(fs.existsSync(settingsPath), 'Settings file exists');

  const savedData = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

  assertEqual(savedData.provider, 'deepseek', 'Saved provider');
  assertEqual(savedData.claudeApiKey, 'sk-ant-persist-test', 'Saved Claude key');
  assertEqual(savedData.deepseekApiKey, 'sk-ds-persist-test', 'Saved DeepSeek key');
  assertEqual(savedData.claudeModel, 'claude-opus-4-5-20251101', 'Saved Claude model');
  assertEqual(savedData.deepseekModel, 'deepseek-chat', 'Saved DeepSeek model');
  assertEqual(savedData.gridSecondsPerCell, 20, 'Saved grid seconds');
});

test('initFromSaved loads persisted settings', () => {
  // Settings from previous test should still exist
  const service = loadFreshService();
  service.initFromSaved();

  assertEqual(service.getProvider(), 'deepseek', 'Loaded provider');
  assertEqual(service.getGridSecondsPerCell(), 20, 'Loaded grid seconds');

  service.setProvider('claude');
  assertEqual(service.getModel(), 'claude-opus-4-5-20251101', 'Loaded Claude model');

  service.setProvider('deepseek');
  assertEqual(service.getModel(), 'deepseek-chat', 'Loaded DeepSeek model');
});

// ========================================
// Test Group 9: Legacy Settings Support
// ========================================
console.log('\n▶ Legacy Settings Tests');
cleanupSettings();

test('Legacy format (apiKey, model) loads correctly', () => {
  // Write legacy format settings
  const settingsPath = path.join(mockUserDataPath, 'ai-settings.json');
  const legacySettings = {
    apiKey: 'sk-ant-legacy-key',
    model: 'claude-sonnet-4-5-20250929'
  };
  fs.writeFileSync(settingsPath, JSON.stringify(legacySettings), 'utf8');

  const service = loadFreshService();
  service.initFromSaved();

  // Should load as Claude
  service.setProvider('claude');
  assertEqual(service.getModel(), 'claude-sonnet-4-5-20250929', 'Legacy model loaded');
  assertTrue(service.isConfigured(), 'Claude configured from legacy');
});

// ========================================
// Test Group 10: Cross-Contamination Prevention
// ========================================
console.log('\n▶ Cross-Contamination Prevention Tests');
cleanupSettings();

test('Claude key never used for DeepSeek client', () => {
  const service = loadFreshService();
  const claudeKey = 'sk-ant-CLAUDE-ONLY';
  const deepseekKey = 'sk-ds-DEEPSEEK-ONLY';

  service.initClaude(claudeKey, 'claude-sonnet-4-5-20250929');
  service.initDeepSeek(deepseekKey, 'deepseek-reasoner');

  // Check all OpenAI client instantiations
  for (const call of sdkCalls.openai) {
    if (call.apiKey === claudeKey) {
      throw new Error(`CRITICAL: Claude key "${claudeKey}" used for OpenAI client!`);
    }
  }
});

test('DeepSeek key never used for Anthropic client', () => {
  const service = loadFreshService();
  const claudeKey = 'sk-ant-CLAUDE-ONLY';
  const deepseekKey = 'sk-ds-DEEPSEEK-ONLY';

  service.initClaude(claudeKey, 'claude-sonnet-4-5-20250929');
  service.initDeepSeek(deepseekKey, 'deepseek-reasoner');

  // Check all Anthropic client instantiations
  for (const call of sdkCalls.anthropic) {
    if (call.apiKey === deepseekKey) {
      throw new Error(`CRITICAL: DeepSeek key "${deepseekKey}" used for Anthropic client!`);
    }
  }
});

test('Provider switch does not recreate clients with wrong keys', () => {
  const service = loadFreshService();
  const claudeKey = 'sk-ant-CLAUDE-ONLY';
  const deepseekKey = 'sk-ds-DEEPSEEK-ONLY';

  service.initClaude(claudeKey, 'claude-sonnet-4-5-20250929');
  service.initDeepSeek(deepseekKey, 'deepseek-reasoner');

  // Switch providers multiple times
  for (let i = 0; i < 5; i++) {
    service.setProvider('claude');
    service.setProvider('deepseek');
  }

  // Verify no cross-contamination in any SDK calls
  for (const call of sdkCalls.openai) {
    if (call.apiKey === claudeKey) {
      throw new Error('Cross-contamination during provider switch!');
    }
  }
  for (const call of sdkCalls.anthropic) {
    if (call.apiKey === deepseekKey) {
      throw new Error('Cross-contamination during provider switch!');
    }
  }
});

// ========================================
// Test Group 11: Grid Settings
// ========================================
console.log('\n▶ Grid Settings Tests');
cleanupSettings();

test('setGridSecondsPerCell updates value', () => {
  const service = loadFreshService();
  service.setGridSecondsPerCell(25);
  assertEqual(service.getGridSecondsPerCell(), 25, 'Grid seconds updated');
});

test('Grid seconds persists correctly', () => {
  const service = loadFreshService();
  service.setGridSecondsPerCell(37.5);

  const settingsPath = path.join(mockUserDataPath, 'ai-settings.json');
  const savedData = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assertEqual(savedData.gridSecondsPerCell, 37.5, 'Grid seconds persisted');
});

// ========================================
// Summary
// ========================================
console.log('\n========================================');
console.log('  Test Summary');
console.log('========================================');
console.log(`  Passed: ${testsPassed}`);
console.log(`  Failed: ${testsFailed}`);

if (failures.length > 0) {
  console.log('\n  ❌ Failures:');
  failures.forEach((f, i) => {
    console.log(`    ${i + 1}. ${f.name}`);
    console.log(`       ${f.error}`);
  });
}

console.log('\n========================================');
if (testsFailed === 0) {
  console.log('  ✅ All tests passed!');
  console.log('  API routing is correctly implemented.');
} else {
  console.log('  ⚠️  Some tests failed!');
  console.log('  Review failures before deploying.');
}
console.log('========================================\n');

// Cleanup
cleanupSettings();
if (fs.existsSync(mockUserDataPath)) {
  try {
    fs.rmSync(mockUserDataPath, { recursive: true });
  } catch (e) {
    // Ignore cleanup errors
  }
}

// Restore original require
Module.prototype.require = originalRequire;

// Exit with appropriate code
process.exit(testsFailed > 0 ? 1 : 0);
