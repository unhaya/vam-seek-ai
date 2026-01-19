const { app, BrowserWindow, ipcMain, dialog, nativeTheme, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const aiService = require('./ai-service');

let mainWindow;
let chatWindow = null;
let settingsWindow = null;
let gridCaptureResolve = null;

// Grid cache - LRU with max 10 videos
const MAX_GRID_CACHE = 10;
const gridCache = new Map();  // videoKey -> gridData
let currentVideoKey = null;   // Currently loaded video key

// Get cache key from video name + duration
function getVideoKey(gridData) {
  if (!gridData) return null;
  return `${gridData.videoName || 'unknown'}_${Math.round(gridData.duration || 0)}`;
}

// Get grid from cache or return null
function getCachedGrid(videoKey) {
  if (!videoKey || !gridCache.has(videoKey)) return null;
  // Move to end (most recently used)
  const data = gridCache.get(videoKey);
  gridCache.delete(videoKey);
  gridCache.set(videoKey, data);
  return data;
}

// Add grid to cache with LRU eviction
function setCachedGrid(videoKey, gridData) {
  if (!videoKey || !gridData) return;
  // Delete if exists (to update position)
  if (gridCache.has(videoKey)) {
    gridCache.delete(videoKey);
  }
  // Evict oldest if at capacity
  if (gridCache.size >= MAX_GRID_CACHE) {
    const oldestKey = gridCache.keys().next().value;
    gridCache.delete(oldestKey);
    console.log(`[GridCache] Evicted: ${oldestKey}`);
  }
  gridCache.set(videoKey, gridData);
  console.log(`[GridCache] Cached: ${videoKey} (${gridCache.size}/${MAX_GRID_CACHE})`);
}

function createWindow() {
  // ダークモードを強制（タイトルバー・メニューバーに適用）
  if (nativeTheme) {
    nativeTheme.themeSource = 'dark';
  }
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0a0a12',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false  // ローカルファイル再生を許可
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

// チャットウィンドウを作成
function createChatWindow() {
  if (chatWindow) {
    chatWindow.focus();
    return;
  }

  chatWindow = new BrowserWindow({
    width: 400,
    height: 600,
    minWidth: 300,
    minHeight: 400,
    backgroundColor: '#1a1a2e',
    parent: mainWindow,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  chatWindow.loadFile(path.join(__dirname, '../renderer/chat.html'));

  chatWindow.on('closed', () => {
    chatWindow = null;
  });
}

// 設定ウィンドウを作成
function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 420,
    height: 580,
    minWidth: 380,
    minHeight: 520,
    resizable: true,
    backgroundColor: '#1a1a2e',
    parent: mainWindow,
    modal: true,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // メニューバーを非表示
  settingsWindow.setMenuBarVisibility(false);

  settingsWindow.loadFile(path.join(__dirname, '../renderer/settings.html'));

  settingsWindow.once('ready-to-show', () => {
    settingsWindow.show();
  });

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// メニューバーを作成
function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Folder',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openDirectory']
            });
            if (result.filePaths[0]) {
              mainWindow.webContents.send('folder-selected', result.filePaths[0]);
            }
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'AI',
      submenu: [
        {
          label: 'Open Chat',
          accelerator: 'CmdOrCtrl+Shift+A',
          click: () => {
            createChatWindow();
          }
        },
        { type: 'separator' },
        {
          label: 'Settings...',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            createSettingsWindow();
          }
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  // Load saved AI settings (API key, model)
  aiService.initFromSaved();
  createMenu();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// フォルダ選択ダイアログ
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.filePaths[0] || null;
});

// フォルダ内のファイル一覧取得
ipcMain.handle('read-directory', async (event, dirPath) => {
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const result = [];

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const isDirectory = entry.isDirectory();
      const isVideo = !isDirectory && /\.(mp4|webm|mov|avi|mkv)$/i.test(entry.name);

      // 動画ファイルまたはフォルダのみ表示（その他のファイルは除外）
      if (isDirectory || isVideo) {
        result.push({
          id: fullPath,
          name: entry.name,
          path: fullPath,
          isDirectory,
          isVideo,
          children: isDirectory ? [] : undefined
        });
      }
    }

    // フォルダ優先、名前順でソート
    result.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return result;
  } catch (err) {
    console.error('Failed to read directory:', err);
    return [];
  }
});

