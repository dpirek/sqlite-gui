const openDbBtn = document.getElementById('open-db-btn');
const toggleLeftBtn = document.getElementById('toggle-left-btn');
const toggleRightBtn = document.getElementById('toggle-right-btn');
const refreshDbBtn = document.getElementById('refresh-db-btn');
const runQueryBtn = document.getElementById('run-query-btn');
const themeToggleBtn = document.getElementById('theme-toggle-btn');
const queryLabel = document.getElementById('query-label');
const queryInput = document.getElementById('query');
const queryHighlight = document.getElementById('query-highlight');
const statusEl = document.getElementById('status');
const resultsTable = document.getElementById('results');
const resultsWrap = document.getElementById('results-wrap');
const dbPathEl = document.getElementById('db-path');
const tablesEl = document.getElementById('tables');
const columnsEditorEl = document.getElementById('columns-editor');
const columnsTableNameEl = document.getElementById('columns-table-name');
const columnsListEl = document.getElementById('columns-list');
const addColumnBtn = document.getElementById('add-column-btn');
const addColumnNameInput = document.getElementById('add-column-name');
const addColumnTypeSelect = document.getElementById('add-column-type');
const assistantMessagesEl = document.getElementById('assistant-messages');
const assistantForm = document.getElementById('assistant-form');
const assistantInput = document.getElementById('assistant-input');
const assistantSubmitBtn = document.getElementById('assistant-submit-btn');
const THEME_STORAGE_KEY = 'sqlite-gui-theme';

let editableTableName = null;
let editableRowIdColumn = '__rowid__';
let selectedTableName = null;
let assistantChatHistory = [];

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? 'var(--error)' : 'var(--muted)';
}

