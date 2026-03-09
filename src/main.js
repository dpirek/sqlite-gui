const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('node:fs');
const path = require('path');

let DatabaseSync = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (_error) {
  DatabaseSync = null;
}

let mainWindow;
let activeDb = null;
let activeDbPath = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function closeActiveDb() {
  if (activeDb) {
    activeDb.close();
    activeDb = null;
    activeDbPath = null;
  }
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function ensureDbReady() {
  if (!activeDb) {
    return { error: 'No database selected.' };
  }

  return null;
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  closeActiveDb();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('db:choose-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'SQLite Databases', extensions: ['db', 'sqlite', 'sqlite3'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  const filePath = result.filePaths[0];

  try {
    if (!DatabaseSync) {
      return {
        canceled: false,
        error:
          "This runtime does not expose Node's built-in 'node:sqlite' module. Use a Node/Electron version that supports it."
      };
    }

    if (!fs.existsSync(filePath)) {
      return { canceled: false, error: 'Selected file does not exist.' };
    }

    closeActiveDb();
    activeDb = new DatabaseSync(filePath, { readOnly: false });
    activeDbPath = filePath;
    return { canceled: false, filePath };
  } catch (error) {
    return { canceled: false, error: error.message };
  }
});

ipcMain.handle('db:tables', async () => {
  const dbError = ensureDbReady();
  if (dbError) {
    return dbError;
  }

  try {
    const rows = activeDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all();
    return { tables: rows.map((row) => row.name), dbPath: activeDbPath };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('db:table-preview', async (_event, tableName) => {
  const dbError = ensureDbReady();
  if (dbError) {
    return dbError;
  }

  if (!tableName || typeof tableName !== 'string') {
    return { error: 'Invalid table name.' };
  }

  try {
    const tableExists = activeDb
      .prepare("SELECT 1 AS existsFlag FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1")
      .get(tableName);

    if (!tableExists) {
      return { error: `Table '${tableName}' not found.` };
    }

    const sql = `SELECT rowid AS "__rowid__", * FROM ${quoteIdentifier(tableName)} LIMIT 100`;
    const statement = activeDb.prepare(sql);
    const rows = statement.all();
    const columns = statement.columns().map((column) => column.name);

    return {
      mode: 'rows',
      tableName,
      rowIdColumn: '__rowid__',
      editable: true,
      columns,
      rows,
      rowCount: rows.length
    };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('db:update-cell', async (_event, payload) => {
  const dbError = ensureDbReady();
  if (dbError) {
    return dbError;
  }

  const tableName = payload?.tableName;
  const columnName = payload?.columnName;
  const value = payload?.value;
  const rowId = Number(payload?.rowId);

  if (!tableName || typeof tableName !== 'string') {
    return { error: 'Invalid table name.' };
  }

  if (!columnName || typeof columnName !== 'string' || columnName === '__rowid__') {
    return { error: 'Invalid column for edit.' };
  }

  if (!Number.isFinite(rowId)) {
    return { error: 'Invalid row identifier.' };
  }

  try {
    const sql = `UPDATE ${quoteIdentifier(tableName)} SET ${quoteIdentifier(columnName)} = ? WHERE rowid = ?`;
    const result = activeDb.prepare(sql).run(value, rowId);

    if (!result || result.changes === 0) {
      return { error: 'No row was updated. The row may no longer exist.' };
    }

    return { ok: true, changes: result.changes };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('db:query', async (_event, sql) => {
  const dbError = ensureDbReady();
  if (dbError) {
    return dbError;
  }

  if (!sql || !sql.trim()) {
    return { error: 'SQL query is empty.' };
  }

  const trimmed = sql.trim();

  try {
    if (/^select|^pragma|^with/i.test(trimmed)) {
      const statement = activeDb.prepare(trimmed);
      const rows = statement.all();
      const columns = rows.length > 0 ? Object.keys(rows[0]) : statement.columns().map((column) => column.name);
      return {
        mode: 'rows',
        editable: false,
        columns,
        rows,
        rowCount: rows.length
      };
    }

    const result = activeDb.prepare(trimmed).run();
    return {
      mode: 'run',
      changes: result.changes,
      lastInsertRowid: Number(result.lastInsertRowid ?? 0)
    };
  } catch (error) {
    return { error: error.message };
  }
});
