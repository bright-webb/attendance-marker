// State
let appState = {
  campuses: [],
  defaultCampusId: '4a015b33-e179-4927-816a-a9ec80f13bfd', // Port Harcourt
  authStatus: null,
  parsedResults: [],
  currentFilter: 'all',
  searchQuery: ''
};

// DOM Elements
const campusSelect = document.getElementById('campusSelect');
const attendanceDate = document.getElementById('attendanceDate');
const attendanceStatus = document.getElementById('attendanceStatus');
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const resultsSection = document.getElementById('resultsSection');
const tableBody = document.getElementById('tableBody');
const masterCheckbox = document.getElementById('masterCheckbox');
const btnMarkAttendance = document.getElementById('btnMarkAttendance');
const readyCountBadge = document.getElementById('readyCountBadge');
const filterInput = document.getElementById('filterInput');

// Init
document.addEventListener('DOMContentLoaded', async () => {
  // Set default date to today in local time
  const today = new Date().toISOString().split('T')[0];
  attendanceDate.value = today;

  await loadInitialStatus();
  await loadCampuses();
  setupEventListeners();
});

// Load status from backend
async function loadInitialStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    appState.authStatus = data.auth;

    updateAuthIndicator(data.auth);

    if (data.defaultCampus && data.defaultCampus.id) {
      appState.defaultCampusId = data.defaultCampus.id;
    }
  } catch (err) {
    console.error('Failed to load status:', err);
    showToast('Failed to connect to backend service', 'error');
  }
}

// Update Auth indicator pill in navbar
function updateAuthIndicator(auth) {
  const pill = document.getElementById('authStatusPill');
  const ind = document.getElementById('authIndicator');
  const text = document.getElementById('authStatusText');

  ind.className = 'status-indicator';

  if (!auth.hasAccessToken) {
    ind.classList.add('danger');
    text.innerText = 'Token Missing (Click to setup)';
  } else if (!auth.isAccessTokenCompleteJwt) {
    ind.classList.add('warning');
    text.innerText = 'Token Incomplete (Check JWT)';
  } else {
    ind.classList.add('success');
    text.innerText = 'Token Connected';
  }
}

// Load campuses
async function loadCampuses() {
  try {
    const res = await fetch('/api/campuses');
    const campuses = await res.json();
    appState.campuses = campuses;

    campusSelect.innerHTML = '';

    // Put Port Harcourt first
    const phcCampus = campuses.find(c => c.id === appState.defaultCampusId);
    if (phcCampus) {
      const opt = document.createElement('option');
      opt.value = phcCampus.id;
      opt.textContent = `${phcCampus.campus_name} (Default)`;
      opt.selected = true;
      campusSelect.appendChild(opt);
    }

    // Add other campuses
    campuses.forEach(c => {
      if (c.id !== appState.defaultCampusId) {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.campus_name;
        campusSelect.appendChild(opt);
      }
    });

    // Add "All Campuses" option at bottom
    const allOpt = document.createElement('option');
    allOpt.value = 'all';
    allOpt.textContent = '--- Search Across All Campuses ---';
    campusSelect.appendChild(allOpt);

    updateCampusBadge();
  } catch (err) {
    console.error('Failed to load campuses:', err);
  }
}

function updateCampusBadge() {
  const selectedOpt = campusSelect.options[campusSelect.selectedIndex];
  if (selectedOpt) {
    const name = selectedOpt.textContent.replace(' (Default)', '');
    document.getElementById('activeCampusName').innerText = name;
  }
}