function setTheme(theme) {
  document.body.dataset.theme = theme;
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  const label = `Switch to ${nextTheme} mode`;
  themeToggleBtn.setAttribute('aria-label', label);
  themeToggleBtn.setAttribute('title', label);
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

function initializeTheme() {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  if (savedTheme === 'light' || savedTheme === 'dark') {
    setTheme(savedTheme);
    return;
  }

  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  setTheme(prefersDark ? 'dark' : 'light');
}

function setPanelCollapsed(side, collapsed) {
  const className = side === 'left' ? 'left-collapsed' : 'right-collapsed';
  const button = side === 'left' ? toggleLeftBtn : toggleRightBtn;
  const panelName = side === 'left' ? 'tables panel' : 'SQL assistant';
  const action = collapsed ? 'Expand' : 'Collapse';

  document.body.classList.toggle(className, collapsed);
  button.setAttribute('aria-pressed', String(collapsed));
  button.setAttribute('aria-label', `${action} ${panelName}`);
  button.setAttribute('title', `${action} ${panelName}`);
}

function togglePanel(side) {
  const className = side === 'left' ? 'left-collapsed' : 'right-collapsed';
  setPanelCollapsed(side, !document.body.classList.contains(className));
}

function clearResults() {
  resultsTable.innerHTML = '';
}

function setWorkspaceMode(mode, options = {}) {
  const isColumnMode = mode === 'columns';
  const hideQueryActions = isColumnMode || Boolean(options.hideQueryActions);
  document.body.classList.toggle('column-edit-mode', isColumnMode);
  queryLabel.hidden = isColumnMode;
  queryInput.closest('.sql-editor').hidden = isColumnMode;
  runQueryBtn.hidden = hideQueryActions;
  resultsWrap.hidden = isColumnMode;
  columnsEditorEl.hidden = !isColumnMode;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function highlightSql(sql) {
  const keywords = new Set([
    'abort',
    'action',
    'add',
    'after',
    'all',
    'alter',
    'and',
    'as',
    'asc',
    'attach',
    'autoincrement',
    'before',
    'begin',
    'between',
    'by',
    'cascade',
    'case',
    'check',
    'collate',
    'column',
    'commit',
    'conflict',
    'constraint',
    'create',
    'cross',
    'current_date',
    'current_time',
    'current_timestamp',
    'database',
    'default',
    'deferrable',
    'deferred',
    'delete',
    'desc',
    'detach',
    'distinct',
    'do',
    'drop',
    'each',
    'else',
    'end',
    'escape',
    'except',
    'exclude',
    'exclusive',
    'exists',
    'explain',
    'fail',
    'filter',
    'first',
    'following',
    'for',
    'foreign',
    'from',
    'full',
    'generated',
    'glob',
    'group',
    'groups',
    'having',
    'if',
    'ignore',
    'immediate',
    'in',
    'index',
    'indexed',
    'initially',
    'inner',
    'insert',
    'instead',
    'intersect',
    'into',
    'is',
    'isnull',
    'join',
    'key',
    'last',
    'left',
    'like',
    'limit',
    'match',
    'materialized',
    'natural',
    'no',
    'not',
    'nothing',
    'notnull',
    'null',
    'nulls',
    'of',
    'offset',
    'on',
    'or',
    'order',
    'others',
    'outer',
    'over',
    'partition',
    'plan',
    'pragma',
    'preceding',
    'primary',
    'query',
    'raise',
    'range',
    'recursive',
    'references',
    'regexp',
    'reindex',
    'release',
    'rename',
    'replace',
    'restrict',
    'returning',
    'right',
    'rollback',
    'row',
    'rows',
    'savepoint',
    'select',
    'set',
    'table',
    'temp',
    'temporary',
    'then',
    'ties',
    'to',
    'transaction',
    'trigger',
    'unbounded',
    'union',
    'unique',
    'update',
    'using',
    'vacuum',
    'values',
    'view',
    'virtual',
    'when',
    'where',
    'window',
    'with',
    'without'
  ]);
  const tokenPattern =
    /(--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b|[(),.;*+=<>!|/-])/g;

  const source = sql || ' ';
  let highlighted = '';
  let previousIndex = 0;

  for (const match of source.matchAll(tokenPattern)) {
    const token = match[0];
    highlighted += escapeHtml(source.slice(previousIndex, match.index));
    previousIndex = match.index + token.length;

    const escaped = escapeHtml(token);
    const lowerToken = token.toLowerCase();

    if (token.startsWith('--') || token.startsWith('/*')) {
      highlighted += `<span class="sql-comment">${escaped}</span>`;
      continue;
    }

    if (token.startsWith("'")) {
      highlighted += `<span class="sql-string">${escaped}</span>`;
      continue;
    }

    if (token.startsWith('"') || token.startsWith('`')) {
      highlighted += `<span class="sql-identifier">${escaped}</span>`;
      continue;
    }

    if (/^\d/.test(token)) {
      highlighted += `<span class="sql-number">${escaped}</span>`;
      continue;
    }

    if (keywords.has(lowerToken)) {
      highlighted += `<span class="sql-keyword">${escaped}</span>`;
      continue;
    }

    if (/^[(),.;*+=<>!|/-]$/.test(token)) {
      highlighted += `<span class="sql-operator">${escaped}</span>`;
      continue;
    }

    highlighted += escaped;
  }

  return highlighted + escapeHtml(source.slice(previousIndex));
}

function syncQueryHighlight() {
  queryHighlight.innerHTML = highlightSql(queryInput.value);
  queryHighlight.scrollTop = queryInput.scrollTop;
  queryHighlight.scrollLeft = queryInput.scrollLeft;
}

function extractSqlBlock(text) {
  const fencedSql = text.match(/```sql\s*([\s\S]*?)```/i);
  if (fencedSql) {
    return fencedSql[1].trim();
  }

  const fenced = text.match(/```\s*([\s\S]*?)```/);
  if (fenced) {
    return fenced[1].trim();
  }

  return '';
}

function appendAssistantMessage(role, text, options = {}) {
  const messageEl = document.createElement('div');
  const bodyEl = document.createElement('div');
  messageEl.classList.add('assistant-message', ...role.split(/\s+/).filter(Boolean));
  bodyEl.classList.add('assistant-message-body');
  bodyEl.textContent = text;
  messageEl.appendChild(bodyEl);

  if (options.sql) {
    const useSqlBtn = document.createElement('button');
    useSqlBtn.type = 'button';
    useSqlBtn.classList.add('use-sql-btn');
    useSqlBtn.textContent = 'Use SQL';
    useSqlBtn.addEventListener('click', () => {
      queryInput.value = options.sql;
      syncQueryHighlight();
      queryInput.focus();
      setStatus('Generated SQL loaded into the editor.');
    });
    messageEl.appendChild(useSqlBtn);
  }

  assistantMessagesEl.appendChild(messageEl);
  assistantMessagesEl.scrollTop = assistantMessagesEl.scrollHeight;
}

async function askSqlAssistant(message) {
  const history = assistantChatHistory.slice(-8);
  assistantSubmitBtn.disabled = true;
  assistantInput.disabled = true;
  appendAssistantMessage('user', message);
  assistantChatHistory.push({ role: 'user', content: message });
  appendAssistantMessage('assistant', 'Generating SQL from the current schema...');

  const pendingMessage = assistantMessagesEl.lastElementChild;
  const result = await window.sqliteGui.generateSql({ message, history });

  pendingMessage.remove();

  if (result.error) {
    appendAssistantMessage('assistant error', result.error);
    assistantSubmitBtn.disabled = false;
    assistantInput.disabled = false;
    assistantInput.focus();
    return;
  }

  appendAssistantMessage('assistant', result.text, {
    sql: extractSqlBlock(result.text)
  });
  assistantChatHistory.push({ role: 'assistant', content: result.text });
  assistantSubmitBtn.disabled = false;
  assistantInput.disabled = false;
  assistantInput.focus();
}

function renderRows(columns, rows, options = {}) {
  clearResults();

  const rowIdColumn = options.rowIdColumn || null;
  const editable = Boolean(options.editable && options.tableName && rowIdColumn);
  const displayColumns = rowIdColumn ? columns.filter((column) => column !== rowIdColumn) : columns;

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');

  for (const column of displayColumns) {
    const th = document.createElement('th');
    th.textContent = column;
    headRow.appendChild(th);
  }

  thead.appendChild(headRow);
  resultsTable.appendChild(thead);

  const tbody = document.createElement('tbody');

  const makeEditableCell = (column, rowId = null, isNewRow = false) => {
    const td = document.createElement('td');
    td.classList.add('editable-cell');
    td.dataset.columnName = column;

    if (isNewRow) {
      td.dataset.newRow = 'true';
      return td;
    }

    td.dataset.rowId = String(rowId);
    return td;
  };

  for (const row of rows) {
    const tr = document.createElement('tr');
    const rowId = rowIdColumn ? row[rowIdColumn] : undefined;

    for (const column of displayColumns) {
      const td = editable ? makeEditableCell(column, rowId) : document.createElement('td');
      const value = row[column];
      td.textContent = value === null || value === undefined ? '' : String(value);

      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }

  if (editable) {
    const emptyRow = document.createElement('tr');
    emptyRow.classList.add('insert-row');

    for (const column of displayColumns) {
      emptyRow.appendChild(makeEditableCell(column, null, true));
    }

    tbody.appendChild(emptyRow);
  }

  resultsTable.appendChild(tbody);

  if (editable) {
    const tfoot = document.createElement('tfoot');
    const actionRow = document.createElement('tr');
    const actionCell = document.createElement('td');
    const insertButton = document.createElement('button');

    actionCell.colSpan = Math.max(displayColumns.length, 1);
    actionCell.classList.add('insert-action-cell');
    insertButton.type = 'button';
    insertButton.classList.add('insert-row-btn');
    insertButton.textContent = 'Insert';
    insertButton.addEventListener('click', insertStagedRow);

    actionCell.appendChild(insertButton);
    actionRow.appendChild(actionCell);
    tfoot.appendChild(actionRow);
    resultsTable.appendChild(tfoot);
  }
}

async function loadTablePreview(tableName) {
  setWorkspaceMode('data', { hideQueryActions: true });
  setStatus(`Loading '${tableName}'...`);
  const result = await window.sqliteGui.getTablePreview(tableName);

  if (result.error) {
    editableTableName = null;
    setStatus(result.error, true);
    clearResults();
    return;
  }

  editableTableName = result.tableName;
  editableRowIdColumn = result.rowIdColumn || '__rowid__';
  renderRows(result.columns || [], result.rows || [], {
    editable: true,
    tableName: editableTableName,
    rowIdColumn: editableRowIdColumn
  });
  setStatus(`Loaded ${result.rowCount} row(s) from '${tableName}'. Click a cell to edit.`);
}

async function refreshCurrentTableAfterSchemaChange(message) {
  await refreshTables();

  if (selectedTableName) {
    await loadColumnEditor(selectedTableName);
  }

  if (editableTableName === selectedTableName) {
    editableTableName = null;
    clearResults();
  }

  setStatus(message);
}

function renderColumns(columns) {
  columnsListEl.innerHTML = '';

  for (const column of columns) {
    const tr = document.createElement('tr');
    const nameCell = document.createElement('td');
    const typeCell = document.createElement('td');
    const notNullCell = document.createElement('td');
    const primaryKeyCell = document.createElement('td');
    const defaultCell = document.createElement('td');
    const actionsCell = document.createElement('td');
    const nameInput = document.createElement('input');
    const typeEl = document.createElement('span');
    const notNullEl = document.createElement('span');
    const primaryKeyEl = document.createElement('span');
    const defaultEl = document.createElement('span');
    const actions = document.createElement('div');
    const renameBtn = document.createElement('button');
    const dropBtn = document.createElement('button');

    actions.classList.add('column-actions');
    nameInput.type = 'text';
    nameInput.value = column.name;
    nameInput.autocomplete = 'off';
    typeEl.classList.add('column-type');
    typeEl.textContent = column.type || 'ANY';
    notNullEl.classList.add('column-check-cell');
    notNullEl.textContent = column.notnull ? '✓' : '';
    primaryKeyEl.classList.add('column-check-cell');
    primaryKeyEl.textContent = column.primaryKey ? '✓' : '';
    defaultEl.classList.add('column-default');
    defaultEl.textContent = column.defaultValue === null || column.defaultValue === undefined ? '' : String(column.defaultValue);

    renameBtn.type = 'button';
    renameBtn.classList.add('column-icon-btn');
    renameBtn.setAttribute('aria-label', `Rename ${column.name}`);
    renameBtn.setAttribute('title', `Rename ${column.name}`);
    renameBtn.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    `;
    renameBtn.addEventListener('click', async () => {
      const nextName = nameInput.value.trim();

      if (!selectedTableName || nextName === column.name) {
        return;
      }

      setStatus(`Renaming '${column.name}'...`);
      const result = await window.sqliteGui.renameColumn({
        tableName: selectedTableName,
        oldColumnName: column.name,
        newColumnName: nextName
      });

      if (result.error) {
        setStatus(result.error, true);
        return;
      }

      await refreshCurrentTableAfterSchemaChange(`Renamed '${column.name}' to '${nextName}'.`);
    });

    dropBtn.type = 'button';
    dropBtn.classList.add('column-icon-btn', 'danger-btn');
    dropBtn.setAttribute('aria-label', `Drop ${column.name}`);
    dropBtn.setAttribute('title', `Drop ${column.name}`);
    dropBtn.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 6h18" />
        <path d="M8 6V4h8v2" />
        <path d="M19 6l-1 14H6L5 6" />
        <path d="M10 11v5" />
        <path d="M14 11v5" />
      </svg>
    `;
    dropBtn.addEventListener('click', async () => {
      if (!selectedTableName || !window.confirm(`Drop column '${column.name}' from '${selectedTableName}'?`)) {
        return;
      }

      setStatus(`Dropping '${column.name}'...`);
      const result = await window.sqliteGui.dropColumn({
        tableName: selectedTableName,
        columnName: column.name
      });

      if (result.error) {
        setStatus(result.error, true);
        return;
      }

      await refreshCurrentTableAfterSchemaChange(`Dropped '${column.name}'.`);
    });

    nameCell.appendChild(nameInput);
    typeCell.appendChild(typeEl);
    notNullCell.appendChild(notNullEl);
    primaryKeyCell.appendChild(primaryKeyEl);
    defaultCell.appendChild(defaultEl);
    actions.appendChild(renameBtn);
    actions.appendChild(dropBtn);
    actionsCell.appendChild(actions);
    tr.appendChild(nameCell);
    tr.appendChild(typeCell);
    tr.appendChild(notNullCell);
    tr.appendChild(primaryKeyCell);
    tr.appendChild(defaultCell);
    tr.appendChild(actionsCell);
    columnsListEl.appendChild(tr);
  }
}

async function loadColumnEditor(tableName) {
  selectedTableName = tableName;
  setWorkspaceMode('columns');
  columnsTableNameEl.textContent = tableName;
  columnsListEl.innerHTML = '';

  const result = await window.sqliteGui.getTableColumns(tableName);

  if (result.error) {
    setStatus(result.error, true);
    return;
  }

  renderColumns(result.columns || []);
}

function renderTables(tables) {
  tablesEl.innerHTML = '';

  for (const table of tables) {
    const li = document.createElement('li');
    const row = document.createElement('div');
    const btn = document.createElement('button');
    const columnsBtn = document.createElement('button');
    row.classList.add('table-list-row');
    btn.type = 'button';
    btn.textContent = table;
    btn.addEventListener('click', async () => {
      selectedTableName = table;
      queryInput.value = `SELECT * FROM ${table} LIMIT 100;`;
      syncQueryHighlight();
      await loadTablePreview(table);
    });
    columnsBtn.type = 'button';
    columnsBtn.classList.add('table-columns-btn');
    columnsBtn.setAttribute('aria-label', `Edit columns for ${table}`);
    columnsBtn.setAttribute('title', `Edit columns for ${table}`);
    columnsBtn.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 5h16" />
        <path d="M4 12h16" />
        <path d="M4 19h16" />
        <path d="M8 3v18" />
        <path d="M16 3v18" />
      </svg>
    `;
    columnsBtn.addEventListener('click', async () => {
      await loadColumnEditor(table);
    });
    row.appendChild(btn);
    row.appendChild(columnsBtn);
    li.appendChild(row);
    tablesEl.appendChild(li);
  }

  if (tables.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No tables found';
    li.style.color = 'var(--muted)';
    tablesEl.appendChild(li);
    setWorkspaceMode('data');
    selectedTableName = null;
  }
}

async function refreshTables() {
  const result = await window.sqliteGui.getTables();
  if (result.error) {
    setStatus(result.error, true);
    return;
  }

  const tables = result.tables || [];
  renderTables(tables);

  if (selectedTableName && !tables.includes(selectedTableName)) {
    selectedTableName = null;
    setWorkspaceMode('data');
  }
}

async function reloadDatabaseFile() {
  const tableToReload = editableTableName;
  refreshDbBtn.disabled = true;
  setStatus('Refreshing database file...');

  const result = await window.sqliteGui.reloadDatabaseFile();

  if (result.error) {
    setStatus(result.error, true);
    refreshDbBtn.disabled = false;
    return;
  }

  dbPathEl.textContent = result.filePath;
  await refreshTables();

  if (tableToReload) {
    await loadTablePreview(tableToReload);
  } else {
    editableTableName = null;
    clearResults();
    setStatus('Database file refreshed.');
  }

  refreshDbBtn.disabled = false;
}

async function initializeDatabaseFromPersistence() {
  const result = await window.sqliteGui.getCurrentDatabaseFile();

  if (result.error) {
    setStatus(result.error, true);
  }

  if (!result.filePath) {
    return;
  }

  editableTableName = null;
  dbPathEl.textContent = result.filePath;
  refreshDbBtn.disabled = false;
  setStatus('Database restored.');
  await refreshTables();
  clearResults();
}

async function runQuery() {
  const sql = queryInput.value;
  setWorkspaceMode('data');
  editableTableName = null;
  setStatus('Running query...');

  const result = await window.sqliteGui.runQuery(sql);

  if (result.error) {
    setStatus(result.error, true);
    clearResults();
    return;
  }

  if (result.mode === 'rows') {
    renderRows(result.columns || [], result.rows || [], { editable: false });
    setStatus(`Returned ${result.rowCount} row(s).`);
    return;
  }

  clearResults();
  setStatus(`Query OK. Changes: ${result.changes}, Last Insert RowID: ${result.lastInsertRowid}`);
}

async function insertStagedRow(event) {
  if (!editableTableName) {
    return;
  }

  const insertButton = event.currentTarget;
  const values = {};
  const insertCells = resultsTable.querySelectorAll('tr.insert-row td[data-new-row="true"]');

  for (const cell of insertCells) {
    const columnName = cell.dataset.columnName;
    const value = cell.textContent;

    if (columnName && value !== '') {
      values[columnName] = value;
    }
  }

  if (Object.keys(values).length === 0) {
    setStatus('Enter at least one value before inserting a row.', true);
    return;
  }

  insertButton.disabled = true;
  setStatus('Inserting row...');

  const result = await window.sqliteGui.insertRow({
    tableName: editableTableName,
    values
  });

  if (result.error) {
    setStatus(result.error, true);
    insertButton.disabled = false;
    return;
  }

  setStatus('Row inserted.');
  await loadTablePreview(editableTableName);
}

function selectCellText(cell) {
  const range = document.createRange();
  range.selectNodeContents(cell);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function enableCellEditing(cell) {
  if (!editableTableName || cell.classList.contains('is-editing')) {
    return;
  }

  const originalValue = cell.textContent;
  const isNewRow = cell.dataset.newRow === 'true';
  const rowId = Number(cell.dataset.rowId);
  const columnName = cell.dataset.columnName;

  if ((!isNewRow && !Number.isFinite(rowId)) || !columnName) {
    return;
  }

  let completed = false;

  cell.classList.add('is-editing');
  cell.contentEditable = 'true';
  cell.focus();
  selectCellText(cell);

  const finish = async (save) => {
    if (completed) {
      return;
    }
    completed = true;

    cell.contentEditable = 'false';
    cell.classList.remove('is-editing');
    cell.removeEventListener('blur', onBlur);
    cell.removeEventListener('keydown', onKeyDown);

    if (!save) {
      cell.textContent = originalValue;
      return;
    }

    const nextValue = cell.textContent;
    if (nextValue === originalValue) {
      return;
    }

    if (isNewRow) {
      return;
    }

    setStatus(`Saving '${columnName}'...`);
    const result = await window.sqliteGui.updateCell({
      tableName: editableTableName,
      columnName,
      rowId,
      value: nextValue
    });

    if (result.error) {
      cell.textContent = originalValue;
      setStatus(result.error, true);
      return;
    }

    setStatus('Cell saved.');
  };

  const onBlur = () => {
    finish(true);
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    }
  };

  cell.addEventListener('blur', onBlur);
  cell.addEventListener('keydown', onKeyDown);
}

openDbBtn.addEventListener('click', async () => {
  const result = await window.sqliteGui.chooseDatabaseFile();

  if (result.canceled) {
    return;
  }

  if (result.error) {
    setStatus(result.error, true);
    return;
  }

  editableTableName = null;
  selectedTableName = null;
  setWorkspaceMode('data');
  dbPathEl.textContent = result.filePath;
  refreshDbBtn.disabled = false;
  setStatus('Database opened.');
  await refreshTables();
  clearResults();
});

toggleLeftBtn.addEventListener('click', () => {
  togglePanel('left');
});

toggleRightBtn.addEventListener('click', () => {
  togglePanel('right');
});

refreshDbBtn.addEventListener('click', reloadDatabaseFile);

runQueryBtn.addEventListener('click', runQuery);

themeToggleBtn.addEventListener('click', () => {
  const currentTheme = document.body.dataset.theme === 'dark' ? 'dark' : 'light';
  setTheme(currentTheme === 'dark' ? 'light' : 'dark');
});

resultsTable.addEventListener('click', (event) => {
  const cell = event.target.closest('td.editable-cell');
  if (!cell) {
    return;
  }

  enableCellEditing(cell);
});

addColumnBtn.addEventListener('click', async () => {
  if (!selectedTableName) {
    return;
  }

  const columnName = addColumnNameInput.value.trim();
  const columnType = addColumnTypeSelect.value;

  if (!columnName) {
    setStatus('Column name is required.', true);
    return;
  }

  setStatus(`Adding '${columnName}'...`);
  const result = await window.sqliteGui.addColumn({
    tableName: selectedTableName,
    columnName,
    columnType
  });

  if (result.error) {
    setStatus(result.error, true);
    return;
  }

  addColumnNameInput.value = '';
  await refreshCurrentTableAfterSchemaChange(`Added '${columnName}'.`);
});

assistantForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = assistantInput.value.trim();

  if (!message) {
    return;
  }

  assistantInput.value = '';
  await askSqlAssistant(message);
});

assistantInput.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    assistantForm.requestSubmit();
  }
});

queryInput.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    runQuery();
  }
});

queryInput.addEventListener('input', syncQueryHighlight);
queryInput.addEventListener('scroll', syncQueryHighlight);

initializeTheme();
setPanelCollapsed('right', document.body.classList.contains('right-collapsed'));
syncQueryHighlight();
setWorkspaceMode('data');
initializeDatabaseFromPersistence();
