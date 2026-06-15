'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { readJSON, writeJSON, appendAuditLog } = require('../../utils/file-io');
const { generateImpactStatement, computePreviewReasoning } = require('../../ai/impact');
const { getLimits } = require('./config-limits');

const router = express.Router();

// ─── Rate limiter for /generate (10 req/min) ─────────────────────────────────

let generateCallCount = 0;
let generateWindowStart = Date.now();
const GENERATE_RATE_LIMIT = 10;

function checkGenerateRateLimit() {
  const now = Date.now();
  if (now - generateWindowStart > 60000) {
    generateWindowStart = now;
    generateCallCount = 0;
  }
  generateCallCount++;
  return generateCallCount <= GENERATE_RATE_LIMIT;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function envelope(success, data, error = null) {
  return { success, data, error, timestamp: new Date().toISOString() };
}

function getProfileDir() {
  const dataDir = process.env.DATA_DIR;
  if (!dataDir) return null;
  return path.join(dataDir, 'profile');
}

function readAchievementsAll(profileDir) {
  const achievements = [];
  for (const file of ['achievements.json', 'activities.json']) {
    try {
      const data = readJSON(path.join(profileDir, file));
      let items = [];
      if (file === 'achievements.json') {
        // Merged schema: top-level array
        items = Array.isArray(data.achievements) ? data.achievements
          // Init schema: wrapped under data.items
          : (data.data && Array.isArray(data.data.items)) ? data.data.items
          : [];
      } else {
        // activities.json
        items = Array.isArray(data.activities) ? data.activities
          : (data.data && Array.isArray(data.data.items)) ? data.data.items
          : [];
      }
      const source = file === 'achievements.json' ? 'achievement' : 'activity';
      items.forEach(item => achievements.push({ ...item, _source: source }));
    } catch (_) { /* file missing is ok */ }
  }
  return achievements;
}

function readImpactStatements(profileDir) {
  try {
    const data = readJSON(path.join(profileDir, 'impact_statements.json'));
    return (data.data && data.data.statements) ? data.data.statements : [];
  } catch (_) {
    return [];
  }
}

function writeImpactStatements(profileDir, statements) {
  const filePath = path.join(profileDir, 'impact_statements.json');
  let existing = { schemaVersion: '2.0.0', lastUpdated: new Date().toISOString(), data: { statements: [] } };
  try { existing = readJSON(filePath); } catch (_) { /* create fresh */ }
  existing.schemaVersion = '2.0.0';
  existing.data = existing.data || {};
  existing.data.statements = statements;
  existing.lastUpdated = new Date().toISOString();
  writeJSON(filePath, existing);
}

function normalizeAchievementForResponse(item) {
  return {
    id: item.id,
    name: item.name || item.title || item.activityName || '(unnamed)',
    category: _normalizeCategory(item),
    description: item.description || item.summary || '',
    role: item.role || null,
    hoursPerWeek: item.hoursPerWeek != null ? item.hoursPerWeek : null,
    yearsInvolved: item.yearsInvolved || null,
    startYear: item.startYear || null,
    endYear: item.endYear || null,
  };
}

function _normalizeCategory(item) {
  if (item.category) {
    const cat = String(item.category).toLowerCase();
    if (cat === 'academic') return 'Academic';
    if (cat === 'award' || cat === 'achievement') return 'Award';
    if (cat === 'sports' || cat === 'community') return 'Extracurricular Activity';
  }
  if (item._source === 'activity') return 'Extracurricular Activity';
  if (item._source === 'achievement') return 'Award';
  return 'Other';
}

// ─── POST /api/impact-statements/preview-reasoning ───────────────────────────

router.post('/preview-reasoning', (req, res) => {
  const { achievementId, studentAnswers } = req.body || {};

  if (!achievementId) {
    return res.status(400).json(envelope(false, null, { code: 'MISSING_FIELD', message: 'achievementId is required.' }));
  }
  if (!studentAnswers || typeof studentAnswers !== 'object') {
    return res.status(400).json(envelope(false, null, { code: 'MISSING_FIELD', message: 'studentAnswers is required.' }));
  }

  const profileDir = getProfileDir();
  if (!profileDir) {
    return res.status(500).json(envelope(false, null, { code: 'FILE_READ_ERROR', message: 'Data directory not configured.' }));
  }

  const allAchievements = readAchievementsAll(profileDir);
  const achievement = allAchievements.find(a => a.id === achievementId);
  if (!achievement) {
    return res.status(404).json(envelope(false, null, { code: 'ACHIEVEMENT_NOT_FOUND', message: 'Achievement not found.' }));
  }

  const norm = normalizeAchievementForResponse(achievement);

  // Sanitize answers — strip to 500 chars per field; ensure all 5 keys present
  const answers = {
    role: String(studentAnswers.role || '').slice(0, 500),
    challenge: String(studentAnswers.challenge || '').slice(0, 500),
    growth: String(studentAnswers.growth || '').slice(0, 500),
    importance: String(studentAnswers.importance || '').slice(0, 500),
    impact: String(studentAnswers.impact || '').slice(0, 500),
  };

  const preview = computePreviewReasoning(norm, answers);
  return res.json(envelope(true, preview));
});

// ─── GET /api/impact-statements/available ─────────────────────────────────────

router.get('/available', (req, res) => {
  const profileDir = getProfileDir();
  if (!profileDir) {
    return res.status(500).json(envelope(false, null, { code: 'FILE_READ_ERROR', message: 'Data directory not configured.' }));
  }

  let achievements;
  try {
    achievements = readAchievementsAll(profileDir);
  } catch (err) {
    return res.status(500).json(envelope(false, null, { code: 'FILE_READ_ERROR', message: 'Could not read achievements data.' }));
  }

  let statements;
  try {
    statements = readImpactStatements(profileDir);
  } catch (err) {
    return res.status(500).json(envelope(false, null, { code: 'FILE_READ_ERROR', message: 'Could not read impact statements data.' }));
  }

  const statementsByAchievementId = {};
  statements.forEach(s => {
    if (s.linkedAchievementId) statementsByAchievementId[s.linkedAchievementId] = s.id;
  });

  const available = [];
  const alreadyHaveStatements = [];

  achievements.forEach(item => {
    const norm = normalizeAchievementForResponse(item);
    if (statementsByAchievementId[item.id]) {
      alreadyHaveStatements.push({ id: norm.id, name: norm.name, statementId: statementsByAchievementId[item.id] });
    } else {
      available.push(norm);
    }
  });

  return res.json(envelope(true, {
    available,
    alreadyHaveStatements,
    totalAchievements: achievements.length,
    totalStatements: statements.length,
  }));
});

// ─── POST /api/impact-statements/generate ────────────────────────────────────

router.post('/generate', async (req, res) => {
  // Rate limit
  if (!checkGenerateRateLimit()) {
    return res.status(429).json(envelope(false, null, { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment and try again.' }));
  }

  const { achievementId, studentAnswers } = req.body || {};

  if (!achievementId) {
    return res.status(400).json(envelope(false, null, { code: 'MISSING_FIELD', message: 'achievementId is required.' }));
  }

  const profileDir = getProfileDir();
  if (!profileDir) {
    return res.status(500).json(envelope(false, null, { code: 'FILE_READ_ERROR', message: 'Data directory not configured.' }));
  }

  // Find achievement
  const allAchievements = readAchievementsAll(profileDir);
  const achievement = allAchievements.find(a => a.id === achievementId);

  if (!achievement) {
    return res.status(404).json(envelope(false, null, { code: 'ACHIEVEMENT_NOT_FOUND', message: 'Achievement not found.' }));
  }

  const norm = normalizeAchievementForResponse(achievement);

  // STORY-003a: Accept optional studentAnswers; sanitize to 500 chars each
  let answers = null;
  if (studentAnswers && typeof studentAnswers === 'object') {
    answers = {
      role: String(studentAnswers.role || '').slice(0, 500),
      challenge: String(studentAnswers.challenge || '').slice(0, 500),
      growth: String(studentAnswers.growth || '').slice(0, 500),
      importance: String(studentAnswers.importance || '').slice(0, 500),
      impact: String(studentAnswers.impact || '').slice(0, 500),
    };
  }

  try {
    const result = await generateImpactStatement(norm, answers);

    // Enforce word count limits
    const limits = getLimits();
    const impactLimits = limits.limits.impactStatements;
    const draftWordCount = result.draft.trim().split(/\s+/).filter(Boolean).length;
    if (draftWordCount < impactLimits.min || draftWordCount > impactLimits.max) {
      console.warn(`[impact-statements/generate] AI draft is ${draftWordCount} words, limit is ${impactLimits.min}–${impactLimits.max}`);
    }

    return res.json(envelope(true, {
      achievementId,
      achievementName: norm.name,
      draft: result.draft,
      wordCount: result.wordCount,
      reasoning: result.reasoning || null,
      confidence: result.confidence || null,
      focusAreas: result.focusAreas || [],
      profileDataUsed: result.profileDataUsed || [],
    }));
  } catch (err) {
    if (err.code === 'AI_TIMEOUT') {
      return res.status(504).json(envelope(false, null, { code: 'AI_TIMEOUT', message: 'Draft generation timed out. Try again.' }));
    }
    return res.status(502).json(envelope(false, null, { code: 'AI_ERROR', message: err.message || 'Draft generation failed. You can still write your own statement.' }));
  }
});

// ─── POST /api/impact-statements/save ────────────────────────────────────────

router.post('/save', (req, res) => {
  const { achievementId, statement, aiDraft, aiGenerated, editedByStudent } = req.body || {};

  // Validate
  if (!achievementId) {
    return res.status(400).json(envelope(false, null, { code: 'MISSING_FIELD', message: 'achievementId is required.' }));
  }
  if (typeof statement !== 'string' || statement.trim().length === 0) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'Statement cannot be empty.' }));
  }
  const wordCount = statement.trim().split(/\s+/).filter(Boolean).length;
  const limits = getLimits();
  const impactLimits = limits.limits.impactStatements;
  if (wordCount > impactLimits.max) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: `Statement exceeds ${impactLimits.max} words.` }));
  }
  if (typeof aiGenerated !== 'boolean') {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'aiGenerated must be a boolean.' }));
  }
  if (typeof editedByStudent !== 'boolean') {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'editedByStudent must be a boolean.' }));
  }

  const profileDir = getProfileDir();
  if (!profileDir) {
    return res.status(500).json(envelope(false, null, { code: 'FILE_WRITE_ERROR', message: 'Could not save statement. Check your data directory.' }));
  }

  // Find achievement
  const allAchievements = readAchievementsAll(profileDir);
  const achievement = allAchievements.find(a => a.id === achievementId);
  if (!achievement) {
    return res.status(404).json(envelope(false, null, { code: 'ACHIEVEMENT_NOT_FOUND', message: 'Achievement not found.' }));
  }
  const norm = normalizeAchievementForResponse(achievement);

  // Check for duplicate
  const statements = readImpactStatements(profileDir);
  const existing = statements.find(s => s.linkedAchievementId === achievementId);
  if (existing) {
    return res.status(409).json(envelope(false, null, { code: 'DUPLICATE_STATEMENT', message: 'An impact statement already exists for this achievement. Use PUT to update it.' }));
  }

  const now = new Date().toISOString();
  const newId = uuidv4();

  // Normalise generatedFrom — ensure all required keys present
  const rawGF = req.body.generatedFrom || {};
  const rawAnswers = (rawGF.studentAnswers && typeof rawGF.studentAnswers === 'object') ? rawGF.studentAnswers : {};
  const normGeneratedFrom = {
    studentAnswers: {
      role: String(rawAnswers.role || ''),
      challenge: String(rawAnswers.challenge || ''),
      growth: String(rawAnswers.growth || ''),
      importance: String(rawAnswers.importance || ''),
      impact: String(rawAnswers.impact || ''),
    },
    profileDataUsed: Array.isArray(rawGF.profileDataUsed) ? rawGF.profileDataUsed : [],
    focusAreas: Array.isArray(rawGF.focusAreas) ? rawGF.focusAreas : [],
  };

  const newStatement = {
    id: newId,
    linkedAchievementId: achievementId,
    linkedAchievementName: norm.name.slice(0, 200),
    linkedAchievementCategory: norm.category,
    statement: statement.trim(),
    aiDraft: aiDraft || null,
    aiGenerated,
    editedByStudent,
    generatedFrom: normGeneratedFrom,
    reasoning: req.body.reasoning || null,
    editHistory: [],
    createdAt: now,
    lastEditedAt: now,
  };

  try {
    statements.push(newStatement);
    writeImpactStatements(profileDir, statements);
  } catch (err) {
    return res.status(500).json(envelope(false, null, { code: 'FILE_WRITE_ERROR', message: 'Could not save statement. Check your data directory.' }));
  }

  // Audit log
  try {
    appendAuditLog(process.env.DATA_DIR, {
      traceId: uuidv4(),
      timestamp: now,
      action: 'impact_statement_created',
      affectedFields: ['impact_statements'],
      actor: 'student',
      meta: { statementId: newId, achievementId },
    });
  } catch (_) { /* non-fatal */ }

  return res.status(201).json(envelope(true, {
    id: newId,
    achievementId,
    achievementName: norm.name,
    createdAt: now,
  }));
});

