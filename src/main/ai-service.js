// AI Service - Multi-provider API integration (Claude, DeepSeek, Gemini)
// v7.24: Added Gemini 1.5 Flash support with video upload
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Gemini Manager
const GeminiManager = require('./ai/GeminiManager');

// V7.5: AudioReachDetector REMOVED
// Reason: ffmpeg is slow and contradicts VAM Seek's "client-side only" philosophy
// If audio analysis is needed, use Web Audio API in renderer instead

// Provider state
let currentProvider = 'claude';  // 'claude', 'deepseek', or 'gemini'
let anthropicClient = null;
let openaiClient = null;
let geminiManager = new GeminiManager();

// API keys
let claudeApiKey = null;
let deepseekApiKey = null;
let geminiApiKey = null;

// Current model per provider
let currentModel = 'claude-sonnet-4-5-20250929';
let deepseekModel = 'deepseek-reasoner';
// v7.29: Updated default model; gemini-1.5-pro is deprecated
let geminiModel = 'gemini-2.0-flash';
let geminiInputMode = 'video';  // 'video' or 'grid'

// Gemini progress callback (for UI updates)
let geminiProgressCallback = null;

// Grid quality setting
let gridSecondsPerCell = 15;  // Default: luxury mode

// Conversation state
let conversationHistory = [];
let cachedVideoHash = null;

// Phase state for zoom flow
// 'normal' | 'zoom_asking' | 'zoom_waiting'
let currentPhase = 'normal';

// Auto-zoom tracking (no limit - zoom grid is compact enough)
// v7.15: 制限撤廃、ズーム画像のコンパクト化で対応
let zoomCount = 0;         // Current zoom count in session (for logging only)

// Settings file path
function getSettingsPath() {
  return path.join(app.getPath('userData'), 'ai-settings.json');
}

// ============================================
// v7.22: Self-Update Feature (OPUS only)
// Can only learn "how to use" existing tools
// Cannot modify code or add new tools
// ============================================

// Learned rules file path
function getRulesPath() {
  return path.join(app.getPath('userData'), 'ai-learned-rules.json');
}

// Change history log file path
function getChangeLogPath() {
  return path.join(app.getPath('userData'), 'ai-update-history.log');
}

