// Chat window logic
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const refineBtn = document.getElementById('refineBtn');
const transcribeBtn = document.getElementById('transcribeBtn');
const connectionStatus = document.getElementById('connectionStatus');

// Track if we have a scene index to refine
let hasSceneIndex = false;

// v7.25: Store transcript data for search
let currentTranscript = null;

// v7.24: Gemini progress element
let geminiProgressEl = null;

// v7.46: Adventure Book navigation history
let adventureHistory = [];
let isAdventureMode = false;

// v7.46: Parse Adventure Book choices from AI response
// Pattern: [??:?? へ] : description
function parseAdventureChoices(text) {
  const choicePattern = /\[(\d{1,3}:\d{2})\s*へ\]\s*[:：]\s*(.+?)(?=\n|$)/g;
  const choices = [];
  let match;
  while ((match = choicePattern.exec(text)) !== null) {
    const [fullMatch, timestamp, description] = match;
    // Parse timestamp to seconds
    const parts = timestamp.split(':');
    const seconds = parseInt(parts[0]) * 60 + parseInt(parts[1]);
    choices.push({ timestamp, seconds, description: description.trim(), fullMatch });
  }
  return choices;
}

// v7.46: Create Adventure Book choice buttons
function createAdventureButtons(choices, originalResponse) {
  const container = document.createElement('div');
  container.className = 'adventure-choices';

  choices.forEach(choice => {
    const btn = document.createElement('button');
    btn.className = 'adventure-choice-btn';
    btn.innerHTML = `<span class="timestamp">[${choice.timestamp}]</span> ${choice.description}`;
    btn.addEventListener('click', () => {
      // Save current state to history
      adventureHistory.push({
        response: originalResponse,
        choices: choices
      });
      // Seek video to timestamp
      window.electronAPI.seekToTimestamp(choice.seconds);
      // Send follow-up prompt
      sendAdventureFollowUp(choice.timestamp);
    });
    container.appendChild(btn);
  });

  // Add "戻る" button if history exists
  if (adventureHistory.length > 0) {
    const backBtn = document.createElement('button');
    backBtn.className = 'adventure-back-btn';
    backBtn.textContent = '← 戻る';
    backBtn.addEventListener('click', () => {
      const prev = adventureHistory.pop();
      if (prev) {
        // Re-display previous response
        addMessage(prev.response, 'ai', null, false, true); // skipAdventure=true to avoid re-parsing
      }
    });
    container.appendChild(backBtn);
  }

  return container;
}

// v7.46: Send Adventure follow-up prompt
async function sendAdventureFollowUp(timestamp) {
  const followUpPrompt = `${timestamp}を選択しました。このシーンから分岐する次の3つの選択肢を提示してください。`;

  // Show user message
  addMessage(followUpPrompt, 'user');

  // Send to AI
  sendBtn.disabled = true;
  const loadingEl = showLoading();

  try {
    const response = await window.electronAPI.sendMessage(followUpPrompt);
    loadingEl.remove();

    const text = response.content || response;
    const usage = response.usage || null;
    addMessage(text, 'ai', usage);
  } catch (err) {
    loadingEl.remove();
    addMessage(`Error: ${err.message}`, 'system');
  } finally {
    sendBtn.disabled = false;
  }
}

// Simple Markdown parser (inline, no external dependencies)
function parseMarkdown(text) {
  let html = text;

  // Escape HTML first (prevent XSS)
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Code blocks (```) - must be before inline code
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');

  // Inline code (`)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Tables (must be before other block elements)
  html = html.replace(/^(\|.+\|)\n(\|[-:| ]+\|)\n((?:\|.+\|\n?)+)/gm, (match, headerRow, separatorRow, bodyRows) => {
    // Parse header
    const headers = headerRow.split('|').filter(c => c.trim()).map(c => `<th>${c.trim()}</th>`).join('');
    // Parse body rows
    const rows = bodyRows.trim().split('\n').map(row => {
      const cells = row.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
  });

  // Headers (## Header)
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');

  // Bold (**text** or __text__)
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');

  // Italic (*text* or _text_)
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

  // Unordered lists (- item or * item)
  html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // Ordered lists (1. item)
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Paragraphs (double newline)
  html = html.replace(/\n\n+/g, '</p><p>');
  html = '<p>' + html + '</p>';

  // Single line breaks
  html = html.replace(/\n/g, '<br>');

  // Clean up empty paragraphs
  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/<p>(<h[234]>)/g, '$1');
  html = html.replace(/(<\/h[234]>)<\/p>/g, '$1');
  html = html.replace(/<p>(<ul>)/g, '$1');
  html = html.replace(/(<\/ul>)<\/p>/g, '$1');
  html = html.replace(/<p>(<pre>)/g, '$1');
  html = html.replace(/(<\/pre>)<\/p>/g, '$1');
  html = html.replace(/<p>(<table>)/g, '$1');
  html = html.replace(/(<\/table>)<\/p>/g, '$1');

  return html;
}

// Send message
async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;

  addMessage(text, 'user');
  chatInput.value = '';
  sendBtn.disabled = true;

  const loadingEl = showLoading();

  try {
    const response = await window.electronAPI.sendChatMessage(text);
    loadingEl.remove();
    removeGeminiProgress();  // v7.24: Remove Gemini progress if shown

    // v7.24: Use formattedMessage for Gemini video mode (pre-linked timestamps)
    // v7.25: Gemini grid mode uses regular message like Claude
    const messageContent = response.formattedMessage || response.message;
    const isPreformatted = !!response.formattedMessage;  // Only true for Gemini video mode
    addMessage(messageContent, 'ai', response.usage, isPreformatted);

    // Enable refine button if response contains timestamps (scene index)
    // Note: Refine is only for grid-based analysis (Claude, DeepSeek, Gemini grid mode)
    // Gemini video mode has formattedMessage, grid mode doesn't
    if (!response.formattedMessage && response.message && /\d{1,3}:\d{2}/.test(response.message)) {
      hasSceneIndex = true;
      refineBtn.disabled = false;
    }
  } catch (err) {
    loadingEl.remove();
    removeGeminiProgress();  // v7.24: Remove Gemini progress on error
    addMessage(`Error: ${err.message}`, 'system');
  } finally {
    sendBtn.disabled = false;
    chatInput.focus();
  }
}

