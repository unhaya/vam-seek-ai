// Chat window logic
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const connectionStatus = document.getElementById('connectionStatus');

// Send message
async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;

  // Add user message
  addMessage(text, 'user');
  chatInput.value = '';
  sendBtn.disabled = true;

  // Show loading
  const loadingEl = showLoading();

  try {
    // Request AI response via IPC
    const response = await window.electronAPI.sendChatMessage(text);

    // Remove loading
    loadingEl.remove();

    // Add AI response
    addMessage(response.message, 'ai');

    // Handle cell highlights if any
    if (response.cells && response.cells.length > 0) {
      addMessage(`Cells of interest: ${response.cells.join(', ')}`, 'system');
    }
  } catch (err) {
    loadingEl.remove();
    addMessage(`Error: ${err.message}`, 'system');
  } finally {
    sendBtn.disabled = false;
    chatInput.focus();
  }
}

// Parse timestamp string to seconds
function parseTimestamp(timeStr) {
  const parts = timeStr.split(/[:時間分秒]/).filter(p => p !== '');
  if (parts.length === 3) {
    // HH:MM:SS or X時間Y分Z秒
    return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
  } else if (parts.length === 2) {
    // MM:SS or X分Y秒
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
  } else if (parts.length === 1) {
    // Just seconds
    return parseInt(parts[0]);
  }
  return 0;
}

// Convert timestamps in text to clickable links
function linkifyTimestamps(text) {
  // Match patterns like: 0:00, 1:23, 12:34, 1:23:45, 0-3分, 15-20分, 1時間30分, etc.
  const patterns = [
    // Range patterns: 0-3分, 15-20分あたり, 1時間30分-2時間
    /(\d+時間)?(\d+)分?[-〜~](\d+時間)?(\d+)分(あたり|頃)?/g,
    // Japanese style: 1時間30分, 3時間30分
    /(\d+)時間(\d+)?分?/g,
    // Standard timestamp: 1:23:45, 12:34, 0:00
    /\d{1,2}:\d{2}(:\d{2})?/g,
    // Simple minute: 15分, 20分あたり
    /(\d+)分(あたり|頃)?/g
  ];

  let result = text;

  // Process range patterns first (e.g., "0-3分", "15-20分")
  result = result.replace(/(\d+)[-〜~](\d+)(分|秒)(あたり|頃)?/g, (match, start, end, unit) => {
    const multiplier = unit === '分' ? 60 : 1;
    const startSec = parseInt(start) * multiplier;
    return `<a href="#" class="timestamp-link" data-seconds="${startSec}">${match}</a>`;
  });

  // Process hour-minute ranges (e.g., "1時間30分-2時間")
  result = result.replace(/(\d+)時間(\d+)?分?[-〜~](\d+)時間(\d+)?分?/g, (match, h1, m1, h2, m2) => {
    const startSec = parseInt(h1) * 3600 + (parseInt(m1) || 0) * 60;
    return `<a href="#" class="timestamp-link" data-seconds="${startSec}">${match}</a>`;
  });

  // Process standalone hour-minute (e.g., "1時間30分") - avoid already linked
  result = result.replace(/(?<!data-seconds="\d+">)(\d+)時間(\d+)?分?(?![^<]*<\/a>)/g, (match, hours, mins) => {
    const seconds = parseInt(hours) * 3600 + (parseInt(mins) || 0) * 60;
    return `<a href="#" class="timestamp-link" data-seconds="${seconds}">${match}</a>`;
  });

  // Process standard timestamps (e.g., "1:23:45", "12:34") - avoid already linked
  result = result.replace(/(?<!data-seconds="\d+">)(\d{1,2}):(\d{2})(:(\d{2}))?(?![^<]*<\/a>)/g, (match, p1, p2, p3, p4) => {
    let seconds;
    if (p4 !== undefined) {
      // HH:MM:SS
      seconds = parseInt(p1) * 3600 + parseInt(p2) * 60 + parseInt(p4);
    } else {
      // MM:SS
      seconds = parseInt(p1) * 60 + parseInt(p2);
    }
    return `<a href="#" class="timestamp-link" data-seconds="${seconds}">${match}</a>`;
  });

  return result;
}

// Add message to chat
function addMessage(text, type) {
  const msgEl = document.createElement('div');
  msgEl.className = `message ${type}`;

  // For AI messages, convert timestamps to clickable links
  if (type === 'ai') {
    msgEl.innerHTML = linkifyTimestamps(text);
    // Add click handlers for timestamp links
    msgEl.querySelectorAll('.timestamp-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const seconds = parseInt(link.dataset.seconds);
        window.electronAPI.seekToTimestamp(seconds);
      });
    });
  } else {
    msgEl.textContent = text;
  }

  if (type !== 'system') {
    const timestamp = document.createElement('div');
    timestamp.className = 'timestamp';
    timestamp.textContent = new Date().toLocaleTimeString();
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

// Event listeners
sendBtn.addEventListener('click', sendMessage);

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Focus input on load
chatInput.focus();
