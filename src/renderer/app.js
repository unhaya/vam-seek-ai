// VAM Seek Player - Main Application
// V7.3: VAM-RGB Plugin System

let currentFolder = null;
let vamInstance = null;
let currentVideoPath = null;

// v7.42: Hi-res zoom request queue (prevent race conditions)
let hiresZoomQueue = [];
let hiresZoomProcessing = false;

// VAM-RGB Plugin System (v1.0) - Default to VAM-RGB mode
let currentGridProcessor = 'vam-rgb';  // 'standard' or 'vam-rgb'

const video = document.getElementById('videoPlayer');
const gridContainer = document.getElementById('gridContainer');

// === 設定の永続化 ===
const STORAGE_KEY = 'vamSeekSettings';

function loadSettings() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
  return {
    treePanelWidth: 280,
    gridPanelWidth: 350,
    gridPanelHeight: 40,  // 縦並び時のグリッド高さ（%）
    columns: 4,
    secondsPerCell: 7,
    scrollBehavior: 'center',
    aspectRatio: 'contain',
    treeCollapsed: false,
    gridCollapsed: false,
    lastFolderPath: null
  };
}

function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

const settings = loadSettings();

// === パネルリサイズ・折りたたみ機能 ===
const gridResizer = document.getElementById('gridResizer');
const gridPanel = document.getElementById('gridPanel');
const treeResizer = document.getElementById('treeResizer');
const treePanel = document.getElementById('treePanel');

let isResizingGrid = false;
let isResizingTree = false;

// レスポンシブ判定（1200px以下で縦並び）
function isVerticalLayout() {
  return window.innerWidth <= 1200;
}

// レイアウトモードに応じたスタイル適用
function applyLayoutStyles() {
  if (isVerticalLayout()) {
    // 縦並び時：高さを適用、幅はCSSで100%
    gridPanel.style.height = (settings.gridPanelHeight || 40) + '%';
  } else {
    // 横並び時：幅を適用、高さはCSSで自動（heightをクリア）
    gridPanel.style.width = settings.gridPanelWidth + 'px';
    gridPanel.style.height = '';  // CSSのデフォルトに戻す
  }
}

// ウィンドウリサイズ時にレイアウトモード切り替え
let previousLayout = isVerticalLayout();
window.addEventListener('resize', () => {
  const currentLayout = isVerticalLayout();
  if (currentLayout !== previousLayout) {
    previousLayout = currentLayout;
    applyLayoutStyles();
  }
});

// 保存された設定を適用
treePanel.style.width = settings.treePanelWidth + 'px';
applyLayoutStyles();
video.style.objectFit = settings.aspectRatio;
document.getElementById('columnsSelect').value = settings.columns;
document.getElementById('secondsSelect').value = settings.secondsPerCell;
document.getElementById('scrollSelect').value = settings.scrollBehavior;

// グリッドパネルリサイズ
gridResizer.addEventListener('mousedown', (e) => {
  isResizingGrid = true;
  gridResizer.classList.add('resizing');
  // 縦並び時は row-resize、横並び時は col-resize
  document.body.style.cursor = isVerticalLayout() ? 'row-resize' : 'col-resize';
  document.body.style.userSelect = 'none';
  e.preventDefault();
});

// ツリーパネルリサイズ
treeResizer.addEventListener('mousedown', (e) => {
  isResizingTree = true;
  treeResizer.classList.add('resizing');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (isResizingGrid) {
    const containerRect = document.getElementById('main').getBoundingClientRect();

    if (isVerticalLayout()) {
      // 縦並び時：高さをリサイズ（%で管理）
      const containerHeight = containerRect.height;
      const mouseY = e.clientY - containerRect.top;
      const newHeightPercent = ((containerHeight - mouseY) / containerHeight) * 100;
      // 最小15%、最大70%
      if (newHeightPercent >= 15 && newHeightPercent <= 70) {
        gridPanel.style.height = newHeightPercent + '%';
      }
    } else {
      // 横並び時：幅をリサイズ
      const newWidth = containerRect.right - e.clientX;
      // 最小200px、最大900px
      if (newWidth >= 200 && newWidth <= 900) {
        gridPanel.style.width = newWidth + 'px';
      }
    }
  } else if (isResizingTree) {
    const containerRect = document.getElementById('main').getBoundingClientRect();
    const newWidth = e.clientX - containerRect.left;
    // 最小200px、最大500px
    if (newWidth >= 200 && newWidth <= 500) {
      treePanel.style.width = newWidth + 'px';
    }
  }
});

document.addEventListener('mouseup', () => {
  if (isResizingGrid) {
    isResizingGrid = false;
    gridResizer.classList.remove('resizing');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    // 設定を保存（縦並び時は高さ、横並び時は幅）
    if (isVerticalLayout()) {
      settings.gridPanelHeight = parseFloat(gridPanel.style.height);
    } else {
      settings.gridPanelWidth = parseInt(gridPanel.style.width);
    }
    saveSettings(settings);
  }
  if (isResizingTree) {
    isResizingTree = false;
    treeResizer.classList.remove('resizing');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    // 設定を保存
    settings.treePanelWidth = parseInt(treePanel.style.width);
    saveSettings(settings);
  }
});

