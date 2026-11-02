# CTECH Attendance Automation Platform

A automated bulk attendance marking system built for CTECH administrators and coordinators. Instead of manually clicking through students one by one on the portal, this platform allows uploading student rosters via CSV or Excel and automatically marks their attendance via the Supabase attendance API.

---

## 🚀 Features

- **Port Harcourt CTEC by Default**: Automatically pre-selects `CTEC PORTHARCOURT - RIVERS` (140 students preloaded from roster).
- **Multi-Format Uploads**: Supports **Excel (.xlsx, .xls)** and **CSV (.csv)** files.
- **Smart Name Matching Engine**:
  - Handles **Exact Name Matching** (e.g. `Wellington Dede`).
  - Handles **Reversed Name Matching / Surname-first** (e.g. `Dede Wellington`).
  - Handles **Partial / Middle Name variations** (e.g. `Anthony Chidera Ani` vs `Anthony Ani`).
  - Handles **Typo tolerance** and flags fuzzy matches for quick verification.
  - Automatically identifies students if they are registered under another campus.
- **Token Management & Auto-Refresh**:
  - Reads `access_token` and `refresh_token` from `.env`.
  - In-app **Settings & Tokens modal** where you can paste, test, and save tokens without manually editing files.
  - Built-in token refresh handler when tokens expire.
- **Preview & Reconciliation**:
  - Shows exact match confidence score for each student.
  - Detects duplicate names in the uploaded sheet.
  - Allows selecting / deselecting individual students before executing.
- **Bulk Execution with Live Feedback**:
  - Real-time progress bar and live terminal log showing results as requests are submitted.
  - Rate-limit friendly with built-in request throttling.

---

## 🛠️ Quick Start

### 1. Start the Server
```bash
npm start
```
The application will start at: **`http://localhost:3000`**

### 2. Configure Your Tokens
1. Open [http://localhost:3000](http://localhost:3000) in your browser.
2. Click on **"Tokens & Settings"** in the top navigation bar.
3. Paste your full `access_token` (JWT) and `refresh_token`.
4. Click **"Test Connection"** to verify that Supabase accepts the credentials, then click **"Save & Apply"**.

### 3. Mark Attendance
1. Choose the **Target Campus** (default is `CTEC PORTHARCOURT - RIVERS`).
2. Pick the **Attendance Date** (defaults to today) and **Status** (`present`).
3. Drag & drop your **CSV or Excel file** into the upload area (or download the sample files provided on the dashboard).
4. Review the matched roster in the preview table.
5. Click **"Mark Attendance for X Students"** to run the bulk submission.

---

## 📁 File Structure

- `server.js` - Express backend server and file parsing endpoints.
- `matcher.js` - Intelligent student name matching engine (exact, reversed, fuzzy, token set).
- `supabaseService.js` - Supabase RPC caller, token manager, and auto-refresh handler.
- `public/` - Modern dashboard frontend (`index.html`, `style.css`, `app.js`).
- `students.txt` - Student roster data.
- `campus_select.txt` - Campus reference list.
- `.env` - Environment variables for API keys and tokens.
# attendance-marker