// ─── GET /api/impact-statements ──────────────────────────────────────────────

router.get('/', (req, res) => {
  const profileDir = getProfileDir();
  if (!profileDir) {
    return res.status(500).json(envelope(false, null, { code: 'FILE_READ_ERROR', message: 'Could not read impact statements.' }));
  }

  try {
    const statements = readImpactStatements(profileDir);
    // Enrich orphaned statements: check which achievements still exist
    const allAchievements = readAchievementsAll(profileDir);
    const achievementIds = new Set(allAchievements.map(a => a.id));

    const enriched = statements.map(s => ({
      ...s,
      orphaned: s.linkedAchievementId && !achievementIds.has(s.linkedAchievementId),
    }));

    return res.json(envelope(true, { statements: enriched, total: enriched.length }));
  } catch (err) {
    return res.status(500).json(envelope(false, null, { code: 'FILE_READ_ERROR', message: 'Could not read impact statements.' }));
  }
});

// ─── PUT /api/impact-statements/:id ──────────────────────────────────────────

router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { statement } = req.body || {};

  if (typeof statement !== 'string' || statement.trim().length === 0) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'Statement cannot be empty.' }));
  }
  const wordCount = statement.trim().split(/\s+/).filter(Boolean).length;
  const limits = getLimits();
  const impactLimits = limits.limits.impactStatements;
  if (wordCount > impactLimits.max) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: `Statement exceeds ${impactLimits.max} words.` }));
  }

  const profileDir = getProfileDir();
  if (!profileDir) {
    return res.status(500).json(envelope(false, null, { code: 'FILE_WRITE_ERROR', message: 'Could not update statement.' }));
  }

  const statements = readImpactStatements(profileDir);
  const idx = statements.findIndex(s => s.id === id);
  if (idx === -1) {
    return res.status(404).json(envelope(false, null, { code: 'NOT_FOUND', message: 'Statement not found.' }));
  }

  const now = new Date().toISOString();

  // Append to editHistory before overwriting
  if (!Array.isArray(statements[idx].editHistory)) {
    statements[idx].editHistory = [];
  }
  statements[idx].editHistory.push({
    editedAt: now,
    previousText: statements[idx].statement,
  });

  statements[idx].statement = statement.trim();
  statements[idx].lastEditedAt = now;
  statements[idx].editedByStudent = true;

  try {
    writeImpactStatements(profileDir, statements);
  } catch (err) {
    return res.status(500).json(envelope(false, null, { code: 'FILE_WRITE_ERROR', message: 'Could not update statement.' }));
  }

  try {
    appendAuditLog(process.env.DATA_DIR, {
      traceId: uuidv4(),
      timestamp: now,
      action: 'impact_statement_updated',
      affectedFields: ['impact_statements'],
      actor: 'student',
      meta: { statementId: id },
    });
  } catch (_) { /* non-fatal */ }

  return res.json(envelope(true, { id, lastEditedAt: now }));
});

