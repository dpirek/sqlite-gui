const openDbBtn = document.getElementById('open-db-btn');
const toggleLeftBtn = document.getElementById('toggle-left-btn');
const toggleRightBtn = document.getElementById('toggle-right-btn');
const leftResizeHandle = document.getElementById('left-resize-handle');
const rightResizeHandle = document.getElementById('right-resize-handle');
const refreshDbBtn = document.getElementById('refresh-db-btn');
const runQueryBtn = document.getElementById('run-query-btn');
const themeToggleBtn = document.getElementById('theme-toggle-btn');
const queryTabsEl = document.getElementById('query-tabs');
const addQueryTabBtn = document.getElementById('add-query-tab-btn');
const queryLabel = document.getElementById('query-label');
const queryInput = document.getElementById('query');
const queryHighlight = document.getElementById('query-highlight');
const statusEl = document.getElementById('status');
const resultsTable = document.getElementById('results');
const resultsWrap = document.getElementById('results-wrap');
const dbPathEl = document.getElementById('db-path');
const dbInfoEl = document.getElementById('db-info');
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
const PANEL_WIDTH_STORAGE_KEY = 'sqlite-gui-panel-widths';
const PANEL_WIDTH_LIMITS = {
  left: { min: 180, max: 520, fallback: 250 },
  right: { min: 260, max: 620, fallback: 340 }
};
const MIN_WORKSPACE_WIDTH = 320;
const DEFAULT_QUERY_SQL = "SELECT name FROM sqlite_master WHERE type='table';";

let editableTableName = null;
let editableRowIdColumn = '__rowid__';
let selectedTableName = null;
let assistantChatHistory = [];
let queryTabs = [];
let activeQueryTabId = null;
let nextQueryTabNumber = 1;
let workspaceMode = 'data';

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? 'var(--error)' : 'var(--muted)';

  if (workspaceMode === 'data') {
    const tab = getActiveQueryTab();
    if (tab) {
      tab.status = message;
      tab.isError = isError;
    }
  }
}

function getActiveQueryTab() {
  return queryTabs.find((tab) => tab.id === activeQueryTabId) || null;
}

