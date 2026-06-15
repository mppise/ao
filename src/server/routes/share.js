'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { readJSON } = require('../../utils/file-io');
const { createToken, findToken, revokeToken, incrementAccess, listTokens } = require('../../lib/shareTokens');
const { shareGenerateRateLimit, shareViewRateLimit } = require('../middleware/rateLimit');

const router = express.Router();

const TOKEN_PATTERN = /^[a-f0-9]{32}$/;

/** Standard envelopes */
function ok(data) {
  return { success: true, data, error: null, timestamp: new Date().toISOString() };
}
function err(code, message) {
  return { success: false, data: null, error: { code, message }, timestamp: new Date().toISOString() };
}

/** Check if request is from localhost */
function isLocalhost(req) {
  const addr = req.socket.remoteAddress || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/** Base URL for constructing share links */
function baseUrl(req) {
  return `http://localhost:${process.env.PORT || 3000}`;
}

// ── POST /api/share/generate ─────────────────────────────────────────────────

router.post('/generate', shareGenerateRateLimit, (req, res) => {
  if (!isLocalhost(req)) {
    return res.status(403).json(err('FORBIDDEN', 'Share management is only available from localhost.'));
  }

  const dataDir = process.env.DATA_DIR || null;
  if (!dataDir) {
    return res.status(500).json(err('DATA_DIR_MISSING', 'Data directory is not configured.'));
  }

  const { durationDays } = req.body;

  if (durationDays === undefined || durationDays === null) {
    return res.status(400).json(err('INVALID_DURATION', 'durationDays is required.'));
  }
  if (!Number.isInteger(Number(durationDays)) || String(durationDays).includes('.')) {
    return res.status(400).json(err('INVALID_DURATION', 'durationDays must be an integer.'));
  }
  const days = parseInt(durationDays, 10);
  if (days < 1 || days > 30) {
    return res.status(400).json(err('INVALID_DURATION', 'durationDays must be between 1 and 30.'));
  }

  try {
    const entry = createToken(dataDir, days);
    const url = `${baseUrl(req)}/share/${entry.token}`;
    return res.json(ok({
      token: entry.token,
      url,
      expiresAt: entry.expiresAt,
      durationDays: days,
    }));
  } catch (e) {
    console.error('[share/generate] error:', e.message);
    return res.status(500).json(err('SHARE_WRITE_FAILED', 'Could not save shareable link. Try again.'));
  }
});

// ── GET /api/share/list ──────────────────────────────────────────────────────

router.get('/list', (req, res) => {
  if (!isLocalhost(req)) {
    return res.status(403).json(err('FORBIDDEN', 'Share management is only available from localhost.'));
  }

  const dataDir = process.env.DATA_DIR || null;
  if (!dataDir) {
    return res.json(ok({ tokens: [] }));
  }

  const tokens = listTokens(dataDir, baseUrl(req));
  return res.json(ok({ tokens }));
});

// ── DELETE /api/share/:token ─────────────────────────────────────────────────

router.delete('/:token', (req, res) => {
  if (!isLocalhost(req)) {
    return res.status(403).json(err('FORBIDDEN', 'Share management is only available from localhost.'));
  }

  const { token } = req.params;
  if (!TOKEN_PATTERN.test(token)) {
    return res.status(400).json(err('INVALID_TOKEN', 'Token format is invalid.'));
  }

  const dataDir = process.env.DATA_DIR || null;
  if (!dataDir) {
    return res.status(404).json(err('TOKEN_NOT_FOUND', 'Shareable link not found.'));
  }

  let entry;
  try {
    entry = findToken(dataDir, token);
  } catch (e) {
    return res.status(404).json(err('TOKEN_NOT_FOUND', 'Shareable link not found.'));
  }

  if (!entry) {
    return res.status(404).json(err('TOKEN_NOT_FOUND', 'Shareable link not found.'));
  }

  if (entry.revoked) {
    return res.json(ok({ token, revoked: true }));
  }

  try {
    revokeToken(dataDir, token);
    return res.json(ok({ token, revoked: true }));
  } catch (e) {
    console.error('[share/revoke] error:', e.message);
    return res.status(500).json(err('SHARE_WRITE_FAILED', 'Could not revoke link. Try again.'));
  }
});

// ── GET /share/:token  (public page — not under /api) ─────────────────────
// This is registered separately on the app in server/index.js

/**
 * Safely extract a scalar value from a profile field that may be a citation
 * object ({ value, confidence, ... }) or a plain scalar.
 */
function extractScalar(field) {
  if (field === null || field === undefined) return null;
  if (typeof field === 'object' && !Array.isArray(field) && 'value' in field) {
    return field.value;
  }
  return field;
}

/**
 * Render the public profile view HTML page.
 */
function buildProfileHTML(profileData, entry) {
  const { metadata, academic, tests, achievements, activities, impactStatements } = profileData;

  // metadata is stored at DATA_DIR/.metadata.json and has shape:
  // { student: { firstName, lastName, displayName } }
  const student = (metadata && metadata.student) || {};
  const firstName = student.firstName || 'Student';
  const lastName = student.lastName || '';
  const fullName = student.displayName || [firstName, lastName].filter(Boolean).join(' ');

  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const expiryStr = new Date(entry.expiresAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // academic.json (merged flat): { gpa: { overall: { value } }, schoolName: { value }, courses: [{ name, grade, ... }] }
  // gpa may also be a plain number or a citation object
  const rawGpa = academic ? (academic.gpa && academic.gpa.overall !== undefined ? academic.gpa.overall : academic.gpa) : null;
  const gpaValue = extractScalar(rawGpa);
  const gpaScale = extractScalar(academic ? (academic.gpaScale !== undefined ? academic.gpaScale : null) : null);
  const gpaDisplay = gpaValue !== null ? (gpaScale !== null ? `${gpaValue} / ${gpaScale}` : String(gpaValue)) : null;

  const rawSchool = academic ? (academic.schoolName !== undefined ? academic.schoolName : academic.school) : null;
  const school = extractScalar(rawSchool);

  const rawCourses = academic && Array.isArray(academic.courses) ? academic.courses : [];
  // Courses are objects with { name, grade, level, ... }; extract display strings
  const courseNames = rawCourses
    .map((c) => (typeof c === 'object' && c !== null ? (c.name || '') : String(c || '')))
    .filter(Boolean);

  // tests.json (merged flat): { sat: { score: { total, math, ebrw }, dateTaken }, act: { score: { composite }, dateTaken }, ap: [...], ib: [...], other: [...] }
  const testEntries = [];
  if (tests) {
    if (tests.sat && tests.sat.score) {
      const total = tests.sat.score.total || (tests.sat.score.math && tests.sat.score.ebrw ? tests.sat.score.math + tests.sat.score.ebrw : null);
      if (total !== null && total !== undefined) {
        const datePart = tests.sat.dateTaken ? ` (${tests.sat.dateTaken})` : '';
        testEntries.push(`SAT: ${total}${datePart}`);
      }
    }
    if (tests.act && tests.act.score) {
      const composite = tests.act.score.composite;
      if (composite !== null && composite !== undefined) {
        const datePart = tests.act.dateTaken ? ` (${tests.act.dateTaken})` : '';
        testEntries.push(`ACT: ${composite}${datePart}`);
      }
    }
    if (Array.isArray(tests.ap)) {
      for (const ap of tests.ap) {
        const datePart = ap.dateTaken ? ` (${ap.dateTaken})` : '';
        testEntries.push(`AP ${ap.examName || 'Exam'}: ${ap.score !== undefined ? ap.score : ''}${datePart}`);
      }
    }
    if (Array.isArray(tests.ib)) {
      for (const ib of tests.ib) {
        const datePart = ib.dateTaken ? ` (${ib.dateTaken})` : '';
        testEntries.push(`IB ${ib.subject || 'Exam'}: ${ib.score !== undefined ? ib.score : ''}${datePart}`);
      }
    }
    if (Array.isArray(tests.other)) {
      for (const o of tests.other) {
        const datePart = o.dateTaken ? ` (${o.dateTaken})` : '';
        testEntries.push(`${o.examName || 'Other Exam'}${datePart}`);
      }
    }
  }

  // achievements.json (merged flat): { achievements: [{ title, awardName, description, issuingOrganization, dateAwarded }] }
  const achList = achievements && Array.isArray(achievements.achievements) ? achievements.achievements : [];

  // activities.json (merged flat): { activities: [{ title, activityName, role, organization, duration }] }
  const actList = activities && Array.isArray(activities.activities) ? activities.activities : [];

  // impact_statements.json: { data: { statements: [{ statement, status, ... }] } }
  const allStmts = (impactStatements && impactStatements.data && Array.isArray(impactStatements.data.statements))
    ? impactStatements.data.statements
    : [];

  const approved = allStmts.filter((s) => s.status === 'approved');
  let shownStmts = approved.slice(0, 5);
  if (shownStmts.length < 5) shownStmts = shownStmts.concat(allStmts.filter((s) => s.status !== 'approved').slice(0, 5 - shownStmts.length));

  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const academicHTML = `
    <section class="mb-4">
      <h2 class="h5 text-uppercase fw-bold border-bottom pb-1 mb-3">Academic Summary</h2>
      ${gpaDisplay !== null ? `<p><strong>GPA:</strong> ${esc(gpaDisplay)}</p>` : ''}
      ${school ? `<p><strong>School:</strong> ${esc(school)}</p>` : ''}
      ${courseNames.length > 0 ? `<p><strong>Courses (${courseNames.length}):</strong> ${courseNames.slice(0, 10).map(esc).join(', ')}${courseNames.length > 10 ? ` ...and ${courseNames.length - 10} more` : ''}</p>` : ''}
      ${gpaDisplay === null && !school && courseNames.length === 0 ? '<p class="text-muted">No academic data recorded.</p>' : ''}
    </section>`;

  const testsHTML = `
    <section class="mb-4">
      <h2 class="h5 text-uppercase fw-bold border-bottom pb-1 mb-3">Test Scores</h2>
      ${testEntries.length === 0
        ? '<p class="text-muted">No test scores recorded.</p>'
        : testEntries.map((t) => `<p>${esc(t)}</p>`).join('')}
    </section>`;

  const achHTML = `
    <section class="mb-4">
      <h2 class="h5 text-uppercase fw-bold border-bottom pb-1 mb-3">Achievements${achList.length > 0 ? ` (top ${Math.min(achList.length, 10)})` : ''}</h2>
      ${achList.length === 0
        ? '<p class="text-muted">No achievements recorded.</p>'
        : achList.slice(0, 10).map((a) => {
            const title = a.title || a.awardName || 'Achievement';
            const desc = a.description || (a.issuingOrganization ? `Awarded by ${a.issuingOrganization}${a.dateAwarded ? ` on ${a.dateAwarded}` : ''}` : '');
            return `<p>- <strong>${esc(title)}</strong>${desc ? ` — ${esc(desc)}` : ''}</p>`;
          }).join('')}
    </section>`;

  const actHTML = `
    <section class="mb-4">
      <h2 class="h5 text-uppercase fw-bold border-bottom pb-1 mb-3">Activities</h2>
      ${actList.length === 0
        ? '<p class="text-muted">No activities recorded.</p>'
        : actList.slice(0, 10).map((a) => {
            const name = a.title || a.activityName || 'Activity';
            const role = a.role ? `, ${a.role}` : '';
            const org = a.organization ? ` at ${a.organization}` : '';
            const dur = a.duration ? ` (${a.duration})` : '';
            return `<p>- <strong>${esc(name)}</strong>${esc(role)}${esc(org)}${esc(dur)}</p>`;
          }).join('')}
    </section>`;

  const stmtsHTML = `
    <section class="mb-4">
      <h2 class="h5 text-uppercase fw-bold border-bottom pb-1 mb-3">Impact Statements${shownStmts.length > 0 ? ` (top ${shownStmts.length})` : ''}</h2>
      ${shownStmts.length === 0
        ? '<p class="text-muted">No impact statements recorded.</p>'
        : shownStmts.map((s) => `<blockquote class="blockquote"><p>"${esc(s.statement || s.text || '')}"</p></blockquote>`).join('')}
    </section>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admissions Officer — Student Profile Summary</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">
</head>
<body class="bg-light">
  <div class="container py-5" style="max-width: 800px;">
    <header class="mb-4 pb-3 border-bottom">
      <h1 class="h4 text-muted mb-1">Admissions Officer — Student Profile Summary</h1>
      <h2 class="h2 fw-bold mb-1">${esc(fullName)}</h2>
      <p class="text-muted small">Profile generated: ${esc(today)}</p>
    </header>
    ${academicHTML}
    ${testsHTML}
    ${achHTML}
    ${actHTML}
    ${stmtsHTML}
    <hr>
    <footer class="text-muted small text-center">
      <p>Generated by Admissions Officer | ${esc(today)}</p>
      <p>This is a read-only view. Link expires ${esc(expiryStr)}.</p>
    </footer>
  </div>
</body>
</html>`;
}

function buildErrorHTML(title, message, statusCode) {
  const sc = esc => String(esc || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${sc(title)}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">
</head>
<body class="bg-light">
  <div class="container py-5 text-center" style="max-width: 600px;">
    <div class="card shadow-sm p-5">
      <h1 class="h3 fw-bold mb-3">${sc(title)}</h1>
      <p class="text-muted">${sc(message)}</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Public share view handler — attach to GET /share/:token on the main app.
 */
router.publicShareHandler = [
  shareViewRateLimit,
  (req, res) => {
    const { token } = req.params;

    if (!TOKEN_PATTERN.test(token)) {
      return res.status(404).send(buildErrorHTML('Link not found.', '', 404));
    }

    const dataDir = process.env.DATA_DIR || null;
    if (!dataDir || !fs.existsSync(dataDir)) {
      return res.status(404).send(buildErrorHTML('Link not found.', '', 404));
    }

    let entry;
    try {
      entry = findToken(dataDir, token);
    } catch (_) {
      return res.status(404).send(buildErrorHTML('Link not found.', '', 404));
    }

    if (!entry) {
      return res.status(404).send(buildErrorHTML('Link not found.', '', 404));
    }

    if (entry.revoked) {
      return res.status(410).send(buildErrorHTML(
        'This link is no longer available.',
        'The profile owner has deactivated this link.',
        410
      ));
    }

    if (new Date() > new Date(entry.expiresAt)) {
      return res.status(410).send(buildErrorHTML(
        'This link has expired.',
        "The profile owner's shareable link is no longer active.",
        410
      ));
    }

    // Load profile data
    function loadProfileFile(filename) {
      const p = path.join(dataDir, 'profile', filename);
      try { return fs.existsSync(p) ? readJSON(p) : null; } catch (_) { return null; }
    }
    function loadRootFile(filename) {
      const p = path.join(dataDir, filename);
      try { return fs.existsSync(p) ? readJSON(p) : null; } catch (_) { return null; }
    }

    const profileData = {
      // .metadata.json lives at DATA_DIR root, not under profile/
      metadata: loadRootFile('.metadata.json'),
      academic: loadProfileFile('academic.json'),
      tests: loadProfileFile('tests.json'),
      achievements: loadProfileFile('achievements.json'),
      activities: loadProfileFile('activities.json'),
      impactStatements: loadProfileFile('impact_statements.json'),
    };

    // Increment access counter (fire-and-forget)
    incrementAccess(dataDir, token);

    return res.status(200).send(buildProfileHTML(profileData, entry));
  },
];

module.exports = router;
