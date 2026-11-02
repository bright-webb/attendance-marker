const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const ENV_PATH = path.join(__dirname, '.env');

class SupabaseService {
  constructor() {
    this.loadConfig();
    // In-flight refresh promise — prevents duplicate refresh calls
    this._refreshPromise = null;
  }

  loadConfig() {
    // Reload env file if present
    if (fs.existsSync(ENV_PATH)) {
      const envConfig = dotenv.parse(fs.readFileSync(ENV_PATH));
      for (const k in envConfig) {
        process.env[k] = envConfig[k];
      }
    }

    this.supabaseUrl = process.env.SUPABASE_URL || 'https://exaoaxasdwatubavchot.supabase.co';
    this.accessToken = process.env.ACCESS_TOKEN || process.env.access_token || '';
    this.refreshToken = process.env.REFRESH_TOKEN || process.env.refresh_token || '';
    this.anonKey = process.env.SUPABASE_ANON_KEY || process.env.anon_key || '';
  }

  saveConfig({ accessToken, refreshToken, supabaseUrl, anonKey }) {
    if (accessToken !== undefined) this.accessToken = (accessToken || '').trim();
    if (refreshToken !== undefined) this.refreshToken = (refreshToken || '').trim();
    if (supabaseUrl !== undefined) this.supabaseUrl = (supabaseUrl || '').trim();
    if (anonKey !== undefined) this.anonKey = (anonKey || '').trim();

    // Write to .env
    const envContent = [
      `SUPABASE_URL=${this.supabaseUrl}`,
      `ACCESS_TOKEN=${this.accessToken}`,
      `REFRESH_TOKEN=${this.refreshToken}`,
      `SUPABASE_ANON_KEY=${this.anonKey}`,
      // Also write lower-case compatibility vars
      `access_token=${this.accessToken}`,
      `refresh_token=${this.refreshToken}`
    ].join('\n');

    fs.writeFileSync(ENV_PATH, envContent, 'utf8');
    this.loadConfig();
    return { success: true, message: 'Configuration saved to .env' };
  }

  getStatus() {
    const isJwtValidLooking = (token) => {
      if (!token) return false;
      const parts = token.split('.');
      return parts.length === 3;
    };

    return {
      hasAccessToken: Boolean(this.accessToken),
      hasRefreshToken: Boolean(this.refreshToken),
      isAccessTokenCompleteJwt: isJwtValidLooking(this.accessToken),
      accessTokenPreview: this.accessToken
        ? `${this.accessToken.substring(0, 10)}...${this.accessToken.substring(this.accessToken.length - 8)}`
        : null,
      refreshTokenPreview: this.refreshToken
        ? `${this.refreshToken.substring(0, 4)}...${this.refreshToken.substring(this.refreshToken.length - 4)}`
        : null,
      supabaseUrl: this.supabaseUrl,
      hasAnonKey: Boolean(this.anonKey)
    };
  }