// フォルダ存在確認
ipcMain.handle('folder-exists', async (event, folderPath) => {
  try {
    const stat = await fs.promises.stat(folderPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
});

// AI Chat message handler
ipcMain.handle('send-chat-message', async (event, message) => {
  try {
    // First, get lightweight video info to check cache
    const videoInfo = await requestVideoInfo();
    if (!videoInfo || !videoInfo.videoName) {
      throw new Error('No video loaded. Please load a video first.');
    }

    // Create video key from info
    const videoKey = `${videoInfo.videoName}_${Math.round(videoInfo.duration || 0)}`;
    let gridData = getCachedGrid(videoKey);

    if (gridData) {
      // Cache hit - use cached grid
      console.log(`[GridCache] Hit: ${videoKey}`);
      currentVideoKey = videoKey;
    } else {
      // Cache miss - need to capture grid
      console.log(`[GridCache] Miss: ${videoKey}`);
      let freshGridData = null;
      if (mainWindow) {
        freshGridData = await new Promise((resolve) => {
          gridCaptureResolve = resolve;
          mainWindow.webContents.send('grid-capture-request');
        });
      }

      if (!freshGridData || !freshGridData.gridImage) {
        throw new Error('Failed to capture grid image. Please ensure a video is loaded.');
      }

      gridData = freshGridData;
      setCachedGrid(videoKey, gridData);
      currentVideoKey = videoKey;
    }

    const response = await aiService.analyzeGrid(message, gridData);
    return response;
  } catch (err) {
    throw err;
  }
});

// 未使用：元のグリッドキャプチャロジック（参考用に残す）
/*
ipcMain.handle('send-chat-message-old', async (event, message) => {
  try {
    let gridData = currentGridData;
    const needsFreshCapture = !currentGridData || !currentGridData.gridImage;
    if (needsFreshCapture && mainWindow) {
      gridData = await new Promise((resolve) => {
        gridCaptureResolve = resolve;
        mainWindow.webContents.send('grid-capture-request');
        setTimeout(() => {
          if (gridCaptureResolve) {
            gridCaptureResolve(currentGridData);
            gridCaptureResolve = null;
          }
        }, 3000);
      });
    }

    const response = await aiService.analyzeGrid(message, gridData);
    return response;
  } catch (err) {
    throw err;
  }
});
*/

// Grid data from renderer
ipcMain.handle('get-grid-data', async () => {
  return currentVideoKey ? getCachedGrid(currentVideoKey) : null;
});

// Update grid data (called from main renderer) - now updates cache
ipcMain.on('update-grid-data', (event, data) => {
  if (data) {
    const videoKey = getVideoKey(data);
    setCachedGrid(videoKey, data);
    currentVideoKey = videoKey;
  }
});

// AI Settings handlers
ipcMain.handle('get-ai-settings', async () => {
  return aiService.getAllSettings();
});

ipcMain.handle('save-ai-settings', async (event, settings) => {
  // Set provider first
  if (settings.provider) {
    aiService.setProvider(settings.provider);
  }

  // Update Claude settings if provided
  if (settings.claudeApiKey && settings.claudeApiKey !== '••••••••') {
    aiService.initClaude(settings.claudeApiKey, settings.claudeModel);
  } else if (settings.claudeModel) {
    // Just update model if no new key
    if (aiService.getProvider() === 'claude') {
      aiService.setModel(settings.claudeModel);
    }
  }

  // Update DeepSeek settings if provided
  if (settings.deepseekApiKey && settings.deepseekApiKey !== '••••••••') {
    aiService.initDeepSeek(settings.deepseekApiKey, settings.deepseekModel);
  } else if (settings.deepseekModel) {
    // Just update model if no new key
    if (aiService.getProvider() === 'deepseek') {
      aiService.setModel(settings.deepseekModel);
    }
  }

  // Update grid quality if provided
  if (settings.gridSecondsPerCell) {
    aiService.setGridSecondsPerCell(settings.gridSecondsPerCell);
    // Notify main window to update grid config
    if (mainWindow) {
      mainWindow.webContents.send('grid-config-changed', settings.gridSecondsPerCell);
    }
  }

  return { success: true };
});

// Seek to timestamp (from chat window)
ipcMain.on('seek-to-timestamp', (event, seconds) => {
  if (mainWindow) {
    mainWindow.webContents.send('seek-to-timestamp', seconds);
  }
});

// AI Phase management
ipcMain.handle('set-ai-phase', async (event, phase) => {
  aiService.setPhase(phase);
  return { success: true };
});

ipcMain.handle('get-ai-phase', async () => {
  return aiService.getPhase();
});

// Auto-zoom counter
ipcMain.handle('increment-zoom-count', async () => {
  return aiService.incrementZoomCount();
});

// Request fresh grid capture from main window
ipcMain.handle('request-grid-capture', async () => {
  if (!mainWindow) return currentVideoKey ? getCachedGrid(currentVideoKey) : null;

  return new Promise((resolve) => {
    gridCaptureResolve = resolve;
    mainWindow.webContents.send('grid-capture-request');

    // Timeout after 3 seconds
    setTimeout(() => {
      if (gridCaptureResolve) {
        gridCaptureResolve(currentVideoKey ? getCachedGrid(currentVideoKey) : null);
        gridCaptureResolve = null;
      }
    }, 3000);
  });
});

// Receive grid capture response
ipcMain.on('grid-capture-response', (event, data) => {
  if (data) {
    const videoKey = getVideoKey(data);
    setCachedGrid(videoKey, data);
    currentVideoKey = videoKey;
  }
  if (gridCaptureResolve) {
    gridCaptureResolve(data);
    gridCaptureResolve = null;
  }
});

// === Video Info (lightweight) ===
let videoInfoResolve = null;

function requestVideoInfo() {
  if (!mainWindow) return Promise.resolve(null);

  return new Promise((resolve) => {
    videoInfoResolve = resolve;
    mainWindow.webContents.send('video-info-request');

    // Timeout after 500ms (should be instant)
    setTimeout(() => {
      if (videoInfoResolve) {
        videoInfoResolve(null);
        videoInfoResolve = null;
      }
    }, 500);
  });
}

ipcMain.on('video-info-response', (event, data) => {
  if (videoInfoResolve) {
    videoInfoResolve(data);
    videoInfoResolve = null;
  }
});

// === Zoom Grid Capture ===
let zoomGridCaptureResolve = null;

// Request zoom grid capture from main window
ipcMain.handle('request-zoom-grid-capture', async (event, startTime, endTime) => {
  if (!mainWindow) return null;

  return new Promise((resolve) => {
    zoomGridCaptureResolve = resolve;
    mainWindow.webContents.send('zoom-grid-capture-request', startTime, endTime);

    // Timeout after 10 seconds (zoom capture takes longer)
    setTimeout(() => {
      if (zoomGridCaptureResolve) {
        zoomGridCaptureResolve(null);
        zoomGridCaptureResolve = null;
      }
    }, 10000);
  });
});

// Receive zoom grid capture response
ipcMain.on('zoom-grid-capture-response', (event, data) => {
  if (zoomGridCaptureResolve) {
    zoomGridCaptureResolve(data);
    zoomGridCaptureResolve = null;
  }
});

// Zoom chat message handler - send zoomed grid to AI
ipcMain.handle('send-zoom-chat-message', async (event, message, startTime, endTime) => {
  try {
    // Request zoom grid capture
    let zoomGridData = null;
    if (mainWindow) {
      zoomGridData = await new Promise((resolve) => {
        zoomGridCaptureResolve = resolve;
        mainWindow.webContents.send('zoom-grid-capture-request', startTime, endTime);
        setTimeout(() => {
          if (zoomGridCaptureResolve) {
            zoomGridCaptureResolve(null);
            zoomGridCaptureResolve = null;
          }
        }, 10000);
      });
    }

    if (!zoomGridData) {
      throw new Error('Failed to capture zoom grid');
    }

    const response = await aiService.analyzeZoomGrid(message, zoomGridData);
    return response;
  } catch (err) {
    throw err;
  }
});