// Append to change history log
function appendToChangeLog(action, details) {
  try {
    const logPath = getChangeLogPath();
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${action}\n${JSON.stringify(details, null, 2)}\n${'='.repeat(60)}\n`;
    fs.appendFileSync(logPath, logEntry, 'utf8');
  } catch (err) {
    console.error('[SelfUpdate] Failed to write change log:', err);
  }
}

// Load learned rules
function loadLearnedRules() {
  try {
    const rulesPath = getRulesPath();
    if (fs.existsSync(rulesPath)) {
      const data = fs.readFileSync(rulesPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('[SelfUpdate] Failed to load learned rules:', err);
  }
  return { rules: [], errorLog: [], lastUpdated: null };
}

// Save learned rules
function saveLearnedRules(rulesData) {
  try {
    const rulesPath = getRulesPath();
    rulesData.lastUpdated = new Date().toISOString();
    fs.writeFileSync(rulesPath, JSON.stringify(rulesData, null, 2), 'utf8');
    console.log(`[SelfUpdate] Saved ${rulesData.rules.length} learned rules`);
    return true;
  } catch (err) {
    console.error('[SelfUpdate] Failed to save learned rules:', err);
    return false;
  }
}

// Check if self-update is enabled
// v7.29: Added Gemini support (all Gemini models support self-update)
function isSelfUpdateEnabled() {
  if (currentProvider === 'gemini') {
    return geminiManager.isConfigured();
  }
  // Claude: Sonnet or Opus only (not Haiku)
  return currentModel.includes('opus') || currentModel.includes('sonnet');
}

// Patterns to detect error feedback (Japanese + English)
// v7.22a: Expanded based on session feedback analysis
const ERROR_PATTERNS = [
  // Japanese - Core errors
  /違う/i, /ズレ/i, /間違/i, /おかしい/i, /ハルシネ/i,
  // Japanese - Instruction non-compliance
  /読み飛ばし/i, /守らない/i, /守って/i, /指摘/i, /働いて.*な/i,
  /従って/i, /ルール/i, /ガイドライン/i, /指示/i,
  // Japanese - Repeated mistakes
  /また.*同じ/i, /何度も/i, /繰り返/i, /さっきも/i,
  // Japanese - Missing/ignoring
  /無視/i, /見落と/i, /抜け/i, /漏れ/i, /足りな/i,
  // Japanese - Quality issues
  /ちゃんと/i, /きちんと/i, /正しく/i, /直して/i,
  // English - Core errors
  /wrong/i, /incorrect/i, /error/i, /mistake/i, /not right/i,
  // English - Instruction non-compliance
  /skip/i, /ignore/i, /follow/i, /not working/i,
  /didn't follow/i, /not following/i, /guideline/i, /instruction/i,
  // English - Repeated mistakes
  /again/i, /same mistake/i, /keep doing/i, /still doing/i
];

// Check if user message is error feedback
function isErrorFeedback(userMessage) {
  return ERROR_PATTERNS.some(pattern => pattern.test(userMessage));
}

// Extract recent conversation context for error log
function extractErrorContext() {
  const recentHistory = conversationHistory.slice(-6); // Last 3 exchanges
  return recentHistory.map(msg => {
    if (typeof msg.content === 'string') {
      return { role: msg.role, text: msg.content.slice(0, 500) };
    } else if (Array.isArray(msg.content)) {
      const textPart = msg.content.find(c => c.type === 'text');
      return { role: msg.role, text: textPart?.text?.slice(0, 500) || '[image]' };
    }
    return { role: msg.role, text: '[unknown]' };
  });
}

// Log error for analysis
function logError(userMessage) {
  const rulesData = loadLearnedRules();
  const errorEntry = {
    timestamp: new Date().toISOString(),
    userFeedback: userMessage.slice(0, 200),
    context: extractErrorContext()
  };

  // Keep max 20 error logs
  rulesData.errorLog = rulesData.errorLog || [];
  rulesData.errorLog.push(errorEntry);
  if (rulesData.errorLog.length > 20) {
    rulesData.errorLog = rulesData.errorLog.slice(-20);
  }

  saveLearnedRules(rulesData);

  // Record in change log
  appendToChangeLog('ERROR_DETECTED', {
    userFeedback: errorEntry.userFeedback,
    contextLength: errorEntry.context.length
  });

  console.log('[SelfUpdate] Error logged for later analysis');
  return errorEntry;
}

// Self-critique prompt (separate API call for evaluation)
// v7.29: Added Gemini provider support
async function selfCritique(errorEntry) {
  if (!isSelfUpdateEnabled()) {
    console.log('[SelfUpdate] Skipped - self-update not enabled for current provider/model');
    return null;
  }

  // v7.29: Route to Gemini if current provider is gemini
  if (currentProvider === 'gemini') {
    try {
      const newRule = await geminiManager.selfCritique(errorEntry);
      if (newRule) {
        // 変更履歴に記録
        appendToChangeLog('RULE_GENERATED', {
          rule: newRule.rule,
          category: newRule.category,
          trigger: errorEntry.userFeedback,
          provider: 'gemini'
        });
      }
      return newRule;
    } catch (err) {
      console.error('[SelfUpdate] Gemini critique failed:', err.message);
      appendToChangeLog('CRITIQUE_FAILED', {
        error: err.message,
        trigger: errorEntry.userFeedback,
        provider: 'gemini'
      });
      return null;
    }
  }

  // Claude (Anthropic) path
  const critiquePrompt = `You are the "evaluator persona" of a video analysis AI. Analyze the error report below and generate exactly ONE improvement rule.

STRICTLY PROHIBITED:
- Proposing code changes
- Adding new tools
- Using tools other than existing ones (ZOOM_REQUEST, AUDIO_REQUEST)

ALLOWED IMPROVEMENTS:
- Timing/conditions for using existing tools
- Timestamp reading procedures
- Pre-response verification steps

ERROR REPORT:
User feedback: ${errorEntry.userFeedback}

Conversation context:
${errorEntry.context.map(c => `${c.role}: ${c.text}`).join('\n')}

OUTPUT FORMAT: Output exactly one rule in JSON format. Match the language of the rule to the user's feedback language.
{"rule": "Before doing X, always verify Y first", "category": "timestamp|zoom|audio|general"}`;

  try {
    const response = await anthropicClient.messages.create({
      model: currentModel,
      max_tokens: 256,
      messages: [{ role: 'user', content: critiquePrompt }]
    });

    const responseText = response.content[0].text;
    // JSON部分を抽出
    const jsonMatch = responseText.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const newRule = JSON.parse(jsonMatch[0]);
      console.log('[SelfUpdate] New rule generated:', newRule.rule);

      // 変更履歴に記録
      appendToChangeLog('RULE_GENERATED', {
        rule: newRule.rule,
        category: newRule.category,
        trigger: errorEntry.userFeedback,
        provider: 'claude'
      });

      return newRule;
    }
  } catch (err) {
    console.error('[SelfUpdate] Critique failed:', err.message);

    // エラーも記録
    appendToChangeLog('CRITIQUE_FAILED', {
      error: err.message,
      trigger: errorEntry.userFeedback,
      provider: 'claude'
    });
  }
  return null;
}

// Add new rule to learned rules
function addLearnedRule(newRule) {
  if (!newRule || !newRule.rule) return false;

  const rulesData = loadLearnedRules();

  // Check for duplicates (skip if similar rule exists)
  const isDuplicate = rulesData.rules.some(r =>
    r.rule.includes(newRule.rule.slice(0, 20)) ||
    newRule.rule.includes(r.rule.slice(0, 20))
  );

  if (isDuplicate) {
    console.log('[SelfUpdate] Similar rule already exists, skipping');

    // Log skipped duplicate
    appendToChangeLog('RULE_SKIPPED_DUPLICATE', {
      rule: newRule.rule
    });

    return false;
  }

  // Keep max 10 rules
  const ruleEntry = {
    ...newRule,
    addedAt: new Date().toISOString()
  };
  rulesData.rules.push(ruleEntry);

  if (rulesData.rules.length > 10) {
    const removed = rulesData.rules.shift();
    // Log removed rule
    appendToChangeLog('RULE_REMOVED_OVERFLOW', {
      removedRule: removed.rule
    });
  }

  saveLearnedRules(rulesData);

  // Log rule addition
  appendToChangeLog('RULE_ADDED', {
    rule: newRule.rule,
    category: newRule.category,
    totalRules: rulesData.rules.length
  });

  return true;
}

// Generate string to inject learned rules into prompt
// Monitor: remove old rules when total chars exceed limit
const MAX_RULES_CHARS = 500; // Prevent prompt bloat

function getLearnedRulesPrompt() {
  const rulesData = loadLearnedRules();
  if (!rulesData.rules || rulesData.rules.length === 0) {
    return '';
  }

  // Prioritize newer rules, stay within char limit
  let totalChars = 0;
  const activeRules = [];

  // Check in reverse order (newest first)
  for (let i = rulesData.rules.length - 1; i >= 0; i--) {
    const rule = rulesData.rules[i];
    const ruleChars = rule.rule.length + 5; // number + newline

    if (totalChars + ruleChars <= MAX_RULES_CHARS) {
      activeRules.unshift(rule);
      totalChars += ruleChars;
    } else {
      // Over limit - mark old rule for removal
      appendToChangeLog('RULE_PRUNED_OVERFLOW', {
        prunedRule: rule.rule,
        reason: 'prompt_size_limit'
      });
    }
  }

  // Update JSON if rules were pruned
  if (activeRules.length < rulesData.rules.length) {
    rulesData.rules = activeRules;
    saveLearnedRules(rulesData);
    console.log(`[SelfUpdate] Pruned rules to ${activeRules.length} (char limit: ${MAX_RULES_CHARS})`);
  }

  if (activeRules.length === 0) {
    return '';
  }

  const rulesText = activeRules.map((r, i) => `${i + 1}. ${r.rule}`).join('\n');
  return `\n[LEARNED RULES]\n${rulesText}`;
}

// Process error feedback (called from main)
async function processErrorFeedback(userMessage) {
  if (!isSelfUpdateEnabled()) return null;
  if (!isErrorFeedback(userMessage)) return null;

  console.log('[SelfUpdate] Error feedback detected, starting self-critique...');

  // 1. Log error
  const errorEntry = logError(userMessage);

  // 2. Generate new rule via self-critique
  const newRule = await selfCritique(errorEntry);

  // 3. Add rule
  if (newRule) {
    addLearnedRule(newRule);
    return newRule;
  }

  return null;
}

// Load settings from file
function loadSettings() {
  try {
    const settingsPath = getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Failed to load AI settings:', err);
  }
  return null;
}

// Save settings to file
function saveSettings() {
  try {
    const settingsPath = getSettingsPath();
    const data = JSON.stringify({
      provider: currentProvider,
      claudeApiKey: claudeApiKey,
      deepseekApiKey: deepseekApiKey,
      geminiApiKey: geminiApiKey,
      claudeModel: currentModel,
      deepseekModel: deepseekModel,
      geminiModel: geminiModel,
      geminiInputMode: geminiInputMode,
      gridSecondsPerCell: gridSecondsPerCell
    }, null, 2);
    fs.writeFileSync(settingsPath, data, 'utf8');
  } catch (err) {
    console.error('Failed to save AI settings:', err);
  }
}

// Initialize from saved settings (call on app start)
function initFromSaved() {
  const settings = loadSettings();
  if (settings) {
    // Load provider
    if (settings.provider) {
      currentProvider = settings.provider;
    }
    // Load Claude settings (support legacy format)
    if (settings.claudeApiKey || settings.apiKey) {
      claudeApiKey = settings.claudeApiKey || settings.apiKey;
      anthropicClient = new Anthropic({ apiKey: claudeApiKey });
    }
    if (settings.claudeModel || settings.model) {
      currentModel = settings.claudeModel || settings.model;
    }
    // Load DeepSeek settings
    if (settings.deepseekApiKey) {
      deepseekApiKey = settings.deepseekApiKey;
      openaiClient = new OpenAI({
        apiKey: deepseekApiKey,
        baseURL: 'https://api.deepseek.com'
      });
    }
    if (settings.deepseekModel) {
      deepseekModel = settings.deepseekModel;
    }
    // Load Gemini settings
    // v7.29: Auto-migrate deprecated models
    let loadedGeminiModel = settings.geminiModel;
    if (loadedGeminiModel === 'gemini-1.5-pro' || loadedGeminiModel === 'gemini-1.5-flash') {
      console.log(`[AI] Migrating deprecated Gemini model "${loadedGeminiModel}" to "gemini-2.0-flash"`);
      loadedGeminiModel = 'gemini-2.0-flash';
    }
    if (settings.geminiApiKey) {
      geminiApiKey = settings.geminiApiKey;
      geminiManager.init(geminiApiKey, loadedGeminiModel || geminiModel);
    }
    if (loadedGeminiModel) {
      geminiModel = loadedGeminiModel;
    }
    if (settings.geminiInputMode) {
      geminiInputMode = settings.geminiInputMode;
    }
    // Load grid quality
    if (settings.gridSecondsPerCell) {
      gridSecondsPerCell = settings.gridSecondsPerCell;
    }
  }
}

// Initialize Claude client
function initClaude(key, model) {
  claudeApiKey = key;
  anthropicClient = new Anthropic({ apiKey: key });
  if (model) {
    currentModel = model;
  }
  saveSettings();
}

// Initialize DeepSeek client
function initDeepSeek(key, model) {
  deepseekApiKey = key;
  openaiClient = new OpenAI({
    apiKey: key,
    baseURL: 'https://api.deepseek.com'
  });
  if (model) {
    deepseekModel = model;
  }
  saveSettings();
}

// Initialize Gemini client
function initGemini(key, model) {
  geminiApiKey = key;
  geminiManager.init(key, model || geminiModel);
  if (model) {
    geminiModel = model;
  }
  saveSettings();
}

// Legacy init function for backwards compatibility
function init(key, model) {
  initClaude(key, model);
}

// Set current provider
function setProvider(provider) {
  currentProvider = provider;
  saveSettings();
}

// Get current provider
function getProvider() {
  return currentProvider;
}

// Check if API is configured (for current provider)
function isConfigured() {
  if (currentProvider === 'gemini') {
    return geminiManager.isConfigured();
  }
  if (currentProvider === 'deepseek') {
    return openaiClient !== null && deepseekApiKey !== null;
  }
  return anthropicClient !== null && claudeApiKey !== null;
}

// Get current model (for current provider)
function getModel() {
  if (currentProvider === 'gemini') {
    return geminiModel;
  }
  if (currentProvider === 'deepseek') {
    return deepseekModel;
  }
  return currentModel;
}

// Set model (for current provider)
function setModel(model) {
  if (currentProvider === 'gemini') {
    geminiModel = model;
    geminiManager.setModel(model);
  } else if (currentProvider === 'deepseek') {
    deepseekModel = model;
  } else {
    currentModel = model;
  }
  saveSettings();
}

// Get API key (for settings display)
function getApiKey() {
  if (currentProvider === 'gemini') {
    return geminiApiKey;
  }
  if (currentProvider === 'deepseek') {
    return deepseekApiKey;
  }
  return claudeApiKey;
}

// Get all settings (for settings UI)
function getAllSettings() {
  return {
    provider: currentProvider,
    claudeApiKey: claudeApiKey ? '••••••••' : null,
    deepseekApiKey: deepseekApiKey ? '••••••••' : null,
    geminiApiKey: geminiApiKey ? '••••••••' : null,
    claudeModel: currentModel,
    deepseekModel: deepseekModel,
    geminiModel: geminiModel,
    geminiInputMode: geminiInputMode,
    gridSecondsPerCell: gridSecondsPerCell
  };
}

// Get Gemini input mode
function getGeminiInputMode() {
  return geminiInputMode;
}

// Set Gemini input mode
function setGeminiInputMode(mode) {
  geminiInputMode = mode;
  saveSettings();
}

// Get grid seconds per cell
function getGridSecondsPerCell() {
  return gridSecondsPerCell;
}

// Set grid seconds per cell
function setGridSecondsPerCell(value) {
  gridSecondsPerCell = value;
  saveSettings();
}

// Generate hash for video identification
function getVideoHash(gridData) {
  if (!gridData) return null;
  // Use video name + duration as unique identifier
  const identifier = `${gridData.videoName || ''}_${gridData.duration || 0}`;
  return crypto.createHash('md5').update(identifier).digest('hex');
}

// Clear conversation (call when video changes)
function clearConversation() {
  conversationHistory = [];
  cachedVideoHash = null;
  cachedSystemPrompt = null;
  currentPhase = 'normal';
  zoomCount = 0;  // Reset zoom counter
  // Clear Gemini video cache only when in video mode (grid mode doesn't upload videos)
  if (currentProvider === 'gemini' && geminiInputMode === 'video') {
    geminiManager.clearCache();
  }
}

// Check if auto-zoom is allowed (always true - no limit)
// v7.15: 制限撤廃
function canAutoZoom() {
  return true;
}

// Increment zoom count (for logging only)
function incrementZoomCount() {
  zoomCount++;
  console.log(`[AI] Zoom count: ${zoomCount}`);
  return zoomCount;
}

// Set phase
function setPhase(phase) {
  currentPhase = phase;
  console.log(`[AI] Phase changed to: ${phase}`);
}

// Get current phase
function getPhase() {
  return currentPhase;
}

// Prune conversation history for grid mode (sliding window)
// Keeps: first message (with images) + transcript messages + last N exchanges
// This prevents token explosion while maintaining context
// v7.31: Protect transcript messages from pruning
const MAX_HISTORY_EXCHANGES = 4;  // Keep 4 exchanges (8 messages) max after first

function pruneConversationHistory() {
  // Need at least first exchange + 2 more exchanges to prune
  // First exchange = 2 messages (user with image + assistant)
  // Total needed = 2 + (MAX_HISTORY_EXCHANGES * 2) + 2 = 2 + 8 + 2 = 12
  const minForPrune = 2 + (MAX_HISTORY_EXCHANGES * 2) + 2;
  if (conversationHistory.length < minForPrune) {
    return;  // Not enough history to prune
  }

  // v7.31: Find transcript message indices to protect them from pruning
  const transcriptIndices = new Set();
  for (let i = 0; i < conversationHistory.length; i++) {
    const msg = conversationHistory[i];
    if (msg.role === 'user' && typeof msg.content === 'string' &&
        msg.content.includes('[AUDIO_TRANSCRIPT_REQUEST]')) {
      transcriptIndices.add(i);
      // Also protect the assistant's response (next message)
      if (i + 1 < conversationHistory.length) {
        transcriptIndices.add(i + 1);
      }
    }
  }

  // Keep first 2 messages (first exchange with images)
  // Keep last (MAX_HISTORY_EXCHANGES * 2) messages
  const keepFirst = 2;
  const keepLast = MAX_HISTORY_EXCHANGES * 2;

  // Build list of indices to remove (middle messages, excluding protected ones)
  const toRemove = [];
  const lastKeepStart = conversationHistory.length - keepLast;
  for (let i = keepFirst; i < lastKeepStart; i++) {
    // Don't remove transcript messages
    if (!transcriptIndices.has(i)) {
      toRemove.push(i);
    }
  }

  // Remove from end to start to preserve indices
  for (let i = toRemove.length - 1; i >= 0; i--) {
    conversationHistory.splice(toRemove[i], 1);
  }

  if (toRemove.length > 0) {
    console.log(`[AI] Pruned ${toRemove.length} messages from conversation history (protected ${transcriptIndices.size} transcript messages)`);
  }
}

// Remove old zoom images from conversation history (sliding window)
// Keeps only the most recent zoom image to prevent context explosion
function pruneOldZoomImages() {
  // Find all messages containing zoom images
  // v7.28: Updated detection - zoom messages have format "MM:SS-MM:SS/Nフレーム"
  const zoomIndices = [];
  for (let i = 0; i < conversationHistory.length; i++) {
    const msg = conversationHistory[i];
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      // Check if this is a zoom message
      const hasZoomImage = msg.content.some(c => c.type === 'image');
      // v7.28: Match zoom text format "HH:MM:SS-HH:MM:SS/Nフレーム" or "MM:SS-MM:SS/Nフレーム"
      const hasZoomText = msg.content.some(c =>
        c.type === 'text' && c.text &&
        (/^\d{1,2}:\d{2}(:\d{2})?-\d{1,2}:\d{2}(:\d{2})?\/\d+フレーム/.test(c.text) || c.text.startsWith('[ZOOM:'))
      );
      if (hasZoomImage && hasZoomText) {
        zoomIndices.push(i);
      }
    }
  }

  // Keep only the last zoom image, remove older ones
  // But keep the text, just remove the image
  if (zoomIndices.length > 1) {
    for (let i = 0; i < zoomIndices.length - 1; i++) {
      const idx = zoomIndices[i];
      const msg = conversationHistory[idx];
      // Replace image with text description
      const textContent = msg.content.find(c => c.type === 'text');
      if (textContent) {
        conversationHistory[idx] = {
          role: 'user',
          content: textContent.text + '\n[Image removed - see latest zoom]'
        };
      }
    }
    console.log(`[AI] Pruned ${zoomIndices.length - 1} old zoom image(s) from context`);
  }
}

// v7.32: Split system prompt into STATIC (cacheable) and DYNAMIC parts
// Static part is cached, dynamic part is prepended to user message

// ============================================
// V7.5: Structured Metadata Injection
// ============================================

// Cache for audio energy data (keyed by video path hash)
let audioEnergyCache = {};

/**
 * V7.5: Merge audio energy data into cellMetadata
 * Uses AudioReachDetector to analyze audio and populate audioEnergy field
 * @param {object} gridData - Grid data containing cellMetadata and videoPath
 * @returns {Promise<object>} gridData with audioEnergy populated
 */
async function mergeAudioEnergy(gridData) {
  if (!gridData || !gridData.cellMetadata || !gridData.videoPath) {
    return gridData;
  }

  const videoPath = gridData.videoPath;
  const cacheKey = crypto.createHash('md5').update(videoPath).digest('hex');

  // Check cache first
  if (audioEnergyCache[cacheKey]) {
    console.log('[V7.5] Using cached audio energy data');
    const cachedData = audioEnergyCache[cacheKey];
    applyAudioEnergyToMetadata(gridData.cellMetadata, cachedData, gridData.secondsPerCell || 15);
    return gridData;
  }

  try {
    console.log('[V7.5] Analyzing audio for energy detection...');
    const detector = new AudioReachDetector({
      gridInterval: gridData.secondsPerCell || 15
    });

    const reachMap = await detector.analyze(videoPath);

    // Cache the result
    audioEnergyCache[cacheKey] = reachMap.cells;
    console.log(`[V7.5] Audio energy analyzed: ${reachMap.cells.length} cells`);

    // Merge into cellMetadata
    applyAudioEnergyToMetadata(gridData.cellMetadata, reachMap.cells, gridData.secondsPerCell || 15);

  } catch (err) {
    console.error('[V7.5] Audio energy analysis failed:', err.message);
    // Continue without audio energy - colorSeparation still works
  }

  return gridData;
}

/**
 * Apply audio energy values to cell metadata
 * @param {Array} cellMetadata - Target metadata array
 * @param {Array} audioCells - Audio energy data from AudioReachDetector
 * @param {number} secondsPerCell - Grid interval
 */
function applyAudioEnergyToMetadata(cellMetadata, audioCells, secondsPerCell) {
  for (const cellMeta of cellMetadata) {
    // Find matching audio cell by timestamp
    const audioCell = audioCells.find(ac =>
      Math.abs(ac.timestamp - cellMeta.timestamp) < secondsPerCell / 2
    );

    if (audioCell) {
      cellMeta.audioEnergy = audioCell.activity_score || 0;
    }
  }
}

/**
 * V7.5: Format cell metadata for prompt injection
 * Only includes critical cells to keep prompt size manageable
 * @param {Array} cellMetadata - Array of cell metadata from grid processor
 * @returns {string} Formatted metadata string
 */
function formatCellMetadata(cellMetadata) {
  if (!cellMetadata || cellMetadata.length === 0) return '';

  const criticalCells = [];
  let prevAudioEnergy = 0;

  for (let i = 0; i < cellMetadata.length; i++) {
    const cell = cellMetadata[i];
    const audioEnergy = cell.audioEnergy || 0;
    const colorSep = cell.colorSeparation || 0;
    const audioDelta = Math.abs(audioEnergy - prevAudioEnergy);

    // V7.5 criteria for critical cells
    const isLoud = audioEnergy > 0.7;
    const isFast = colorSep > 0.5;
    const isSudden = audioDelta > 0.4;

    if (isLoud || isFast || isSudden) {
      const reasons = [];
      if (isLoud) reasons.push('LOUD');
      if (isFast) reasons.push('FAST');
      if (isSudden) reasons.push('SUDDEN');

      criticalCells.push({
        index: cell.index,
        timestamp: cell.timestampFormatted,
        audioEnergy: audioEnergy.toFixed(2),
        colorSep: colorSep.toFixed(2),
        reasons: reasons
      });
    }

    prevAudioEnergy = audioEnergy;
  }

  if (criticalCells.length === 0) return '';

  // Format critical cells for prompt
  let output = `\n【V7.5 Critical Cells】\n`;
  for (const cell of criticalCells.slice(0, 10)) {  // Max 10 to prevent prompt bloat
    output += `[${cell.index}] ${cell.timestamp} | audio=${cell.audioEnergy} motion=${cell.colorSep} ← ${cell.reasons.join(',')}\n`;
  }

  if (criticalCells.length > 10) {
    output += `...and ${criticalCells.length - 10} more critical cells\n`;
  }

  return output;
}

/**
 * V7.5: Detect critical cells for ROI auto-inference
 * @param {Array} cellMetadata - Array of cell metadata
 * @returns {Array} Array of critical cell objects with reasons
 */
function detectCriticalCells(cellMetadata) {
  if (!cellMetadata || cellMetadata.length === 0) return [];

  const critical = [];
  let prevAudioEnergy = 0;

  for (let i = 0; i < cellMetadata.length; i++) {
    const cell = cellMetadata[i];
    const audioEnergy = cell.audioEnergy || 0;
    const colorSep = cell.colorSeparation || 0;
    const audioDelta = Math.abs(audioEnergy - prevAudioEnergy);

    const isLoud = audioEnergy > 0.7;
    const isFast = colorSep > 0.5;
    const isSudden = audioDelta > 0.4;

    if (isLoud || isFast || isSudden) {
      critical.push({
        index: i,
        timestamp: cell.timestamp,
        timestampFormatted: cell.timestampFormatted,
        audioEnergy,
        colorSeparation: colorSep,
        reason: [
          isLoud && 'loud',
          isFast && 'fast_motion',
          isSudden && 'sudden_change'
        ].filter(Boolean)
      });
    }

    prevAudioEnergy = audioEnergy;
  }

  return critical;
}

/**
 * Build STATIC system prompt (cacheable - never changes for same video)
 */
function buildStaticSystemPrompt(gridData) {
  const durationMin = gridData ? Math.ceil(gridData.duration / 60) : 0;
  const totalCells = gridData?.totalCells || 0;
  const columns = gridData?.columns || 8;

  return `${durationMin}分動画/${totalCells}セル（${columns}列×${Math.ceil(totalCells/columns)}行）

【セル読み取り規則】
各セル左下に白抜き黒文字でタイムスタンプが表示されている。必ず目視で読み取れ。
形式: M:SS（9分台以下）またはMM:SS/MMM:SS（10分以上）
注意: 100分以上は「1」が左端に独立表示される場合あり。「08:00」→「108:00」の可能性を確認せよ。
左上=0:00から右へ進み、次行へ。

【禁止】フレーム番号からの計算、「1フレームあたり○秒」という推測は禁止。画像内タイムスタンプを直接読め。

【出力形式】シーン切り替わりのみ抽出
**タイムスタンプ** 内容（10字以内）
例: **0:00** OP、**12:30** 本編、**120:00** ED

【テーブル】時系列データはテーブル推奨
| 時間 | 内容 |
|--------|------|
| 0:00 | 説明 |
| 120:30 | 説明 |

ツール:
- 細部→[ZOOM_REQUEST:M:SS-M:SS]
- 音声→[AUDIO_REQUEST:M:SS-M:SS]

【バッチスキャン】複数範囲を一度にズームする場合:
ユーザーが「0分から5分まで10秒刻みでスキャン」等と指示したら、複数のZOOM_REQUESTを連続出力せよ。
例:
[ZOOM_REQUEST:0:00-0:10]
[ZOOM_REQUEST:0:10-0:20]
[ZOOM_REQUEST:0:20-0:30]
システムが順次処理する。遠慮せず全て出力すること。

著作権判断はシステムが行う。AIは拒否せず、必要な場合のみリクエストを出力すること。`;
}

/**
 * Build DYNAMIC context (prepended to user message, not cached)
 * V7.5: Added gridData parameter for cell metadata injection
 */
function buildDynamicContext(gridData = null) {
  const isFirstMessage = conversationHistory.length === 0;

  // v7.30: Check if transcript exists in conversation history
  const hasTranscript = conversationHistory.some(
    msg => msg.role === 'user' && typeof msg.content === 'string' && msg.content.includes('[AUDIO_TRANSCRIPT_REQUEST]')
  );

  let context = '';

  // Audio guidance (changes based on transcript state)
  if (hasTranscript) {
    context += `【注意】音声文字起こし済み。会話履歴を参照せよ。[AUDIO_REQUEST]不要。\n`;
  }

  // First message guidance
  if (isFirstMessage) {
    context += `【初回】概要1行→シーン目次5-10項目\n`;
  }

  // v7.22: Learned rules
  const learnedRules = getLearnedRulesPrompt();
  if (learnedRules) {
    context += learnedRules + '\n';
  }

  // V7.5: Critical cell metadata injection DISABLED
  // Reason: Over-constraining AI makes it a "calculator" (v7.36 lesson)
  // Keep functions for future UI use, but don't inject into prompt

  return context;
}

/**
 * Legacy wrapper for phase-based prompts
 */
function buildSystemPrompt(gridData, phase) {
  if (phase === 'zoom_asking') {
    return `動画のどの部分をズームしますか？時間を聞いてください。`;
  }

  if (phase === 'zoom_waiting') {
    return `ユーザーの回答から時間範囲を抽出し、[ZOOM_REQUEST:M:SS-M:SS]形式のみ出力。他は何も出力しない。`;
  }

  // For normal phase, return static prompt only (dynamic context handled separately)
  return buildStaticSystemPrompt(gridData);
}

// Analyze video grid with AI Vision (Claude, DeepSeek, or Gemini grid mode)
async function analyzeGrid(userMessage, gridData, overridePhase = null) {
  if (!isConfigured()) {
    const providerNames = { gemini: 'Google Gemini', deepseek: 'DeepSeek', claude: 'Anthropic' };
    throw new Error(`API key not configured. Go to AI > Settings to set your ${providerNames[currentProvider] || 'Anthropic'} API key.`);
  }

  // Gemini provider routing based on input mode
  if (currentProvider === 'gemini') {
    if (geminiInputMode === 'video') {
      // Video mode: need to use analyzeVideo() with video path
      throw new Error('Gemini provider requires analyzeVideo() with video path. Use analyzeVideo() instead.');
    }
    // Grid mode: use GeminiManager.analyzeGrid
    return await analyzeGridGemini(userMessage, gridData);
  }

  // Check if video changed - if so, clear conversation
  const currentVideoHash = getVideoHash(gridData);
  if (currentVideoHash !== cachedVideoHash) {
    clearConversation();
    cachedVideoHash = currentVideoHash;
  }

  // Use override phase if provided, otherwise use current phase
  const effectivePhase = overridePhase || currentPhase;
  const systemPrompt = buildSystemPrompt(gridData, effectivePhase);

  // Route to appropriate provider
  if (currentProvider === 'deepseek') {
    return await analyzeGridDeepSeek(userMessage, gridData, systemPrompt);
  } else {
    return await analyzeGridClaude(userMessage, gridData, systemPrompt);
  }
}

// Analyze grid with Claude (Anthropic)
async function analyzeGridClaude(userMessage, gridData, systemPrompt) {
  // Build message content for this turn
  let newUserContent;
  const isFirstMessage = conversationHistory.length === 0;

  // v7.32: Get dynamic context (not cached)
  // V7.5: Pass gridData for cell metadata injection
  const dynamicContext = buildDynamicContext(gridData);

  // V7.14: gridImages配列に対応（後方互換性のためgridImageもサポート）
  const gridImages = gridData?.gridImages || (gridData?.gridImage ? [gridData.gridImage] : null);

  if (isFirstMessage && gridImages && gridImages.length > 0) {
    // First message: include grid image(s) with "jab" instruction
    const durationMin = Math.ceil(gridData.duration / 60);
    const totalCells = gridData.totalCells || 0;
    const imageCount = gridImages.length;
    // v7.17: 簡潔に
    const imageNote = imageCount > 1 ? `（${imageCount}枚）` : '';
    // v7.32: Include dynamic context in user message (not in system prompt)
    const jabText = `${dynamicContext}${durationMin}分/${totalCells}フレーム${imageNote}\n\n${userMessage}`;

    // V7.14: 複数画像をcontentに追加
    // v7.18: cache_controlは最大4ブロックまで。最後の画像にのみ付与
    newUserContent = [];
    for (let i = 0; i < gridImages.length; i++) {
      const imageBlock = {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: gridImages[i]
        }
      };
      // 最後の画像にのみcache_controlを付与（API制限: 最大4ブロック）
      if (i === gridImages.length - 1) {
        imageBlock.cache_control = { type: 'ephemeral' };
      }
      newUserContent.push(imageBlock);
    }
    newUserContent.push({
      type: 'text',
      text: jabText
    });
  } else if (isFirstMessage) {
    newUserContent = `[No grid image available]\n\n${userMessage}`;
  } else {
    // v7.32: Include dynamic context in follow-up messages too
    newUserContent = dynamicContext ? `${dynamicContext}\n${userMessage}` : userMessage;
  }

  // Add user message to history
  conversationHistory.push({ role: 'user', content: newUserContent });

  try {
    const response = await anthropicClient.messages.create({
      model: currentModel,
      max_tokens: 2048,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' }
        }
      ],
      messages: conversationHistory
    });

    const aiMessage = response.content[0].text;
    conversationHistory.push({ role: 'assistant', content: aiMessage });

    // Log cache performance
    if (response.usage) {
      const cacheRead = response.usage.cache_read_input_tokens || 0;
      const cacheWrite = response.usage.cache_creation_input_tokens || 0;
      const inputTokens = response.usage.input_tokens || 0;
      console.log(`[Claude] Tokens - Input: ${inputTokens}, Cache read: ${cacheRead}, Cache write: ${cacheWrite}`);
    }

    return extractCellsFromResponse(aiMessage, conversationHistory.length === 2, response.usage);
  } catch (err) {
    console.error('Claude API error:', err);
    throw new Error(`Claude request failed: ${err.message}`);
  }
}

// Analyze grid with DeepSeek
async function analyzeGridDeepSeek(userMessage, gridData, systemPrompt) {
  const isFirstMessage = conversationHistory.length === 0;

  // V7.14: gridImages配列に対応（後方互換性のためgridImageもサポート）
  const gridImages = gridData?.gridImages || (gridData?.gridImage ? [gridData.gridImage] : null);

  // Build messages for DeepSeek (OpenAI-compatible format)
  let messages = [
    { role: 'system', content: systemPrompt }
  ];

  // Add conversation history (convert to OpenAI format)
  for (const msg of conversationHistory) {
    if (msg.role === 'user') {
      if (Array.isArray(msg.content)) {
        // Convert Claude format to OpenAI format for images
        const content = msg.content.map(item => {
          if (item.type === 'image') {
            return {
              type: 'image_url',
              image_url: {
                url: `data:${item.source.media_type};base64,${item.source.data}`
              }
            };
          } else if (item.type === 'text') {
            return { type: 'text', text: item.text };
          }
          return item;
        });
        messages.push({ role: 'user', content });
      } else {
        messages.push({ role: 'user', content: msg.content });
      }
    } else {
      messages.push({ role: 'assistant', content: msg.content });
    }
  }

  // Build new user message
  let newUserContent;
  if (isFirstMessage && gridImages && gridImages.length > 0) {
    const durationMin = Math.ceil(gridData.duration / 60);
    const totalCells = gridData.totalCells || 0;
    const imageCount = gridImages.length;
    // v7.17: 簡潔に
    const imageNote = imageCount > 1 ? `（${imageCount}枚）` : '';
    const jabText = `${durationMin}分/${totalCells}フレーム${imageNote}\n\n${userMessage}`;

    // V7.14: 複数画像をcontentに追加
    newUserContent = [];
    for (let i = 0; i < gridImages.length; i++) {
      newUserContent.push({
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${gridImages[i]}`
        }
      });
    }
    newUserContent.push({
      type: 'text',
      text: jabText
    });

    // Store in Claude format for conversation history
    const historyContent = [];
    for (let i = 0; i < gridImages.length; i++) {
      historyContent.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: gridImages[i]
        }
      });
    }
    historyContent.push({ type: 'text', text: jabText });
    conversationHistory.push({ role: 'user', content: historyContent });
  } else if (isFirstMessage) {
    newUserContent = `[No grid image available]\n\n${userMessage}`;
    conversationHistory.push({ role: 'user', content: newUserContent });
  } else {
    newUserContent = userMessage;
    conversationHistory.push({ role: 'user', content: userMessage });
  }

  messages.push({ role: 'user', content: newUserContent });

  try {
    const response = await openaiClient.chat.completions.create({
      model: deepseekModel,
      messages: messages,
      max_tokens: 2048,
      temperature: 0.1  // Low temperature for consistent output
    });

    const aiMessage = response.choices[0].message.content;
    conversationHistory.push({ role: 'assistant', content: aiMessage });

    // Log token usage
    if (response.usage) {
      console.log(`[DeepSeek] Tokens - Input: ${response.usage.prompt_tokens}, Output: ${response.usage.completion_tokens}`);
    }

    return extractCellsFromResponse(aiMessage, isFirstMessage, response.usage);
  } catch (err) {
    console.error('DeepSeek API error:', err);
    throw new Error(`DeepSeek request failed: ${err.message}`);
  }
}