// Setup Event Listeners
function setupEventListeners() {
  campusSelect.addEventListener('change', updateCampusBadge);

  // Drag and Drop
  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) {
      handleFileUpload(fileInput.files[0]);
    }
  });

  // Master checkbox
  masterCheckbox.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    const visibleResults = getFilteredResults();
    visibleResults.forEach(r => {
      if (r.matchedStudent && r.matchedStudent.id) {
        r.selected = isChecked;
      }
    });
    renderTable();
    updateCounters();
  });

  // Filter input
  filterInput.addEventListener('input', (e) => {
    appState.searchQuery = e.target.value.toLowerCase().trim();
    renderTable();
  });

  // Filter pills
  document.querySelectorAll('.filter-pills .pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-pills .pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      appState.currentFilter = btn.dataset.filter;
      renderTable();
    });
  });

  // Select all ready button
  document.getElementById('btnToggleAll').addEventListener('click', () => {
    const anyUnselected = appState.parsedResults.some(r => r.matchedStudent && !r.selected);
    appState.parsedResults.forEach(r => {
      if (r.matchedStudent && r.matchedStudent.id) {
        r.selected = anyUnselected;
      }
    });
    renderTable();
    updateCounters();
  });

  // Mark attendance button
  btnMarkAttendance.addEventListener('click', executeAttendanceMarking);

  // Token character count tracker
  const cfgAccessToken = document.getElementById('cfgAccessToken');
  cfgAccessToken.addEventListener('input', () => {
    const len = cfgAccessToken.value.trim().length;
    const helper = document.getElementById('tokenLengthHelper');
    const parts = cfgAccessToken.value.trim().split('.');
    helper.innerText = `Token Length: ${len} characters | JWT Parts: ${parts.length} ${parts.length === 3 ? '(Complete JWT)' : '(Incomplete)'}`;
  });
}

// Upload file to backend
async function handleFileUpload(file) {
  const allowedExtensions = ['.csv', '.xlsx', '.xls'];
  const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
  if (!allowedExtensions.includes(ext)) {
    showToast('Please upload a valid CSV or Excel file (.csv, .xlsx, .xls)', 'error');
    return;
  }

  showToast(`Uploading and analyzing ${file.name}...`, 'info');

  const formData = new FormData();
  formData.append('file', file);
  formData.append('campusId', campusSelect.value);

  try {
    const res = await fetch('/api/parse-upload', {
      method: 'POST',
      body: formData
    });

    const data = await res.json();
    if (!data.success) {
      showToast(data.message || 'Failed to process file', 'error');
      return;
    }

    appState.parsedResults = data.results || [];
    resultsSection.style.display = 'block';

    updateStatsBar(data.summary);
    renderTable();
    updateCounters();

    // Scroll to results
    resultsSection.scrollIntoView({ behavior: 'smooth' });
    showToast(`Successfully analyzed ${appState.parsedResults.length} records!`, 'success');
  } catch (err) {
    console.error('Upload error:', err);
    showToast(`Error processing file: ${err.message}`, 'error');
  }
}

// Update stats cards
function updateStatsBar(summary) {
  document.getElementById('statTotal').innerText = summary.totalRows;
  document.getElementById('statMatched').innerText = summary.matchedCount;
  document.getElementById('statFuzzy').innerText = summary.fuzzyCount;
  document.getElementById('statOtherCampus').innerText = summary.otherCampusCount;
  document.getElementById('statUnmatched').innerText = summary.unmatchedCount;
}

// Filter results
function getFilteredResults() {
  return appState.parsedResults.filter(item => {
    // 1. Filter pill
    if (appState.currentFilter === 'selected' && !item.selected) return false;
    if (appState.currentFilter === 'unmatched' && item.status !== 'unmatched') return false;

    // 2. Search query
    if (appState.searchQuery) {
      const q = appState.searchQuery;
      const inputMatch = item.inputName.toLowerCase().includes(q);
      const studentMatch = item.matchedStudent && (
        item.matchedStudent.first_name.toLowerCase().includes(q) ||
        item.matchedStudent.last_name.toLowerCase().includes(q) ||
        (item.matchedStudent.student_id_number && item.matchedStudent.student_id_number.toLowerCase().includes(q))
      );
      const matchTypeMatch = (item.matchType || '').toLowerCase().includes(q);
      if (!inputMatch && !studentMatch && !matchTypeMatch) return false;
    }

    return true;
  });
}

