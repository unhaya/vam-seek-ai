const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  readDirectory: (path) => ipcRenderer.invoke('read-directory', path),
  folderExists: (path) => ipcRenderer.invoke('folder-exists', path),
  // AI Chat
  sendChatMessage: (message) => ipcRenderer.invoke('send-chat-message', message),
  // Grid data for AI
  getGridData: () => ipcRenderer.invoke('get-grid-data'),
  updateGridData: (data) => ipcRenderer.send('update-grid-data', data),
  // Request fresh grid capture from main window
  requestGridCapture: () => ipcRenderer.invoke('request-grid-capture'),
  // AI Settings
  getAISettings: () => ipcRenderer.invoke('get-ai-settings'),
  saveAISettings: (settings) => ipcRenderer.invoke('save-ai-settings', settings),
  // Seek video to timestamp (from chat window)
  seekToTimestamp: (seconds) => ipcRenderer.send('seek-to-timestamp', seconds),
  // Listen for folder selection from menu
  onFolderSelected: (callback) => ipcRenderer.on('folder-selected', (_event, path) => callback(path)),
  // Listen for seek command from chat window
  onSeekToTimestamp: (callback) => ipcRenderer.on('seek-to-timestamp', (_event, seconds) => callback(seconds)),
  // Listen for grid capture request
  onGridCaptureRequest: (callback) => ipcRenderer.on('grid-capture-request', () => callback()),
  // Send grid capture response
  sendGridCaptureResponse: (data) => ipcRenderer.send('grid-capture-response', data)
});