// ツリーパネル折りたたみ
const treeCollapseBtn = document.getElementById('treeCollapseBtn');
const treeExpandBtn = document.getElementById('treeExpandBtn');
let treeCollapsed = settings.treeCollapsed;

function setTreeCollapsed(collapsed, save = true) {
  treeCollapsed = collapsed;
  treePanel.classList.toggle('collapsed', collapsed);
  treeResizer.classList.toggle('hidden', collapsed);
  treeExpandBtn.classList.toggle('hidden', !collapsed);
  if (save) {
    settings.treeCollapsed = collapsed;
    saveSettings(settings);
  }
}

// 起動時の折りたたみ状態を適用
setTreeCollapsed(settings.treeCollapsed, false);

treeCollapseBtn.addEventListener('click', () => {
  setTreeCollapsed(true);
});

treeExpandBtn.addEventListener('click', () => {
  setTreeCollapsed(false);
});

// グリッドパネル折りたたみ
const gridCollapseBtn = document.getElementById('gridCollapseBtn');
const gridExpandBtn = document.getElementById('gridExpandBtn');
let gridCollapsed = settings.gridCollapsed;

function setGridCollapsed(collapsed, save = true) {
  gridCollapsed = collapsed;
  gridPanel.classList.toggle('collapsed', collapsed);
  gridResizer.classList.toggle('hidden', collapsed);
  gridExpandBtn.classList.toggle('hidden', !collapsed);
  if (save) {
    settings.gridCollapsed = collapsed;
    saveSettings(settings);
  }
}

// 起動時の折りたたみ状態を適用
setGridCollapsed(settings.gridCollapsed, false);

gridCollapseBtn.addEventListener('click', () => {
  setGridCollapsed(true);
});

gridExpandBtn.addEventListener('click', () => {
  setGridCollapsed(false);
});

// フォルダを開く
document.getElementById('openFolderBtn').addEventListener('click', async () => {
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    await openFolder(folder);
  }
});

// フォルダを開く共通処理
async function openFolder(folderPath) {
  currentFolder = folderPath;
  updateBreadcrumb(folderPath);
  settings.lastFolderPath = folderPath;
  saveSettings(settings);
  await loadTree(folderPath);
}

// パンくずリストを更新
function updateBreadcrumb(folderPath) {
  const breadcrumb = document.getElementById('breadcrumb');
  breadcrumb.innerHTML = '';

  if (!folderPath) return;

  // パスを分割（Windows: バックスラッシュ、Unix: スラッシュ）
  const parts = folderPath.split(/[/\\]/).filter(p => p);
  let accumulated = '';

  parts.forEach((part, i) => {
    // パス区切り
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = '/';
      breadcrumb.appendChild(sep);
    }

    // パス要素
    accumulated += (i === 0 && /^[A-Z]:$/i.test(part)) ? part : (accumulated ? '\\' : '') + part;
    const fullPath = accumulated;

    const span = document.createElement('span');
    span.textContent = part;
    span.title = fullPath;
    span.addEventListener('click', () => openFolder(fullPath));
    breadcrumb.appendChild(span);
  });
}

// 起動時に前回のフォルダを自動で開く
if (settings.lastFolderPath) {
  // フォルダが存在するか確認してから開く
  window.electronAPI.folderExists(settings.lastFolderPath).then(exists => {
    if (exists) {
      openFolder(settings.lastFolderPath);
    }
  });
}

// ツリーを読み込む
async function loadTree(folderPath) {
  const treeContainer = document.getElementById('treeContainer');
  treeContainer.innerHTML = '';

  const items = await window.electronAPI.readDirectory(folderPath);
  renderTree(items, treeContainer, 0);
}

// === 検索機能 ===
const searchInput = document.getElementById('searchInput');
const searchCount = document.getElementById('searchCount');
let searchTimeout = null;

searchInput.addEventListener('input', () => {
  // Debounce: 300ms待ってから検索
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => performSearch(), 300);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    searchInput.value = '';
    performSearch();
  }
});

async function performSearch() {
  const query = searchInput.value.trim();
  const treeContainer = document.getElementById('treeContainer');

  if (!query || !currentFolder) {
    // 検索クリア: 通常のツリー表示に戻す
    searchCount.textContent = '';
    await loadTree(currentFolder);
    return;
  }

  // スペースで分割してAND検索のキーワードに
  const keywords = query.split(/\s+/).filter(k => k.length > 0);
  if (keywords.length === 0) {
    searchCount.textContent = '';
    await loadTree(currentFolder);
    return;
  }

  // 検索実行
  searchCount.textContent = '...';
  const results = await window.electronAPI.searchFiles(currentFolder, keywords);

  // 結果を表示
  treeContainer.innerHTML = '';
  searchCount.textContent = `${results.length}`;

  for (const item of results) {
    const div = document.createElement('div');
    div.className = `tree-item ${item.isDirectory ? 'folder' : 'video'} search-result`;
    div.textContent = item.relativePath;
    div.dataset.path = item.path;
    div.title = item.path;

    if (item.isVideo) {
      div.addEventListener('click', () => loadVideo(item.path, item.name));
    } else if (item.isDirectory) {
      // フォルダクリックでそのフォルダに移動
      div.addEventListener('click', async () => {
        searchInput.value = '';
        searchCount.textContent = '';
        await openFolder(item.path);
      });
    }
    treeContainer.appendChild(div);
  }
}