function formatBytes(bytes) {
  const value = Number(bytes);

  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const size = value / 1024 ** exponent;
  const precision = size >= 10 || exponent === 0 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[exponent]}`;
}

function formatCount(value) {
  return new Intl.NumberFormat().format(Number(value) || 0);
}

function formatModifiedDate(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function setDatabaseHeader(info = {}) {
  dbPathEl.textContent = info.filePath || 'No database selected';

  if (!info.filePath) {
    dbInfoEl.textContent = '';
    dbInfoEl.setAttribute('title', '');
    return;
  }

  if (info.fileSizeBytes === undefined && info.tableCount === undefined) {
    dbInfoEl.textContent = 'Loading database info...';
    dbInfoEl.setAttribute('title', dbInfoEl.textContent);
    return;
  }

  const parts = [
    formatBytes(info.fileSizeBytes),
    `${formatCount(info.tableCount)} tables`,
    `${formatCount(info.totalRecords)} records`,
    `${formatCount(info.viewCount)} views`,
    `${formatCount(info.indexCount)} indexes`
  ];
  const modifiedDate = formatModifiedDate(info.modifiedAt);

  if (modifiedDate) {
    parts.push(`modified ${modifiedDate}`);
  }

  dbInfoEl.textContent = parts.join(' · ');
  dbInfoEl.setAttribute('title', dbInfoEl.textContent);
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

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getPanelWidth(side) {
  const cssValue = getComputedStyle(document.documentElement)
    .getPropertyValue(side === 'left' ? '--left-panel-width' : '--right-panel-width')
    .trim();
  const width = Number.parseFloat(cssValue);
  return Number.isFinite(width) ? width : PANEL_WIDTH_LIMITS[side].fallback;
}

function getPanelWidthState() {
  return {
    left: getPanelWidth('left'),
    right: getPanelWidth('right')
  };
}

function getMaxPanelWidth(side, widths = getPanelWidthState()) {
  const layoutWidth = document.querySelector('.layout')?.getBoundingClientRect().width || window.innerWidth;
  const otherSide = side === 'left' ? 'right' : 'left';
  const otherIsCollapsed = document.body.classList.contains(`${otherSide}-collapsed`);
  const reservedWidth = otherIsCollapsed ? 0 : widths[otherSide];
  const availableWidth = layoutWidth - reservedWidth - MIN_WORKSPACE_WIDTH;
  return Math.max(PANEL_WIDTH_LIMITS[side].min, Math.min(PANEL_WIDTH_LIMITS[side].max, availableWidth));
}

function setPanelWidth(side, width, options = {}) {
  const widths = getPanelWidthState();
  const max = getMaxPanelWidth(side, widths);
  const nextWidth = clamp(Math.round(width), PANEL_WIDTH_LIMITS[side].min, max);
  const propertyName = side === 'left' ? '--left-panel-width' : '--right-panel-width';

  document.documentElement.style.setProperty(propertyName, `${nextWidth}px`);

  if (options.persist) {
    persistPanelWidths();
  }
}

function persistPanelWidths() {
  localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, JSON.stringify(getPanelWidthState()));
}

function initializePanelWidths() {
  let savedWidths = {};

  try {
    savedWidths = JSON.parse(localStorage.getItem(PANEL_WIDTH_STORAGE_KEY) || '{}') || {};
  } catch (_error) {
    savedWidths = {};
  }

  for (const side of ['left', 'right']) {
    if (Number.isFinite(savedWidths[side])) {
      setPanelWidth(side, savedWidths[side]);
    }
  }
}

function setupPanelResize(side, handle) {
  const isLeft = side === 'left';
  const collapsedClassName = isLeft ? 'left-collapsed' : 'right-collapsed';

  const resizeToClientX = (clientX, shouldPersist = false) => {
    if (document.body.classList.contains(collapsedClassName)) {
      return;
    }

    const layoutRect = document.querySelector('.layout').getBoundingClientRect();
    const width = isLeft ? clientX - layoutRect.left : layoutRect.right - clientX;
    setPanelWidth(side, width, { persist: shouldPersist });
  };

  handle.addEventListener('pointerdown', (event) => {
    if (document.body.classList.contains(collapsedClassName)) {
      return;
    }

    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add('resizing-columns');
    resizeToClientX(event.clientX);
  });

  handle.addEventListener('pointermove', (event) => {
    if (!handle.hasPointerCapture(event.pointerId)) {
      return;
    }

    resizeToClientX(event.clientX);
  });

  const stopResize = (event) => {
    if (handle.hasPointerCapture(event.pointerId)) {
      resizeToClientX(event.clientX, true);
      handle.releasePointerCapture(event.pointerId);
    }

    document.body.classList.remove('resizing-columns');
  };

  handle.addEventListener('pointerup', stopResize);
  handle.addEventListener('pointercancel', stopResize);

  handle.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }

    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const delta = event.shiftKey ? 40 : 16;
    setPanelWidth(side, getPanelWidth(side) + (isLeft ? direction : -direction) * delta, { persist: true });
  });
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

function createQueryTab(sql = DEFAULT_QUERY_SQL) {
  const number = nextQueryTabNumber;
  nextQueryTabNumber += 1;

  return {
    id: `query-tab-${number}-${Date.now()}`,
    title: `Query ${number}`,
    sql,
    status: 'Ready.',
    isError: false,
    result: null,
    hideQueryActions: false,
    editableTableName: null,
    editableRowIdColumn: '__rowid__'
  };
}

function renderQueryTabs() {
  queryTabsEl.innerHTML = '';

  for (const tab of queryTabs) {
    const tabEl = document.createElement('div');
    const tabButton = document.createElement('button');
    const titleEl = document.createElement('span');
    const closeBtn = document.createElement('button');

    tabEl.classList.add('query-tab');
    tabEl.classList.toggle('is-active', tab.id === activeQueryTabId);
    tabEl.setAttribute('role', 'presentation');
    tabButton.type = 'button';
    tabButton.classList.add('query-tab-select');
    tabButton.setAttribute('role', 'tab');
    tabButton.setAttribute('aria-selected', String(tab.id === activeQueryTabId));
    tabButton.setAttribute('title', tab.title);
    tabButton.dataset.tabId = tab.id;
    titleEl.classList.add('query-tab-title');
    titleEl.textContent = tab.title;

    closeBtn.type = 'button';
    closeBtn.classList.add('query-tab-close');
    closeBtn.setAttribute('aria-label', `Close ${tab.title}`);
    closeBtn.setAttribute('title', `Close ${tab.title}`);
    closeBtn.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </svg>
    `;

    tabButton.addEventListener('click', () => {
      activateQueryTab(tab.id);
    });

    closeBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      closeQueryTab(tab.id);
    });

    tabButton.appendChild(titleEl);
    tabEl.appendChild(tabButton);
    tabEl.appendChild(closeBtn);
    queryTabsEl.appendChild(tabEl);
  }
}

