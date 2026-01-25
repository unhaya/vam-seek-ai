const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  readDirectory: (path) => ipcRenderer.invoke('read-directory', path),
  folderExists: (path) => ipcRenderer.invoke('folder-exists', path),
  searchFiles: (rootPath, keywords) => ipcRenderer.invoke('search-files', rootPath, keywords),
  // AI Chat
  sendChatMessage: (message) => ipcRenderer.invoke('send-chat-message', message),
  sendZoomChatMessage: (message, startTime, endTime) => ipcRenderer.invoke('send-zoom-chat-message', message, startTime, endTime),
  // v7.23: Refine timestamps using zoom scans
  refineTimestamps: () => ipcRenderer.invoke('refine-timestamps'),
  // Grid data for AI
  getGridData: () => ipcRenderer.invoke('get-grid-data'),
  updateGridData: (data) => ipcRenderer.send('update-grid-data', data),
  // Request fresh grid capture from main window
  requestGridCapture: () => ipcRenderer.invoke('request-grid-capture'),
  requestZoomGridCapture: (startTime, endTime) => ipcRenderer.invoke('request-zoom-grid-capture', startTime, endTime),
  // AI Settings
  getAISettings: () => ipcRenderer.invoke('get-ai-settings'),
  saveAISettings: (settings) => ipcRenderer.invoke('save-ai-settings', settings),
  // AI Phase management
  setAIPhase: (phase) => ipcRenderer.invoke('set-ai-phase', phase),
  getAIPhase: () => ipcRenderer.invoke('get-ai-phase'),
  // Auto-zoom counter
  incrementZoomCount: () => ipcRenderer.invoke('increment-zoom-count'),
  // Seek video to timestamp (from chat window)
  seekToTimestamp: (seconds) => ipcRenderer.send('seek-to-timestamp', seconds),
  // Listen for folder selection from menu
  onFolderSelected: (callback) => ipcRenderer.on('folder-selected', (_event, path) => callback(path)),
  // Listen for seek command from chat window
  onSeekToTimestamp: (callback) => ipcRenderer.on('seek-to-timestamp', (_event, seconds) => callback(seconds)),
  // Listen for grid capture request
  onGridCaptureRequest: (callback) => ipcRenderer.on('grid-capture-request', () => callback()),
  // Send grid capture response
  sendGridCaptureResponse: (data) => ipcRenderer.send('grid-capture-response', data),
  // Video info (lightweight - no grid image)
  onVideoInfoRequest: (callback) => ipcRenderer.on('video-info-request', () => callback()),
  sendVideoInfoResponse: (data) => ipcRenderer.send('video-info-response', data),
  // Zoom grid capture
  onZoomGridCaptureRequest: (callback) => ipcRenderer.on('zoom-grid-capture-request', (_event, startTime, endTime) => callback(startTime, endTime)),
  sendZoomGridCaptureResponse: (data) => ipcRenderer.send('zoom-grid-capture-response', data),
  // v7.26: High-resolution zoom grid capture (for auto-interrogate)
  onHiResZoomRequest: (callback) => ipcRenderer.on('hires-zoom-request', (_event, timestamp, range) => callback(timestamp, range)),
  sendHiResZoomResponse: (data) => ipcRenderer.send('hires-zoom-response', data),
  // Grid config changes from settings
  onGridConfigChanged: (callback) => ipcRenderer.on('grid-config-changed', (_event, secondsPerCell) => callback(secondsPerCell)),
  // v7.22: Self-update API
  triggerSelfUpdate: (errorContext) => ipcRenderer.invoke('trigger-self-update', errorContext),
  getLearnedRules: () => ipcRenderer.invoke('get-learned-rules'),
  isSelfUpdateEnabled: () => ipcRenderer.invoke('is-self-update-enabled'),
  // v7.24: Gemini progress updates
  onGeminiProgress: (callback) => ipcRenderer.on('gemini-progress', (_event, progress) => callback(progress)),
  // v7.25: Audio analysis (full transcription with Gemini)
  analyzeAudio: (options) => ipcRenderer.invoke('analyze-audio', options),
  // v7.29: AI provider notification (for grid size adjustment)
  onAIProviderChanged: (callback) => ipcRenderer.on('ai-provider-changed', (_event, provider) => callback(provider))
});