// ツリーを描画
function renderTree(items, container, level) {
  for (const item of items) {
    const div = document.createElement('div');
    div.className = `tree-item ${item.isDirectory ? 'folder' : 'video'}`;
    div.style.paddingLeft = `${10 + level * 20}px`;
    div.textContent = item.name;
    div.dataset.path = item.path;
    div.dataset.isDirectory = item.isDirectory;

    if (item.isVideo) {
      div.addEventListener('click', () => loadVideo(item.path, item.name));
    } else if (item.isDirectory) {
      div.addEventListener('click', async () => {
        // 展開/折りたたみ
        const isExpanded = div.classList.contains('expanded');

        if (isExpanded) {
          div.classList.remove('expanded');
          const children = div.nextElementSibling;
          if (children && children.classList.contains('tree-children')) {
            children.remove();
          }
        } else {
          div.classList.add('expanded');
          const childItems = await window.electronAPI.readDirectory(item.path);
          const childContainer = document.createElement('div');
          childContainer.className = 'tree-children';
          renderTree(childItems, childContainer, level + 1);
          div.after(childContainer);
        }
      });
    }

    container.appendChild(div);
  }
}

// 動画を読み込む
function loadVideo(videoPath, videoName) {
  // 選択状態を更新
  document.querySelectorAll('.tree-item').forEach(el => el.classList.remove('selected'));
  document.querySelector(`[data-path="${CSS.escape(videoPath)}"]`)?.classList.add('selected');

  // Windowsパスをfile:// URLに変換（特殊文字をエンコード）
  // D:\Videos\動画 [test].mp4 → file:///D:/Videos/%E5%8B%95%E7%94%BB%20%5Btest%5D.mp4
  const normalizedPath = videoPath.replace(/\\/g, '/');
  const fileUrl = 'file:///' + normalizedPath.split('/').map(segment => encodeURIComponent(segment)).join('/');
  video.src = fileUrl;
  currentVideoPath = videoPath;

  // ヘッダーにファイル名を表示
  document.getElementById('currentFile').textContent = videoName;

  // 既存のVAMインスタンスを破棄
  if (vamInstance) {
    vamInstance.destroy();
    vamInstance = null;
  }
}

// ============================================
// AI Grid Configuration - V7.14 最適化設定
// ============================================
// Claude: 1568px閾値、Gemini: 3072px閾値（マージン込み3000px）
const AI_GRID_CONFIG_CLAUDE = {
  COLUMNS: 8,              // グリッド列数
  CELL_WIDTH: 196,         // セル幅（V7.14: 1568px÷8=196、リサイズ回避）
  CELL_HEIGHT: 110,        // セル高さ
  MAX_ROWS_PER_IMAGE: 14,  // 1枚あたり最大行数（1568÷110=14.2）
  MAX_CELLS_PER_IMAGE: 112,// 1枚あたり最大セル数（8×14=112）
  SECONDS_PER_CELL: 15,    // サンプリング間隔
  JPEG_QUALITY: 0.8,
  CROP_LEFT: 0.15,         // 左15%カット (V7.1復元)
  CROP_TOP: 0.05,          // 上5%カット
  CROP_WIDTH: 0.70,        // 横70%維持（左右15%ずつカット）
  CROP_HEIGHT: 0.90,       // 縦90%維持
  FONT_SIZE: 14            // タイムスタンプフォントサイズ
};

// v7.29: Gemini用設定（3000px上限、セルサイズ拡大でOCR精度向上）
const AI_GRID_CONFIG_GEMINI = {
  COLUMNS: 8,              // グリッド列数（Claude同様）
  CELL_WIDTH: 375,         // セル幅（3000px÷8=375）
  CELL_HEIGHT: 210,        // セル高さ
  MAX_ROWS_PER_IMAGE: 14,  // 1枚あたり最大行数（3000÷210=14.2）
  MAX_CELLS_PER_IMAGE: 112,// 1枚あたり最大セル数（8×14=112）
  SECONDS_PER_CELL: 15,    // サンプリング間隔
  JPEG_QUALITY: 0.8,
  CROP_LEFT: 0.15,         // 左15%カット (V7.1復元)
  CROP_TOP: 0.05,
  CROP_WIDTH: 0.70,        // 横70%維持（左右15%ずつカット）
  CROP_HEIGHT: 0.90,
  FONT_SIZE: 28            // タイムスタンプフォントサイズ（2倍）
};

// v7.29: 現在のプロバイダー（main.jsから設定される）
let currentAIProvider = 'claude';

// プロバイダーに応じた設定を取得
function getAIGridConfig() {
  if (currentAIProvider === 'gemini') {
    return AI_GRID_CONFIG_GEMINI;
  }
  return AI_GRID_CONFIG_CLAUDE;
}

// 後方互換性のためのエイリアス
const AI_GRID_CONFIG = AI_GRID_CONFIG_CLAUDE;
// ============================================