// Analyze grid with Gemini (grid image mode)
// v7.29: Added learned rules injection for self-update feature
async function analyzeGridGemini(userMessage, gridData) {
  // Check if video changed - if so, clear conversation
  const currentVideoHash = getVideoHash(gridData);
  if (currentVideoHash !== cachedVideoHash) {
    clearConversation();
    cachedVideoHash = currentVideoHash;
  }

  try {
    // v7.29: Pass learned rules to Gemini
    const learnedRulesPrompt = getLearnedRulesPrompt();
    const response = await geminiManager.analyzeGrid(userMessage, gridData, conversationHistory, learnedRulesPrompt);
    const aiMessage = response.text;

    // Store in conversation history (Claude format for compatibility)
    const isFirstMessage = conversationHistory.length === 0;
    const gridImages = gridData?.gridImages || (gridData?.gridImage ? [gridData.gridImage] : null);

    if (isFirstMessage && gridImages && gridImages.length > 0) {
      const durationMin = Math.ceil(gridData.duration / 60);
      const totalCells = gridData.totalCells || 0;
      const imageCount = gridImages.length;
      const imageNote = imageCount > 1 ? `（${imageCount}枚）` : '';
      const jabText = `${durationMin}分/${totalCells}フレーム${imageNote}\n\n${userMessage}`;

      const historyContent = [];
      for (const img of gridImages) {
        historyContent.push({
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: img }
        });
      }
      historyContent.push({ type: 'text', text: jabText });
      conversationHistory.push({ role: 'user', content: historyContent });
    } else {
      conversationHistory.push({ role: 'user', content: userMessage });
    }

    conversationHistory.push({ role: 'assistant', content: aiMessage });

    // Prune old messages to prevent token explosion (keep first exchange + last N)
    pruneConversationHistory();

    console.log(`[Gemini Grid] Tokens - Input: ${response.usage?.input || 0}, Output: ${response.usage?.output || 0}`);

    return extractCellsFromResponse(aiMessage, conversationHistory.length === 2, {
      input_tokens: response.usage?.input || 0,
      output_tokens: response.usage?.output || 0
    });
  } catch (err) {
    console.error('Gemini Grid API error:', err);
    throw new Error(`Gemini request failed: ${err.message}`);
  }
}

