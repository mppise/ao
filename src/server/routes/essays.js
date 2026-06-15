'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { readJSON, writeJSON, appendAuditLog } = require('../../utils/file-io');
const { generateEssayDraft } = require('../../ai/essay');

const router = express.Router();

// ─── Rate limiting for generation (5 per 60-min rolling window, per process) ──
const GENERATION_LIMIT = 5;
const GENERATION_WINDOW_MS = 60 * 60 * 1000;
const generationTimestamps = [];

function isRateLimited() {
  const now = Date.now();
  // Remove timestamps older than the window
  while (generationTimestamps.length > 0 && now - generationTimestamps[0] > GENERATION_WINDOW_MS) {
    generationTimestamps.shift();
  }
  return generationTimestamps.length >= GENERATION_LIMIT;
}

function recordGeneration() {
  generationTimestamps.push(Date.now());
}

// ─── UUID v4 validation ────────────────────────────────────────────────────────
const UUID_V4_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function isValidUUIDv4(id) {
  return UUID_V4_RE.test(id);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function envelope(success, data, error = null) {
  return { success, data, error, timestamp: new Date().toISOString() };
}

function getDataDir() {
  return process.env.DATA_DIR || null;
}

function getEssaysPath(dataDir) {
  return path.join(dataDir, 'profile', 'essays.json');
}

function readEssays(dataDir) {
  try {
    return readJSON(getEssaysPath(dataDir));
  } catch (_) {
    return null;
  }
}

function writeEssays(dataDir, fileData) {
  writeJSON(getEssaysPath(dataDir), fileData);
}

function initEssaysFile() {
  return {
    schemaVersion: '1.1.0',
    lastUpdated: new Date().toISOString(),
    data: { drafts: [] },
  };
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ─── GET /api/essays/provenance ───────────────────────────────────────────────

router.get('/provenance', (req, res) => {
  const dataDir = getDataDir();
  if (!dataDir || !fs.existsSync(dataDir)) {
    return res.status(503).json(
      envelope(false, null, { code: 'DATA_DIR_UNAVAILABLE', message: 'Data directory not accessible.' })
    );
  }

  const profileDir = path.join(dataDir, 'profile');
  const warnings = [];
  let gpa = null;
  let testScores = null;
  let achievements = null;
  let impactStatements = null;

  // Read academic.json → GPA
  try {
    const academicData = readJSON(path.join(profileDir, 'academic.json'));
    // Support both simple schema (data.gpa) and rich schema (top-level gpa.overall.value)
    let gpaValue = null;
    let gpaConf = null;
    let gpaSrc = 'Manually added';

    if (academicData) {
      // Rich schema: academicData.gpa.overall.value
      if (academicData.gpa && academicData.gpa.overall && academicData.gpa.overall.value != null) {
        gpaValue = academicData.gpa.overall.value;
        gpaConf = academicData.gpa.overall.confidence != null ? academicData.gpa.overall.confidence : null;
        gpaSrc = academicData.gpa.overall.source || 'Manually added';
      } else if (academicData.data && academicData.data.gpa != null) {
        // Simple schema: data.gpa
        gpaValue = academicData.data.gpa;
        gpaConf = academicData.data.confidence != null ? academicData.data.confidence : null;
        gpaSrc = academicData.data.source || 'Manually added';
      } else if (academicData.gpa != null && typeof academicData.gpa !== 'object') {
        // Flat top-level
        gpaValue = academicData.gpa;
      }
    }

    if (gpaValue != null) {
      gpa = {
        value: String(gpaValue),
        confidence: gpaConf,
        source: gpaSrc,
      };
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      warnings.push('Could not read academic data.');
    }
  }

  // Read tests.json → test scores
  // Supports merged schema: { sat: { score: { total } }, act: { score: { composite } }, ap: [], ib: [], other: [] }
  // and init schema: { data: { sat, act, ap: [], ib: [], other: [] } }
  try {
    const testsFile = readJSON(path.join(profileDir, 'tests.json'));
    if (testsFile) {
      // Normalise: prefer top-level merged schema, fall back to data wrapper
      const tests = (testsFile.sat !== undefined || testsFile.act !== undefined ||
                     testsFile.ap !== undefined || testsFile.ib !== undefined)
        ? testsFile
        : (testsFile.data || {});

      const items = [];

      // SAT — synthetic id 'sat'
      if (tests.sat && tests.sat.score) {
        const total = tests.sat.score.total != null
          ? tests.sat.score.total
          : (tests.sat.score.math != null && tests.sat.score.ebrw != null
              ? tests.sat.score.math + tests.sat.score.ebrw
              : null);
        if (total != null) {
          items.push({
            id: 'sat',
            name: 'SAT',
            score: String(total),
            confidence: tests.sat.confidence != null ? tests.sat.confidence : null,
            source: tests.sat.source || 'Manually added',
          });
        }
      } else if (tests.sat != null && typeof tests.sat !== 'object') {
        items.push({ id: 'sat', name: 'SAT', score: String(tests.sat), confidence: null, source: 'Manually added' });
      }

      // ACT — synthetic id 'act'
      if (tests.act && tests.act.score) {
        const composite = tests.act.score.composite != null ? tests.act.score.composite : null;
        if (composite != null) {
          items.push({
            id: 'act',
            name: 'ACT',
            score: String(composite),
            confidence: tests.act.confidence != null ? tests.act.confidence : null,
            source: tests.act.source || 'Manually added',
          });
        }
      } else if (tests.act != null && typeof tests.act !== 'object') {
        items.push({ id: 'act', name: 'ACT', score: String(tests.act), confidence: null, source: 'Manually added' });
      }

      // AP scores — synthetic id 'ap-<examName>'
      if (Array.isArray(tests.ap)) {
        tests.ap.forEach(a => items.push({
          id: a.id || `ap-${a.examName || a.name || ''}`,
          name: `AP ${a.examName || a.name || ''}`,
          score: String(a.score || ''),
          confidence: a.confidence != null ? a.confidence : null,
          source: a.source || 'Manually added',
        }));
      }

      // IB scores — synthetic id 'ib-<subject>'
      if (Array.isArray(tests.ib)) {
        tests.ib.forEach(a => items.push({
          id: a.id || `ib-${a.subject || ''}`,
          name: `IB ${a.subject || ''} (${a.level || ''})`,
          score: String(a.score || ''),
          confidence: a.confidence != null ? a.confidence : null,
          source: a.source || 'Manually added',
        }));
      }

      if (items.length > 0) testScores = items;
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      warnings.push('Could not read test score data.');
    }
  }

  // Read achievements.json + activities.json
  // Supports merged schema: { achievements: [...] } / { activities: [...] }
  // and init schema: { data: { items: [...] } }
  try {
    const achItems = [];
    for (const file of ['achievements.json', 'activities.json']) {
      try {
        const achData = readJSON(path.join(profileDir, file));
        if (achData) {
          let items = [];
          if (file === 'achievements.json') {
            // Merged schema
            items = Array.isArray(achData.achievements) ? achData.achievements
              // Init schema
              : (achData.data && Array.isArray(achData.data.items)) ? achData.data.items
              : [];
          } else {
            // activities.json
            items = Array.isArray(achData.activities) ? achData.activities
              : (achData.data && Array.isArray(achData.data.items)) ? achData.data.items
              : [];
          }
          items.forEach(a => achItems.push({ ...a, _file: file }));
        }
      } catch (err) {
        if (err.code !== 'ENOENT') {
          warnings.push(`Could not read ${file === 'achievements.json' ? 'achievements' : 'activities'} data.`);
        }
      }
    }
    if (achItems.length > 0) {
      achievements = achItems.map(a => ({
        id: a.id,
        name: a.awardName || a.activityName || a.title || a.name || '(unnamed)',
        category: a.category || (a._file === 'activities.json' ? 'Extracurricular Activity' : 'Award'),
        confidence: a.confidence != null ? a.confidence : null,
        source: typeof a.source === 'object' ? (a.source.documentName || 'Extracted') : (a.source || 'Manually added'),
      }));
    }
  } catch (err) {
    warnings.push('Could not read achievements data.');
  }

  // Read impact_statements.json
  try {
    const stData = readJSON(path.join(profileDir, 'impact_statements.json'));
    const st = stData && stData.data ? stData.data : stData;
    const items = (st && st.statements) ? st.statements : (Array.isArray(st) ? st : []);
    if (items.length > 0) {
      impactStatements = items.map(s => ({
        id: s.id,
        linkedAchievementName: s.linkedAchievementName || '',
        preview: (s.statement || '').slice(0, 80),
        aiGenerated: s.aiGenerated === true,
      }));
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      warnings.push('Could not read impact statements data.');
    }
  }

  const responseData = { gpa, testScores, achievements, impactStatements };
  const response = envelope(true, responseData);
  if (warnings.length > 0) response.warnings = warnings;
  return res.json(response);
});

// ─── POST /api/essays/generate ────────────────────────────────────────────────

router.post('/generate', async (req, res) => {
  const dataDir = getDataDir();
  if (!dataDir || !fs.existsSync(dataDir)) {
    return res.status(503).json(
      envelope(false, null, { code: 'DATA_DIR_UNAVAILABLE', message: 'Data directory not accessible.' })
    );
  }

  // Rate limit check
  if (isRateLimited()) {
    return res.status(429).json(
      envelope(false, null, {
        code: 'RATE_LIMIT_EXCEEDED',
        message: "You've generated 5 personal statements in the past hour. Please wait before generating again.",
      })
    );
  }

  // STORY-003a: Accept optional provenanceSelection; resolve IDs to provenanceUsed
  const { provenanceSelection } = req.body || {};
  let provenanceUsed = null;

  if (provenanceSelection && typeof provenanceSelection === 'object') {
    provenanceUsed = _resolveProvenanceUsed(dataDir, provenanceSelection);
  }

  let aiText;
  try {
    aiText = await generateEssayDraft(dataDir, provenanceSelection || null);
  } catch (err) {
    if (err.code === 'INSUFFICIENT_PROFILE_DATA') {
      return res.status(400).json(
        envelope(false, null, { code: 'INSUFFICIENT_PROFILE_DATA', message: err.message })
      );
    }
    if (err.code === 'AI_TIMEOUT') {
      return res.status(504).json(
        envelope(false, null, { code: 'GEMINI_TIMEOUT', message: 'Personal statement generation timed out after 30 seconds. Please try again.' })
      );
    }
    return res.status(502).json(
      envelope(false, null, { code: 'GEMINI_API_ERROR', message: err.message || 'The AI service returned an error. Check your API key and try again.' })
    );
  }

  // Record successful generation for rate limiting
  recordGeneration();

  const now = new Date().toISOString();
  const draft = {
    id: uuidv4(),
    aiDraft: aiText,
    studentEdit: aiText,
    wordCount: 0,
    generatedAt: now,
    editedAt: now,
    status: 'draft',
    provenanceUsed: provenanceUsed || null,
  };

  // Persist to essays.json
  try {
    let fileData = readEssays(dataDir) || initEssaysFile();
    if (!fileData.data || !Array.isArray(fileData.data.drafts)) {
      fileData.data = { drafts: [] };
    }
    fileData.data.drafts.push(draft);
    fileData.lastUpdated = now;
    writeEssays(dataDir, fileData);
  } catch (writeErr) {
    console.error('[essays/generate] file write error:', writeErr.message);
    return res.status(500).json(
      envelope(false, null, { code: 'FILE_WRITE_ERROR', message: 'Failed to save the generated draft to disk.' })
    );
  }

  appendAuditLog(dataDir, { timestamp: now, action: 'essay_generated', id: draft.id });

  return res.json(envelope(true, draft, null));
});

/**
 * Resolve provenanceSelection IDs into display data.
 * @param {string} dataDir
 * @param {object} sel - { includeGpa, testScoreIds, achievementIds, impactStatementIds }
 * @returns {object} provenanceUsed
 */
function _resolveProvenanceUsed(dataDir, sel) {
  const profileDir = path.join(dataDir, 'profile');
  const result = {};

  // GPA
  if (sel.includeGpa === true) {
    try {
      const academicData = readJSON(path.join(profileDir, 'academic.json'));
      if (academicData) {
        let gpaValue = null, gpaConf = null, gpaSrc = 'Manually added';
        if (academicData.gpa && academicData.gpa.overall && academicData.gpa.overall.value != null) {
          gpaValue = academicData.gpa.overall.value;
          gpaConf = academicData.gpa.overall.confidence != null ? academicData.gpa.overall.confidence : null;
          gpaSrc = academicData.gpa.overall.source || 'Manually added';
        } else if (academicData.data && academicData.data.gpa != null) {
          gpaValue = academicData.data.gpa;
          gpaConf = academicData.data.confidence != null ? academicData.data.confidence : null;
          gpaSrc = academicData.data.source || 'Manually added';
        }
        if (gpaValue != null) {
          result.gpa = { value: String(gpaValue), confidence: gpaConf, source: gpaSrc };
        }
      }
    } catch (_) { /* non-fatal */ }
  }

  // Test scores — build same synthetic-ID items as provenance GET endpoint
  if (Array.isArray(sel.testScoreIds) && sel.testScoreIds.length > 0) {
    try {
      const testsFile = readJSON(path.join(profileDir, 'tests.json'));
      if (testsFile) {
        const tests = (testsFile.sat !== undefined || testsFile.act !== undefined ||
                       testsFile.ap !== undefined || testsFile.ib !== undefined)
          ? testsFile
          : (testsFile.data || {});

        const items = [];
        if (tests.sat && tests.sat.score) {
          const total = tests.sat.score.total != null ? tests.sat.score.total
            : (tests.sat.score.math != null && tests.sat.score.ebrw != null ? tests.sat.score.math + tests.sat.score.ebrw : null);
          if (total != null) items.push({ id: 'sat', name: 'SAT', score: String(total), confidence: tests.sat.confidence || null, source: tests.sat.source || 'Manually added' });
        } else if (tests.sat != null && typeof tests.sat !== 'object') {
          items.push({ id: 'sat', name: 'SAT', score: String(tests.sat), confidence: null, source: 'Manually added' });
        }
        if (tests.act && tests.act.score && tests.act.score.composite != null) {
          items.push({ id: 'act', name: 'ACT', score: String(tests.act.score.composite), confidence: tests.act.confidence || null, source: tests.act.source || 'Manually added' });
        } else if (tests.act != null && typeof tests.act !== 'object') {
          items.push({ id: 'act', name: 'ACT', score: String(tests.act), confidence: null, source: 'Manually added' });
        }
        if (Array.isArray(tests.ap)) tests.ap.forEach(a => items.push({ id: a.id || `ap-${a.examName || ''}`, name: `AP ${a.examName || ''}`, score: String(a.score || ''), confidence: a.confidence || null, source: a.source || 'Manually added' }));
        if (Array.isArray(tests.ib)) tests.ib.forEach(a => items.push({ id: a.id || `ib-${a.subject || ''}`, name: `IB ${a.subject || ''}`, score: String(a.score || ''), confidence: a.confidence || null, source: a.source || 'Manually added' }));

        result.testScores = items.filter(t => sel.testScoreIds.includes(t.id));
      }
    } catch (_) { /* non-fatal */ }
  }

  // Achievements — supports merged schema { achievements: [...] } / { activities: [...] }
  if (Array.isArray(sel.achievementIds) && sel.achievementIds.length > 0) {
    try {
      const achItems = [];
      for (const file of ['achievements.json', 'activities.json']) {
        try {
          const achData = readJSON(path.join(profileDir, file));
          if (achData) {
            let items = [];
            if (file === 'achievements.json') {
              items = Array.isArray(achData.achievements) ? achData.achievements
                : (achData.data && Array.isArray(achData.data.items)) ? achData.data.items : [];
            } else {
              items = Array.isArray(achData.activities) ? achData.activities
                : (achData.data && Array.isArray(achData.data.items)) ? achData.data.items : [];
            }
            items.forEach(a => achItems.push({ ...a, _file: file }));
          }
        } catch (_) { /* non-fatal */ }
      }
      result.achievements = achItems
        .filter(a => sel.achievementIds.includes(a.id))
        .map(a => ({
          id: a.id,
          name: a.awardName || a.activityName || a.title || a.name || '(unnamed)',
          category: a.category || (a._file === 'activities.json' ? 'Extracurricular Activity' : 'Award'),
          source: typeof a.source === 'object' ? (a.source.documentName || 'Extracted') : (a.source || 'Manually added'),
        }));
    } catch (_) { /* non-fatal */ }
  }

  // Impact statements
  if (Array.isArray(sel.impactStatementIds) && sel.impactStatementIds.length > 0) {
    try {
      const stData = readJSON(path.join(profileDir, 'impact_statements.json'));
      const st = stData && stData.data ? stData.data : stData;
      const items = (st && st.statements) ? st.statements : (Array.isArray(st) ? st : []);
      result.impactStatements = items
        .filter(s => sel.impactStatementIds.includes(s.id))
        .map(s => ({
          id: s.id,
          achievementName: s.linkedAchievementName || '',
          preview: (s.statement || '').slice(0, 80),
        }));
    } catch (_) { /* non-fatal */ }
  }

  return result;
}

// ─── POST /api/essays/save ────────────────────────────────────────────────────

router.post('/save', (req, res) => {
  const { id, studentEdit } = req.body || {};

  if (!id || !studentEdit) {
    return res.status(400).json(
      envelope(false, null, { code: 'MISSING_FIELDS', message: '`id` and `studentEdit` are required.' })
    );
  }
  if (studentEdit.length > 10000) {
    return res.status(400).json(
      envelope(false, null, { code: 'ESSAY_TOO_LONG', message: 'Essay exceeds 10,000 characters.' })
    );
  }

  const dataDir = getDataDir();
  if (!dataDir || !fs.existsSync(dataDir)) {
    return res.status(503).json(envelope(false, null, { code: 'DATA_DIR_UNAVAILABLE', message: 'Data directory not accessible.' }));
  }

  let fileData = readEssays(dataDir);
  if (!fileData || !fileData.data || !Array.isArray(fileData.data.drafts)) {
    return res.status(404).json(
      envelope(false, null, { code: 'DRAFT_NOT_FOUND', message: 'No draft with that id exists.' })
    );
  }

  const idx = fileData.data.drafts.findIndex(d => d.id === id);
  if (idx === -1) {
    return res.status(404).json(
      envelope(false, null, { code: 'DRAFT_NOT_FOUND', message: 'No draft with that id exists.' })
    );
  }

  const now = new Date().toISOString();
  fileData.data.drafts[idx].studentEdit = studentEdit;
  fileData.data.drafts[idx].wordCount = countWords(studentEdit);
  fileData.data.drafts[idx].editedAt = now;
  fileData.data.drafts[idx].status = 'saved';
  fileData.lastUpdated = now;

  try {
    writeEssays(dataDir, fileData);
  } catch (writeErr) {
    console.error('[essays/save] file write error:', writeErr.message);
    return res.status(500).json(
      envelope(false, null, { code: 'FILE_WRITE_ERROR', message: 'Failed to save essay.' })
    );
  }

  appendAuditLog(dataDir, { timestamp: now, action: 'essay_saved', id });

  return res.json(envelope(true, fileData.data.drafts[idx], null));
});

// ─── GET /api/essays ──────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const dataDir = getDataDir();
  if (!dataDir || !fs.existsSync(dataDir)) {
    return res.json(envelope(true, { drafts: [], total: 0 }, null));
  }

  const fileData = readEssays(dataDir);
  if (!fileData || !fileData.data || !Array.isArray(fileData.data.drafts)) {
    return res.json(envelope(true, { drafts: [], total: 0 }, null));
  }

  const sorted = [...fileData.data.drafts].sort(
    (a, b) => new Date(b.generatedAt) - new Date(a.generatedAt)
  );

  return res.json(envelope(true, { drafts: sorted, total: sorted.length }, null));
});