// AI用グリッド画像を生成（人間用グリッドとは独立）
// V7.14: 112セルを超える場合は複数画像に分割
// v7.29: プロバイダーに応じたグリッドサイズ（Claude: 1568px, Gemini: 3000px）
// V7.3: VAM-RGB Plugin System
async function captureGridForAI() {
  if (!video.duration || video.readyState < 2) return null;

  // V7.3: VAM-RGB Plugin System - Use plugin if available
  if (typeof GridProcessorPlugin !== 'undefined') {
    const config = getAIGridConfig();
    const processorConfig = {
      columns: config.COLUMNS,
      cellWidth: config.CELL_WIDTH,
      cellHeight: config.CELL_HEIGHT,
      maxCellsPerImage: config.MAX_CELLS_PER_IMAGE,
      secondsPerCell: config.SECONDS_PER_CELL,
      jpegQuality: config.JPEG_QUALITY,
      cropLeft: config.CROP_LEFT,
      cropTop: config.CROP_TOP,
      cropWidth: config.CROP_WIDTH,
      cropHeight: config.CROP_HEIGHT,
      fontSize: config.FONT_SIZE
    };
    const processor = GridProcessorPlugin.getProcessor(currentGridProcessor, video, processorConfig);
    console.log(`[GridCapture] Using plugin: ${processor.name}, provider: ${currentAIProvider}`);
    return await processor.generateGrid();
  }

  // Legacy fallback (if plugin not loaded)
  console.log('[GridCapture] Plugin not available, using legacy mode');

  // 元の再生位置を保存
  const originalTime = video.currentTime;
  const wasPlaying = !video.paused;
  if (wasPlaying) video.pause();

  // v7.29: プロバイダーに応じた設定を取得
  const config = getAIGridConfig();
  const AI_COLUMNS = config.COLUMNS;
  const CELL_WIDTH = config.CELL_WIDTH;
  const CELL_HEIGHT = config.CELL_HEIGHT;
  const MAX_CELLS = config.MAX_CELLS_PER_IMAGE;
  const FONT_SIZE = config.FONT_SIZE || 14;

  const duration = video.duration;
  const secondsPerCell = config.SECONDS_PER_CELL;
  const totalCells = Math.ceil(duration / secondsPerCell);
  console.log(`[GridCapture] provider=${currentAIProvider}, cellSize=${CELL_WIDTH}x${CELL_HEIGHT}, totalCells=${totalCells}`);

  // V7.14: 必要な画像枚数を計算
  const imageCount = Math.ceil(totalCells / MAX_CELLS);
  const gridImages = [];

  // フレームキャプチャ用Canvas（再利用）
  const frameCanvas = document.createElement('canvas');
  frameCanvas.width = CELL_WIDTH;
  frameCanvas.height = CELL_HEIGHT;
  const frameCtx = frameCanvas.getContext('2d');

  // 各画像を生成
  for (let imgIdx = 0; imgIdx < imageCount; imgIdx++) {
    const startCell = imgIdx * MAX_CELLS;
    const endCell = Math.min(startCell + MAX_CELLS, totalCells);
    const cellsInThisImage = endCell - startCell;
    const rowsInThisImage = Math.ceil(cellsInThisImage / AI_COLUMNS);

    const gridWidth = AI_COLUMNS * CELL_WIDTH;
    const gridHeight = rowsInThisImage * CELL_HEIGHT;

    // Canvas作成
    const gridCanvas = document.createElement('canvas');
    gridCanvas.width = gridWidth;
    gridCanvas.height = gridHeight;
    const ctx = gridCanvas.getContext('2d');

    // 背景
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, gridWidth, gridHeight);

    // 各セルにフレームを描画
    for (let cellIdx = startCell; cellIdx < endCell; cellIdx++) {
      const timestamp = cellIdx * secondsPerCell;
      if (timestamp >= duration) break;

      const localIdx = cellIdx - startCell;  // この画像内でのインデックス
      const col = localIdx % AI_COLUMNS;
      const row = Math.floor(localIdx / AI_COLUMNS);
      const x = col * CELL_WIDTH;
      const y = row * CELL_HEIGHT;

      // 現在のビデオフレームをキャプチャ
      video.currentTime = timestamp;
      await new Promise(resolve => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        };
        video.addEventListener('seeked', onSeeked);
      });

      // V7.14: フレームをトリミングして描画（中央70%×90%を抽出）
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const cropX = vw * config.CROP_LEFT;
      const cropY = vh * config.CROP_TOP;
      const cropW = vw * config.CROP_WIDTH;
      const cropH = vh * config.CROP_HEIGHT;
      frameCtx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, CELL_WIDTH, CELL_HEIGHT);
      ctx.drawImage(frameCanvas, x, y);

      // v7.15: タイムスタンプ視認性改善（黒文字に白縁、背景ボックス不要）
      // v7.29: フォントサイズをプロバイダー設定から取得
      const timeLabel = formatTime(timestamp);
      ctx.font = `bold ${FONT_SIZE}px sans-serif`;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.ceil(FONT_SIZE / 5);  // フォントサイズに応じた縁取り
      ctx.strokeText(timeLabel, x + 3, y + CELL_HEIGHT - 4);
      ctx.fillStyle = '#000';
      ctx.fillText(timeLabel, x + 3, y + CELL_HEIGHT - 4);
    }

    // V7.14: この画像をbase64として保存
    gridImages.push(gridCanvas.toDataURL('image/jpeg', config.JPEG_QUALITY).split(',')[1]);
  }

  // 元の再生位置に戻す
  video.currentTime = originalTime;
  if (wasPlaying) video.play();

  // v7.13: タイムスタンプリストを生成（AIプロンプト用）
  const timestamps = [];
  for (let i = 0; i < totalCells; i++) {
    const ts = i * secondsPerCell;
    if (ts < duration) timestamps.push(formatTime(ts));
  }

  // V7.14: 後方互換性のためbase64も維持（1枚目を参照）
  return {
    gridImages: gridImages,           // V7.14: 複数画像対応
    base64: gridImages[0] || null,    // V7.14: 後方互換性用（1枚目）
    columns: AI_COLUMNS,
    rows: Math.ceil(totalCells / AI_COLUMNS),
    secondsPerCell: secondsPerCell,
    totalCells: totalCells,
    imageCount: imageCount,           // V7.14: 画像枚数
    timestampList: timestamps         // v7.13: AIプロンプト用タイムスタンプリスト
  };
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// 動画メタデータ読み込み完了時にVAM Seekを初期化
video.addEventListener('loadedmetadata', () => {
  if (typeof VAMSeek !== 'undefined') {
    // Destroy existing instance before creating new one (v1.3.4 - fix video switch oscillation)
    if (vamInstance) {
      vamInstance.destroy();
      vamInstance = null;
    }
    const scrollValue = document.getElementById('scrollSelect').value;
    vamInstance = VAMSeek.init({
      video: video,
      container: gridContainer,
      columns: parseInt(document.getElementById('columnsSelect').value),
      secondsPerCell: parseInt(document.getElementById('secondsSelect').value),
      autoScroll: scrollValue !== 'off',
      scrollBehavior: scrollValue === 'off' ? 'center' : scrollValue,
      onSeek: (time, cell) => {
        console.log(`Seeked to ${time.toFixed(2)}s`);
      },
      onError: (err) => {
        console.error('VAMSeek error:', err);
      }
    });
  }
});

