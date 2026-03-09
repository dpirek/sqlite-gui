const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sqliteGui', {
  chooseDatabaseFile: () => ipcRenderer.invoke('db:choose-file'),
  getTables: () => ipcRenderer.invoke('db:tables'),
  getTablePreview: (tableName) => ipcRenderer.invoke('db:table-preview', tableName),
  updateCell: (payload) => ipcRenderer.invoke('db:update-cell', payload),
  runQuery: (sql) => ipcRenderer.invoke('db:query', sql)
});
