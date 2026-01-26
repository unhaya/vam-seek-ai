const { app, BrowserWindow, ipcMain, dialog, nativeTheme, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const aiService = require('./ai-service');
const whisperService = require('./whisper-service');

// v7.26: Fast Python-based audio/grid extraction
async function runPythonExtract(videoPath, options = {}) {
  const scriptPath = path.join(__dirname, '../../scripts/fast_extract.py');
  const outputDir = path.join(os.tmpdir(), `vam_extract_${Date.now()}`);

  // Build command args
  const args = [scriptPath, videoPath, outputDir];

  if (options.interval) args.push('--interval', options.interval.toString());
  if (options.gridCols) args.push('--grid-cols', options.gridCols.toString());
  if (options.cellWidth) args.push('--cell-width', options.cellWidth.toString());
  if (options.cellHeight) args.push('--cell-height', options.cellHeight.toString());
  if (options.audioOnly) args.push('--audio-only');
  if (options.audioAI) args.push('--audio-ai');  // v7.29: AI-optimized audio (16kHz mono 48kbps MP3)
  if (options.gridOnly) args.push('--grid-only');
  if (options.zoom) {
    args.push('--zoom');
    args.push('--zoom-start', options.zoomStart.toString());
    if (options.zoomDuration) args.push('--zoom-duration', options.zoomDuration.toString());
  }

  return new Promise((resolve, reject) => {
    const proc = spawn('python', args, { windowsHide: true });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout);
          result.outputDir = outputDir;
          resolve(result);
        } catch (e) {
          reject(new Error(`Failed to parse Python output: ${stdout}`));
        }
      } else {
        reject(new Error(`Python script failed (code ${code}): ${stderr}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn Python: ${err.message}`));
    });
  });
}

// Clean up extraction temp directory
function cleanupExtractDir(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return;
  try {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      fs.unlinkSync(path.join(dirPath, file));
    }
    fs.rmdirSync(dirPath);
    console.log(`[FastExtract] Cleaned up: ${dirPath}`);
  } catch (e) {
    console.warn(`[FastExtract] Cleanup failed: ${e.message}`);
  }
}

let mainWindow;
let chatWindow = null;
let settingsWindow = null;
let gridCaptureResolve = null;

// Grid cache - LRU with max 10 videos
const MAX_GRID_CACHE = 10;
const gridCache = new Map();
let currentVideoKey = null;

// Zoom cache - LRU with max 50 zoom ranges per video
const MAX_ZOOM_CACHE = 50;
const zoomCache = new Map();  // "videoKey_start_end" -> zoomGridData

function getVideoKey(gridData) {
  if (!gridData) return null;
  const secPerCell = gridData.secondsPerCell || aiService.getGridSecondsPerCell();
  // v7.30: Include processorName in cache key for VAM-RGB plugin support
  const processor = gridData.processorName || 'standard';
  return `${gridData.videoName || 'unknown'}_${Math.round(gridData.duration || 0)}_${secPerCell}sec_${processor}`;
}

function getZoomKey(videoKey, startTime, endTime) {
  return `${videoKey}_zoom_${startTime}-${endTime}`;
}

function getCachedGrid(videoKey) {
  if (!videoKey || !gridCache.has(videoKey)) return null;
  const data = gridCache.get(videoKey);
  gridCache.delete(videoKey);
  gridCache.set(videoKey, data);
  return data;
}

function setCachedGrid(videoKey, gridData) {
  if (!videoKey || !gridData) return;
  if (gridCache.has(videoKey)) gridCache.delete(videoKey);
  if (gridCache.size >= MAX_GRID_CACHE) {
    const oldestKey = gridCache.keys().next().value;
    gridCache.delete(oldestKey);
    console.log(`[GridCache] Evicted: ${oldestKey}`);
  }
  gridCache.set(videoKey, gridData);
  console.log(`[GridCache] Cached: ${videoKey} (${gridCache.size}/${MAX_GRID_CACHE})`);
}