// ─── DELETE /api/impact-statements/:id ───────────────────────────────────────

router.delete('/:id', (req, res) => {
  const { id } = req.params;

  const profileDir = getProfileDir();
  if (!profileDir) {
    return res.status(500).json(envelope(false, null, { code: 'FILE_WRITE_ERROR', message: 'Could not delete statement.' }));
  }

  const statements = readImpactStatements(profileDir);
  const idx = statements.findIndex(s => s.id === id);
  if (idx === -1) {
    return res.status(404).json(envelope(false, null, { code: 'NOT_FOUND', message: 'Statement not found.' }));
  }

  const deleted = statements.splice(idx, 1)[0];

  try {
    writeImpactStatements(profileDir, statements);
  } catch (err) {
    return res.status(500).json(envelope(false, null, { code: 'FILE_WRITE_ERROR', message: 'Could not delete statement.' }));
  }

  try {
    appendAuditLog(process.env.DATA_DIR, {
      traceId: uuidv4(),
      timestamp: new Date().toISOString(),
      action: 'impact_statement_deleted',
      affectedFields: ['impact_statements'],
      actor: 'student',
      meta: { statementId: id, achievementId: deleted.linkedAchievementId },
    });
  } catch (_) { /* non-fatal */ }

  return res.json(envelope(true, { deleted: true, id }));
});

module.exports = router;