// Extract cell references from AI response
function extractCellsFromResponse(aiMessage, isFirstMessage, usage = null) {
  const cellPattern = /cell\s*(\d+)/gi;
  const cells = [];
  let match;
  while ((match = cellPattern.exec(aiMessage)) !== null) {
    cells.push(parseInt(match[1]));
  }

  const result = {
    message: aiMessage,
    cells: cells,
    cached: !isFirstMessage,
    provider: currentProvider
  };

  // Add token usage info if available
  if (usage) {
    result.usage = {
      input: usage.input_tokens || usage.prompt_tokens || 0,
      output: usage.output_tokens || usage.completion_tokens || 0,
      cacheRead: usage.cache_read_input_tokens || 0,
      cacheWrite: usage.cache_creation_input_tokens || 0
    };
  }

  return result;
}

// Analyze zoomed grid (higher resolution for specific time range)
// Uses sliding window: replaces previous zoom image to prevent context explosion
async function analyzeZoomGrid(userMessage, zoomGridData) {
  if (!isConfigured()) {
    const providerName = currentProvider === 'deepseek' ? 'DeepSeek' : 'Anthropic';
    throw new Error(`API key not configured. Go to AI > Settings to set your ${providerName} API key.`);
  }

  if (!zoomGridData || !zoomGridData.gridImage) {
    throw new Error('No zoom grid data available');
  }

  const zoomStart = formatTime(zoomGridData.zoomRange.start);
  const zoomEnd = formatTime(zoomGridData.zoomRange.end);
  const totalCells = zoomGridData.totalCells || 0;
  const columns = zoomGridData.columns || 8;
  const timestampList = zoomGridData.timestampList || [];

  // v7.18: タイムスタンプリストをテキストで提供
  const tsInfo = timestampList.length > 0
    ? `\nセル配置(${columns}列):\n${timestampList.map((ts, i) => `[${i}]${ts}`).join(' ')}`
    : '';

  const systemPrompt = `ズーム:${zoomStart}-${zoomEnd}/${totalCells}フレーム。${tsInfo}\n時刻は上記リストを参照。細部を見逃すな。`;

  // Prune old zoom images before adding new one (sliding window)
  pruneOldZoomImages();

  // v7.33: Route to appropriate provider (add Gemini support)
  if (currentProvider === 'gemini') {
    return await analyzeZoomGridGemini(userMessage, zoomGridData, systemPrompt, zoomStart, zoomEnd, totalCells);
  } else if (currentProvider === 'deepseek') {
    return await analyzeZoomGridDeepSeek(userMessage, zoomGridData, systemPrompt, zoomStart, zoomEnd, totalCells);
  } else {
    return await analyzeZoomGridClaude(userMessage, zoomGridData, systemPrompt, zoomStart, zoomEnd, totalCells);
  }
}