// v7.30: Add transcript to current video's grid cache
function addTranscriptToCache(transcriptText) {
  if (!currentVideoKey || !transcriptText) return false;
  const cached = gridCache.get(currentVideoKey);
  if (!cached) {
    console.log(`[GridCache] No cache found for transcript: ${currentVideoKey}`);
    return false;
  }
  cached.transcript = transcriptText;
  console.log(`[GridCache] Transcript added to: ${currentVideoKey}`);
  return true;
}

// v7.30: Get transcript from cache if available
function getCachedTranscript(videoKey) {
  const cached = gridCache.get(videoKey);
  return cached?.transcript || null;
}

function getCachedZoom(zoomKey) {
  if (!zoomKey || !zoomCache.has(zoomKey)) return null;
  const data = zoomCache.get(zoomKey);
  zoomCache.delete(zoomKey);
  zoomCache.set(zoomKey, data);
  return data;
}

function setCachedZoom(zoomKey, zoomGridData) {
  if (!zoomKey || !zoomGridData) return;
  if (zoomCache.has(zoomKey)) zoomCache.delete(zoomKey);
  if (zoomCache.size >= MAX_ZOOM_CACHE) {
    const oldestKey = zoomCache.keys().next().value;
    zoomCache.delete(oldestKey);
    console.log(`[ZoomCache] Evicted: ${oldestKey}`);
  }
  zoomCache.set(zoomKey, zoomGridData);
  console.log(`[ZoomCache] Cached: ${zoomKey} (${zoomCache.size}/${MAX_ZOOM_CACHE})`);
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

  // 起動時に最大化
  mainWindow.maximize();

  // v7.29: ウィンドウ読み込み完了後にプロバイダーを通知
  mainWindow.webContents.once('did-finish-load', () => {
    const provider = aiService.getProvider();
    mainWindow.webContents.send('ai-provider-changed', provider);
    console.log(`[Main] Notified renderer of AI provider: ${provider}`);
  });
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

// v7.26: Fix GPU cache access denied error
// Set unique cache path to prevent conflicts between instances
app.commandLine.appendSwitch('disk-cache-dir', path.join(os.tmpdir(), `vamseek-cache-${process.pid}`));
app.commandLine.appendSwitch('gpu-cache-dir', path.join(os.tmpdir(), `vamseek-gpu-cache-${process.pid}`));

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

// 再帰的ファイル検索（AND検索対応、フォルダも含む）
ipcMain.handle('search-files', async (event, rootPath, keywords) => {
  const results = [];
  const videoExtensions = /\.(mp4|webm|mov|avi|mkv)$/i;

  // キーワードを小文字化（大文字小文字を区別しない）
  const lowerKeywords = keywords.map(k => k.toLowerCase());

  async function searchRecursive(dirPath) {
    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.relative(rootPath, fullPath);
        const lowerPath = fullPath.toLowerCase();
        const matchesAll = lowerKeywords.every(kw => lowerPath.includes(kw));

        if (entry.isDirectory()) {
          // フォルダ: マッチしたら結果に追加
          if (matchesAll) {
            results.push({
              name: entry.name,
              path: fullPath,
              relativePath: relativePath,
              isDirectory: true,
              isVideo: false
            });
          }
          // サブフォルダを再帰検索（マッチ有無に関わらず）
          await searchRecursive(fullPath);
        } else if (videoExtensions.test(entry.name)) {
          // 動画ファイル: フルパスでAND検索（全キーワードを含む）
          if (matchesAll) {
            results.push({
              name: entry.name,
              path: fullPath,
              relativePath: relativePath,
              isDirectory: false,
              isVideo: true
            });
          }
        }
      }
    } catch (err) {
      // アクセス拒否等のエラーは無視
      console.error(`Search error in ${dirPath}:`, err.message);
    }
  }

  await searchRecursive(rootPath);

  // フォルダ優先、名前順ソート
  results.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.relativePath.localeCompare(b.relativePath);
  });

  return results;
});