// グリッド設定変更
document.getElementById('columnsSelect').addEventListener('change', (e) => {
  const value = parseInt(e.target.value);
  settings.columns = value;
  saveSettings(settings);
  if (vamInstance) {
    vamInstance.configure({ columns: value });
  }
});

document.getElementById('secondsSelect').addEventListener('change', (e) => {
  const value = parseInt(e.target.value);
  settings.secondsPerCell = value;
  saveSettings(settings);
  if (vamInstance) {
    vamInstance.configure({ secondsPerCell: value });
  }
});

// スクロール設定変更
document.getElementById('scrollSelect').addEventListener('change', (e) => {
  const value = e.target.value;
  settings.scrollBehavior = value;
  saveSettings(settings);
  if (vamInstance) {
    // Use setScrollMode() to safely switch modes (cancels ongoing animations)
    vamInstance.setScrollMode(value);
  }
});

// === 動画アスペクト比コンテキストメニュー ===
const contextMenu = document.getElementById('videoContextMenu');

// 起動時のアスペクト比設定をメニューに反映
document.querySelectorAll('.context-menu-item').forEach(item => {
  item.classList.toggle('active', item.dataset.aspect === settings.aspectRatio);
});

video.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  contextMenu.style.left = e.clientX + 'px';
  contextMenu.style.top = e.clientY + 'px';
  contextMenu.classList.remove('hidden');
});

document.addEventListener('click', (e) => {
  if (!contextMenu.contains(e.target)) {
    contextMenu.classList.add('hidden');
  }
});

document.querySelectorAll('.context-menu-item').forEach(item => {
  item.addEventListener('click', () => {
    const aspect = item.dataset.aspect;
    video.style.objectFit = aspect;
    settings.aspectRatio = aspect;
    saveSettings(settings);

    // アクティブ状態を更新
    document.querySelectorAll('.context-menu-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');

    contextMenu.classList.add('hidden');
  });
});

// === AIチャットからのシーク処理 ===
window.electronAPI.onSeekToTimestamp((seconds) => {
  if (video.readyState >= 1) {
    video.currentTime = seconds;
    video.play();
  }
});

// === AI Grid設定変更リスナー ===
window.electronAPI.onGridConfigChanged((secondsPerCell) => {
  AI_GRID_CONFIG_CLAUDE.SECONDS_PER_CELL = secondsPerCell;
  AI_GRID_CONFIG_GEMINI.SECONDS_PER_CELL = secondsPerCell;
  console.log(`[GridConfig] Updated SECONDS_PER_CELL to ${secondsPerCell}`);
});

// v7.29: AIプロバイダー変更通知を受信
window.electronAPI.onAIProviderChanged((provider) => {
  currentAIProvider = provider;
  console.log(`[GridConfig] AI provider changed to: ${provider}`);
});

// 起動時にAI設定を読み込んでグリッド設定を反映
window.electronAPI.getAISettings().then(settings => {
  if (settings && settings.gridSecondsPerCell) {
    AI_GRID_CONFIG_CLAUDE.SECONDS_PER_CELL = settings.gridSecondsPerCell;
    AI_GRID_CONFIG_GEMINI.SECONDS_PER_CELL = settings.gridSecondsPerCell;
    console.log(`[GridConfig] Loaded SECONDS_PER_CELL: ${settings.gridSecondsPerCell}`);
  }
  // v7.29: プロバイダー設定も読み込み
  if (settings && settings.provider) {
    currentAIProvider = settings.provider;
    console.log(`[GridConfig] Loaded AI provider: ${settings.provider}`);
  }
});