// Refine timestamps using zoom scans
async function refineTimestamps() {
  if (!hasSceneIndex) return;

  addMessage('[Refine] Scanning timestamp boundaries...', 'system');
  refineBtn.disabled = true;
  sendBtn.disabled = true;

  const loadingEl = showLoading();

  try {
    const response = await window.electronAPI.refineTimestamps();
    loadingEl.remove();
    addMessage(response.message, 'ai', response.usage);
  } catch (err) {
    loadingEl.remove();
    addMessage(`Refine error: ${err.message}`, 'system');
  } finally {
    sendBtn.disabled = false;
    // Keep refine button enabled for re-refining
    refineBtn.disabled = false;
    chatInput.focus();
  }
}


// Convert timestamps in text to clickable links
function linkifyTimestamps(text) {
  let result = text;

  // Process range patterns first (e.g., "0-3分", "15-20分")
  result = result.replace(/(\d+)[-〜~](\d+)(分|秒)(あたり|頃)?/g, (match, start, _end, unit) => {
    const multiplier = unit === '分' ? 60 : 1;
    const startSec = parseInt(start) * multiplier;
    return `<a href="#" class="timestamp-link" data-seconds="${startSec}">${match}</a>`;
  });

  // Process hour-minute ranges (e.g., "1時間30分-2時間")
  result = result.replace(/(\d+)時間(\d+)?分?[-〜~](\d+)時間(\d+)?分?/g, (match, h1, m1) => {
    const startSec = parseInt(h1) * 3600 + (parseInt(m1) || 0) * 60;
    return `<a href="#" class="timestamp-link" data-seconds="${startSec}">${match}</a>`;
  });

  // Process standalone hour-minute (e.g., "1時間30分") - avoid already linked
  result = result.replace(/(?<!data-seconds="\d+">)(\d+)時間(\d+)?分?(?![^<]*<\/a>)/g, (match, hours, mins) => {
    const seconds = parseInt(hours) * 3600 + (parseInt(mins) || 0) * 60;
    return `<a href="#" class="timestamp-link" data-seconds="${seconds}">${match}</a>`;
  });

  // Process standard timestamps (e.g., "1:23:45", "12:34", "120:30") - avoid already linked
  // Support 1-3 digit minutes for videos over 100 minutes
  result = result.replace(/(?<!data-seconds="\d+">)(\d{1,3}):(\d{2})(:(\d{2}))?(?![^<]*<\/a>)/g, (match, p1, p2, _p3, p4) => {
    let seconds;
    if (p4 !== undefined) {
      // HH:MM:SS
      seconds = parseInt(p1) * 3600 + parseInt(p2) * 60 + parseInt(p4);
    } else {
      // MM:SS (supports up to 999:59)
      seconds = parseInt(p1) * 60 + parseInt(p2);
    }
    return `<a href="#" class="timestamp-link" data-seconds="${seconds}">${match}</a>`;
  });

  return result;
}

// Format token count for display
function formatTokens(count) {
  if (count >= 1000) {
    return (count / 1000).toFixed(1) + 'k';
  }
  return count.toString();
}