// ─── GET /api/essays/:id ──────────────────────────────────────────────────────

router.get('/:id', (req, res) => {
  const { id } = req.params;

  if (!isValidUUIDv4(id)) {
    return res.status(400).json(
      envelope(false, null, { code: 'INVALID_ID', message: 'Invalid essay id format.' })
    );
  }

  const dataDir = getDataDir();
  if (!dataDir || !fs.existsSync(dataDir)) {
    return res.status(503).json(envelope(false, null, { code: 'DATA_DIR_UNAVAILABLE', message: 'Data directory not accessible.' }));
  }

  const fileData = readEssays(dataDir);
  if (!fileData || !fileData.data || !Array.isArray(fileData.data.drafts)) {
    return res.status(404).json(
      envelope(false, null, { code: 'DRAFT_NOT_FOUND', message: 'No draft with that id exists.' })
    );
  }

  const draft = fileData.data.drafts.find(d => d.id === id);
  if (!draft) {
    return res.status(404).json(
      envelope(false, null, { code: 'DRAFT_NOT_FOUND', message: 'No draft with that id exists.' })
    );
  }

  return res.json(envelope(true, { draft }, null));
});

// ─── PUT /api/essays/:id ──────────────────────────────────────────────────────

router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { studentEdit } = req.body || {};

  if (!studentEdit) {
    return res.status(400).json(
      envelope(false, null, { code: 'MISSING_FIELDS', message: '`studentEdit` is required.' })
    );
  }
  if (studentEdit.length > 10000) {
    return res.status(400).json(
      envelope(false, null, { code: 'ESSAY_TOO_LONG', message: 'Essay exceeds 10,000 characters.' })
    );
  }

  const dataDir = getDataDir();
  if (!dataDir || !fs.existsSync(dataDir)) {
    return res.status(503).json(envelope(false, null, { code: 'DATA_DIR_UNAVAILABLE', message: 'Data directory not accessible.' }));
  }

  let fileData = readEssays(dataDir);
  if (!fileData || !fileData.data || !Array.isArray(fileData.data.drafts)) {
    return res.status(404).json(
      envelope(false, null, { code: 'DRAFT_NOT_FOUND', message: 'No draft with that id exists.' })
    );
  }

  const idx = fileData.data.drafts.findIndex(d => d.id === id);
  if (idx === -1) {
    return res.status(404).json(
      envelope(false, null, { code: 'DRAFT_NOT_FOUND', message: 'No draft with that id exists.' })
    );
  }

  const now = new Date().toISOString();
  fileData.data.drafts[idx].studentEdit = studentEdit;
  fileData.data.drafts[idx].wordCount = countWords(studentEdit);
  fileData.data.drafts[idx].editedAt = now;
  fileData.data.drafts[idx].status = 'saved';
  fileData.lastUpdated = now;

  try {
    writeEssays(dataDir, fileData);
  } catch (writeErr) {
    console.error('[essays/put] file write error:', writeErr.message);
    return res.status(500).json(
      envelope(false, null, { code: 'FILE_WRITE_ERROR', message: 'Failed to save essay.' })
    );
  }

  appendAuditLog(dataDir, { timestamp: now, action: 'essay_updated', id });

  return res.json(envelope(true, fileData.data.drafts[idx], null));
});