// Analyze zoom grid with Claude
async function analyzeZoomGridClaude(userMessage, zoomGridData, systemPrompt, zoomStart, zoomEnd, totalCells) {
  // v7.17: 簡潔に
  const jabText = `${zoomStart}-${zoomEnd}/${totalCells}フレーム\n\n${userMessage}`;

  const zoomUserContent = [
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: zoomGridData.gridImage
      }
    },
    {
      type: 'text',
      text: jabText
    }
  ];

  conversationHistory.push({ role: 'user', content: zoomUserContent });

  try {
    const response = await anthropicClient.messages.create({
      model: currentModel,
      max_tokens: 2048,
      system: [{ type: 'text', text: systemPrompt }],
      messages: conversationHistory
    });

    const aiMessage = response.content[0].text;
    conversationHistory.push({ role: 'assistant', content: aiMessage });

    if (response.usage) {
      console.log(`[Claude Zoom] Tokens - Input: ${response.usage.input_tokens || 0}`);
    }

    return {
      message: aiMessage,
      cells: [],
      isZoom: true,
      zoomRange: zoomGridData.zoomRange,
      provider: 'claude'
    };
  } catch (err) {
    console.error('Claude API error (zoom):', err);
    throw new Error(`Claude zoom request failed: ${err.message}`);
  }
}