// Render reconciliation table
function renderTable() {
  const visible = getFilteredResults();
  tableBody.innerHTML = '';

  if (visible.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 2.5rem; color: #64748b;">
          No student records match the active filter or search.
        </td>
      </tr>
    `;
    return;
  }

  visible.forEach((row) => {
    const tr = document.createElement('tr');

    // Badge styling
    let badgeHtml = '';
    if (row.status === 'matched') {
      badgeHtml = `<span class="badge badge-success">${row.matchType} (${row.confidence}%)</span>`;
    } else if (row.status === 'fuzzy') {
      badgeHtml = `<span class="badge badge-warning">${row.matchType} (${row.confidence}%)</span>`;
    } else if (row.status === 'other_campus') {
      badgeHtml = `<span class="badge badge-info">${row.matchType}</span>`;
    } else {
      badgeHtml = `<span class="badge badge-danger">Unmatched</span>`;
    }

    if (row.isDuplicate) {
      badgeHtml += ` <span class="badge badge-warning">Duplicate in file</span>`;
    }

    // Student info
    let studentHtml = `<span style="color: #94a3b8; font-style: italic;">No student record matched</span>`;
    let campusName = '-';

    if (row.matchedStudent) {
      campusName = row.matchedStudent.campus_name || 'Active Campus';
      studentHtml = `
        <div class="student-meta">
          <span class="student-name">${escapeHtml(row.matchedStudent.first_name)} ${escapeHtml(row.matchedStudent.last_name)}</span>
          <span class="student-sub">${escapeHtml(row.matchedStudent.student_id_number || row.matchedStudent.email || row.matchedStudent.id)}</span>
        </div>
      `;
    }

    const canSelect = Boolean(row.matchedStudent && row.matchedStudent.id);

    // Show uploaded name + email (if present) in the input cell
    const inputCellHtml = row.emailInput
      ? `<strong>${escapeHtml(row.inputName)}</strong><br><span style="font-size:0.78rem;color:#64748b;">${escapeHtml(row.emailInput)}</span>`
      : `<strong>${escapeHtml(row.inputName)}</strong>`;

    tr.innerHTML = `
      <td>
        <input type="checkbox" class="row-checkbox" data-row="${row.rowNumber}" ${row.selected ? 'checked' : ''} ${!canSelect ? 'disabled' : ''}>
      </td>
      <td style="color: #94a3b8; font-weight: 600;">${row.rowNumber}</td>
      <td>${inputCellHtml}</td>
      <td>${studentHtml}</td>
      <td><span class="tag">${escapeHtml(campusName)}</span></td>
      <td>${badgeHtml}</td>
      <td>
        ${row.selected ? '<span style="color: #10b981; font-weight: 700;">Ready</span>' : '<span style="color: #94a3b8;">Excluded</span>'}
      </td>
    `;

    // Checkbox event
    const chk = tr.querySelector('.row-checkbox');
    chk.addEventListener('change', (e) => {
      row.selected = e.target.checked;
      updateCounters();
      tr.querySelector('td:last-child').innerHTML = row.selected
        ? '<span style="color: #10b981; font-weight: 700;">Ready</span>'
        : '<span style="color: #94a3b8;">Excluded</span>';
    });

    tableBody.appendChild(tr);
  });
}

function updateCounters() {
  const total = appState.parsedResults.length;
  const selected = appState.parsedResults.filter(r => r.selected).length;
  const unmatched = appState.parsedResults.filter(r => r.status === 'unmatched').length;

  document.getElementById('countPillAll').innerText = total;
  document.getElementById('countPillSelected').innerText = selected;
  document.getElementById('countPillUnmatched').innerText = unmatched;

  readyCountBadge.innerText = selected;
  btnMarkAttendance.disabled = selected === 0;

  // Show/hide the "Download Unmatched" buttons
  const downloadGroup = document.getElementById('downloadUnmatchedGroup');
  if (downloadGroup) {
    downloadGroup.style.display = unmatched > 0 ? 'flex' : 'none';
  }

  // Master checkbox status
  const visible = getFilteredResults().filter(r => r.matchedStudent && r.matchedStudent.id);
  if (visible.length > 0) {
    masterCheckbox.checked = visible.every(r => r.selected);
  } else {
    masterCheckbox.checked = false;
  }
}

// Download unmatched names as CSV or XLSX
async function downloadUnmatched(format) {
  const unmatched = appState.parsedResults.filter(r => r.status === 'unmatched');
  if (unmatched.length === 0) {
    showToast('No unmatched records to export.', 'warning');
    return;
  }

  if (format === 'csv') {
    const header = 'Row,Uploaded Name,First Name Input,Last Name Input,Status';
    const rows = unmatched.map(r =>
      [r.rowNumber, `"${r.inputName}"`, `"${r.firstNameInput || ''}"`, `"${r.lastNameInput || ''}"`, r.status].join(',')
    );
    const csvContent = [header, ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    triggerDownload(blob, 'unmatched_names.csv');
    showToast(`Exported ${unmatched.length} unmatched names as CSV.`, 'success');
  } else if (format === 'xlsx') {
    try {
      const res = await fetch('/api/export-unmatched', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unmatched })
      });
      if (!res.ok) {
        const err = await res.json();
        showToast(err.message || 'Export failed', 'error');
        return;
      }
      const blob = await res.blob();
      triggerDownload(blob, 'unmatched_names.xlsx');
      showToast(`Exported ${unmatched.length} unmatched names as Excel.`, 'success');
    } catch (err) {
      showToast(`Export error: ${err.message}`, 'error');
    }
  }
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 300);
}

// Execute Attendance Marking
async function executeAttendanceMarking() {
  const selectedItems = appState.parsedResults.filter(r => r.selected && r.matchedStudent && r.matchedStudent.id);

  if (selectedItems.length === 0) {
    showToast('No students selected to mark attendance', 'warning');
    return;
  }

  const date = attendanceDate.value;
  const status = attendanceStatus.value;

  if (!date) {
    showToast('Please pick an attendance date first', 'error');
    return;
  }

  // Open modal
  const modal = document.getElementById('executionModal');
  const fill = document.getElementById('execProgressFill');
  const percentText = document.getElementById('execProgressPercent');
  const fractionText = document.getElementById('execProgressFraction');
  const successCountText = document.getElementById('execSuccessCount');
  const failureCountText = document.getElementById('execFailureCount');
  const consoleLogs = document.getElementById('consoleLogs');
  const btnDone = document.getElementById('btnDoneExec');

  modal.classList.add('active');
  btnDone.disabled = true;
  consoleLogs.innerHTML = '';
  fill.style.width = '0%';
  percentText.innerText = '0%';
  fractionText.innerText = `0 / ${selectedItems.length} Completed`;
  successCountText.innerText = '0';
  failureCountText.innerText = '0';

  appendLog(`Initiating bulk attendance for ${selectedItems.length} students on date ${date} (Status: ${status})...`, 'info');

  const payload = {
    date,
    status,
    items: selectedItems.map(s => ({
      studentId: s.matchedStudent.id,
      inputName: s.inputName,
      studentName: `${s.matchedStudent.first_name} ${s.matchedStudent.last_name}`
    }))
  };

  try {
    const res = await fetch('/api/mark-attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!data.results) {
      appendLog(`Error: ${data.message || 'Unexpected server error'}`, 'error');
      btnDone.disabled = false;
      return;
    }

    fill.style.width = '100%';
    percentText.innerText = '100%';
    fractionText.innerText = `${data.total} / ${data.total} Completed`;
    successCountText.innerText = data.successCount;
    failureCountText.innerText = data.failureCount;

    data.results.forEach(r => {
      if (r.success) {
        appendLog(`[OK] Marked: ${r.studentName} (${r.inputName}) as ${r.status}`, 'success');
      } else {
        appendLog(`[FAIL] ${r.studentName}: ${r.error}`, 'error');
      }
    });

    appendLog(`Finished! Successfully marked ${data.successCount} of ${data.total} students.`, data.successCount > 0 ? 'success' : 'error');
    btnDone.disabled = false;
    showToast(`Bulk attendance complete: ${data.successCount} marked!`, 'success');
  } catch (err) {
    appendLog(`Execution error: ${err.message}`, 'error');
    btnDone.disabled = false;
  }
}

function appendLog(msg, type = 'info') {
  const consoleLogs = document.getElementById('consoleLogs');
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = `log-entry log-${type}`;
  entry.innerText = `[${time}] ${msg}`;
  consoleLogs.appendChild(entry);
  consoleLogs.scrollTop = consoleLogs.scrollHeight;
}

function clearConsole() {
  document.getElementById('consoleLogs').innerHTML = '';
}

function closeExecutionModal() {
  document.getElementById('executionModal').classList.remove('active');
}

// SETTINGS MODAL
async function openSettingsModal() {
  const modal = document.getElementById('settingsModal');
  modal.classList.add('active');

  const feedback = document.getElementById('testFeedback');
  feedback.style.display = 'none';

  // Load current values
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.auth) {
      document.getElementById('cfgSupabaseUrl').value = data.auth.supabaseUrl || 'https://exaoaxasdwatubavchot.supabase.co';
    }
  } catch (_) {}
}

function closeSettingsModal() {
  document.getElementById('settingsModal').classList.remove('active');
}

async function saveSettings() {
  const accessToken = document.getElementById('cfgAccessToken').value.trim();
  const refreshToken = document.getElementById('cfgRefreshToken').value.trim();
  const supabaseUrl = document.getElementById('cfgSupabaseUrl').value.trim();
  const anonKey = document.getElementById('cfgAnonKey').value.trim();

  const payload = { accessToken, refreshToken, supabaseUrl, anonKey };

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    showToast(data.message || 'Settings saved successfully!', 'success');
    await loadInitialStatus();
    closeSettingsModal();
  } catch (err) {
    showToast(`Failed to save settings: ${err.message}`, 'error');
  }
}

async function testConnection() {
  const feedback = document.getElementById('testFeedback');
  feedback.style.display = 'block';
  feedback.className = 'test-feedback';
  feedback.innerText = 'Testing connection to Supabase...';

  // Save current values first
  const accessToken = document.getElementById('cfgAccessToken').value.trim();
  const refreshToken = document.getElementById('cfgRefreshToken').value.trim();
  const supabaseUrl = document.getElementById('cfgSupabaseUrl').value.trim();
  const anonKey = document.getElementById('cfgAnonKey').value.trim();

  await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken, refreshToken, supabaseUrl, anonKey })
  });

  try {
    const res = await fetch('/api/test-connection', { method: 'POST' });
    const data = await res.json();

    if (data.success) {
      feedback.className = 'test-feedback success';
      feedback.innerText = `Verified: ${data.message}`;
      showToast('Connection verified!', 'success');
    } else {
      feedback.className = 'test-feedback error';
      feedback.innerText = `Failed: ${data.message}`;
      showToast('Connection test failed', 'error');
    }
    await loadInitialStatus();
  } catch (err) {
    feedback.className = 'test-feedback error';
    feedback.innerText = `Network error: ${err.message}`;
  }
}

async function refreshToken() {
  const feedback = document.getElementById('testFeedback');
  feedback.style.display = 'block';
  feedback.className = 'test-feedback';
  feedback.innerText = 'Calling Supabase Auth to refresh token...';

  try {
    const res = await fetch('/api/refresh-token', { method: 'POST' });
    const data = await res.json();

    if (data.success) {
      feedback.className = 'test-feedback success';
      feedback.innerText = 'Success: New Access Token retrieved and saved!';
      showToast('Token refreshed!', 'success');
      await loadInitialStatus();
    } else {
      feedback.className = 'test-feedback error';
      feedback.innerText = `Refresh failed: ${data.message}`;
    }
  } catch (err) {
    feedback.className = 'test-feedback error';
    feedback.innerText = `Error: ${err.message}`;
  }
}

async function syncStudents() {
  const feedback = document.getElementById('testFeedback');
  feedback.style.display = 'block';
  feedback.className = 'test-feedback';
  feedback.innerText = 'Syncing students roster from Supabase...';

  try {
    const res = await fetch('/api/sync-students', { method: 'POST' });
    const data = await res.json();

    if (data.success) {
      feedback.className = 'test-feedback success';
      feedback.innerText = data.message;
      showToast(data.message, 'success');
    } else {
      feedback.className = 'test-feedback error';
      feedback.innerText = `Sync failed: ${data.message}`;
    }
  } catch (err) {
    feedback.className = 'test-feedback error';
    feedback.innerText = `Error: ${err.message}`;
  }
}

// Helpers
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerText = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