// === グリッドキャプチャリクエスト処理 ===
window.electronAPI.onGridCaptureRequest(async () => {
  // 動画がロードされるまで待つ（最大3秒）
  let attempts = 0;
  while ((!video.duration || video.readyState < 2) && attempts < 30) {
    await new Promise(r => setTimeout(r, 100));
    attempts++;
  }

  if (!video.duration || video.readyState < 2) {
    console.error('[GridCapture] Video not ready after waiting');
    window.electronAPI.sendGridCaptureResponse(null);
    return;
  }

  // AI専用グリッド画像を生成（人間用UIグリッドとは独立）
  const aiGrid = await captureGridForAI();
  if (!aiGrid) {
    window.electronAPI.sendGridCaptureResponse(null);
    return;
  }

  const gridData = {
    duration: video.duration,
    columns: aiGrid.columns,
    secondsPerCell: aiGrid.secondsPerCell,
    totalCells: aiGrid.totalCells,
    rows: aiGrid.rows,
    videoName: document.getElementById('currentFile').textContent,
    videoPath: currentVideoPath,          // v7.19: Whisper用の動画パス
    gridImages: aiGrid.gridImages,        // V7.14: 複数画像対応
    gridImage: aiGrid.base64,             // V7.14: 後方互換性用
    imageCount: aiGrid.imageCount,        // V7.14: 画像枚数
    timestampList: aiGrid.timestampList,  // v7.13: AIプロンプト用
    processorName: aiGrid.processorName   // v7.30: VAM-RGB plugin support
  };

  window.electronAPI.sendGridCaptureResponse(gridData);
});

// === 軽量な動画情報リクエスト（グリッド画像なし） ===
window.electronAPI.onVideoInfoRequest(() => {
  if (!video.duration || video.readyState < 1) {
    window.electronAPI.sendVideoInfoResponse(null);
    return;
  }

  window.electronAPI.sendVideoInfoResponse({
    videoName: document.getElementById('currentFile').textContent,
    duration: video.duration,
    videoPath: currentVideoPath  // v7.24: Gemini用の動画パス
  });
});

// === ズームグリッド生成（特定時間範囲の高解像度グリッド） ===
async function captureZoomGridForAI(startTime, endTime) {
  if (!video.duration || video.readyState < 2) return null;
  if (startTime < 0 || endTime > video.duration || startTime >= endTime) return null;

  // 元の再生位置を保存
  const originalTime = video.currentTime;
  const wasPlaying = !video.paused;
  if (wasPlaying) video.pause();

  // v7.15: ズームグリッド設定（コンパクト化でAPI料金抑制）
  // 初回スキャンで大まかに把握済み→ズームは確認用なので小さめでOK
  const ZOOM_COLUMNS = 8;
  const ZOOM_MAX_CELLS = 32;   // v7.15: 48→32に削減
  const CELL_WIDTH = 160;      // v7.15: 196→160に縮小
  const CELL_HEIGHT = 90;      // v7.15: 110→90に縮小（16:9維持）
  const CELL_GAP = 2;          // v7.30: 2px black line between cells
  const FONT_SIZE = 16;        // v7.30: 1.3x larger (was 12)

  const zoomDuration = endTime - startTime;

  // ズーム範囲に応じて秒/セルを決定（より細かく）
  let secondsPerCell;
  if (zoomDuration <= 30) {
    secondsPerCell = 1;   // 30秒以下：1秒/セル
  } else if (zoomDuration <= 60) {
    secondsPerCell = 2;   // 1分以下：2秒/セル
  } else if (zoomDuration <= 180) {
    secondsPerCell = 5;   // 3分以下：5秒/セル
  } else if (zoomDuration <= 600) {
    secondsPerCell = 10;  // 10分以下：10秒/セル
  } else {
    secondsPerCell = 15;  // それ以上：15秒/セル
  }

  let totalCells = Math.ceil(zoomDuration / secondsPerCell);
  if (totalCells > ZOOM_MAX_CELLS) {
    totalCells = ZOOM_MAX_CELLS;
    // v7.12: 浮動小数点を排除 - 整数秒に切り上げてタイムスタンプのズレを防ぐ
    secondsPerCell = Math.ceil(zoomDuration / ZOOM_MAX_CELLS);
  }

  const rows = Math.ceil(totalCells / ZOOM_COLUMNS);
  // v7.30: Include gap in grid size
  const gridWidth = ZOOM_COLUMNS * CELL_WIDTH + (ZOOM_COLUMNS - 1) * CELL_GAP;
  const gridHeight = rows * CELL_HEIGHT + (rows - 1) * CELL_GAP;

  // Canvas作成
  const gridCanvas = document.createElement('canvas');
  gridCanvas.width = gridWidth;
  gridCanvas.height = gridHeight;
  const ctx = gridCanvas.getContext('2d');

  // 背景
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, gridWidth, gridHeight);

  // フレームキャプチャ用Canvas
  const frameCanvas = document.createElement('canvas');
  frameCanvas.width = CELL_WIDTH;
  frameCanvas.height = CELL_HEIGHT;
  const frameCtx = frameCanvas.getContext('2d');

  // 各セルにフレームを描画
  for (let i = 0; i < totalCells; i++) {
    const timestamp = startTime + (i * secondsPerCell);
    if (timestamp >= endTime) break;

    const col = i % ZOOM_COLUMNS;
    const row = Math.floor(i / ZOOM_COLUMNS);
    // v7.30: Account for gap in position
    const x = col * (CELL_WIDTH + CELL_GAP);
    const y = row * (CELL_HEIGHT + CELL_GAP);

    // ビデオをシーク
    video.currentTime = timestamp;
    await new Promise(resolve => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      };
      video.addEventListener('seeked', onSeeked);
    });

    // V7.14: フレームをトリミングして描画（中央70%×90%を抽出）
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cropX = vw * AI_GRID_CONFIG.CROP_LEFT;
    const cropY = vh * AI_GRID_CONFIG.CROP_TOP;
    const cropW = vw * AI_GRID_CONFIG.CROP_WIDTH;
    const cropH = vh * AI_GRID_CONFIG.CROP_HEIGHT;
    frameCtx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, CELL_WIDTH, CELL_HEIGHT);
    ctx.drawImage(frameCanvas, x, y);

    // v7.30: タイムスタンプ視認性改善（1.3x larger font）
    const timeLabel = formatTime(timestamp);
    ctx.font = `bold ${FONT_SIZE}px sans-serif`;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.ceil(FONT_SIZE / 5);
    ctx.strokeText(timeLabel, x + 2, y + CELL_HEIGHT - 3);
    ctx.fillStyle = '#000';
    ctx.fillText(timeLabel, x + 2, y + CELL_HEIGHT - 3);
  }

  // 元の再生位置に戻す
  video.currentTime = originalTime;
  if (wasPlaying) video.play();

  // v7.13: タイムスタンプリストを生成（AIプロンプト用）
  const timestamps = [];
  for (let i = 0; i < totalCells; i++) {
    const ts = startTime + (i * secondsPerCell);
    if (ts < endTime) timestamps.push(formatTime(ts));
  }

  return {
    base64: gridCanvas.toDataURL('image/jpeg', AI_GRID_CONFIG.JPEG_QUALITY).split(',')[1],
    columns: ZOOM_COLUMNS,
    rows: rows,
    secondsPerCell: secondsPerCell,
    totalCells: totalCells,
    startTime: startTime,
    endTime: endTime,
    timestampList: timestamps  // v7.13: AIプロンプト用タイムスタンプリスト
  };
}

