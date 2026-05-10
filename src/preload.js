const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sqliteGui', {
  chooseDatabaseFile: () => ipcRenderer.invoke('db:choose-file'),
  getCurrentDatabaseFile: () => ipcRenderer.invoke('db:current'),
  reloadDatabaseFile: () => ipcRenderer.invoke('db:reload-file'),
  getTables: () => ipcRenderer.invoke('db:tables'),
  getTableColumns: (tableName) => ipcRenderer.invoke('db:table-columns', tableName),
  addColumn: (payload) => ipcRenderer.invoke('db:add-column', payload),
  renameColumn: (payload) => ipcRenderer.invoke('db:rename-column', payload),
  dropColumn: (payload) => ipcRenderer.invoke('db:drop-column', payload),
  getTablePreview: (tableName) => ipcRenderer.invoke('db:table-preview', tableName),
  updateCell: (payload) => ipcRenderer.invoke('db:update-cell', payload),
  insertRow: (payload) => ipcRenderer.invoke('db:insert-row', payload),
  runQuery: (sql) => ipcRenderer.invoke('db:query', sql),
  generateSql: (payload) => ipcRenderer.invoke('ai:generate-sql', payload)
});
