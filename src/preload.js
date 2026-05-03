const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Config operations
  readConfig: () => ipcRenderer.invoke('read-config'),
  writeConfig: (toml) => ipcRenderer.invoke('write-config', toml),
  patchConfig: (updates) => ipcRenderer.invoke('patch-config', updates),

  // Auth operations
  writeAuth: (auth) => ipcRenderer.invoke('write-auth', auth),

  // API operations
  fetchModels: (key) => ipcRenderer.invoke('fetch-models', key),
  fetchModelsList: () => ipcRenderer.invoke('fetch-models-list'),

  // Launch Codex
  launchCodex: () => ipcRenderer.invoke('launch-codex'),

  // Window controls
  minimize: () => ipcRenderer.send('win-minimize'),
  maximize: () => ipcRenderer.send('win-maximize'),
  close: () => ipcRenderer.send('win-close'),
});