function renderActiveQueryResult() {
  const tab = getActiveQueryTab();
  clearResults();

  if (!tab?.result) {
    return;
  }

  if (tab.result.mode === 'rows') {
    renderRows(tab.result.columns || [], tab.result.rows || [], tab.result.options || {});
  }
}

function activateQueryTab(tabId) {
  const tab = queryTabs.find((item) => item.id === tabId);
  if (!tab) {
    return;
  }

  const currentTab = getActiveQueryTab();
  if (currentTab) {
    currentTab.sql = queryInput.value;
  }

  activeQueryTabId = tab.id;
  editableTableName = tab.editableTableName;
  editableRowIdColumn = tab.editableRowIdColumn || '__rowid__';
  queryInput.value = tab.sql;
  runQueryBtn.hidden = Boolean(tab.hideQueryActions);
  setStatus(tab.status, tab.isError);
  syncQueryHighlight();
  renderQueryTabs();
  renderActiveQueryResult();
}

function addQueryTab(sql = DEFAULT_QUERY_SQL, options = {}) {
  const tab = createQueryTab(sql);
  queryTabs.push(tab);
  activateQueryTab(tab.id);
  if (options.focus !== false) {
    queryInput.focus();
  }
}

function closeQueryTab(tabId) {
  if (queryTabs.length === 1) {
    const tab = getActiveQueryTab();
    if (tab) {
      tab.sql = DEFAULT_QUERY_SQL;
      tab.status = 'Ready.';
      tab.isError = false;
      tab.result = null;
      tab.hideQueryActions = false;
      tab.editableTableName = null;
      tab.editableRowIdColumn = '__rowid__';
      activateQueryTab(tab.id);
    }
    return;
  }

  const index = queryTabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) {
    return;
  }

  queryTabs.splice(index, 1);

  if (activeQueryTabId === tabId) {
    const nextTab = queryTabs[Math.min(index, queryTabs.length - 1)];
    activateQueryTab(nextTab.id);
    return;
  }

  renderQueryTabs();
}

function setActiveQueryResult(result) {
  const tab = getActiveQueryTab();
  if (!tab) {
    return;
  }

  tab.result = result;
  tab.hideQueryActions = Boolean(result?.hideQueryActions);
  tab.editableTableName = result?.options?.editable ? result.options.tableName : null;
  tab.editableRowIdColumn = result?.options?.rowIdColumn || '__rowid__';
  editableTableName = tab.editableTableName;
  editableRowIdColumn = tab.editableRowIdColumn;
  runQueryBtn.hidden = tab.hideQueryActions;
}

function resetQueryTabResults(status = 'Ready.') {
  for (const tab of queryTabs) {
    tab.status = status;
    tab.isError = false;
    tab.result = null;
    tab.hideQueryActions = false;
    tab.editableTableName = null;
    tab.editableRowIdColumn = '__rowid__';
  }

  const activeTab = getActiveQueryTab();
  if (activeTab) {
    editableTableName = null;
    editableRowIdColumn = '__rowid__';
    runQueryBtn.hidden = false;
    setStatus(activeTab.status, activeTab.isError);
  }

  clearResults();
}

function clearResults() {
  resultsTable.innerHTML = '';
}

function clearActiveQueryResult() {
  const tab = getActiveQueryTab();
  if (tab) {
    tab.result = null;
    tab.hideQueryActions = false;
    tab.editableTableName = null;
    tab.editableRowIdColumn = '__rowid__';
  }

  editableTableName = null;
  editableRowIdColumn = '__rowid__';
  if (workspaceMode === 'data') {
    runQueryBtn.hidden = false;
  }
  clearResults();
}

function updateActiveEditableResultCell(rowId, columnName, value) {
  const tab = getActiveQueryTab();
  const rowIdColumn = tab?.result?.options?.rowIdColumn;

  if (!rowIdColumn || !Array.isArray(tab?.result?.rows)) {
    return;
  }

  const row = tab.result.rows.find((item) => Number(item[rowIdColumn]) === rowId);
  if (row) {
    row[columnName] = value;
  }
}