// === ズームグリッドキャプチャリクエスト処理 ===
window.electronAPI.onZoomGridCaptureRequest(async (startTime, endTime) => {
  if (!video.duration || video.readyState < 2) {
    window.electronAPI.sendZoomGridCaptureResponse(null);
    return;
  }

  const zoomGrid = await captureZoomGridForAI(startTime, endTime);
  if (!zoomGrid) {
    window.electronAPI.sendZoomGridCaptureResponse(null);
    return;
  }

  const gridData = {
    duration: video.duration,
    columns: zoomGrid.columns,
    secondsPerCell: zoomGrid.secondsPerCell,
    totalCells: zoomGrid.totalCells,
    rows: zoomGrid.rows,
    videoName: document.getElementById('currentFile').textContent,
    gridImage: zoomGrid.base64,
    isZoom: true,
    zoomRange: {
      start: zoomGrid.startTime,
      end: zoomGrid.endTime
    },
    timestampList: zoomGrid.timestampList  // v7.13: AIプロンプト用
  };

  window.electronAPI.sendZoomGridCaptureResponse(gridData);
});

// === v7.26: 高解像度ズームグリッド生成（タイムスタンプ自動詰め寄り用） ===
// 1秒間隔、384px以上のセルで「言い訳できない」精度を実現
async function captureHiResZoomGrid(centerTime, range = 5) {
  if (!video.duration || video.readyState < 2) return null;

  const startTime = Math.max(0, centerTime - range);
  const endTime = Math.min(video.duration, centerTime + range);
  const zoomDuration = endTime - startTime;

  if (zoomDuration <= 0) return null;

  // 元の再生位置を保存
  const originalTime = video.currentTime;
  const wasPlaying = !video.paused;
  if (wasPlaying) video.pause();

  // 高解像度設定: 384px以上、1秒間隔
  const HIRES_CELL_WIDTH = 384;
  const HIRES_CELL_HEIGHT = 216;  // 16:9
  const HIRES_COLUMNS = 5;        // 横5セル
  const HIRES_CELL_GAP = 2;       // v7.30: 2px black line between cells
  const HIRES_FONT_SIZE = 21;     // v7.30: 1.3x larger (was 16)
  const SECONDS_PER_CELL = 1;     // 1秒間隔

  const totalCells = Math.ceil(zoomDuration / SECONDS_PER_CELL);
  const rows = Math.ceil(totalCells / HIRES_COLUMNS);
  // v7.30: Include gap in grid size
  const gridWidth = HIRES_COLUMNS * HIRES_CELL_WIDTH + (HIRES_COLUMNS - 1) * HIRES_CELL_GAP;
  const gridHeight = rows * HIRES_CELL_HEIGHT + (rows - 1) * HIRES_CELL_GAP;

  // Canvas作成
  const gridCanvas = document.createElement('canvas');
  gridCanvas.width = gridWidth;
  gridCanvas.height = gridHeight;
  const ctx = gridCanvas.getContext('2d');

  // 背景
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, gridWidth, gridHeight);

  // フレームキャプチャ用Canvas
  const frameCanvas = document.createElement('canvas');
  frameCanvas.width = HIRES_CELL_WIDTH;
  frameCanvas.height = HIRES_CELL_HEIGHT;
  const frameCtx = frameCanvas.getContext('2d');

  // 各セルにフレームを描画
  const timestamps = [];
  for (let i = 0; i < totalCells; i++) {
    const timestamp = startTime + (i * SECONDS_PER_CELL);
    if (timestamp >= endTime) break;

    timestamps.push(formatTime(timestamp));

    const col = i % HIRES_COLUMNS;
    const row = Math.floor(i / HIRES_COLUMNS);
    // v7.30: Account for gap in position
    const x = col * (HIRES_CELL_WIDTH + HIRES_CELL_GAP);
    const y = row * (HIRES_CELL_HEIGHT + HIRES_CELL_GAP);

    // ビデオをシーク
    video.currentTime = timestamp;
    await new Promise(resolve => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      };
      video.addEventListener('seeked', onSeeked);
    });

    // フレームをクロップして描画（中央70%×90%）
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cropX = vw * AI_GRID_CONFIG.CROP_LEFT;
    const cropY = vh * AI_GRID_CONFIG.CROP_TOP;
    const cropW = vw * AI_GRID_CONFIG.CROP_WIDTH;
    const cropH = vh * AI_GRID_CONFIG.CROP_HEIGHT;
    frameCtx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, HIRES_CELL_WIDTH, HIRES_CELL_HEIGHT);
    ctx.drawImage(frameCanvas, x, y);

    // タイムスタンプ（v7.30: 1.3x larger font）
    const timeLabel = formatTime(timestamp);
    ctx.font = `bold ${HIRES_FONT_SIZE}px sans-serif`;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.ceil(HIRES_FONT_SIZE / 5);
    ctx.strokeText(timeLabel, x + 4, y + HIRES_CELL_HEIGHT - 6);
    ctx.fillStyle = '#000';
    ctx.fillText(timeLabel, x + 4, y + HIRES_CELL_HEIGHT - 6);
  }

  // 元の再生位置に戻す
  video.currentTime = originalTime;
  if (wasPlaying) video.play();

  return {
    base64: gridCanvas.toDataURL('image/jpeg', 0.90).split(',')[1],  // 高品質JPEG
    columns: HIRES_COLUMNS,
    rows: rows,
    secondsPerCell: SECONDS_PER_CELL,
    totalCells: totalCells,
    startTime: startTime,
    endTime: endTime,
    centerTime: centerTime,
    timestampList: timestamps,
    cellWidth: HIRES_CELL_WIDTH,
    cellHeight: HIRES_CELL_HEIGHT
  };
}

