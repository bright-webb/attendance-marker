const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const { findBestStudentMatch } = require('./matcher');
const supabaseService = require('./supabaseService');

const app = express();
const PORT = process.env.PORT || 3000;

// ROOT_DIR: works in local dev (__dirname = project root) AND on Vercel where
// @vercel/node bundles via ncc — in that case __dirname becomes something like
// /var/task while the included files land at process.cwd(). We try __dirname
// first and fall back to process.cwd() so file lookups always resolve correctly.
function resolveRoot(...segments) {
  const fromDirname = path.join(__dirname, ...segments);
  if (fs.existsSync(fromDirname)) return fromDirname;
  const fromCwd = path.join(process.cwd(), ...segments);
  if (fs.existsSync(fromCwd)) return fromCwd;
  // Return the __dirname version as the canonical path even if missing,
  // so error messages make sense.
  return fromDirname;
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Serve static files — check both __dirname/public and cwd/public
const publicDir = resolveRoot('public');
app.use(express.static(publicDir));

// Configure multer for file uploads in memory
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Cache for campuses and students
let campuses = [];
let students = [];
const DEFAULT_CAMPUS_ID = '4a015b33-e179-4927-816a-a9ec80f13bfd'; // CTEC PORTHARCOURT - RIVERS

function loadLocalData() {
  try {
    const campusPath = resolveRoot('campus_select.txt');
    if (fs.existsSync(campusPath)) {
      const rawCampuses = fs.readFileSync(campusPath, 'utf8');
      const lastBracket = rawCampuses.lastIndexOf(']');
      if (lastBracket !== -1) {
        campuses = JSON.parse(rawCampuses.substring(0, lastBracket + 1));
      }
    }
  } catch (err) {
    console.error('Error loading campus_select.txt:', err.message);
  }

  try {
    const studentsPath = resolveRoot('students.txt');
    if (fs.existsSync(studentsPath)) {
      const rawStudents = fs.readFileSync(studentsPath, 'utf8');
      const lastBracket = rawStudents.lastIndexOf(']');
      if (lastBracket !== -1) {
        students = JSON.parse(rawStudents.substring(0, lastBracket + 1));
      }
    }
  } catch (err) {
    console.error('Error loading students.txt:', err.message);
  }

  console.log(`Loaded ${campuses.length} campuses and ${students.length} students into cache.`);
}

loadLocalData();

// Helper: Normalize column names
function normalizeKey(k) {
  return (k || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Helper: Extract name information from a row object
function extractNameFromRow(row) {
  const keys = Object.keys(row);
  let firstName = '';
  let lastName = '';
  let fullName = '';
  const emails = []; // collect all email columns

  for (const k of keys) {
    const nk = normalizeKey(k);
    const val = (row[k] !== undefined && row[k] !== null) ? String(row[k]).trim() : '';
    if (!val) continue;

    if (nk === 'firstname' || nk === 'fname' || nk === 'first') {
      firstName = val;
    } else if (nk === 'lastname' || nk === 'lname' || nk === 'surname' || nk === 'last') {
      lastName = val;
    } else if (nk === 'name' || nk === 'fullname' || nk === 'studentname' || nk === 'student') {
      fullName = val;
    } else if (nk.includes('email') || nk === 'mail') {
      // Collect every email column — matcher will try all of them
      if (val.includes('@')) {
        emails.push(val.toLowerCase());
      }
    }
  }

  // If separate names weren't found, or if raw row is an array / positional
  if (!firstName && !lastName && !fullName) {
    const values = Object.values(row).map(v => (v ? String(v).trim() : '')).filter(Boolean);
    if (values.length === 1) {
      fullName = values[0];
    } else if (values.length >= 2) {
      firstName = values[0];
      lastName = values[1];
    }
  }

  return {
    firstName,
    lastName,
    emails,                                    // all detected email columns
    email: emails[0] || '',                    // keep backward-compat primary
    rawName: fullName || `${firstName} ${lastName}`.trim()
  };
}

// --- API ROUTES ---

// 1. Get Application Status & Stats
app.get('/api/status', (req, res) => {
  const authStatus = supabaseService.getStatus();
  const defaultCampus = campuses.find(c => c.id === DEFAULT_CAMPUS_ID);

  res.json({
    auth: authStatus,
    campusesCount: campuses.length,
    studentsCount: students.length,
    defaultCampus: defaultCampus || {
      id: DEFAULT_CAMPUS_ID,
      campus_name: 'CTEC PORTHARCOURT - RIVERS'
    }
  });
});

// 2. Get Campuses
app.get('/api/campuses', (req, res) => {
  res.json(campuses);
});

// 3. Get Students (optional campus filter)
app.get('/api/students', (req, res) => {
  const { campus_id, search } = req.query;
  let result = students;

  if (campus_id && campus_id !== 'all') {
    result = result.filter(s => s.campus_id === campus_id);
  }

  if (search) {
    const q = search.toLowerCase();
    result = result.filter(s =>
      (s.first_name && s.first_name.toLowerCase().includes(q)) ||
      (s.last_name && s.last_name.toLowerCase().includes(q)) ||
      (s.student_id_number && s.student_id_number.toLowerCase().includes(q)) ||
      (s.email && s.email.toLowerCase().includes(q))
    );
  }

  res.json({
    total: result.length,
    students: result.slice(0, 100) // Paginated slice for fast UI response
  });
});

// 4. Update / Save Configuration
app.post('/api/config', (req, res) => {
  const { accessToken, refreshToken, supabaseUrl, anonKey } = req.body;
  const result = supabaseService.saveConfig({
    accessToken,
    refreshToken,
    supabaseUrl,
    anonKey
  });
  res.json(result);
});

// 5. Test Supabase Connection
app.post('/api/test-connection', async (req, res) => {
  const result = await supabaseService.testConnection();
  res.json(result);
});

// 6. Force Refresh Token
app.post('/api/refresh-token', async (req, res) => {
  try {
    const result = await supabaseService.refreshTokenIfNeeded();
    res.json({ success: true, message: 'Token refreshed successfully!', data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 7. Sync Remote Students from Supabase
app.post('/api/sync-students', async (req, res) => {
  try {
    console.log('Starting full student sync (paginated)…');
    const remoteStudents = await supabaseService.fetchRemoteStudents();
    if (Array.isArray(remoteStudents) && remoteStudents.length > 0) {
      students = remoteStudents;

      // Persist the full roster to students.txt so it survives server restarts
      try {
        fs.writeFileSync(
          resolveRoot('students.txt'),
          JSON.stringify(students),
          'utf8'
        );
        console.log(`Persisted ${students.length} students to students.txt`);
      } catch (writeErr) {
        console.warn('Could not persist students.txt:', writeErr.message);
      }

      res.json({
        success: true,
        message: `Successfully synced ${students.length} students from Supabase.`,
        total: students.length
      });
    } else {
      res.status(400).json({ success: false, message: 'No students received from endpoint.' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 8. Upload and Parse CSV / Excel File
app.post('/api/parse-upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded.' });
  }

  const campusId = req.body.campusId || DEFAULT_CAMPUS_ID;
  const campusStudents = campusId === 'all'
    ? students
    : students.filter(s => s.campus_id === campusId);

  try {
    // Read buffer with xlsx (supports CSV, XLS, XLSX)
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return res.status(400).json({ success: false, message: 'Uploaded file has no readable sheets.' });
    }

    const worksheet = workbook.Sheets[sheetName];
    const rawRows = xlsx.utils.sheet_to_json(worksheet, { defval: '' });

    if (!rawRows || rawRows.length === 0) {
      return res.status(400).json({ success: false, message: 'The uploaded sheet is empty.' });
    }

    const parsedResults = [];
    const seenStudentIds = new Set();

    rawRows.forEach((row, index) => {
      const extracted = extractNameFromRow(row);
      if (!extracted.rawName && !extracted.email) return; // Skip completely empty rows

      const matchResult = findBestStudentMatch(extracted, campusStudents, students, campuses);

      let isDuplicate = false;
      if (matchResult.student && matchResult.student.id) {
        if (seenStudentIds.has(matchResult.student.id)) {
          isDuplicate = true;
        } else {
          seenStudentIds.add(matchResult.student.id);
        }
      }

      parsedResults.push({
        rowNumber: index + 1,
        inputName: extracted.rawName,
        firstNameInput: extracted.firstName,
        lastNameInput: extracted.lastName,
        emailInput: extracted.email || '',
        status: matchResult.status,
        confidence: matchResult.confidence,
        matchType: matchResult.matchType,
        inTargetCampus: matchResult.inTargetCampus,
        isDuplicate,
        matchedStudent: matchResult.student,
        // Selected by default if matched in target campus and not duplicate
        selected: (matchResult.status === 'matched' || matchResult.status === 'fuzzy') && !isDuplicate
      });
    });

    const summary = {
      totalRows: parsedResults.length,
      matchedCount: parsedResults.filter(r => r.status === 'matched' && r.inTargetCampus).length,
      fuzzyCount: parsedResults.filter(r => r.status === 'fuzzy' && r.inTargetCampus).length,
      otherCampusCount: parsedResults.filter(r => r.status === 'other_campus').length,
      unmatchedCount: parsedResults.filter(r => r.status === 'unmatched').length,
      duplicateCount: parsedResults.filter(r => r.isDuplicate).length
    };

    res.json({
      success: true,
      filename: req.file.originalname,
      targetCampusId: campusId,
      summary,
      results: parsedResults
    });
  } catch (err) {
    console.error('File parsing error:', err);
    res.status(500).json({ success: false, message: `Failed to parse file: ${err.message}` });
  }
});

// 9. Batch Mark Attendance
app.post('/api/mark-attendance', async (req, res) => {
  const { items, date, status } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: 'No students provided to mark attendance.' });
  }

  const attendanceDate = date || new Date().toISOString().split('T')[0];
  const attendanceStatus = status || 'present';

  // Pre-warm: attempt one token refresh before the batch so the access token is
  // fresh and individual 401 → refresh storms don't hit Supabase's rate limit.
  try {
    await supabaseService.refreshTokenIfNeeded();
  } catch (_) {
    // Non-fatal — the existing token may still be valid; continue anyway.
  }

  const executionResults = [];
  let successCount = 0;
  let failureCount = 0;

  for (const item of items) {
    if (!item.studentId) {
      executionResults.push({
        inputName: item.inputName,
        studentName: item.studentName || 'Unknown',
        success: false,
        error: 'Missing student ID'
      });
      failureCount++;
      continue;
    }

    try {
      const response = await supabaseService.markStudentAttendance(
        item.studentId,
        attendanceDate,
        attendanceStatus
      );

      if (response.success) {
        successCount++;
        executionResults.push({
          studentId: item.studentId,
          inputName: item.inputName,
          studentName: item.studentName,
          success: true,
          date: attendanceDate,
          status: attendanceStatus
        });
      } else {
        failureCount++;
        executionResults.push({
          studentId: item.studentId,
          inputName: item.inputName,
          studentName: item.studentName,
          success: false,
          error: response.error || 'Failed to mark attendance'
        });
      }
    } catch (err) {
      failureCount++;
      executionResults.push({
        studentId: item.studentId,
        inputName: item.inputName,
        studentName: item.studentName,
        success: false,
        error: err.message
      });
    }

    // 150ms gap between calls — enough breathing room for Supabase rate limits
    await new Promise(resolve => setTimeout(resolve, 150));
  }

  res.json({
    success: failureCount === 0,
    total: items.length,
    successCount,
    failureCount,
    date: attendanceDate,
    status: attendanceStatus,
    results: executionResults
  });
});

// 12. Sample CSV Download
app.get('/api/sample-csv', (req, res) => {
  const sampleData = [
    ['first_name', 'last_name', 'email'],
    ['Wellington', 'Dede', 'wellington.dede@example.com'],
    ['Oscar', 'Upadhi', 'oscar.upadhi@example.com'],
    ['Anthony', 'Ani', 'anthony.ani@example.com'],
    ['Emmanuel', 'Napoleon', 'emmanuel.napoleon@example.com'],
    ['Michael', 'Onome', ''],
    ['Prince', 'George', ''],
    ['Precious', 'Eze', '']
  ];
  const csvContent = sampleData.map(e => e.join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="sample_attendance_phc.csv"');
  res.send(csvContent);
});

// 11. Export Unmatched Names as XLSX
app.post('/api/export-unmatched', (req, res) => {
  const { unmatched } = req.body;

  if (!Array.isArray(unmatched) || unmatched.length === 0) {
    return res.status(400).json({ success: false, message: 'No unmatched records provided.' });
  }

  try {
    const wsData = unmatched.map(r => ({
      'Row #': r.rowNumber,
      'Uploaded Name': r.inputName || '',
      'First Name Input': r.firstNameInput || '',
      'Last Name Input': r.lastNameInput || '',
      'Email Input': r.emailInput || '',
      'Status': r.status || 'unmatched'
    }));

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(wsData);

    // Set column widths for readability
    ws['!cols'] = [
      { wch: 8 },  // Row #
      { wch: 30 }, // Uploaded Name
      { wch: 20 }, // First Name Input
      { wch: 20 }, // Last Name Input
      { wch: 30 }, // Email Input
      { wch: 12 }  // Status
    ];

    xlsx.utils.book_append_sheet(wb, ws, 'Unmatched Names');
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="unmatched_names.xlsx"');
    res.send(buffer);
  } catch (err) {
    console.error('Export unmatched error:', err);
    res.status(500).json({ success: false, message: `Export failed: ${err.message}` });
  }
});

// 13. Sample Excel Download
app.get('/api/sample-excel', (req, res) => {
  const wb = xlsx.utils.book_new();
  const wsData = [
    { 'Full Name': 'Wellington Dede', 'Email': 'wellington.dede@example.com', 'Note': 'Present' },
    { 'Full Name': 'Upadhi Oscar', 'Email': 'oscar.upadhi@example.com', 'Note': 'Present (Surname First)' },
    { 'Full Name': 'Ani Anthony', 'Email': '', 'Note': 'Present (Surname First, no email)' },
    { 'Full Name': 'Napoleon Emmanuel', 'Email': 'emmanuel.napoleon@example.com', 'Note': 'Present' },
    { 'Full Name': 'Onome Michael', 'Email': '', 'Note': 'Present (name match only)' }
  ];
  const ws = xlsx.utils.json_to_sheet(wsData);
  xlsx.utils.book_append_sheet(wb, ws, 'Attendance');
  const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="sample_attendance_phc.xlsx"');
  res.send(buffer);
});

// Export app for serverless environments (e.g. Vercel)
module.exports = app;

// Only start the HTTP server when running directly (local dev)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🚀 CTECH Attendance Automation Platform is running!`);
    console.log(`🌐 Local Web Portal: http://localhost:${PORT}`);
    console.log(`📍 Default Campus: CTEC PORTHARCOURT - RIVERS`);
    console.log(`=======================================================`);
  });
}