function setWorkspaceMode(mode, options = {}) {
  workspaceMode = mode;
  const isColumnMode = mode === 'columns';
  const hideQueryActions = isColumnMode || Boolean(options.hideQueryActions);
  document.body.classList.toggle('column-edit-mode', isColumnMode);
  queryTabsEl.closest('.query-tabs-bar').hidden = isColumnMode;
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
      const tab = getActiveQueryTab();
      if (tab) {
        tab.sql = options.sql;
      }
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
    setStatus(result.error, true);
    clearActiveQueryResult();
    return;
  }

  editableTableName = result.tableName;
  editableRowIdColumn = result.rowIdColumn || '__rowid__';
  const renderOptions = {
    editable: true,
    tableName: editableTableName,
    rowIdColumn: editableRowIdColumn
  };
  renderRows(result.columns || [], result.rows || [], renderOptions);
  setActiveQueryResult({
    mode: 'rows',
    columns: result.columns || [],
    rows: result.rows || [],
    rowCount: result.rowCount,
    hideQueryActions: true,
    options: renderOptions
  });
  setStatus(`Loaded ${result.rowCount} row(s) from '${tableName}'. Click a cell to edit.`);
}

async function refreshCurrentTableAfterSchemaChange(message) {
  await refreshTables();

  if (selectedTableName) {
    await loadColumnEditor(selectedTableName);
  }

  if (editableTableName === selectedTableName) {
    clearActiveQueryResult();
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
      const tab = getActiveQueryTab();
      if (tab) {
        tab.sql = queryInput.value;
      }
      syncQueryHighlight();
      await loadTablePreview(table);
    });
    columnsBtn.type = 'button';
    columnsBtn.classList.add('table-columns-btn');
    columnsBtn.setAttribute('aria-label', `Edit columns for ${table}`);
    columnsBtn.setAttribute('title', `Edit columns for ${table}`);
    columnsBtn.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
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
  setDatabaseHeader(result.dbInfo || { filePath: result.dbPath });
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

  setDatabaseHeader({ filePath: result.filePath });
  await refreshTables();

  if (tableToReload) {
    await loadTablePreview(tableToReload);
  } else {
    clearActiveQueryResult();
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
  setDatabaseHeader({ filePath: result.filePath });
  refreshDbBtn.disabled = false;
  setStatus('Database restored.');
  await refreshTables();
  resetQueryTabResults('Database restored.');
}

async function runQuery() {
  const sql = queryInput.value;
  const activeTab = getActiveQueryTab();
  if (activeTab) {
    activeTab.sql = sql;
  }
  setWorkspaceMode('data');
  editableTableName = null;
  setStatus('Running query...');

  const result = await window.sqliteGui.runQuery(sql);

  if (result.error) {
    setStatus(result.error, true);
    clearActiveQueryResult();
    return;
  }

  if (result.mode === 'rows') {
    const renderOptions = { editable: false };
    renderRows(result.columns || [], result.rows || [], renderOptions);
    setActiveQueryResult({
      mode: 'rows',
      columns: result.columns || [],
      rows: result.rows || [],
      rowCount: result.rowCount,
      hideQueryActions: false,
      options: renderOptions
    });
    setStatus(`Returned ${result.rowCount} row(s).`);
    return;
  }

  clearActiveQueryResult();
  setActiveQueryResult({
    mode: 'run',
    changes: result.changes,
    lastInsertRowid: result.lastInsertRowid,
    hideQueryActions: false
  });
  setStatus(`Query OK. Changes: ${result.changes}, Last Insert RowID: ${result.lastInsertRowid}`);
  await refreshTables();
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
  await refreshTables();
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
    updateActiveEditableResultCell(rowId, columnName, nextValue);
    await refreshTables();
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
  setDatabaseHeader({ filePath: result.filePath });
  refreshDbBtn.disabled = false;
  setStatus('Database opened.');
  await refreshTables();
  resetQueryTabResults('Database opened.');
});

toggleLeftBtn.addEventListener('click', () => {
  togglePanel('left');
});

toggleRightBtn.addEventListener('click', () => {
  togglePanel('right');
});

refreshDbBtn.addEventListener('click', reloadDatabaseFile);

runQueryBtn.addEventListener('click', runQuery);

addQueryTabBtn.addEventListener('click', () => {
  addQueryTab();
});

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

queryInput.addEventListener('input', () => {
  const tab = getActiveQueryTab();
  if (tab) {
    tab.sql = queryInput.value;
  }

  syncQueryHighlight();
});
queryInput.addEventListener('scroll', syncQueryHighlight);

window.addEventListener('resize', () => {
  setPanelWidth('left', getPanelWidth('left'));
  setPanelWidth('right', getPanelWidth('right'), { persist: true });
});

initializeTheme();
initializePanelWidths();
setupPanelResize('left', leftResizeHandle);
setupPanelResize('right', rightResizeHandle);
setPanelCollapsed('right', document.body.classList.contains('right-collapsed'));
addQueryTab(queryInput.value || DEFAULT_QUERY_SQL, { focus: false });
setWorkspaceMode('data');
initializeDatabaseFromPersistence();
