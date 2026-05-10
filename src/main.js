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
let startupDbError = null;

const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_OPENAI_MODEL = 'gpt-5';
const SETTINGS_FILE_NAME = 'settings.json';

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

function openDatabaseFile(filePath) {
  if (!DatabaseSync) {
    return {
      error:
        "This runtime does not expose Node's built-in 'node:sqlite' module. Use a Node/Electron version that supports it."
    };
  }

  if (!fs.existsSync(filePath)) {
    return { error: 'Selected file does not exist.' };
  }

  const nextDb = new DatabaseSync(filePath, { readOnly: false });
  closeActiveDb();
  activeDb = nextDb;
  activeDbPath = filePath;

  return { filePath };
}

function getSettingsPath() {
  return path.join(app.getPath('userData'), SETTINGS_FILE_NAME);
}

function readSettings() {
  try {
    const settingsPath = getSettingsPath();

    if (!fs.existsSync(settingsPath)) {
      return {};
    }

    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (_error) {
    return {};
  }
}

function writeSettings(settings) {
  const settingsPath = getSettingsPath();
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

function persistSelectedDatabaseFile(filePath) {
  writeSettings({
    ...readSettings(),
    selectedDatabaseFile: filePath
  });
}

function restoreSelectedDatabaseFile() {
  const filePath = readSettings().selectedDatabaseFile;

  if (!filePath) {
    return;
  }

  if (!fs.existsSync(filePath)) {
    startupDbError = `Previously selected database was not found: ${filePath}`;
    persistSelectedDatabaseFile(null);
    return;
  }

  const result = openDatabaseFile(filePath);
  if (result.error) {
    startupDbError = result.error;
  }
}

function parseEnvFile(content) {
  const values = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

function loadEnv() {
  const envPaths = [path.join(process.cwd(), '.env'), path.join(app.getAppPath(), '.env')];
  let envValues = {};

  for (const envPath of envPaths) {
    try {
      if (fs.existsSync(envPath)) {
        envValues = { ...envValues, ...parseEnvFile(fs.readFileSync(envPath, 'utf8')) };
      }
    } catch (_error) {
      // Ignore unreadable .env files and fall back to process.env.
    }
  }

  return { ...envValues, ...process.env };
}

function getOpenAIConfig() {
  const env = loadEnv();
  return {
    apiKey: env.OPENAI_API_KEY || env.OPENAPI_API_KEY || '',
    model: env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL
  };
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

function validateIdentifierValue(value, label) {
  if (!value || typeof value !== 'string' || !value.trim()) {
    return `${label} is required.`;
  }

  return null;
}

function getTableColumns(tableName) {
  return activeDb.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all();
}

function ensureTableExists(tableName) {
  const identifierError = validateIdentifierValue(tableName, 'Table name');
  if (identifierError) {
    return { error: identifierError };
  }

  const tableExists = activeDb
    .prepare("SELECT 1 AS existsFlag FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1")
    .get(tableName);

  if (!tableExists) {
    return { error: `Table '${tableName}' not found.` };
  }

  return null;
}

function ensureColumnExists(tableName, columnName) {
  const identifierError = validateIdentifierValue(columnName, 'Column name');
  if (identifierError) {
    return { error: identifierError };
  }

  const exists = getTableColumns(tableName).some((column) => column.name === columnName);
  if (!exists) {
    return { error: `Column '${columnName}' not found.` };
  }

  return null;
}

function getDatabaseSchemaContext() {
  const dbError = ensureDbReady();
  if (dbError) {
    return dbError;
  }

  try {
    const objects = activeDb
      .prepare(
        "SELECT type, name, tbl_name AS tableName, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type, name"
      )
      .all();
    const tables = objects.filter((object) => object.type === 'table');
    const lines = [`Database file: ${activeDbPath}`, '', 'Tables:'];

    for (const table of tables) {
      lines.push(`- ${table.name}`);

      const columns = activeDb.prepare(`PRAGMA table_info(${quoteIdentifier(table.name)})`).all();
      for (const column of columns) {
        const parts = [
          `  - ${column.name}`,
          column.type || 'ANY',
          column.pk ? 'PRIMARY KEY' : '',
          column.notnull ? 'NOT NULL' : '',
          column.dflt_value !== null && column.dflt_value !== undefined ? `DEFAULT ${column.dflt_value}` : ''
        ].filter(Boolean);
        lines.push(parts.join(' '));
      }

      const foreignKeys = activeDb.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(table.name)})`).all();
      for (const foreignKey of foreignKeys) {
        lines.push(`  - FOREIGN KEY ${foreignKey.from} REFERENCES ${foreignKey.table}(${foreignKey.to})`);
      }
    }

    lines.push('', 'DDL:');
    for (const object of objects) {
      lines.push(`-- ${object.type}: ${object.name}`);
      lines.push(`${object.sql};`);
    }

    const schema = lines.join('\n');
    const maxSchemaLength = 30000;

    if (schema.length > maxSchemaLength) {
      return {
        schema: `${schema.slice(0, maxSchemaLength)}\n\n-- Schema truncated at ${maxSchemaLength} characters.`
      };
    }

    return { schema };
  } catch (error) {
    return { error: error.message };
  }
}

function extractResponseText(responseBody) {
  if (typeof responseBody.output_text === 'string') {
    return responseBody.output_text;
  }

  const chunks = [];

  for (const outputItem of responseBody.output || []) {
    for (const contentItem of outputItem.content || []) {
      if (typeof contentItem.text === 'string') {
        chunks.push(contentItem.text);
      }
    }
  }

  return chunks.join('\n').trim();
}

function buildSqlAssistantPrompt(question, schema, history = []) {
  const historyText = history
    .slice(-8)
    .map((message) => `${message.role}: ${message.content}`)
    .join('\n\n');

  return [
    'You are a SQLite query assistant inside a local SQLite GUI.',
    'Use only the database schema provided below. Do not invent table or column names.',
    'Generate SQLite-compatible SQL for the user request.',
    'Prefer SELECT queries unless the user explicitly asks to modify data.',
    'Return a short explanation followed by a fenced sql code block with the best query.',
    historyText ? ['', 'Recent chat:', historyText].join('\n') : '',
    '',
    'Schema:',
    schema,
    '',
    'User request:',
    question
  ].join('\n');
}

app.whenReady().then(() => {
  restoreSelectedDatabaseFile();
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
    const result = openDatabaseFile(filePath);
    if (!result.error) {
      persistSelectedDatabaseFile(filePath);
      startupDbError = null;
    }
    return { canceled: false, ...result };
  } catch (error) {
    return { canceled: false, error: error.message };
  }
});

ipcMain.handle('db:current', async () => ({
  filePath: activeDbPath,
  error: startupDbError
}));

ipcMain.handle('db:reload-file', async () => {
  if (!activeDbPath) {
    return { error: 'No database selected.' };
  }

  const filePath = activeDbPath;

  try {
    return openDatabaseFile(filePath);
  } catch (error) {
    return { error: error.message };
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

ipcMain.handle('db:table-columns', async (_event, tableName) => {
  const dbError = ensureDbReady();
  if (dbError) {
    return dbError;
  }

  const tableError = ensureTableExists(tableName);
  if (tableError) {
    return tableError;
  }

  try {
    return {
      tableName,
      columns: getTableColumns(tableName).map((column) => ({
        name: column.name,
        type: column.type || '',
        notnull: Boolean(column.notnull),
        defaultValue: column.dflt_value,
        primaryKey: Boolean(column.pk)
      }))
    };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('db:add-column', async (_event, payload) => {
  const dbError = ensureDbReady();
  if (dbError) {
    return dbError;
  }

  const tableName = payload?.tableName;
  const columnName = String(payload?.columnName || '').trim();
  const columnType = String(payload?.columnType || 'TEXT').trim().toUpperCase();
  const allowedTypes = new Set(['TEXT', 'INTEGER', 'REAL', 'NUMERIC', 'BLOB']);

  const tableError = ensureTableExists(tableName);
  if (tableError) {
    return tableError;
  }

  const columnNameError = validateIdentifierValue(columnName, 'Column name');
  if (columnNameError) {
    return { error: columnNameError };
  }

  if (!allowedTypes.has(columnType)) {
    return { error: 'Invalid column type.' };
  }

  if (getTableColumns(tableName).some((column) => column.name === columnName)) {
    return { error: `Column '${columnName}' already exists.` };
  }

  try {
    activeDb
      .prepare(`ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(columnName)} ${columnType}`)
      .run();
    return { ok: true };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('db:rename-column', async (_event, payload) => {
  const dbError = ensureDbReady();
  if (dbError) {
    return dbError;
  }

  const tableName = payload?.tableName;
  const oldColumnName = payload?.oldColumnName;
  const newColumnName = String(payload?.newColumnName || '').trim();

  const tableError = ensureTableExists(tableName);
  if (tableError) {
    return tableError;
  }

  const columnError = ensureColumnExists(tableName, oldColumnName);
  if (columnError) {
    return columnError;
  }

  const newColumnError = validateIdentifierValue(newColumnName, 'New column name');
  if (newColumnError) {
    return { error: newColumnError };
  }

  if (getTableColumns(tableName).some((column) => column.name === newColumnName)) {
    return { error: `Column '${newColumnName}' already exists.` };
  }

  try {
    activeDb
      .prepare(
        `ALTER TABLE ${quoteIdentifier(tableName)} RENAME COLUMN ${quoteIdentifier(oldColumnName)} TO ${quoteIdentifier(
          newColumnName
        )}`
      )
      .run();
    return { ok: true };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('db:drop-column', async (_event, payload) => {
  const dbError = ensureDbReady();
  if (dbError) {
    return dbError;
  }

  const tableName = payload?.tableName;
  const columnName = payload?.columnName;

  const tableError = ensureTableExists(tableName);
  if (tableError) {
    return tableError;
  }

  const columnError = ensureColumnExists(tableName, columnName);
  if (columnError) {
    return columnError;
  }

  try {
    activeDb.prepare(`ALTER TABLE ${quoteIdentifier(tableName)} DROP COLUMN ${quoteIdentifier(columnName)}`).run();
    return { ok: true };
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

ipcMain.handle('db:insert-row', async (_event, payload) => {
  const dbError = ensureDbReady();
  if (dbError) {
    return dbError;
  }

  const tableName = payload?.tableName;
  const values = payload?.values;

  if (!tableName || typeof tableName !== 'string') {
    return { error: 'Invalid table name.' };
  }

  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return { error: 'Invalid row values.' };
  }

  try {
    const tableExists = activeDb
      .prepare("SELECT 1 AS existsFlag FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1")
      .get(tableName);

    if (!tableExists) {
      return { error: `Table '${tableName}' not found.` };
    }

    const tableColumns = activeDb
      .prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`)
      .all()
      .map((column) => column.name);
    const insertColumns = Object.keys(values).filter(
      (columnName) => columnName !== '__rowid__' && tableColumns.includes(columnName)
    );

    if (insertColumns.length === 0) {
      return { error: 'Enter at least one value before inserting a row.' };
    }

    const placeholders = insertColumns.map(() => '?').join(', ');
    const sql = `INSERT INTO ${quoteIdentifier(tableName)} (${insertColumns
      .map(quoteIdentifier)
      .join(', ')}) VALUES (${placeholders})`;
    const result = activeDb.prepare(sql).run(...insertColumns.map((columnName) => values[columnName]));

    return {
      ok: true,
      changes: result.changes,
      lastInsertRowid: Number(result.lastInsertRowid ?? 0)
    };
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

ipcMain.handle('ai:generate-sql', async (_event, payload) => {
  const question = String(payload?.message || '').trim();
  const history = Array.isArray(payload?.history)
    ? payload.history
        .filter((message) => message && (message.role === 'user' || message.role === 'assistant'))
        .map((message) => ({
          role: message.role,
          content: String(message.content || '').slice(0, 4000)
        }))
    : [];

  if (!question) {
    return { error: 'Ask the assistant what SQL to generate.' };
  }

  const schemaResult = getDatabaseSchemaContext();
  if (schemaResult.error) {
    return schemaResult;
  }

  const { apiKey, model } = getOpenAIConfig();
  if (!apiKey) {
    return { error: 'Missing OPENAI_API_KEY in .env or process environment.' };
  }

  try {
    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        instructions:
          'You generate clear, correct SQLite SQL from user requests. Keep explanations brief and always include the SQL in a fenced sql code block.',
        input: buildSqlAssistantPrompt(question, schemaResult.schema, history),
        max_output_tokens: 1200
      })
    });

    const responseBody = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        error: responseBody?.error?.message || `OpenAI request failed with HTTP ${response.status}.`
      };
    }

    const text = extractResponseText(responseBody);
    if (!text) {
      return { error: 'OpenAI returned an empty response.' };
    }

    return {
      text,
      model,
      schemaLength: schemaResult.schema.length
    };
  } catch (error) {
    return { error: error.message };
  }
});
