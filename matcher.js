// Name matching engine for students

function normalizeString(str) {
  if (!str) return '';
  return str
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .replace(/^(mr|mrs|ms|miss|dr|engr|pastor|bro|sis)\.?\s+/i, '') // remove titles
    .replace(/[^a-z0-9\s]/g, ' ') // replace punctuation with spaces
    .replace(/\s+/g, ' ')
    .trim();
}

// Levenshtein distance for fuzzy matching
function levenshteinDistance(s1, s2) {
  const m = s1.length;
  const n = s2.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }
  return dp[m][n];
}

function similarityScore(s1, s2) {
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1;
  const dist = levenshteinDistance(s1, s2);
  return (maxLen - dist) / maxLen;
}

/**
 * Match a raw uploaded record to the student database
 * @param {Object} query - { rawName, firstName, lastName, email }
 * @param {Array} campusStudents - Students in active campus
 * @param {Array} allStudents - Full roster (for cross-campus lookup)
 * @param {Array} campuses - List of campuses for metadata
 */
function findBestStudentMatch(query, campusStudents, allStudents = [], campuses = []) {
  const campusMap = new Map((campuses || []).map(c => [c.id, c.campus_name]));

  // Normalize query emails — support both single `email` and array `emails`
  const queryEmails = [
    ...(Array.isArray(query.emails) ? query.emails : []),
    ...(query.email ? [query.email] : [])
  ]
    .map(e => e.trim().toLowerCase())
    .filter(Boolean)
    .filter((e, i, arr) => arr.indexOf(e) === i); // dedupe

  // Helper: check if a student record matches ANY of the query emails
  function studentEmailMatches(s) {
    if (!queryEmails.length) return false;
    const studentFields = [s.email, s.official_email, s.l2e_email, s.njfp_email]
      .map(f => (f || '').trim().toLowerCase())
      .filter(Boolean);
    return queryEmails.some(qe => studentFields.includes(qe));
  }

  // ── Email match (highest priority, deterministic) ──────────────────────────
  if (queryEmails.length) {
    // Check campus students first
    const emailMatchInCampus = campusStudents.find(studentEmailMatches);

    if (emailMatchInCampus) {
      return {
        status: 'matched',
        confidence: 100,
        matchType: 'Email Match',
        student: {
          id: emailMatchInCampus.id,
          first_name: emailMatchInCampus.first_name,
          last_name: emailMatchInCampus.last_name,
          email: emailMatchInCampus.email,
          student_id_number: emailMatchInCampus.student_id_number,
          campus_id: emailMatchInCampus.campus_id,
          campus_name: campusMap.get(emailMatchInCampus.campus_id) || 'Current Campus'
        },
        inTargetCampus: true
      };
    }

    // Check other campuses
    const campusCampusId = campusStudents[0] && campusStudents[0].campus_id;
    const emailMatchOther = allStudents.find(
      s => s.campus_id !== campusCampusId && studentEmailMatches(s)
    );

    if (emailMatchOther) {
      const otherCampusName = campusMap.get(emailMatchOther.campus_id) || 'Other Campus';
      return {
        status: 'other_campus',
        confidence: 100,
        matchType: `Email Match (Registered in ${otherCampusName})`,
        student: {
          id: emailMatchOther.id,
          first_name: emailMatchOther.first_name,
          last_name: emailMatchOther.last_name,
          email: emailMatchOther.email,
          student_id_number: emailMatchOther.student_id_number,
          campus_id: emailMatchOther.campus_id,
          campus_name: otherCampusName
        },
        inTargetCampus: false
      };
    }
  }
  // ── End email check ─────────────────────────────────────────────────────────

  // Build clean search strings
  let queryFirst = normalizeString(query.firstName || '');
  let queryLast = normalizeString(query.lastName || '');
  let rawCombined = normalizeString(query.rawName || `${queryFirst} ${queryLast}`.trim());

  if (!rawCombined) {
    return {
      status: 'unmatched',
      confidence: 0,
      match: null,
      message: 'Empty name provided'
    };
  }

  const queryTokens = rawCombined.split(' ').filter(t => t.length > 1);

  // Helper to score a candidate against the query
  function evaluateCandidate(student) {
    const sFirst = normalizeString(student.first_name);
    const sLast = normalizeString(student.last_name);
    const sDirect = `${sFirst} ${sLast}`.trim();
    const sReversed = `${sLast} ${sFirst}`.trim();
    const sTokens = [sFirst, sLast].join(' ').split(' ').filter(t => t.length > 1);

    // 1. Exact direct match
    if (rawCombined === sDirect || (queryFirst === sFirst && queryLast === sLast)) {
      return { score: 100, type: 'Exact Match' };
    }

    // 2. Exact reversed match (Surname First)
    if (rawCombined === sReversed || (queryFirst === sLast && queryLast === sFirst)) {
      return { score: 98, type: 'Reversed Name Match (Surname First)' };
    }

    // 3. Token set equivalence (e.g. all words match regardless of order)
    if (queryTokens.length >= 2 && sTokens.length >= 2) {
      const qInS = queryTokens.every(t => sTokens.includes(t));
      const sInQ = sTokens.every(t => queryTokens.includes(t));
      if (qInS && sInQ) {
        return { score: 95, type: 'Full Token Match' };
      }
      if (sInQ && queryTokens.length > sTokens.length) {
        // Query has extra middle names e.g. "Wellington Chukwuemeka Dede"
        return { score: 90, type: 'Middle Name / Substring Match' };
      }
      if (qInS && sTokens.length > queryTokens.length) {
        return { score: 88, type: 'Partial Name Match' };
      }
    }

    // 4. One token exact match + other token high fuzzy match
    if (queryTokens.length >= 2 && sTokens.length >= 2) {
      const [q1, q2] = queryTokens;
      const simDirect = (similarityScore(q1, sFirst) + similarityScore(q2, sLast)) / 2;
      const simRev = (similarityScore(q1, sLast) + similarityScore(q2, sFirst)) / 2;
      const bestSim = Math.max(simDirect, simRev);

      if (bestSim >= 0.85) {
        return {
          score: Math.round(bestSim * 90),
          type: bestSim >= 0.9 ? 'Close Typo Match' : 'Fuzzy Match'
        };
      }
    }

    // 5. Full string similarity
    const fullSim = Math.max(similarityScore(rawCombined, sDirect), similarityScore(rawCombined, sReversed));
    if (fullSim >= 0.82) {
      return {
        score: Math.round(fullSim * 85),
        type: 'Fuzzy Match'
      };
    }

    return { score: 0, type: 'No Match' };
  }

  // First pass: evaluate against active campus students
  let bestCandidate = null;
  let highestScore = 0;
  let matchType = '';

  for (const student of campusStudents) {
    const evalRes = evaluateCandidate(student);
    if (evalRes.score > highestScore) {
      highestScore = evalRes.score;
      bestCandidate = student;
      matchType = evalRes.type;
      if (highestScore === 100) break; // Maximum score, stop early
    }
  }

  if (bestCandidate && highestScore >= 75) {
    return {
      status: highestScore >= 85 ? 'matched' : 'fuzzy',
      confidence: highestScore,
      matchType: matchType,
      student: {
        id: bestCandidate.id,
        first_name: bestCandidate.first_name,
        last_name: bestCandidate.last_name,
        email: bestCandidate.email,
        student_id_number: bestCandidate.student_id_number,
        campus_id: bestCandidate.campus_id,
        campus_name: campusMap.get(bestCandidate.campus_id) || 'Current Campus'
      },
      inTargetCampus: true
    };
  }

  // Second pass: if not found in current campus, check other campuses
  if (allStudents && allStudents.length > 0) {
    let crossCandidate = null;
    let crossScore = 0;
    let crossType = '';

    for (const student of allStudents) {
      if (student.campus_id === (campusStudents[0] && campusStudents[0].campus_id)) continue;
      const evalRes = evaluateCandidate(student);
      if (evalRes.score > crossScore) {
        crossScore = evalRes.score;
        crossCandidate = student;
        crossType = evalRes.type;
        if (crossScore === 100) break;
      }
    }

    if (crossCandidate && crossScore >= 85) {
      const otherCampusName = campusMap.get(crossCandidate.campus_id) || 'Other Campus';
      return {
        status: 'other_campus',
        confidence: crossScore,
        matchType: `${crossType} (Registered in ${otherCampusName})`,
        student: {
          id: crossCandidate.id,
          first_name: crossCandidate.first_name,
          last_name: crossCandidate.last_name,
          email: crossCandidate.email,
          student_id_number: crossCandidate.student_id_number,
          campus_id: crossCandidate.campus_id,
          campus_name: otherCampusName
        },
        inTargetCampus: false
      };
    }
  }

  return {
    status: 'unmatched',
    confidence: 0,
    matchType: 'Not Found',
    student: null,
    message: 'No student record matched this name'
  };
}

module.exports = {
  normalizeString,
  findBestStudentMatch,
  similarityScore
};