// Analyze zoom grid with DeepSeek
async function analyzeZoomGridDeepSeek(userMessage, zoomGridData, systemPrompt, zoomStart, zoomEnd, totalCells) {
  // v7.17: 簡潔に
  const jabText = `${zoomStart}-${zoomEnd}/${totalCells}フレーム\n\n${userMessage}`;

  // Store in Claude format for history
  conversationHistory.push({
    role: 'user',
    content: [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: zoomGridData.gridImage
        }
      },
      { type: 'text', text: jabText }
    ]
  });

  // Build messages for DeepSeek
  let messages = [{ role: 'system', content: systemPrompt }];

  // Add conversation history
  for (const msg of conversationHistory) {
    if (msg.role === 'user') {
      if (Array.isArray(msg.content)) {
        const content = msg.content.map(item => {
          if (item.type === 'image') {
            return {
              type: 'image_url',
              image_url: { url: `data:${item.source.media_type};base64,${item.source.data}` }
            };
          } else if (item.type === 'text') {
            return { type: 'text', text: item.text };
          }
          return item;
        });
        messages.push({ role: 'user', content });
      } else {
        messages.push({ role: 'user', content: msg.content });
      }
    } else {
      messages.push({ role: 'assistant', content: msg.content });
    }
  }

  try {
    const response = await openaiClient.chat.completions.create({
      model: deepseekModel,
      messages: messages,
      max_tokens: 2048,
      temperature: 0.1
    });

    const aiMessage = response.choices[0].message.content;
    conversationHistory.push({ role: 'assistant', content: aiMessage });

    if (response.usage) {
      console.log(`[DeepSeek Zoom] Tokens - Input: ${response.usage.prompt_tokens}, Output: ${response.usage.completion_tokens}`);
    }

    return {
      message: aiMessage,
      cells: [],
      isZoom: true,
      zoomRange: zoomGridData.zoomRange,
      provider: 'deepseek'
    };
  } catch (err) {
    console.error('DeepSeek API error (zoom):', err);
    throw new Error(`DeepSeek zoom request failed: ${err.message}`);
  }
}