// Add message to chat
// v7.24: Added isPreformatted param for Gemini responses with pre-linked timestamps
// v7.46: Added skipAdventure param for history restoration
function addMessage(text, type, usage = null, isPreformatted = false, skipAdventure = false) {
  const msgEl = document.createElement('div');
  msgEl.className = `message ${type}`;

  // For AI messages, parse Markdown then convert timestamps to clickable links
  if (type === 'ai') {
    let htmlContent;
    if (isPreformatted) {
      // v7.24: Gemini returns pre-formatted HTML with timestamp links already
      // Don't escape HTML or re-linkify - just use as-is
      htmlContent = text;
    } else {
      // Claude/DeepSeek: parse markdown then linkify timestamps
      htmlContent = linkifyTimestamps(parseMarkdown(text));
    }
    msgEl.innerHTML = htmlContent;

    // Add click handlers for timestamp links
    msgEl.querySelectorAll('.timestamp-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const seconds = parseInt(link.dataset.seconds);
        window.electronAPI.seekToTimestamp(seconds);
      });
    });

    // v7.46: Detect Adventure Book choices and create buttons
    if (!skipAdventure) {
      const choices = parseAdventureChoices(text);
      if (choices.length >= 2) {
        isAdventureMode = true;
        const buttonsContainer = createAdventureButtons(choices, text);
        msgEl.appendChild(buttonsContainer);
      }
    }
  } else {
    msgEl.textContent = text;
  }

  if (type !== 'system') {
    const timestamp = document.createElement('div');
    timestamp.className = 'timestamp';
    let timeText = new Date().toLocaleTimeString();

    // Add token usage for AI messages
    if (type === 'ai' && usage) {
      const parts = [];
      if (usage.input) parts.push(`in:${formatTokens(usage.input)}`);
      if (usage.output) parts.push(`out:${formatTokens(usage.output)}`);
      if (usage.cacheRead) parts.push(`cache:${formatTokens(usage.cacheRead)}`);
      // v7.24: Show cached tokens for Gemini
      if (usage.cached) parts.push(`cached:${formatTokens(usage.cached)}`);
      if (parts.length > 0) {
        timeText += ` | ${parts.join(' ')}`;
      }
    }

    timestamp.textContent = timeText;
    msgEl.appendChild(timestamp);
  }

  chatMessages.appendChild(msgEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Show loading indicator
function showLoading() {
  const loadingEl = document.createElement('div');
  loadingEl.className = 'message ai loading';
  loadingEl.innerHTML = '<span></span><span></span><span></span>';
  chatMessages.appendChild(loadingEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return loadingEl;
}

// v7.24: Show/update Gemini progress
function showGeminiProgress(progress) {
  if (!geminiProgressEl) {
    geminiProgressEl = document.createElement('div');
    geminiProgressEl.className = 'progress-container';
    geminiProgressEl.innerHTML = `
      <div class="stage"></div>
      <div class="message"></div>
      <div class="progress-bar"><div class="progress-bar-fill" style="width: 0%"></div></div>
    `;
    chatMessages.appendChild(geminiProgressEl);
  }

  const stageEl = geminiProgressEl.querySelector('.stage');
  const messageEl = geminiProgressEl.querySelector('.message');
  const fillEl = geminiProgressEl.querySelector('.progress-bar-fill');

  // Map stage to Japanese message
  const stageMessages = {
    'upload': 'Uploading video to Google...',
    'processing': 'Google is processing video...',
    'caching': 'Creating context cache...',
    'ready': 'Ready for questions'
  };

  stageEl.textContent = stageMessages[progress.stage] || progress.stage;
  messageEl.textContent = progress.message;

  if (progress.progress !== null) {
    fillEl.style.width = `${progress.progress}%`;
  }

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Remove Gemini progress indicator
function removeGeminiProgress() {
  if (geminiProgressEl) {
    geminiProgressEl.remove();
    geminiProgressEl = null;
  }
}

// v7.25: Full audio transcription with Gemini
async function transcribeAudio() {
  addMessage('[Transcribe] Analyzing full audio...', 'system');
  transcribeBtn.disabled = true;
  sendBtn.disabled = true;

  const loadingEl = showLoading();

  try {
    const response = await window.electronAPI.analyzeAudio({});
    loadingEl.remove();
    removeGeminiProgress();

    // Use formattedMessage for clickable timestamps
    const messageContent = response.formattedMessage || response.message;
    addMessage(messageContent, 'ai', response.usage, !!response.formattedMessage);

    // Store transcript for search functionality
    if (response.transcript) {
      currentTranscript = response.transcript;
      addMessage(`[Transcribe] ${response.transcript.lines.length} lines, ${response.transcript.keywords.length} keywords extracted`, 'system');
    }
  } catch (err) {
    loadingEl.remove();
    removeGeminiProgress();
    addMessage(`Transcribe error: ${err.message}`, 'system');
  } finally {
    sendBtn.disabled = false;
    transcribeBtn.disabled = false;
    chatInput.focus();
  }
}

// Event listeners
sendBtn.addEventListener('click', () => sendMessage());
refineBtn.addEventListener('click', () => refineTimestamps());
transcribeBtn.addEventListener('click', () => transcribeAudio());

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Focus input on load
chatInput.focus();

// v7.24: Listen for Gemini progress updates
window.electronAPI.onGeminiProgress((progress) => {
  showGeminiProgress(progress);
});
