// AI Service - Multi-provider API integration (Claude & DeepSeek)
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Provider state
let currentProvider = 'claude';  // 'claude' or 'deepseek'
let anthropicClient = null;
let openaiClient = null;

// API keys
let claudeApiKey = null;
let deepseekApiKey = null;

// Current model per provider
let currentModel = 'claude-sonnet-4-5-20250929';
let deepseekModel = 'deepseek-reasoner';

// Grid quality setting
let gridSecondsPerCell = 15;  // Default: luxury mode

// Conversation state for prompt caching
let conversationHistory = [];  // Array of {role, content} messages
let cachedVideoHash = null;    // Hash of current video (to detect video change)
let cachedSystemPrompt = null; // System prompt for current conversation

// Phase state for zoom flow
// 'normal' | 'zoom_asking' | 'zoom_waiting'
let currentPhase = 'normal';

// Auto-zoom protection
const MAX_ZOOM_DEPTH = 2;  // Maximum auto-zoom requests per conversation
let zoomCount = 0;         // Current zoom count in session

// Settings file path
function getSettingsPath() {
  return path.join(app.getPath('userData'), 'ai-settings.json');
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
      claudeModel: currentModel,
      deepseekModel: deepseekModel,
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
  if (currentProvider === 'deepseek') {
    return openaiClient !== null && deepseekApiKey !== null;
  }
  return anthropicClient !== null && claudeApiKey !== null;
}

// Get current model (for current provider)
function getModel() {
  if (currentProvider === 'deepseek') {
    return deepseekModel;
  }
  return currentModel;
}

// Set model (for current provider)
function setModel(model) {
  if (currentProvider === 'deepseek') {
    deepseekModel = model;
  } else {
    currentModel = model;
  }
  saveSettings();
}

// Get API key (for settings display)
function getApiKey() {
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
    claudeModel: currentModel,
    deepseekModel: deepseekModel,
    gridSecondsPerCell: gridSecondsPerCell
  };
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
}

// Check if auto-zoom is allowed
function canAutoZoom() {
  return zoomCount < MAX_ZOOM_DEPTH;
}