  getHeaders() {
    const headers = {
      'Content-Type': 'application/json'
    };
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }
    // Supabase requires apikey header on REST endpoints
    const apiKey = this.anonKey || this.accessToken;
    if (apiKey) {
      headers['apikey'] = apiKey;
    }
    return headers;
  }

  async refreshTokenIfNeeded() {
    if (!this.refreshToken) {
      throw new Error('No refresh token available to renew access token.');
    }

    // Deduplicate: if a refresh is already in-flight, wait for it instead of
    // firing a second request (prevents 429 when many students hit 401 at once)
    if (this._refreshPromise) {
      return this._refreshPromise;
    }

    this._refreshPromise = (async () => {
      const refreshUrl = `${this.supabaseUrl}/auth/v1/token?grant_type=refresh_token`;
      const response = await fetch(refreshUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.anonKey || this.accessToken
        },
        body: JSON.stringify({ refresh_token: this.refreshToken })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to refresh token: ${response.status} ${errText}`);
      }

      const data = await response.json();
      if (data.access_token) {
        this.saveConfig({
          accessToken: data.access_token,
          refreshToken: data.refresh_token || this.refreshToken
        });
        return data;
      }
      throw new Error('Refresh response did not contain new access_token');
    })();

    try {
      return await this._refreshPromise;
    } finally {
      // Clear so future genuine expirations can refresh again
      this._refreshPromise = null;
    }
  }

  async testConnection() {
    if (!this.accessToken) {
      return { success: false, message: 'No access token provided.' };
    }

    const testUrl = `${this.supabaseUrl}/rest/v1/campuses?select=id,campus_name&limit=1`;
    try {
      let res = await fetch(testUrl, {
        method: 'GET',
        headers: this.getHeaders()
      });

      if (res.status === 401 && this.refreshToken) {
        // Attempt refresh
        try {
          await this.refreshTokenIfNeeded();
          res = await fetch(testUrl, {
            method: 'GET',
            headers: this.getHeaders()
          });
        } catch (refreshErr) {
          return {
            success: false,
            message: `Token expired and auto-refresh failed: ${refreshErr.message}`
          };
        }
      }

      if (res.ok) {
        const data = await res.json();
        return {
          success: true,
          message: 'Connection to Supabase verified successfully!',
          data
        };
      } else {
        const errText = await res.text();
        return {
          success: false,
          statusCode: res.status,
          message: `Supabase returned ${res.status}: ${errText}`
        };
      }
    } catch (err) {
      return { success: false, message: `Network error: ${err.message}` };
    }
  }

  /**
   * Mark attendance for a single student via RPC
   * @param {string} studentId
   * @param {string} date (YYYY-MM-DD)
   * @param {string} status (e.g. "present")
   */
  async markStudentAttendance(studentId, date, status = 'present') {
    const endpoint = `${this.supabaseUrl}/rest/v1/rpc/mark_student_attendance`;
    const payload = {
      _student_id: studentId,
      _date: date,
      _status: status
    };

    const makeRequest = async () => {
      return await fetch(endpoint, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload)
      });
    };

    let response = await makeRequest();

    // Auto-refresh token if 401 unauthorized
    if (response.status === 401 && this.refreshToken) {
      try {
        await this.refreshTokenIfNeeded();
        response = await makeRequest();
      } catch (err) {
        return {
          success: false,
          studentId,
          error: `Auth error: ${err.message}`,
          statusCode: 401
        };
      }
    }

    if (!response.ok) {
      const errText = await response.text();
      return {
        success: false,
        studentId,
        statusCode: response.status,
        error: errText || `HTTP ${response.status}`
      };
    }

    let responseData = null;
    try {
      const text = await response.text();
      responseData = text ? JSON.parse(text) : { success: true };
    } catch (_) {
      responseData = { success: true };
    }

    return {
      success: true,
      studentId,
      data: responseData
    };
  }

  /**
   * Sync latest students from Supabase — paginates through ALL records.
   * Supabase REST default page size is 1000; we keep fetching until a page
   * comes back with fewer rows than PAGE_SIZE (i.e. we've hit the end).
   */
  async fetchRemoteStudents() {
    const PAGE_SIZE = 1000;
    let allStudents = [];
    let offset = 0;

    while (true) {
      const url =
        `${this.supabaseUrl}/rest/v1/students` +
        `?select=*%2Ccampus%3Acampuses%28*%29` +
        `&is_active=eq.true` +
        `&order=id.asc` +
        `&limit=${PAGE_SIZE}` +
        `&offset=${offset}`;

      let res = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders()
      });

      // Auto-refresh once on 401
      if (res.status === 401 && this.refreshToken) {
        await this.refreshTokenIfNeeded();
        res = await fetch(url, {
          method: 'GET',
          headers: this.getHeaders()
        });
      }

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Failed to fetch students (offset=${offset}): ${res.status} ${err}`);
      }

      const page = await res.json();

      if (!Array.isArray(page) || page.length === 0) break;

      allStudents = allStudents.concat(page);
      console.log(`  Fetched ${allStudents.length} students so far (page offset=${offset})…`);

      // If we got fewer rows than PAGE_SIZE we've reached the last page
      if (page.length < PAGE_SIZE) break;

      offset += PAGE_SIZE;
    }

    return allStudents;
  }
}

module.exports = new SupabaseService();
