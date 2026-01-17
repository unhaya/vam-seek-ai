// AI Service - Claude API integration
const Anthropic = require('@anthropic-ai/sdk');
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

let client = null;
let apiKey = null;
let currentModel = 'claude-sonnet-4-5-20250929';

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
      apiKey: apiKey,
      model: currentModel
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
    if (settings.apiKey) {
      apiKey = settings.apiKey;
      client = new Anthropic({ apiKey: settings.apiKey });
    }
    if (settings.model) {
      currentModel = settings.model;
    }
  }
}

// Initialize Anthropic client
function init(key, model) {
  apiKey = key;
  client = new Anthropic({ apiKey: key });
  if (model) {
    currentModel = model;
  }
  // Save to file
  saveSettings();
}

// Check if API is configured
function isConfigured() {
  return client !== null && apiKey !== null;
}

// Get current model
function getModel() {
  return currentModel;
}

// Set model
function setModel(model) {
  currentModel = model;
  // Save to file
  saveSettings();
}

// Get API key (for settings display)
function getApiKey() {
  return apiKey;
}

// Analyze video grid with Claude Vision
async function analyzeGrid(userMessage, gridData) {
  if (!isConfigured()) {
    throw new Error('API key not configured. Go to AI > Settings to set your Anthropic API key.');
  }

  // Build the prompt with grid context
  const gridInfo = gridData ? `
Video: ${gridData.videoName || 'Unknown'}
Duration: ${Math.floor(gridData.duration / 60)}m ${Math.floor(gridData.duration % 60)}s
Grid: ${gridData.columns} columns x ${gridData.rows} rows
Seconds per cell: ${gridData.secondsPerCell}s
Total cells: ${gridData.totalCells}

Cell index calculation:
- Cell 0 = 0:00
- Cell N = N * ${gridData.secondsPerCell} seconds
- Row = floor(cell / ${gridData.columns}), Column = cell % ${gridData.columns}` : 'No video loaded';

  const systemPrompt = `You are an AI assistant analyzing video content through a 2D thumbnail grid image.

${gridInfo}

The grid image shows thumbnails arranged left-to-right, top-to-bottom. Each cell represents ${gridData?.secondsPerCell || 'N'} seconds of video.

When answering:
1. Describe what you see in specific cells
2. Reference timestamps (e.g., "at 2:30" or "cell 15")
3. Be specific about visual content
4. Answer in the user's language

Respond concisely and directly.`;

  // Build message content
  let messageContent;

  if (gridData && gridData.gridImage) {
    // Use Vision API with grid image
    messageContent = [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: gridData.gridImage
        }
      },
      {
        type: 'text',
        text: userMessage
      }
    ];
  } else {
    // No image available
    messageContent = `[No grid image available]\n\n${userMessage}`;
  }

  const messages = [
    { role: 'user', content: messageContent }
  ];

  try {
    const response = await client.messages.create({
      model: currentModel,
      max_tokens: 2048,
      system: systemPrompt,
      messages: messages
    });

    const aiMessage = response.content[0].text;

    // Extract cell references if any (simple pattern matching)
    const cellPattern = /cell\s*(\d+)/gi;

    const cells = [];
    let match;
    while ((match = cellPattern.exec(aiMessage)) !== null) {
      cells.push(parseInt(match[1]));
    }

    return {
      message: aiMessage,
      cells: cells
    };
  } catch (err) {
    console.error('AI API error:', err);
    throw new Error(`AI request failed: ${err.message}`);
  }
}

module.exports = {
  init,
  initFromSaved,
  isConfigured,
  getModel,
  setModel,
  getApiKey,
  analyzeGrid
};