// AI Chat message handler
ipcMain.handle('send-chat-message', async (event, message) => {
  try {
    // First, get lightweight video info to check cache
    const videoInfo = await requestVideoInfo();
    if (!videoInfo || !videoInfo.videoName) {
      throw new Error('No video loaded. Please load a video first.');
    }

    // v7.24: Gemini video mode uses direct video upload
    // v7.25: Gemini grid mode uses grid images like Claude
    if (aiService.isGeminiProvider() && aiService.getGeminiInputMode() === 'video') {
      // Get video path from renderer
      const videoPath = videoInfo.videoPath;
      if (!videoPath) {
        throw new Error('Video path not available. Please reload the video.');
      }

      // Set up progress callback to notify renderer
      aiService.setGeminiProgressCallback((progress) => {
        if (mainWindow) {
          mainWindow.webContents.send('gemini-progress', progress);
        }
      });

      // Analyze video with Gemini
      const response = await aiService.analyzeVideo(videoPath, message);
      return response;
    }
    // Note: Gemini grid mode falls through to use analyzeGrid below

    // Create video key from info + current grid setting
    // v7.12: secondsPerCellを含めて設定変更時のキャッシュ混線を防ぐ
    // v7.30: Include processor name for VAM-RGB plugin support
    // v7.33: Fix cache lookup to match actual cache key format (with version suffix)
    const secPerCell = aiService.getGridSecondsPerCell();
    const baseKey = `${videoInfo.videoName}_${Math.round(videoInfo.duration || 0)}_${secPerCell}sec`;

    // v7.33: Search cache for any VAM-RGB variant (with or without version)
    // Cache keys include processor name which may have version (e.g., "VAM-RGB v3.0")
    let gridData = null;
    for (const [key, value] of gridCache.entries()) {
      if (key.startsWith(baseKey) && (key.includes('VAM-RGB') || key.includes('standard'))) {
        gridData = getCachedGrid(key);
        if (gridData) break;
      }
    }
    // Fallback: try legacy format (no processor suffix)
    if (!gridData) {
      gridData = getCachedGrid(baseKey);
    }

    if (gridData) {
      // Cache hit - use cached grid
      const hitKey = getVideoKey(gridData);
      console.log(`[GridCache] Hit: ${hitKey}`);
      currentVideoKey = hitKey;

      // v7.30: Restore transcript to conversation history if available
      if (gridData.transcript) {
        aiService.restoreTranscript(gridData.transcript);
        console.log(`[GridCache] Transcript restored for: ${hitKey}`);
      }
    } else {
      // Cache miss - need to capture grid
      console.log(`[GridCache] Miss: ${baseKey}`);
      let freshGridData = null;
      if (mainWindow) {
        freshGridData = await new Promise((resolve) => {
          gridCaptureResolve = resolve;
          mainWindow.webContents.send('grid-capture-request');
        });
      }

      // V7.14: gridImages配列に対応（後方互換性のためgridImageもサポート）
      const hasGridImages = freshGridData && (freshGridData.gridImages?.length > 0 || freshGridData.gridImage);
      if (!hasGridImages) {
        throw new Error('Failed to capture grid image. Please ensure a video is loaded.');
      }

      gridData = freshGridData;
      // Note: setCachedGrid is already called in grid-capture-response handler
    }

    // v7.22: エラーフィードバック検出（OPUS専用自己アップデート）
    // ユーザーの指摘を検知したら、バックグラウンドで自己批評を実行
    if (aiService.isSelfUpdateEnabled()) {
      aiService.processErrorFeedback(message).then(newRule => {
        if (newRule) {
          console.log(`[SelfUpdate] New rule added: ${newRule.rule}`);
        }
      }).catch(err => {
        console.error('[SelfUpdate] Error:', err.message);
      });
    }

    let response = await aiService.analyzeGrid(message, gridData);

    // v7.29: バッチZOOM_REQUEST対応
    // AIが複数の[ZOOM_REQUEST:M:SS-M:SS]を出力したら全て検出して順次処理
    const zoomPattern = /\[ZOOM_REQUEST:(\d+):(\d{2})-(\d+):(\d{2})\]/g;
    const zoomMatches = [...response.message.matchAll(zoomPattern)];

    if (zoomMatches.length > 0) {
      console.log(`[AI] ${zoomMatches.length} zoom request(s) detected`);
      const zoomResults = [];

      for (let i = 0; i < zoomMatches.length; i++) {
        const zoomMatch = zoomMatches[i];
        console.log(`[AI] Processing zoom ${i + 1}/${zoomMatches.length}: ${zoomMatch[0]}`);

        const startTime = parseInt(zoomMatch[1]) * 60 + parseInt(zoomMatch[2]);
        const endTime = parseInt(zoomMatch[3]) * 60 + parseInt(zoomMatch[4]);

        // ズームキャッシュをチェック
        const zoomKey = getZoomKey(currentVideoKey, startTime, endTime);
        let zoomGridData = getCachedZoom(zoomKey);

        if (zoomGridData) {
          console.log(`[ZoomCache] Hit: ${zoomKey}`);
        } else {
          // キャッシュミス - キャプチャ実行
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
          if (zoomGridData) {
            setCachedZoom(zoomKey, zoomGridData);
          }
        }

        if (!zoomGridData) {
          console.log(`[AI] Zoom grid capture failed for ${zoomMatch[0]}`);
          zoomResults.push({ range: zoomMatch[0], success: false, error: 'capture failed' });
          continue;
        }

        // ズームグリッドでAIに問い合わせ
        aiService.incrementZoomCount();
        const zoomPrompt = zoomMatches.length > 1
          ? `【ズームスキャン ${i + 1}/${zoomMatches.length}】${zoomMatch[0]} の高解像度画像です。この区間の詳細を分析してください。`
          : 'ズーム画像を分析し、先ほどの質問に回答してください。';

        const zoomResponse = await aiService.analyzeZoomGrid(zoomPrompt, zoomGridData);
        zoomResults.push({
          range: zoomMatch[0],
          success: true,
          message: zoomResponse.message,
          usage: zoomResponse.usage
        });
      }

      // 複数ズーム結果がある場合、最終回答を統合リクエスト
      if (zoomResults.length > 1) {
        const successfulResults = zoomResults.filter(r => r.success);
        if (successfulResults.length > 0) {
          const summaryPrompt = `【バッチズームスキャン完了】${successfulResults.length}区間のスキャン結果を統合して、ユーザーの質問に最終回答してください。`;
          response = await aiService.analyzeGrid(summaryPrompt, null);
        }
      } else if (zoomResults.length === 1 && zoomResults[0].success) {
        // 単一ズームの場合は従来通り
        response = { message: zoomResults[0].message, usage: zoomResults[0].usage };
      }
    }

    // v7.19: AUDIO_REQUEST自動検出ループ
    // AIが[AUDIO_REQUEST:M:SS-M:SS]を出力したら音声文字起こしを実行
    // v7.26: Geminiプロバイダーでは無効（Transcribeボタンで全音声分析可能）
    const whisperAvailable = whisperService.isAvailable();
    const isGemini = aiService.isGeminiProvider();
    console.log(`[AI] Whisper available: ${whisperAvailable}`);
    if (whisperAvailable && !isGemini) {
      const MAX_AUDIO_LOOPS = 2;  // 音声リクエストは最大2回
      for (let i = 0; i < MAX_AUDIO_LOOPS; i++) {
        const audioMatch = response.message.match(/\[AUDIO_REQUEST:(\d+):(\d{2})-(\d+):(\d{2})\]/);
        if (!audioMatch) break;

        console.log(`[AI] Audio request detected: ${audioMatch[0]}`);
        const startTime = parseInt(audioMatch[1]) * 60 + parseInt(audioMatch[2]);
        const endTime = parseInt(audioMatch[3]) * 60 + parseInt(audioMatch[4]);

        // 動画パスを取得
        const videoPath = gridData?.videoPath;
        if (!videoPath) {
          console.log('[AI] Video path not available for audio transcription');
          break;
        }

        // 音声文字起こし実行
        const result = await whisperService.transcribeSegment(videoPath, startTime, endTime);

        if (!result.success) {
          console.log(`[AI] Audio transcription failed: ${result.error}`);
          // エラー時は文字起こし失敗をAIに通知
          response = await aiService.analyzeWithTranscript(
            `音声文字起こし失敗: ${result.error}`,
            gridData
          );
          break;
        }

        // 文字起こし結果をAIに送信
        const tsRange = `${audioMatch[1]}:${audioMatch[2]}-${audioMatch[3]}:${audioMatch[4]}`;
        response = await aiService.analyzeWithTranscript(
          `[AUDIO:${tsRange}]\n${result.transcript}`,
          gridData
        );
      }
    }

    // v7.26: タイムスタンプ自動詰め寄り（Auto-Interrogate）
    // 初回のシーンインデックス生成時のみ、AIの応答からタイムスタンプを検出し高解像度ズームで詰め寄る
    // response.cached === false は初回応答を示す
    // v7.43: ユーザーが詳細を要求したときのみ発動（概要クエリでは発動しない）
    const isDetailRequest = (msg) => {
      const keywords = ['詳細', '確認', '探して', '探せ', 'どこ', 'いつ', '見せて', 'zoom', 'ズーム', '拡大'];
      const lowerMsg = msg.toLowerCase();
      return keywords.some(kw => lowerMsg.includes(kw.toLowerCase()));
    };
    const isFirstResponse = response.cached === false;
    const extractedTimestamps = extractTimestampsFromResponse(response.message);
    const userWantsDetails = isDetailRequest(message);

    // v7.43: Skip auto-interrogate on overview queries (e.g., "memo")
    if (isFirstResponse && extractedTimestamps.length > 0 && !userWantsDetails) {
      console.log(`[AI] Auto-interrogate skipped: overview query (${extractedTimestamps.length} timestamps in response)`);
    }

    if (isFirstResponse && userWantsDetails && extractedTimestamps.length > 0 && extractedTimestamps.length <= 10) {
      // 最大10個のタイムスタンプまで処理（多すぎる場合は概要応答とみなしてスキップ）
      console.log(`[AI] Auto-interrogate: ${extractedTimestamps.length} timestamps detected (user requested details)`);

      // 各タイムスタンプに対して高解像度ズームを取得
      const hiresZooms = [];
      const MAX_INTERROGATE = 5;  // 最大5箇所まで詰め寄り
      const timestampsToCheck = extractedTimestamps.slice(0, MAX_INTERROGATE);

      for (const ts of timestampsToCheck) {
        console.log(`[AI] Capturing hi-res zoom for ${ts.original} (${ts.seconds}s)`);
        const hiresData = await requestHiResZoom(ts.seconds, 5);  // 前後5秒
        if (hiresData) {
          hiresZooms.push({
            timestamp: ts,
            gridData: hiresData
          });
        }
      }

      if (hiresZooms.length > 0) {
        // 高解像度ズームグリッドをAIに送信して詳細確認を要求
        console.log(`[AI] Sending ${hiresZooms.length} hi-res zoom(s) for verification`);

        // v7.41: 全てのズーム画像を順次送信
        const interrogateResults = [];
        for (let i = 0; i < hiresZooms.length; i++) {
          const zoom = hiresZooms[i];
          const zoomPrompt = `${zoom.timestamp.original} の高解像度キャプチャ（384px/1秒間隔）です。
詳細を確認し、正確な情報を提供してください。
「不鮮明」「確認困難」は受け付けません。`;

          console.log(`[AI] Sending hi-res zoom ${i + 1}/${hiresZooms.length}: ${zoom.timestamp.original}`);
          try {
            const zoomResponse = await aiService.analyzeZoomGrid(zoomPrompt, zoom.gridData);
            interrogateResults.push({
              timestamp: zoom.timestamp.original,
              message: zoomResponse.message
            });
          } catch (err) {
            console.error(`[AI] Zoom verification failed for ${zoom.timestamp.original}:`, err.message);
            interrogateResults.push({
              timestamp: zoom.timestamp.original,
              message: `[エラー] ${err.message}`
            });
          }
        }

        // 元の応答に詰め寄り結果を追加
        const interrogateSummary = interrogateResults
          .map(r => `### ${r.timestamp}\n${r.message}`)
          .join('\n\n');
        response = {
          ...response,
          message: response.message + '\n\n---\n**[詳細確認]**\n' + interrogateSummary,
          interrogated: true,
          interrogatedTimestamps: hiresZooms.map(z => z.timestamp.original)
        };
      }
    }

    return response;
  } catch (err) {
    throw err;
  }
});