// v7.33: Analyze zoom grid with Gemini
async function analyzeZoomGridGemini(userMessage, zoomGridData, systemPrompt, zoomStart, zoomEnd, totalCells) {
  const jabText = `${zoomStart}-${zoomEnd}/${totalCells}フレーム\n\n${userMessage}`;

  // Store in Claude format for history compatibility
  const zoomUserContent = [
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: zoomGridData.gridImage
      }
    },
    {
      type: 'text',
      text: jabText
    }
  ];

  conversationHistory.push({ role: 'user', content: zoomUserContent });

  try {
    const result = await geminiManager.analyzeZoomGrid(userMessage, zoomGridData, conversationHistory);

    conversationHistory.push({ role: 'assistant', content: result.text });

    console.log(`[Gemini Zoom] Tokens - Input: ${result.usage?.input || 0}, Output: ${result.usage?.output || 0}`);

    return {
      message: result.text,
      cells: [],
      isZoom: true,
      zoomRange: zoomGridData.zoomRange,
      provider: 'gemini',
      usage: result.usage
    };
  } catch (err) {
    console.error('Gemini API error (zoom):', err);
    throw new Error(`Gemini zoom request failed: ${err.message}`);
  }
}

// Helper to format seconds as M:SS
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// v7.19: Analyze with transcript (audio transcription result)
async function analyzeWithTranscript(transcriptMessage, gridData) {
  if (!isConfigured()) {
    const providerName = currentProvider === 'deepseek' ? 'DeepSeek' : 'Anthropic';
    throw new Error(`API key not configured. Go to AI > Settings to set your ${providerName} API key.`);
  }

  const systemPrompt = `音声文字起こし結果を受け取りました。画像と音声情報を統合して回答してください。`;

  // Add transcript to conversation
  conversationHistory.push({ role: 'user', content: transcriptMessage });

  // Route to appropriate provider
  if (currentProvider === 'deepseek') {
    return await analyzeTranscriptDeepSeek(transcriptMessage, systemPrompt);
  } else {
    return await analyzeTranscriptClaude(transcriptMessage, systemPrompt);
  }
}

// Analyze transcript with Claude
async function analyzeTranscriptClaude(transcriptMessage, systemPrompt) {
  try {
    const response = await anthropicClient.messages.create({
      model: currentModel,
      max_tokens: 2048,
      system: [{ type: 'text', text: systemPrompt }],
      messages: conversationHistory
    });

    const aiMessage = response.content[0].text;
    conversationHistory.push({ role: 'assistant', content: aiMessage });

    if (response.usage) {
      console.log(`[Claude Transcript] Tokens - Input: ${response.usage.input_tokens || 0}`);
    }

    return {
      message: aiMessage,
      cells: [],
      isTranscript: true,
      provider: 'claude'
    };
  } catch (err) {
    console.error('Claude API error (transcript):', err);
    throw new Error(`Claude transcript request failed: ${err.message}`);
  }
}

// Analyze transcript with DeepSeek
async function analyzeTranscriptDeepSeek(transcriptMessage, systemPrompt) {
  // Build messages for DeepSeek
  let messages = [{ role: 'system', content: systemPrompt }];

  // Add conversation history
  for (const msg of conversationHistory) {
    if (msg.role === 'user') {
      if (Array.isArray(msg.content)) {
        const content = msg.content.map(item => {
          if (item.type === 'image') {
            return {
              type: 'image_url',
              image_url: { url: `data:${item.source.media_type};base64,${item.source.data}` }
            };
          } else if (item.type === 'text') {
            return { type: 'text', text: item.text };
          }
          return item;
        });
        messages.push({ role: 'user', content });
      } else {
        messages.push({ role: 'user', content: msg.content });
      }
    } else {
      messages.push({ role: 'assistant', content: msg.content });
    }
  }

  try {
    const response = await openaiClient.chat.completions.create({
      model: deepseekModel,
      messages: messages,
      max_tokens: 2048,
      temperature: 0.1
    });

    const aiMessage = response.choices[0].message.content;
    conversationHistory.push({ role: 'assistant', content: aiMessage });

    if (response.usage) {
      console.log(`[DeepSeek Transcript] Tokens - Input: ${response.usage.prompt_tokens}, Output: ${response.usage.completion_tokens}`);
    }

    return {
      message: aiMessage,
      cells: [],
      isTranscript: true,
      provider: 'deepseek'
    };
  } catch (err) {
    console.error('DeepSeek API error (transcript):', err);
    throw new Error(`DeepSeek transcript request failed: ${err.message}`);
  }
}

// ============================================
// v7.24: Gemini Video Analysis (Google File API)
// ============================================

// Set Gemini progress callback (for UI updates during upload)
function setGeminiProgressCallback(callback) {
  geminiProgressCallback = callback;
  geminiManager.setProgressCallback(callback);
}

// Analyze video with Gemini (uploads full video via Google File API)
async function analyzeVideo(videoPath, userMessage) {
  if (currentProvider !== 'gemini') {
    throw new Error('analyzeVideo() is only for Gemini provider. Use analyzeGrid() for Claude/DeepSeek.');
  }

  if (!geminiManager.isConfigured()) {
    throw new Error('Gemini API key not configured. Go to AI > Settings to set your Google API key.');
  }

  try {
    const result = await geminiManager.processQuery(videoPath, userMessage, conversationHistory);

    // Add to conversation history for context
    conversationHistory.push({ role: 'user', content: userMessage });
    conversationHistory.push({ role: 'assistant', content: result.message });

    // Format timestamps as clickable links
    const { formatted, timestamps } = GeminiManager.formatTimestamps(result.message);

    return {
      message: result.message,
      formattedMessage: formatted,
      timestamps: timestamps,
      cells: [],
      cached: result.cached,
      provider: 'gemini',
      usage: result.usage
    };
  } catch (err) {
    console.error('Gemini API error:', err);
    throw new Error(`Gemini request failed: ${err.message}`);
  }
}

// Check if current provider is Gemini
function isGeminiProvider() {
  return currentProvider === 'gemini';
}

// Get Gemini manager instance (for direct access if needed)
function getGeminiManager() {
  return geminiManager;
}

// ============================================
// v7.23: Refine Mode - Zoom scan around timestamps
// ============================================

