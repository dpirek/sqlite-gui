const openDbBtn = document.getElementById('open-db-btn');
const runQueryBtn = document.getElementById('run-query-btn');
const themeToggleBtn = document.getElementById('theme-toggle-btn');
const queryInput = document.getElementById('query');
const statusEl = document.getElementById('status');
const resultsTable = document.getElementById('results');
const dbPathEl = document.getElementById('db-path');
const tablesEl = document.getElementById('tables');
const THEME_STORAGE_KEY = 'sqlite-gui-theme';

let editableTableName = null;
let editableRowIdColumn = '__rowid__';

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? 'var(--error)' : 'var(--muted)';
}

function setTheme(theme) {
  document.body.dataset.theme = theme;
  themeToggleBtn.textContent = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
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

function clearResults() {
  resultsTable.innerHTML = '';
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
  for (const row of rows) {
    const tr = document.createElement('tr');
    const rowId = rowIdColumn ? row[rowIdColumn] : undefined;

    for (const column of displayColumns) {
      const td = document.createElement('td');
      const value = row[column];
      td.textContent = value === null || value === undefined ? '' : String(value);

      if (editable) {
        td.classList.add('editable-cell');
        td.dataset.columnName = column;
        td.dataset.rowId = String(rowId);
      }

      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }

  resultsTable.appendChild(tbody);
}

async function loadTablePreview(tableName) {
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

function renderTables(tables) {
  tablesEl.innerHTML = '';

  for (const table of tables) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = table;
    btn.addEventListener('click', async () => {
      queryInput.value = `SELECT * FROM ${table} LIMIT 100;`;
      await loadTablePreview(table);
    });
    li.appendChild(btn);
    tablesEl.appendChild(li);
  }

  if (tables.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No tables found';
    li.style.color = 'var(--muted)';
    tablesEl.appendChild(li);
  }
}

async function refreshTables() {
  const result = await window.sqliteGui.getTables();
  if (result.error) {
    setStatus(result.error, true);
    return;
  }

  renderTables(result.tables || []);
}

async function runQuery() {
  const sql = queryInput.value;
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
  const rowId = Number(cell.dataset.rowId);
  const columnName = cell.dataset.columnName;

  if (!Number.isFinite(rowId) || !columnName) {
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
  dbPathEl.textContent = result.filePath;
  setStatus('Database opened.');
  await refreshTables();
  clearResults();
});

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

queryInput.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    runQuery();
  }
});

initializeTheme();