// v7.25: Audio analysis handler (full transcription with Gemini)
// v7.26: Uses Python script for instant audio extraction with -c:a copy
ipcMain.handle('analyze-audio', async (event, options = {}) => {
  let extractResult = null;
  try {
    // Get video info
    const videoInfo = await requestVideoInfo();
    if (!videoInfo || !videoInfo.videoPath) {
      throw new Error('No video loaded. Please load a video first.');
    }

    // Set up progress callback
    const sendProgress = (progress) => {
      if (mainWindow) {
        mainWindow.webContents.send('gemini-progress', progress);
      }
    };
    aiService.setGeminiProgressCallback(sendProgress);

    // v7.26: Use Python for instant audio extraction
    sendProgress({ stage: 'upload', message: 'Extracting audio (instant)...', progress: 0 });

    try {
      // v7.29: Use AI-optimized audio (16kHz mono 48kbps MP3) to reduce token consumption
      extractResult = await runPythonExtract(videoInfo.videoPath, { audioAI: true });
      console.log(`[FastExtract] AI-optimized audio extracted: ${extractResult.audio_path}`);
    } catch (pythonErr) {
      console.warn('[FastExtract] Python failed, falling back to Node.js:', pythonErr.message);
      // Fallback to original slow method
      const response = await aiService.analyzeAudio(videoInfo.videoPath, options);
      return response;
    }

    // Analyze audio with Gemini using pre-extracted file
    const response = await aiService.analyzeAudioFile(extractResult.audio_path, options);

    // v7.30: Add transcript to grid cache for persistence across video switches
    if (response.message) {
      addTranscriptToCache(response.message);
    }

    // Cleanup temp files
    if (extractResult.outputDir) {
      cleanupExtractDir(extractResult.outputDir);
    }

    return response;
  } catch (err) {
    // Cleanup on error
    if (extractResult?.outputDir) {
      cleanupExtractDir(extractResult.outputDir);
    }
    console.error('Audio analysis error:', err);
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
    // v7.29: Notify renderer of provider change for grid size adjustment
    if (mainWindow) {
      mainWindow.webContents.send('ai-provider-changed', settings.provider);
    }
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

  // Update Gemini settings if provided
  if (settings.geminiApiKey && settings.geminiApiKey !== '••••••••') {
    aiService.initGemini(settings.geminiApiKey, settings.geminiModel);
  } else if (settings.geminiModel) {
    // Just update model if no new key
    if (aiService.getProvider() === 'gemini') {
      aiService.setModel(settings.geminiModel);
    }
  }

  // Update Gemini input mode if provided
  if (settings.geminiInputMode) {
    aiService.setGeminiInputMode(settings.geminiInputMode);
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

// v7.22: 自己アップデート機能のIPCハンドラー
ipcMain.handle('trigger-self-update', async (event, errorContext) => {
  if (!aiService.isSelfUpdateEnabled()) {
    return { success: false, error: 'Self-update requires OPUS model' };
  }

  const result = await aiService.processErrorFeedback(errorContext);
  return {
    success: !!result,
    rule: result ? result.rule : null
  };
});

ipcMain.handle('get-learned-rules', async () => {
  return aiService.loadLearnedRules();
});

ipcMain.handle('is-self-update-enabled', () => {
  return aiService.isSelfUpdateEnabled();
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
    // DEBUG: Save grid images to test folder (REMOVE LATER)
    const fs = require('fs');
    const path = require('path');
    const testDir = path.join(__dirname, '../../test');
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
    if (data.gridImages) {
      data.gridImages.forEach((img, i) => {
        fs.writeFileSync(path.join(testDir, `grid_${i}.jpg`), Buffer.from(img, 'base64'));
      });
      console.log(`[DEBUG] Saved ${data.gridImages.length} grid image(s) to ${testDir}`);
    }
    // END DEBUG
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

// v7.26: High-resolution zoom for auto-interrogate
let hiresZoomResolve = null;

ipcMain.on('hires-zoom-response', (event, data) => {
  if (hiresZoomResolve) {
    hiresZoomResolve(data);
    hiresZoomResolve = null;
  }
});

// Request high-resolution zoom grid for a specific timestamp
async function requestHiResZoom(timestamp, range = 5) {
  if (!mainWindow) return null;

  return new Promise((resolve) => {
    hiresZoomResolve = resolve;
    mainWindow.webContents.send('hires-zoom-request', timestamp, range);

    // Timeout after 15 seconds (high-res takes longer)
    setTimeout(() => {
      if (hiresZoomResolve) {
        hiresZoomResolve(null);
        hiresZoomResolve = null;
      }
    }, 15000);
  });
}

// Extract timestamps from AI response (MM:SS or H:MM:SS format)
function extractTimestampsFromResponse(message) {
  const timestamps = [];
  // Match MM:SS or H:MM:SS or HH:MM:SS patterns
  const pattern = /(\d{1,3}):(\d{2})(?::(\d{2}))?/g;
  let match;

  while ((match = pattern.exec(message)) !== null) {
    let seconds;
    if (match[3] !== undefined) {
      // H:MM:SS or HH:MM:SS
      seconds = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]);
    } else {
      // MM:SS (can be up to 999:59)
      seconds = parseInt(match[1]) * 60 + parseInt(match[2]);
    }
    timestamps.push({
      original: match[0],
      seconds: seconds
    });
  }

  // Remove duplicates and sort
  const unique = [];
  const seen = new Set();
  for (const ts of timestamps) {
    if (!seen.has(ts.seconds)) {
      seen.add(ts.seconds);
      unique.push(ts);
    }
  }
  unique.sort((a, b) => a.seconds - b.seconds);

  return unique;
}

// Zoom chat message handler - send zoomed grid to AI
ipcMain.handle('send-zoom-chat-message', async (event, message, startTime, endTime) => {
  try {
    // ズームキャッシュをチェック
    const zoomKey = getZoomKey(currentVideoKey, startTime, endTime);
    let zoomGridData = getCachedZoom(zoomKey);

    if (zoomGridData) {
      console.log(`[ZoomCache] Hit: ${zoomKey}`);
    } else {
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
      if (zoomGridData) {
        setCachedZoom(zoomKey, zoomGridData);
      }
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

// v7.23: Refine timestamps using zoom scans
// Extracts timestamps from last AI response and scans around each
ipcMain.handle('refine-timestamps', async () => {
  try {
    // Get cached grid data
    const gridData = currentVideoKey ? getCachedGrid(currentVideoKey) : null;
    if (!gridData) {
      throw new Error('No video loaded. Please load a video first.');
    }

    // Call AI service to start refine mode
    const response = await aiService.startRefineMode(gridData, async (startTime, endTime) => {
      // Callback to capture zoom grid for each timestamp
      const zoomKey = getZoomKey(currentVideoKey, startTime, endTime);
      let zoomGridData = getCachedZoom(zoomKey);

      if (zoomGridData) {
        console.log(`[Refine][ZoomCache] Hit: ${zoomKey}`);
      } else {
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
        if (zoomGridData) {
          setCachedZoom(zoomKey, zoomGridData);
        }
      }
      return zoomGridData;
    });

    return response;
  } catch (err) {
    throw err;
  }
});