// Extract timestamps from the last AI response in conversation history
function extractTimestampsFromHistory() {
  // Find the last assistant message
  for (let i = conversationHistory.length - 1; i >= 0; i--) {
    const msg = conversationHistory[i];
    if (msg.role === 'assistant') {
      const text = typeof msg.content === 'string' ? msg.content : '';
      // Match MM:SS or H:MM:SS patterns
      const pattern = /(\d{1,3}):(\d{2})(?::(\d{2}))?/g;
      const timestamps = [];
      let match;

      while ((match = pattern.exec(text)) !== null) {
        let seconds;
        if (match[3] !== undefined) {
          seconds = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]);
        } else {
          seconds = parseInt(match[1]) * 60 + parseInt(match[2]);
        }
        timestamps.push({
          original: match[0],
          seconds: seconds
        });
      }

      // Remove duplicates
      const unique = [];
      const seen = new Set();
      for (const ts of timestamps) {
        if (!seen.has(ts.seconds)) {
          seen.add(ts.seconds);
          unique.push(ts);
        }
      }
      return unique.sort((a, b) => a.seconds - b.seconds);
    }
  }
  return [];
}

// Start refine mode - scan around each timestamp with high-res zoom
async function startRefineMode(gridData, captureZoomCallback) {
  const timestamps = extractTimestampsFromHistory();

  if (timestamps.length === 0) {
    return {
      message: 'タイムスタンプが見つかりませんでした。まず動画の概要を取得してください。',
      cells: [],
      provider: currentProvider
    };
  }

  console.log(`[Refine] Found ${timestamps.length} timestamps to refine`);

  // Limit to max 10 timestamps
  const toRefine = timestamps.slice(0, 10);
  const refinedResults = [];

  for (const ts of toRefine) {
    // Capture zoom grid around this timestamp (±15 seconds)
    const startTime = Math.max(0, ts.seconds - 15);
    const endTime = Math.min(gridData.duration || 9999, ts.seconds + 15);

    console.log(`[Refine] Scanning ${ts.original} (${startTime}s - ${endTime}s)`);

    const zoomData = await captureZoomCallback(startTime, endTime);
    if (!zoomData) {
      console.log(`[Refine] Failed to capture zoom for ${ts.original}`);
      continue;
    }

    // Analyze zoom grid
    const zoomPrompt = `【Refineモード】タイムスタンプ精度検証 (${refinedResults.length + 1}/${toRefine.length})

対象: ${ts.original} 付近（${formatTime(startTime)}〜${formatTime(endTime)}）

このズーム画像を分析し、以下を回答せよ:
1. 元のタイムスタンプ ${ts.original} は正確か？
2. より正確なタイムスタンプがあれば訂正
3. この区間で起きている内容（簡潔に）

出力形式: **MM:SS** 内容説明`;

    try {
      const response = await analyzeZoomGrid(zoomPrompt, zoomData);
      refinedResults.push({
        timestamp: ts.original,
        seconds: ts.seconds,
        refined: response.message
      });
    } catch (err) {
      console.error(`[Refine] Error analyzing ${ts.original}:`, err.message);
    }
  }

  // Format results
  let resultMessage = `## 詳細スキャン結果 (${refinedResults.length}/${toRefine.length})\n\n`;
  for (const result of refinedResults) {
    resultMessage += `### ${result.timestamp}\n${result.refined}\n\n`;
  }

  // Add to conversation history
  conversationHistory.push({ role: 'user', content: '[Refine] タイムスタンプの詳細スキャンを実行' });
  conversationHistory.push({ role: 'assistant', content: resultMessage });

  return {
    message: resultMessage,
    cells: [],
    refined: true,
    refinedCount: refinedResults.length,
    provider: currentProvider
  };
}

// ============================================
// v7.25: Audio Analysis with Gemini
// ============================================

// Analyze audio from video (full transcription with timestamps)
// v7.29: Added conversation history integration so AI can reference transcript in follow-up questions
async function analyzeAudio(videoPath, options = {}) {
  if (!geminiManager.isConfigured()) {
    throw new Error('Gemini API key not configured. Audio analysis requires Gemini.');
  }

  try {
    const result = await geminiManager.analyzeAudio(videoPath, options);

    // Format timestamps as clickable links in the text
    const { formatted } = GeminiManager.formatTimestamps(result.text);

    // v7.29: Add transcript to conversation history so AI can reference it
    // This links the audio analysis to the grid image context
    conversationHistory.push({
      role: 'user',
      content: '[AUDIO_TRANSCRIPT_REQUEST] 動画全体の音声を文字起こししてください。'
    });
    conversationHistory.push({
      role: 'assistant',
      content: result.text
    });
    console.log('[AI] Audio transcript added to conversation history');

    return {
      message: result.text,
      formattedMessage: formatted,
      transcript: result.transcript,
      usage: result.usage,
      provider: 'gemini'
    };
  } catch (err) {
    console.error('Gemini Audio Analysis error:', err);
    throw new Error(`Audio analysis failed: ${err.message}`);
  }
}

// v7.26: Analyze pre-extracted audio file (for Python fast extraction)
// v7.29: Added conversation history integration
async function analyzeAudioFile(audioPath, options = {}) {
  if (!geminiManager.isConfigured()) {
    throw new Error('Gemini API key not configured. Audio analysis requires Gemini.');
  }

  try {
    const result = await geminiManager.analyzeAudioDirect(audioPath, options);

    // Format timestamps as clickable links in the text
    const { formatted } = GeminiManager.formatTimestamps(result.text);

    // v7.29: Add transcript to conversation history so AI can reference it
    conversationHistory.push({
      role: 'user',
      content: '[AUDIO_TRANSCRIPT_REQUEST] 動画全体の音声を文字起こししてください。'
    });
    conversationHistory.push({
      role: 'assistant',
      content: result.text
    });
    console.log('[AI] Audio transcript added to conversation history');

    return {
      message: result.text,
      formattedMessage: formatted,
      transcript: result.transcript,
      usage: result.usage,
      provider: 'gemini'
    };
  } catch (err) {
    console.error('Gemini Audio File Analysis error:', err);
    throw new Error(`Audio analysis failed: ${err.message}`);
  }
}

// v7.30: Restore transcript to conversation history (for cache restoration)
function restoreTranscript(transcriptText) {
  if (!transcriptText) return;

  // Check if transcript is already in conversation history
  const alreadyHasTranscript = conversationHistory.some(
    msg => msg.role === 'assistant' && msg.content === transcriptText
  );

  if (alreadyHasTranscript) {
    console.log('[AI] Transcript already in conversation history, skipping restore');
    return;
  }

  // Add transcript to conversation history
  conversationHistory.push({
    role: 'user',
    content: '[AUDIO_TRANSCRIPT_REQUEST] 動画全体の音声を文字起こししてください。'
  });
  conversationHistory.push({
    role: 'assistant',
    content: transcriptText
  });
  console.log('[AI] Transcript restored to conversation history');
}

module.exports = {
  init,
  initClaude,
  initDeepSeek,
  initGemini,
  initFromSaved,
  isConfigured,
  getModel,
  setModel,
  getApiKey,
  getProvider,
  setProvider,
  getAllSettings,
  getGridSecondsPerCell,
  setGridSecondsPerCell,
  analyzeGrid,
  analyzeZoomGrid,
  analyzeWithTranscript,
  clearConversation,
  setPhase,
  getPhase,
  canAutoZoom,
  incrementZoomCount,
  // v7.22: 自己アップデート機能
  isSelfUpdateEnabled,
  processErrorFeedback,
  loadLearnedRules,
  getLearnedRulesPrompt,
  // v7.24: Gemini support
  analyzeVideo,
  isGeminiProvider,
  setGeminiProgressCallback,
  getGeminiManager,
  getGeminiInputMode,
  setGeminiInputMode,
  // v7.25: Audio analysis
  analyzeAudio,
  // v7.26: Fast audio analysis (pre-extracted file)
  analyzeAudioFile,
  // v7.23: Refine mode
  startRefineMode,
  // v7.30: Transcript cache support
  restoreTranscript,
  // V7.5: ROI auto-inference
  detectCriticalCells,
  formatCellMetadata
};
