const openDbBtn = document.getElementById('open-db-btn');
const refreshDbBtn = document.getElementById('refresh-db-btn');
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
  dbPathEl.textContent = result.filePath;
  refreshDbBtn.disabled = false;
  setStatus('Database opened.');
  await refreshTables();
  clearResults();
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

queryInput.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    runQuery();
  }
});

initializeTheme();