// ─── DELETE /api/essays/:id ───────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  const { id } = req.params;

  if (!isValidUUIDv4(id)) {
    return res.status(400).json(
      envelope(false, null, { code: 'INVALID_ID', message: 'Invalid essay id format.' })
    );
  }

  const dataDir = getDataDir();
  if (!dataDir || !fs.existsSync(dataDir)) {
    return res.status(503).json(envelope(false, null, { code: 'DATA_DIR_UNAVAILABLE', message: 'Data directory not accessible.' }));
  }

  let fileData = readEssays(dataDir);
  if (!fileData || !fileData.data || !Array.isArray(fileData.data.drafts)) {
    return res.status(404).json(
      envelope(false, null, { code: 'DRAFT_NOT_FOUND', message: 'No draft with that id exists.' })
    );
  }

  const idx = fileData.data.drafts.findIndex(d => d.id === id);
  if (idx === -1) {
    return res.status(404).json(
      envelope(false, null, { code: 'DRAFT_NOT_FOUND', message: 'No draft with that id exists.' })
    );
  }

  fileData.data.drafts.splice(idx, 1);
  const now = new Date().toISOString();
  fileData.lastUpdated = now;

  try {
    writeEssays(dataDir, fileData);
  } catch (writeErr) {
    console.error('[essays/delete] file write error:', writeErr.message);
    return res.status(500).json(
      envelope(false, null, { code: 'FILE_WRITE_ERROR', message: 'Failed to delete essay.' })
    );
  }

  appendAuditLog(dataDir, { timestamp: now, action: 'essay_deleted', id });

  return res.json(envelope(true, { deletedId: id }, null));
});

module.exports = router;
