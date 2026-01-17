const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  readDirectory: (path) => ipcRenderer.invoke('read-directory', path),
  folderExists: (path) => ipcRenderer.invoke('folder-exists', path)
});