// Increment zoom count (call when zoom is performed)
function incrementZoomCount() {
  zoomCount++;
  console.log(`[AI] Zoom count: ${zoomCount}/${MAX_ZOOM_DEPTH}`);
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

// Remove old zoom images from conversation history (sliding window)
// Keeps only the most recent zoom image to prevent context explosion
function pruneOldZoomImages() {
  // Find all messages containing zoom images (have [ZOOM: prefix in text)
  const zoomIndices = [];
  for (let i = 0; i < conversationHistory.length; i++) {
    const msg = conversationHistory[i];
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      // Check if this is a zoom message
      const hasZoomImage = msg.content.some(c => c.type === 'image');
      const hasZoomText = msg.content.some(c => c.type === 'text' && c.text && c.text.startsWith('[ZOOM:'));
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

// Build phase-specific system prompt
function buildSystemPrompt(gridData, phase, allowAutoZoom = false) {
  // Calculate video duration in minutes
  const durationMin = gridData ? Math.ceil(gridData.duration / 60) : 0;
  const totalCells = gridData?.totalCells || 0;
  const secPerCell = gridData?.secondsPerCell || 0;

  if (phase === 'zoom_asking') {
    return `動画のどの部分をズームしますか？時間を聞いてください。`;
  }

  if (phase === 'zoom_waiting') {
    return `ユーザーの回答から時間範囲を抽出し、[ZOOM_REQUEST:M:SS-M:SS]形式のみ出力。他は何も出力しない。`;
  }

  // Normal phase - clearly state video duration and grid structure
  let prompt = `${durationMin}分の動画。${totalCells}枚のフレーム、各${secPerCell}秒間隔。
各フレーム左下にタイムスタンプ表示。
回答はM:SS形式のみ（例: 1:07, 12:30）。「付近」「頃」禁止。
List timestamps in chronological order.`;

  // Add auto-zoom capability if allowed
  if (allowAutoZoom) {
    prompt += `
If you need higher resolution to answer accurately, output [ZOOM_AUTO:M:SS-M:SS] at the END of your response. Only use this for specific time ranges (max 2 min span). Do not zoom if the current grid is sufficient.`;
  }

  return prompt;
}

// Analyze video grid with AI Vision (Claude or DeepSeek)
async function analyzeGrid(userMessage, gridData, overridePhase = null) {
  if (!isConfigured()) {
    const providerName = currentProvider === 'deepseek' ? 'DeepSeek' : 'Anthropic';
    throw new Error(`API key not configured. Go to AI > Settings to set your ${providerName} API key.`);
  }

  // Check if video changed - if so, clear conversation
  const currentVideoHash = getVideoHash(gridData);
  if (currentVideoHash !== cachedVideoHash) {
    clearConversation();
    cachedVideoHash = currentVideoHash;
  }

  // Use override phase if provided, otherwise use current phase
  const effectivePhase = overridePhase || currentPhase;
  // Allow auto-zoom only if under limit and in normal phase
  const allowAutoZoom = canAutoZoom() && effectivePhase === 'normal';
  const systemPrompt = buildSystemPrompt(gridData, effectivePhase, allowAutoZoom);

  cachedSystemPrompt = systemPrompt;

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

  if (isFirstMessage && gridData && gridData.gridImage) {
    // First message: include grid image with "jab" instruction
    const durationMin = Math.ceil(gridData.duration / 60);
    const totalCells = gridData.totalCells || 0;
    const jabText = `${durationMin}分の動画のグリッド画像（${totalCells}フレーム）。各フレーム左下にタイムスタンプ。\n\n質問: ${userMessage}`;

    newUserContent = [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: gridData.gridImage
        },
        cache_control: { type: 'ephemeral' }  // Enable prompt caching
      },
      {
        type: 'text',
        text: jabText
      }
    ];
  } else if (isFirstMessage) {
    newUserContent = `[No grid image available]\n\n${userMessage}`;
  } else {
    newUserContent = userMessage;
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

    return extractCellsFromResponse(aiMessage, conversationHistory.length === 2);
  } catch (err) {
    console.error('Claude API error:', err);
    throw new Error(`Claude request failed: ${err.message}`);
  }
}

// Analyze grid with DeepSeek
async function analyzeGridDeepSeek(userMessage, gridData, systemPrompt) {
  const isFirstMessage = conversationHistory.length === 0;

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
  if (isFirstMessage && gridData && gridData.gridImage) {
    const durationMin = Math.ceil(gridData.duration / 60);
    const totalCells = gridData.totalCells || 0;
    const jabText = `${durationMin}分の動画のグリッド画像（${totalCells}フレーム）。各フレーム左下にタイムスタンプ。\n\n質問: ${userMessage}`;

    newUserContent = [
      {
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${gridData.gridImage}`
        }
      },
      {
        type: 'text',
        text: jabText
      }
    ];

    // Store in Claude format for conversation history
    conversationHistory.push({
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: gridData.gridImage
          }
        },
        { type: 'text', text: jabText }
      ]
    });
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

    return extractCellsFromResponse(aiMessage, isFirstMessage);
  } catch (err) {
    console.error('DeepSeek API error:', err);
    throw new Error(`DeepSeek request failed: ${err.message}`);
  }
}

// Extract cell references from AI response
function extractCellsFromResponse(aiMessage, isFirstMessage) {
  const cellPattern = /cell\s*(\d+)/gi;
  const cells = [];
  let match;
  while ((match = cellPattern.exec(aiMessage)) !== null) {
    cells.push(parseInt(match[1]));
  }

  return {
    message: aiMessage,
    cells: cells,
    cached: !isFirstMessage,
    provider: currentProvider
  };
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

  // Build zoom-specific system prompt (simple)
  const zoomStart = formatTime(zoomGridData.zoomRange.start);
  const zoomEnd = formatTime(zoomGridData.zoomRange.end);
  const totalCells = zoomGridData.totalCells || 0;
  const secPerCell = zoomGridData.secondsPerCell.toFixed(1);

  const systemPrompt = `ズーム: ${zoomStart}-${zoomEnd}。${totalCells}枚、各${secPerCell}秒間隔。
各フレーム左下にタイムスタンプ表示。
回答はM:SS形式のみ。「付近」「頃」禁止。`;

  // Prune old zoom images before adding new one (sliding window)
  pruneOldZoomImages();

  // Route to appropriate provider
  if (currentProvider === 'deepseek') {
    return await analyzeZoomGridDeepSeek(userMessage, zoomGridData, systemPrompt, zoomStart, zoomEnd, totalCells);
  } else {
    return await analyzeZoomGridClaude(userMessage, zoomGridData, systemPrompt, zoomStart, zoomEnd, totalCells);
  }
}

// Analyze zoom grid with Claude
async function analyzeZoomGridClaude(userMessage, zoomGridData, systemPrompt, zoomStart, zoomEnd, totalCells) {
  const jabText = `ズーム: ${zoomStart}-${zoomEnd}のグリッド画像（${totalCells}フレーム）。各フレーム左下にタイムスタンプ。\n\n質問: ${userMessage}`;

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
  const jabText = `ズーム: ${zoomStart}-${zoomEnd}のグリッド画像（${totalCells}フレーム）。各フレーム左下にタイムスタンプ。\n\n質問: ${userMessage}`;

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

// Helper to format seconds as M:SS
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

module.exports = {
  init,
  initClaude,
  initDeepSeek,
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
  clearConversation,
  setPhase,
  getPhase,
  canAutoZoom,
  incrementZoomCount
};