// v7.42: Process hi-res zoom queue sequentially (prevent race conditions)
async function processHiresZoomQueue() {
  if (hiresZoomProcessing || hiresZoomQueue.length === 0) return;

  hiresZoomProcessing = true;
  const { timestamp, range } = hiresZoomQueue.shift();

  console.log(`[HiRes] Processing zoom request: ${timestamp}s (queue: ${hiresZoomQueue.length} remaining)`);

  try {
    if (!video.duration || video.readyState < 2) {
      window.electronAPI.sendHiResZoomResponse(null);
      return;
    }

    const hiresGrid = await captureHiResZoomGrid(timestamp, range);
    if (!hiresGrid) {
      window.electronAPI.sendHiResZoomResponse(null);
      return;
    }

    const gridData = {
      duration: video.duration,
      columns: hiresGrid.columns,
      secondsPerCell: hiresGrid.secondsPerCell,
      totalCells: hiresGrid.totalCells,
      rows: hiresGrid.rows,
      videoName: document.getElementById('currentFile').textContent,
      gridImage: hiresGrid.base64,
      isHiResZoom: true,
      centerTime: hiresGrid.centerTime,
      zoomRange: {
        start: hiresGrid.startTime,
        end: hiresGrid.endTime
      },
      timestampList: hiresGrid.timestampList,
      cellWidth: hiresGrid.cellWidth,
      cellHeight: hiresGrid.cellHeight
    };

    window.electronAPI.sendHiResZoomResponse(gridData);
  } finally {
    hiresZoomProcessing = false;
    // Process next item in queue
    if (hiresZoomQueue.length > 0) {
      processHiresZoomQueue();
    }
  }
}

// 高解像度ズームリクエストハンドラ
window.electronAPI.onHiResZoomRequest((timestamp, range) => {
  // v7.42: Queue requests instead of processing immediately
  hiresZoomQueue.push({ timestamp, range });
  console.log(`[HiRes] Queued zoom request: ${timestamp}s (queue size: ${hiresZoomQueue.length})`);
  processHiresZoomQueue();
});
