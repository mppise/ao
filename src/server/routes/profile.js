'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { readJSON, writeJSON } = require('../../utils/file-io');
const { appendAudit } = require('../../utils/profile-init');

const router = express.Router();

// Simple in-memory rate limiter for /sections (60 req/min)
let sectionsCallCount = 0;
let sectionsWindowStart = Date.now();
const SECTIONS_RATE_LIMIT = 60;

/** Standard response envelope */
function envelope(success, data, error = null) {
  return { success, data, error, timestamp: new Date().toISOString() };
}

/**
 * GET /api/profile/sections
 * Returns current state of all 6 profile sections.
 */
router.get('/sections', (req, res) => {
  // Rate limiting
  const now = Date.now();
  if (now - sectionsWindowStart > 60000) {
    sectionsWindowStart = now;
    sectionsCallCount = 0;
  }
  sectionsCallCount++;
  if (sectionsCallCount > SECTIONS_RATE_LIMIT) {
    return res.status(429).json(
      envelope(false, null, { code: 'RATE_LIMIT', message: 'Too many requests. Please wait a moment.' })
    );
  }

  const dataDir = process.env.DATA_DIR || null;
  if (!dataDir || !fs.existsSync(dataDir)) {
    return res.status(503).json(
      envelope(false, null, {
        code: 'DATA_DIR_UNAVAILABLE',
        message: 'Data directory is not set or not accessible.',
      })
    );
  }

  const metaPath = path.join(dataDir, '.metadata.json');
  if (!fs.existsSync(metaPath)) {
    return res.status(503).json(
      envelope(false, null, {
        code: 'DATA_DIR_UNAVAILABLE',
        message: 'Profile not found. Please complete onboarding.',
      })
    );
  }

  try {
    const meta = readJSON(metaPath);
    const profileDir = path.join(dataDir, 'profile');

    const sections = {
      academic: readSectionAcademic(profileDir),
      tests: readSectionTests(profileDir),
      achievements: readSectionItems(profileDir, 'achievements'),
      activities: readSectionItems(profileDir, 'activities'),
      impact_statements: readSectionStatements(profileDir),
      essays: readSectionDrafts(profileDir),
    };

    return res.json(
      envelope(true, {
        sections,
        student: {
          firstName: meta.student.firstName,
          displayName: meta.student.displayName,
        },
        profileCompletionPercent: 0,
      })
    );
  } catch (err) {
    console.error('[profile/sections] read error:', err.message);
    return res.status(500).json(
      envelope(false, null, { code: 'READ_ERROR', message: 'Could not load your profile. Check that your data directory is accessible.' })
    );
  }
});

function readSectionAcademic(profileDir) {
  try {
    const file = readJSON(path.join(profileDir, 'academic.json'));

    // Check the spec-defined nested data structure (written by manual entry)
    const nestedData = file.data || {};
    const hasNestedData = (
      nestedData.gpa !== null && nestedData.gpa !== undefined ||
      nestedData.school !== null && nestedData.school !== undefined ||
      nestedData.graduationYear !== null && nestedData.graduationYear !== undefined ||
      (Array.isArray(nestedData.courses) && nestedData.courses.length > 0)
    );

    // Also check top-level fields written by STORY-003 extraction
    // Extraction saves fields like file.gpa (object), file.schoolName, file.courses (array), etc.
    const hasTopLevelData = (
      (file.gpa && typeof file.gpa === 'object') ||
      (file.schoolName && typeof file.schoolName === 'object') ||
      (file.graduationYear && typeof file.graduationYear === 'object') ||
      (Array.isArray(file.courses) && file.courses.length > 0)
    );

    const hasData = hasNestedData || hasTopLevelData;

    // Build a unified summary for display
    let summary = null;
    if (hasData) {
      summary = buildAcademicSummary(file, nestedData);
    }

    return { isEmpty: !hasData, summary };
  } catch (_) {
    return { isEmpty: true, summary: null };
  }
}

/**
 * Build a human-readable summary string for the academic section card.
 * Works with both the spec data structure and the extraction data structure.
 */
function buildAcademicSummary(file, nestedData) {
  const parts = [];

  // GPA — could be in nested data.gpa (number) or top-level file.gpa (object with .value)
  let gpa = null;
  let gpaScale = null;
  if (nestedData.gpa !== null && nestedData.gpa !== undefined) {
    gpa = nestedData.gpa;
    gpaScale = nestedData.gpaScale;
  } else if (file.gpa && typeof file.gpa === 'object') {
    if (file.gpa.overall && file.gpa.overall.value !== undefined) {
      gpa = file.gpa.overall.value;
    } else if (file.gpa.value !== undefined) {
      gpa = file.gpa.value;
    }
    if (file.gpaScale && file.gpaScale.value !== undefined) {
      gpaScale = file.gpaScale.value;
    }
  }

  if (gpa !== null && gpa !== undefined) {
    const scaleStr = gpaScale ? `/${gpaScale}` : '';
    parts.push(`GPA ${gpa}${scaleStr}`);
  }

  // Graduation year
  let gradYear = null;
  if (nestedData.graduationYear !== null && nestedData.graduationYear !== undefined) {
    gradYear = nestedData.graduationYear;
  } else if (file.graduationYear && typeof file.graduationYear === 'object' && file.graduationYear.value !== undefined) {
    gradYear = file.graduationYear.value;
  }
  if (gradYear) parts.push(`Class of ${gradYear}`);

  // Course count
  const courses = Array.isArray(file.courses) && file.courses.length > 0
    ? file.courses
    : (Array.isArray(nestedData.courses) ? nestedData.courses : []);
  if (courses.length > 0) parts.push(`${courses.length} course${courses.length !== 1 ? 's' : ''}`);

  return parts.length > 0 ? parts.join(' · ') : 'Academic data saved';
}

function readSectionTests(profileDir) {
  try {
    const file = readJSON(path.join(profileDir, 'tests.json'));

    // Spec-defined nested structure (written by manual entry: /tests/add)
    const nestedData = file.data || {};
    const hasNestedData = (
      nestedData.sat !== null && nestedData.sat !== undefined ||
      nestedData.act !== null && nestedData.act !== undefined ||
      (Array.isArray(nestedData.ap) && nestedData.ap.length > 0) ||
      (Array.isArray(nestedData.other) && nestedData.other.length > 0)
    );

    // Extraction structure written by profile-merge.js (top-level file.sat, file.act, file.ap, file.ib)
    const hasTopLevelData = (
      (file.sat !== null && file.sat !== undefined) ||
      (file.act !== null && file.act !== undefined) ||
      (Array.isArray(file.ap) && file.ap.length > 0) ||
      (Array.isArray(file.ib) && file.ib.length > 0) ||
      (Array.isArray(file.other) && file.other.length > 0)
    );

    const hasData = hasNestedData || hasTopLevelData;

    let summary = null;
    if (hasData) {
      summary = buildTestsSummary(file, nestedData);
    }

    return { isEmpty: !hasData, summary };
  } catch (_) {
    return { isEmpty: true, summary: null };
  }
}

/**
 * Build a human-readable summary for the Tests section card.
 */
function buildTestsSummary(file, nestedData) {
  const parts = [];

  // SAT — could be nested (manual) or top-level (extraction)
  const sat = (nestedData.sat) || (file.sat && typeof file.sat === 'object' ? file.sat : null);
  if (sat) {
    if (sat.score && sat.score.total) {
      parts.push(`SAT ${sat.score.total}`);
    } else if (sat.score) {
      parts.push('SAT (scores saved)');
    } else if (typeof sat.score === 'number') {
      parts.push(`SAT ${sat.score}`);
    } else {
      parts.push('SAT saved');
    }
  }

  // ACT
  const act = (nestedData.act) || (file.act && typeof file.act === 'object' ? file.act : null);
  if (act) {
    if (act.score && act.score.composite) {
      parts.push(`ACT ${act.score.composite}`);
    } else {
      parts.push('ACT saved');
    }
  }

  // AP scores
  const apArr = (Array.isArray(nestedData.ap) ? nestedData.ap : []).concat(Array.isArray(file.ap) ? file.ap : []);
  if (apArr.length > 0) parts.push(`${apArr.length} AP score${apArr.length !== 1 ? 's' : ''}`);

  // IB scores (extraction only)
  const ibArr = Array.isArray(file.ib) ? file.ib : [];
  if (ibArr.length > 0) parts.push(`${ibArr.length} IB score${ibArr.length !== 1 ? 's' : ''}`);

  // Other tests (combined)
  const otherArr = (Array.isArray(nestedData.other) ? nestedData.other : []).concat(Array.isArray(file.other) ? file.other : []);
  if (otherArr.length > 0) parts.push(`${otherArr.length} other test${otherArr.length !== 1 ? 's' : ''}`);

  return parts.length > 0 ? parts.join(' · ') : 'Test data saved';
}

function readSectionItems(profileDir, filename) {
  try {
    const file = readJSON(path.join(profileDir, filename + '.json'));

    // Spec-defined nested structure: file.data.items[] (written by manual entry)
    const nestedCount = (file.data && Array.isArray(file.data.items)) ? file.data.items.length : 0;

    // Extraction structure: file[sectionName][] (written by profile-merge.js)
    // achievements.json writes to file.achievements[], activities.json to file.activities[]
    const topLevelKey = filename; // e.g. 'achievements' or 'activities'
    const topLevelCount = Array.isArray(file[topLevelKey]) ? file[topLevelKey].length : 0;

    const count = nestedCount + topLevelCount;
    return { isEmpty: count === 0, count };
  } catch (_) {
    return { isEmpty: true, count: 0 };
  }
}

function readSectionStatements(profileDir) {
  try {
    const data = readJSON(path.join(profileDir, 'impact_statements.json'));
    const count = data.data && data.data.statements ? data.data.statements.length : 0;
    return { isEmpty: count === 0, count };
  } catch (_) {
    return { isEmpty: true, count: 0 };
  }
}

function readSectionDrafts(profileDir) {
  try {
    const data = readJSON(path.join(profileDir, 'essays.json'));
    const drafts = data.data && data.data.drafts ? data.data.drafts : [];
    const count = drafts.length;
    // Find the most recent editedAt timestamp
    let lastEdited = null;
    if (count > 0) {
      const sorted = drafts.slice().sort((a, b) => new Date(b.editedAt) - new Date(a.editedAt));
      lastEdited = sorted[0].editedAt || null;
    }
    return { isEmpty: count === 0, count, lastEdited };
  } catch (_) {
    return { isEmpty: true, count: 0, lastEdited: null };
  }
}

// -------------------------
// Section Detail Endpoints
// -------------------------

/**
 * GET /api/profile/section/:name
 * Returns full data for a single section (academic, tests, achievements, activities).
 */
router.get('/section/:name', (req, res) => {
  const { name } = req.params;
  const validSections = ['academic', 'tests', 'achievements', 'activities'];

  if (!validSections.includes(name)) {
    return res.status(400).json(envelope(false, null, { code: 'INVALID_SECTION', message: 'Invalid section name.' }));
  }

  const dataDir = process.env.DATA_DIR || null;
  if (!dataDir || !fs.existsSync(dataDir)) {
    return res.status(503).json(envelope(false, null, { code: 'DATA_DIR_UNAVAILABLE', message: 'Data directory is not accessible.' }));
  }

  const profileDir = path.join(dataDir, 'profile');

  try {
    let data;
    if (name === 'academic') {
      data = readFullAcademic(profileDir);
    } else if (name === 'tests') {
      data = readFullTests(profileDir);
    } else if (name === 'achievements') {
      data = readFullItems(profileDir, 'achievements');
    } else if (name === 'activities') {
      data = readFullItems(profileDir, 'activities');
    }

    return res.json(envelope(true, { section: name, data }));
  } catch (err) {
    console.error(`[profile/section/${name}] error:`, err.message);
    return res.status(500).json(envelope(false, null, { code: 'READ_ERROR', message: 'Could not load section data.' }));
  }
});

function readFullAcademic(profileDir) {
  try {
    const file = readJSON(path.join(profileDir, 'academic.json'));
    const nestedData = file.data || {};
    const courses = [];

    // Collect courses from nested (manual) structure
    if (Array.isArray(nestedData.courses)) {
      courses.push(...nestedData.courses);
    }
    // Collect courses from extraction structure
    if (Array.isArray(file.courses)) {
      courses.push(...file.courses);
    }

    // Build unified academic object
    let gpa = null;
    let gpaScale = null;
    let graduationYear = null;
    let school = null;
    let classRank = null;
    let classSize = null;

    if (nestedData.gpa !== undefined && nestedData.gpa !== null) {
      gpa = nestedData.gpa;
      gpaScale = nestedData.gpaScale || null;
      graduationYear = nestedData.graduationYear || null;
      school = nestedData.school || null;
    } else if (file.gpa && typeof file.gpa === 'object') {
      gpa = (file.gpa.overall && file.gpa.overall.value !== undefined) ? file.gpa.overall.value : (file.gpa.value !== undefined ? file.gpa.value : null);
      gpaScale = (file.gpaScale && file.gpaScale.value !== undefined) ? file.gpaScale.value : null;
      graduationYear = (file.graduationYear && file.graduationYear.value !== undefined) ? file.graduationYear.value : null;
      school = (file.schoolName && file.schoolName.value !== undefined) ? file.schoolName.value : null;
    }

    if (file.classRank && typeof file.classRank === 'object') {
      classRank = file.classRank.value || null;
      classSize = file.classSize && file.classSize.value ? file.classSize.value : null;
    } else if (nestedData.classRank !== undefined) {
      classRank = nestedData.classRank || null;
      classSize = nestedData.classSize || null;
    }

    // AP/IB exam scores — manual entries stored in file.apIbScores[]
    const apExams = Array.isArray(file.apIbScores) ? file.apIbScores : (Array.isArray(file.apExams) ? file.apExams : (Array.isArray(nestedData.apExams) ? nestedData.apExams : []));

    return { gpa, gpaScale, graduationYear, school, classRank, classSize, courses, apExams };
  } catch (_) {
    return { gpa: null, gpaScale: null, graduationYear: null, school: null, classRank: null, classSize: null, courses: [], apExams: [] };
  }
}

function readFullTests(profileDir) {
  try {
    const file = readJSON(path.join(profileDir, 'tests.json'));
    const nestedData = file.data || {};

    const sat = nestedData.sat || (file.sat && typeof file.sat === 'object' ? file.sat : null);
    const act = nestedData.act || (file.act && typeof file.act === 'object' ? file.act : null);
    const ap = [
      ...(Array.isArray(nestedData.ap) ? nestedData.ap : []),
      ...(Array.isArray(file.ap) ? file.ap : []),
    ];
    const ib = Array.isArray(file.ib) ? file.ib : [];
    const other = [
      ...(Array.isArray(nestedData.other) ? nestedData.other : []),
      ...(Array.isArray(file.other) ? file.other : []),
    ];

    return { sat, act, ap, ib, other };
  } catch (_) {
    return { sat: null, act: null, ap: [], ib: [], other: [] };
  }
}

function readFullItems(profileDir, filename) {
  try {
    const file = readJSON(path.join(profileDir, filename + '.json'));
    const nestedItems = (file.data && Array.isArray(file.data.items)) ? file.data.items : [];
    const topLevelItems = Array.isArray(file[filename]) ? file[filename] : [];
    const items = [...nestedItems, ...topLevelItems];
    return { items };
  } catch (_) {
    return { items: [] };
  }
}

// -------------------------
// Manual Entry Endpoints
// -------------------------

/**
 * POST /api/profile/academic/add
 */
router.post('/academic/add', (req, res) => {
  const { gpa, gpaScale, graduationYear, school } = req.body || {};

  if (!gpa) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'GPA is required.' }));
  }
  const gpaNum = parseFloat(gpa);
  if (isNaN(gpaNum) || gpaNum < 0 || gpaNum > 5.0) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'GPA must be a number between 0 and 5.0.' }));
  }
  if (gpaScale !== undefined && gpaScale !== '' && isNaN(parseFloat(gpaScale))) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'GPA Scale must be a number.' }));
  }
  if (graduationYear !== undefined && graduationYear !== '' && isNaN(parseInt(graduationYear))) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'Graduation year must be a number.' }));
  }
  if (school && school.length > 100) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'School name must be 100 characters or fewer.' }));
  }

  try {
    const dataDir = process.env.DATA_DIR;
    const filePath = path.join(dataDir, 'profile', 'academic.json');
    const existing = readJSON(filePath);
    const now = new Date().toISOString();

    existing.data.gpa = gpaNum;
    existing.data.gpaScale = gpaScale ? parseFloat(gpaScale) : existing.data.gpaScale;
    existing.data.graduationYear = graduationYear ? parseInt(graduationYear) : existing.data.graduationYear;
    existing.data.school = school || existing.data.school;
    existing.lastUpdated = now;

    // Mark as manually entered with high confidence
    existing.sources = existing.sources || [];
    existing.sources.push({
      entryType: 'manual',
      enteredAt: now,
      confidence: 100,
      confirmedByStudent: true,
      fields: ['gpa', 'gpaScale', 'graduationYear', 'school'].filter(f => req.body[f]),
    });

    writeJSON(filePath, existing);
    appendAudit(dataDir, 'ACADEMIC_ADDED_MANUAL', ['gpa', 'gpaScale', 'graduationYear', 'school']);

    return res.status(201).json(envelope(true, { section: 'academic', savedAt: now }));
  } catch (err) {
    console.error('[academic/add] error:', err.message);
    return res.status(500).json(envelope(false, null, { code: 'WRITE_ERROR', message: 'Failed to save academic data.' }));
  }
});

/**
 * POST /api/profile/tests/add
 */
router.post('/tests/add', (req, res) => {
  const { testType, testName, score, testDate } = req.body || {};
  const validTypes = ['SAT', 'ACT', 'AP', 'IB', 'Other'];

  if (!testType || !validTypes.includes(testType)) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'Test type is required and must be one of: ' + validTypes.join(', ') }));
  }
  if (!testName || testName.trim().length === 0 || testName.length > 50) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'Test name is required (max 50 chars).' }));
  }
  if (!score || isNaN(parseFloat(score))) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'Score is required and must be numeric.' }));
  }
  if (testDate && !/^\d{2}\/\d{2}\/\d{4}$/.test(testDate)) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'Test date must be in MM/DD/YYYY format.' }));
  }

  try {
    const dataDir = process.env.DATA_DIR;
    const filePath = path.join(dataDir, 'profile', 'tests.json');
    const existing = readJSON(filePath);
    const now = new Date().toISOString();

    const entry = {
      id: uuidv4(),
      testType,
      testName: testName.trim(),
      score: parseFloat(score),
      testDate: testDate || null,
      enteredAt: now,
      confidence: 100,
      confirmedByStudent: true,
    };

    // Place in correct bucket
    const type = testType.toLowerCase();
    if (type === 'sat') {
      existing.data.sat = entry;
    } else if (type === 'act') {
      existing.data.act = entry;
    } else if (type === 'ap') {
      existing.data.ap = existing.data.ap || [];
      existing.data.ap.push(entry);
    } else {
      existing.data.other = existing.data.other || [];
      existing.data.other.push(entry);
    }

    existing.lastUpdated = now;
    existing.sources = existing.sources || [];
    existing.sources.push({ entryType: 'manual', enteredAt: now, confidence: 100, confirmedByStudent: true });

    writeJSON(filePath, existing);
    appendAudit(dataDir, 'TESTS_ADDED_MANUAL', ['testType', 'testName', 'score']);

    return res.status(201).json(envelope(true, { section: 'tests', savedAt: now }));
  } catch (err) {
    console.error('[tests/add] error:', err.message);
    return res.status(500).json(envelope(false, null, { code: 'WRITE_ERROR', message: 'Failed to save test data.' }));
  }
});

/**
 * POST /api/profile/achievements/add
 */
router.post('/achievements/add', (req, res) => {
  const { title, organization, dateAwarded, category } = req.body || {};
  const validCategories = ['academic', 'sports', 'community', 'other'];

  if (!title || title.trim().length === 0 || title.length > 100) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'Title is required (max 100 chars).' }));
  }
  if (organization && organization.length > 100) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'Organization must be 100 characters or fewer.' }));
  }
  if (dateAwarded && !/^\d{2}\/\d{2}\/\d{4}$/.test(dateAwarded)) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'Date must be in MM/DD/YYYY format.' }));
  }
  if (category && !validCategories.includes(category.toLowerCase())) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'Category must be one of: ' + validCategories.join(', ') }));
  }

  try {
    const dataDir = process.env.DATA_DIR;
    const filePath = path.join(dataDir, 'profile', 'achievements.json');
    const existing = readJSON(filePath);
    const now = new Date().toISOString();

    const entry = {
      id: uuidv4(),
      title: title.trim(),
      organization: organization ? organization.trim() : null,
      dateAwarded: dateAwarded || null,
      category: category ? category.toLowerCase() : null,
      description: '',
      confidence: 100,
      source: null,
      excerpt: null,
      confirmedByStudent: true,
      enteredAt: now,
    };

    existing.data.items = existing.data.items || [];
    existing.data.items.push(entry);
    existing.lastUpdated = now;

    writeJSON(filePath, existing);
    appendAudit(dataDir, 'ACHIEVEMENTS_ADDED_MANUAL', ['title', 'organization', 'dateAwarded', 'category']);

    return res.status(201).json(envelope(true, { section: 'achievements', savedAt: now }));
  } catch (err) {
    console.error('[achievements/add] error:', err.message);
    return res.status(500).json(envelope(false, null, { code: 'WRITE_ERROR', message: 'Failed to save achievement.' }));
  }
});

/**
 * POST /api/profile/activities/add
 */
router.post('/activities/add', (req, res) => {
  const { activityName, role, organization, hoursPerWeek } = req.body || {};

  if (!activityName || activityName.trim().length === 0 || activityName.length > 100) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'Activity name is required (max 100 chars).' }));
  }
  if (role && role.length > 100) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'Role must be 100 characters or fewer.' }));
  }
  if (organization && organization.length > 100) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'Organization must be 100 characters or fewer.' }));
  }
  if (hoursPerWeek !== undefined && hoursPerWeek !== '') {
    const h = parseFloat(hoursPerWeek);
    if (isNaN(h) || h < 0 || h > 100) {
      return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'Hours per week must be a number between 0 and 100.' }));
    }
  }

  try {
    const dataDir = process.env.DATA_DIR;
    const filePath = path.join(dataDir, 'profile', 'activities.json');
    const existing = readJSON(filePath);
    const now = new Date().toISOString();

    const entry = {
      id: uuidv4(),
      activityName: activityName.trim(),
      role: role ? role.trim() : null,
      organization: organization ? organization.trim() : null,
      hoursPerWeek: (hoursPerWeek !== undefined && hoursPerWeek !== '') ? parseFloat(hoursPerWeek) : null,
      confidence: 100,
      source: null,
      excerpt: null,
      confirmedByStudent: true,
      enteredAt: now,
    };

    existing.data.items = existing.data.items || [];
    existing.data.items.push(entry);
    existing.lastUpdated = now;

    writeJSON(filePath, existing);
    appendAudit(dataDir, 'ACTIVITIES_ADDED_MANUAL', ['activityName', 'role', 'organization']);

    return res.status(201).json(envelope(true, { section: 'activities', savedAt: now }));
  } catch (err) {
    console.error('[activities/add] error:', err.message);
    return res.status(500).json(envelope(false, null, { code: 'WRITE_ERROR', message: 'Failed to save activity.' }));
  }
});

/**
 * POST /api/profile/academic/add-exam-score
 * Add an AP or IB exam score, optionally linked to an existing course.
 *
 * Body: { examType, courseName, score, examDate, linkedCourseName }
 *   examType: 'AP' | 'IB'
 *   courseName: display name for the exam (e.g., "AP Calculus BC")
 *   score: number (1–5 for AP, 1–7 for IB)
 *   examDate: optional date string (MM/YYYY or YYYY)
 *   linkedCourseName: optional course name to link this score to in courses list
 */
router.post('/academic/add-exam-score', (req, res) => {
  const { examType, courseName, score, examDate, linkedCourseName } = req.body || {};
  const validTypes = ['AP', 'IB'];

  if (!examType || !validTypes.includes(examType)) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'examType must be AP or IB.' }));
  }
  if (!courseName || courseName.trim().length === 0 || courseName.length > 100) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'courseName is required (max 100 chars).' }));
  }
  if (score === undefined || score === null || score === '') {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'score is required.' }));
  }
  const scoreNum = parseInt(score, 10);
  if (isNaN(scoreNum)) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'score must be a number.' }));
  }
  if (examType === 'AP' && (scoreNum < 1 || scoreNum > 5)) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'AP exam score must be between 1 and 5.' }));
  }
  if (examType === 'IB' && (scoreNum < 1 || scoreNum > 7)) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'IB exam score must be between 1 and 7.' }));
  }

  try {
    const dataDir = process.env.DATA_DIR;
    const filePath = path.join(dataDir, 'profile', 'academic.json');
    const existing = readJSON(filePath);
    const now = new Date().toISOString();

    if (!Array.isArray(existing.apIbScores)) existing.apIbScores = [];

    const entry = {
      id: uuidv4(),
      examType,
      courseName: courseName.trim(),
      score: scoreNum,
      examDate: examDate ? examDate.trim() : null,
      linkedCourseName: linkedCourseName ? linkedCourseName.trim() : null,
      confidence: 100,
      confirmedByStudent: true,
      enteredAt: now,
    };

    existing.apIbScores.push(entry);
    existing.lastUpdated = now;

    writeJSON(filePath, existing);
    appendAudit(dataDir, 'AP_IB_SCORE_ADDED_MANUAL', ['examType', 'courseName', 'score']);

    return res.status(201).json(envelope(true, { section: 'academic', examScore: entry, savedAt: now }));
  } catch (err) {
    console.error('[academic/add-exam-score] error:', err.message);
    return res.status(500).json(envelope(false, null, { code: 'WRITE_ERROR', message: 'Failed to save exam score.' }));
  }
});

/**
 * DELETE /api/profile/academic/exam-score/:id
 * Delete an AP/IB exam score by ID.
 * Searches both academic.json (apIbScores) and tests.json (data.ap / data.ib).
 */
router.delete('/academic/exam-score/:id', (req, res) => {
  const { id } = req.params;

  if (!id || typeof id !== 'string' || id.length > 100) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'Invalid exam score ID.' }));
  }

  try {
    const dataDir = process.env.DATA_DIR;
    const now = new Date().toISOString();

    // Try academic.json first (legacy storage)
    const academicPath = path.join(dataDir, 'profile', 'academic.json');
    const academic = readJSON(academicPath);
    if (Array.isArray(academic.apIbScores)) {
      const idx = academic.apIbScores.findIndex(s => s.id === id);
      if (idx !== -1) {
        academic.apIbScores.splice(idx, 1);
        academic.lastUpdated = now;
        writeJSON(academicPath, academic);
        appendAudit(dataDir, 'EXAM_SCORE_DELETED', ['id']);
        const remainingCount = academic.apIbScores.length;
        return res.json(envelope(true, { deletedId: id, remainingCount }));
      }
    }

    // Try tests.json (spec-defined storage for AP/IB)
    const testsPath = path.join(dataDir, 'profile', 'tests.json');
    const tests = readJSON(testsPath);
    const apArr = Array.isArray(tests.data && tests.data.ap) ? tests.data.ap : [];
    const ibArr = Array.isArray(tests.data && tests.data.ib) ? tests.data.ib : [];

    const apIdx = apArr.findIndex(s => s.id === id);
    if (apIdx !== -1) {
      tests.data.ap.splice(apIdx, 1);
      tests.lastUpdated = now;
      writeJSON(testsPath, tests);
      appendAudit(dataDir, 'EXAM_SCORE_DELETED', ['id']);
      const remainingCount = tests.data.ap.length + (tests.data.ib || []).length;
      return res.json(envelope(true, { deletedId: id, remainingCount }));
    }

    const ibIdx = ibArr.findIndex(s => s.id === id);
    if (ibIdx !== -1) {
      tests.data.ib.splice(ibIdx, 1);
      tests.lastUpdated = now;
      writeJSON(testsPath, tests);
      appendAudit(dataDir, 'EXAM_SCORE_DELETED', ['id']);
      const remainingCount = (tests.data.ap || []).length + tests.data.ib.length;
      return res.json(envelope(true, { deletedId: id, remainingCount }));
    }

    return res.status(404).json(envelope(false, null, { code: 'NOT_FOUND', message: 'Exam score not found.' }));
  } catch (err) {
    console.error('[academic/exam-score/delete] error:', err.message);
    return res.status(500).json(envelope(false, null, { code: 'WRITE_ERROR', message: 'Failed to delete exam score.' }));
  }
});

// -------------------------
// New CRUD Endpoints (STORY-001 bug fix)
// -------------------------

/**
 * GET /api/profile/activities
 * Returns all activity items.
 */
router.get('/activities', (req, res) => {
  const dataDir = process.env.DATA_DIR;
  if (!dataDir) {
    return res.status(503).json(envelope(false, null, { code: 'DATA_DIR_UNAVAILABLE', message: 'Data directory not set.' }));
  }
  try {
    const filePath = path.join(dataDir, 'profile', 'activities.json');
    const file = readJSON(filePath);
    const items = (file.data && Array.isArray(file.data.items)) ? file.data.items : [];
    return res.json(envelope(true, { items, count: items.length }));
  } catch (err) {
    console.error('[activities GET] error:', err.message);
    return res.status(500).json(envelope(false, null, { code: 'READ_ERROR', message: 'Failed to read activities.' }));
  }
});

/**
 * PUT /api/profile/activities/:id
 * Updates a single activity by ID.
 */
router.put('/activities/:id', (req, res) => {
  const { id } = req.params;
  const { activityName, role, organization, hoursPerWeek, startDate, endDate } = req.body || {};

  // Validate
  if (!activityName || activityName.trim().length === 0 || activityName.length > 100) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'Activity name is required (max 100 chars).' }));
  }
  if (organization !== undefined && organization !== null && organization !== '' && organization.length > 100) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'Organization must be 100 characters or fewer.' }));
  }
  if (role !== undefined && role !== null && role !== '' && role.length > 100) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'Role must be 100 characters or fewer.' }));
  }
  if (hoursPerWeek !== undefined && hoursPerWeek !== '' && hoursPerWeek !== null) {
    const h = parseFloat(hoursPerWeek);
    if (isNaN(h) || h < 0 || h > 100) {
      return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'Hours per week must be a number between 0 and 100.' }));
    }
  }

  // Date validation helper
  function parseMMDDYYYY(dateStr) {
    if (!dateStr || dateStr.trim() === '') return null;
    const match = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return false; // invalid format
    const [, mm, dd, yyyy] = match;
    const d = new Date(`${yyyy}-${mm}-${dd}`);
    if (isNaN(d.getTime())) return false;
    return `${yyyy}-${mm}-${dd}`;
  }

  let parsedStart = null;
  let parsedEnd = null;

  if (startDate && startDate.trim() !== '') {
    parsedStart = parseMMDDYYYY(startDate);
    if (parsedStart === false) {
      return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'Start date must be a valid MM/DD/YYYY date.' }));
    }
    if (parsedStart && new Date(parsedStart) > new Date()) {
      return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'Start date must not be in the future.' }));
    }
  }

  if (endDate && endDate.trim() !== '') {
    parsedEnd = parseMMDDYYYY(endDate);
    if (parsedEnd === false) {
      return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'End date must be a valid MM/DD/YYYY date.' }));
    }
    if (parsedEnd && new Date(parsedEnd) > new Date()) {
      return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'End date must not be in the future.' }));
    }
    if (parsedStart && parsedEnd && new Date(parsedEnd) < new Date(parsedStart)) {
      return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'End date must be on or after start date.' }));
    }
  }

  try {
    const dataDir = process.env.DATA_DIR;
    const filePath = path.join(dataDir, 'profile', 'activities.json');
    const file = readJSON(filePath);
    const now = new Date().toISOString();
    let found = false;

    const items = (file.data && Array.isArray(file.data.items)) ? file.data.items : [];
    const idx = items.findIndex(item => item.id === id);
    if (idx !== -1) {
      items[idx] = {
        ...items[idx],
        activityName: activityName.trim(),
        title: activityName.trim(), // keep title in sync
        role: (role && role.trim()) || items[idx].role || null,
        organization: (organization && organization.trim()) || null,
        hoursPerWeek: (hoursPerWeek !== undefined && hoursPerWeek !== '' && hoursPerWeek !== null) ? parseFloat(hoursPerWeek) : items[idx].hoursPerWeek,
        startDate: parsedStart,
        endDate: parsedEnd,
        // Preserve source field
        source: items[idx].source,
        confirmedByStudent: true,
        updatedAt: now,
      };
      file.data.items = items;
      found = true;
    }

    // Search extraction-path items (file.activities)
    if (!found && Array.isArray(file.activities)) {
      const aidx = file.activities.findIndex(item => item.id === id);
      if (aidx !== -1) {
        file.activities[aidx] = {
          ...file.activities[aidx],
          activityName: activityName.trim(),
          title: activityName.trim(),
          role: (role && role.trim()) || file.activities[aidx].role || null,
          organization: (organization && organization.trim()) || null,
          hoursPerWeek: (hoursPerWeek !== undefined && hoursPerWeek !== '' && hoursPerWeek !== null) ? parseFloat(hoursPerWeek) : file.activities[aidx].hoursPerWeek,
          startDate: parsedStart,
          endDate: parsedEnd,
          // Preserve source field
          source: file.activities[aidx].source,
          confirmedByStudent: true,
          updatedAt: now,
        };
        found = true;
      }
    }

    if (!found) {
      return res.status(404).json(envelope(false, null, { code: 'NOT_FOUND', message: 'Activity not found.' }));
    }

    file.lastUpdated = now;
    writeJSON(filePath, file);
    appendAudit(dataDir, 'ACTIVITY_EDITED', ['activityName', 'role', 'organization', 'hoursPerWeek', 'startDate', 'endDate']);
    return res.json(envelope(true, { id, updatedAt: now }));
  } catch (err) {
    console.error('[activities PUT] error:', err.message);
    return res.status(500).json(envelope(false, null, { code: 'WRITE_ERROR', message: 'Failed to update activity.' }));
  }
});

/**
 * DELETE /api/profile/activities/:id
 * Removes a single activity by ID.
 */
router.delete('/activities/:id', (req, res) => {
  const { id } = req.params;
  try {
    const dataDir = process.env.DATA_DIR;
    const filePath = path.join(dataDir, 'profile', 'activities.json');
    const file = readJSON(filePath);
    const now = new Date().toISOString();
    let found = false;

    // Search manual entries
    const items = (file.data && Array.isArray(file.data.items)) ? file.data.items : [];
    const idx = items.findIndex(item => item.id === id);
    if (idx !== -1) {
      items.splice(idx, 1);
      file.data.items = items;
      found = true;
    }

    // Search extraction-path items (file.activities)
    if (!found && Array.isArray(file.activities)) {
      const aidx = file.activities.findIndex(item => item.id === id);
      if (aidx !== -1) {
        file.activities.splice(aidx, 1);
        found = true;
      }
    }

    if (!found) {
      return res.status(404).json(envelope(false, null, { code: 'NOT_FOUND', message: 'Activity not found.' }));
    }

    file.lastUpdated = now;
    writeJSON(filePath, file);
    appendAudit(dataDir, 'ACTIVITY_DELETED', ['id']);
    const remainingCount = items.length + (Array.isArray(file.activities) ? file.activities.length : 0);
    return res.json(envelope(true, { deletedId: id, remainingCount }));
  } catch (err) {
    console.error('[activities DELETE] error:', err.message);
    return res.status(500).json(envelope(false, null, { code: 'WRITE_ERROR', message: 'Failed to delete activity.' }));
  }
});

/**
 * GET /api/profile/achievements
 * Returns all achievement items.
 */
router.get('/achievements', (req, res) => {
  const dataDir = process.env.DATA_DIR;
  if (!dataDir) {
    return res.status(503).json(envelope(false, null, { code: 'DATA_DIR_UNAVAILABLE', message: 'Data directory not set.' }));
  }
  try {
    const filePath = path.join(dataDir, 'profile', 'achievements.json');
    const file = readJSON(filePath);
    const items = (file.data && Array.isArray(file.data.items)) ? file.data.items : [];
    return res.json(envelope(true, { items, count: items.length }));
  } catch (err) {
    console.error('[achievements GET] error:', err.message);
    return res.status(500).json(envelope(false, null, { code: 'READ_ERROR', message: 'Failed to read achievements.' }));
  }
});

/**
 * PUT /api/profile/achievements/:id
 * Updates a single achievement by ID.
 */
router.put('/achievements/:id', (req, res) => {
  const { id } = req.params;
  const { title, description, category, dateAwarded } = req.body || {};
  const validCategories = ['academic', 'sports', 'community', 'other'];

  if (!title || title.trim().length === 0 || title.length > 100) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'Title is required (max 100 chars).' }));
  }
  if (!category || !validCategories.includes(category.toLowerCase())) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'Category must be one of: academic, sports, community, other.' }));
  }
  if (description && description.length > 500) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'Description must be 500 characters or fewer.' }));
  }
  if (dateAwarded && dateAwarded.trim() !== '') {
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dateAwarded)) {
      return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'Date must be in MM/DD/YYYY format.' }));
    }
    const [mm, dd, yyyy] = dateAwarded.split('/');
    const d = new Date(`${yyyy}-${mm}-${dd}`);
    if (isNaN(d.getTime())) {
      return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'Date is not a valid date.' }));
    }
    if (d > new Date()) {
      return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'Date must not be in the future.' }));
    }
  }

  try {
    const dataDir = process.env.DATA_DIR;
    const filePath = path.join(dataDir, 'profile', 'achievements.json');
    const file = readJSON(filePath);
    const now = new Date().toISOString();

    // Convert MM/DD/YYYY → YYYY-MM-DD for storage
    function _toISO(dateAwarded, existing) {
      if (dateAwarded && dateAwarded.trim() !== '') {
        const [mm, dd, yyyy] = dateAwarded.split('/');
        return `${yyyy}-${mm}-${dd}`;
      } else if (dateAwarded === '' || dateAwarded === null) {
        return null;
      }
      return existing || null;
    }

    let found = false;

    // Search manual entries (file.data.items)
    const items = (file.data && Array.isArray(file.data.items)) ? file.data.items : [];
    const idx = items.findIndex(item => item.id === id);
    if (idx !== -1) {
      const dateAwardedISO = _toISO(dateAwarded, items[idx].dateAwarded);
      items[idx] = {
        ...items[idx],
        title: title.trim(),
        description: description !== undefined ? (description || '') : (items[idx].description || ''),
        category: category.toLowerCase(),
        dateAwarded: dateAwardedISO,
        // Preserve source field — do NOT overwrite
        source: items[idx].source,
        confirmedByStudent: true,
        updatedAt: now,
      };
      file.data.items = items;
      found = true;
    }

    // Search extraction-path items (file.achievements)
    if (!found && Array.isArray(file.achievements)) {
      const aidx = file.achievements.findIndex(item => item.id === id);
      if (aidx !== -1) {
        const dateAwardedISO = _toISO(dateAwarded, file.achievements[aidx].dateAwarded);
        file.achievements[aidx] = {
          ...file.achievements[aidx],
          title: title.trim(),
          description: description !== undefined ? (description || '') : (file.achievements[aidx].description || ''),
          category: category.toLowerCase(),
          dateAwarded: dateAwardedISO,
          // Preserve source field
          source: file.achievements[aidx].source,
          confirmedByStudent: true,
          updatedAt: now,
        };
        found = true;
      }
    }

    if (!found) {
      return res.status(404).json(envelope(false, null, { code: 'NOT_FOUND', message: 'Achievement not found.' }));
    }

    file.lastUpdated = now;
    writeJSON(filePath, file);
    appendAudit(dataDir, 'ACHIEVEMENT_EDITED', ['title', 'description', 'category', 'dateAwarded']);
    return res.json(envelope(true, { id, updatedAt: now }));
  } catch (err) {
    console.error('[achievements PUT] error:', err.message);
    return res.status(500).json(envelope(false, null, { code: 'WRITE_ERROR', message: 'Failed to update achievement.' }));
  }
});

/**
 * DELETE /api/profile/achievements/:id
 * Removes a single achievement by ID.
 */
router.delete('/achievements/:id', (req, res) => {
  const { id } = req.params;
  try {
    const dataDir = process.env.DATA_DIR;
    const filePath = path.join(dataDir, 'profile', 'achievements.json');
    const file = readJSON(filePath);
    const now = new Date().toISOString();
    let found = false;

    // Search manual entries
    const items = (file.data && Array.isArray(file.data.items)) ? file.data.items : [];
    const idx = items.findIndex(item => item.id === id);
    if (idx !== -1) {
      items.splice(idx, 1);
      file.data.items = items;
      found = true;
    }

    // Search extraction-path items
    if (!found && Array.isArray(file.achievements)) {
      const aidx = file.achievements.findIndex(item => item.id === id);
      if (aidx !== -1) {
        file.achievements.splice(aidx, 1);
        found = true;
      }
    }

    if (!found) {
      return res.status(404).json(envelope(false, null, { code: 'NOT_FOUND', message: 'Achievement not found.' }));
    }

    file.lastUpdated = now;
    writeJSON(filePath, file);
    appendAudit(dataDir, 'ACHIEVEMENT_DELETED', ['id']);
    const remainingCount = items.length + (Array.isArray(file.achievements) ? file.achievements.length : 0);
    return res.json(envelope(true, { deletedId: id, remainingCount }));
  } catch (err) {
    console.error('[achievements DELETE] error:', err.message);
    return res.status(500).json(envelope(false, null, { code: 'WRITE_ERROR', message: 'Failed to delete achievement.' }));
  }
});

/**
 * GET /api/profile/academic/exam-scores
 * Returns all AP and IB exam scores from both tests.json and academic.json.
 */
router.get('/academic/exam-scores', (req, res) => {
  const dataDir = process.env.DATA_DIR;
  if (!dataDir) {
    return res.status(503).json(envelope(false, null, { code: 'DATA_DIR_UNAVAILABLE', message: 'Data directory not set.' }));
  }
  try {
    const ap = [];
    const ib = [];

    // Collect from academic.json (legacy)
    try {
      const academic = readJSON(path.join(dataDir, 'profile', 'academic.json'));
      if (Array.isArray(academic.apIbScores)) {
        for (const s of academic.apIbScores) {
          if (s.examType === 'IB') ib.push(s);
          else ap.push(s);
        }
      }
    } catch (_) {}

    // Collect from tests.json (spec-defined)
    try {
      const tests = readJSON(path.join(dataDir, 'profile', 'tests.json'));
      if (tests.data) {
        if (Array.isArray(tests.data.ap)) ap.push(...tests.data.ap);
        if (Array.isArray(tests.data.ib)) ib.push(...tests.data.ib);
      }
    } catch (_) {}

    return res.json(envelope(true, { ap, ib, count: ap.length + ib.length }));
  } catch (err) {
    console.error('[academic/exam-scores GET] error:', err.message);
    return res.status(500).json(envelope(false, null, { code: 'READ_ERROR', message: 'Failed to read exam scores.' }));
  }
});

/**
 * PUT /api/profile/academic/exam-score/:id
 * Updates a single AP or IB exam score by ID.
 * Searches academic.json (apIbScores) and tests.json (data.ap / data.ib).
 */
router.put('/academic/exam-score/:id', (req, res) => {
  const { id } = req.params;
  const { courseName, examType, score, dateTaken } = req.body || {};
  const validTypes = ['AP', 'IB'];

  if (!courseName || courseName.trim().length === 0 || courseName.length > 100) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'Course name is required (max 100 chars).' }));
  }
  if (!examType || !validTypes.includes(examType)) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'Exam type must be AP or IB.' }));
  }
  if (score === undefined || score === null || score === '') {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'Score is required.' }));
  }
  const scoreNum = parseInt(score, 10);
  if (isNaN(scoreNum)) {
    return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'Score must be a number.' }));
  }
  if (examType === 'AP' && (scoreNum < 1 || scoreNum > 5)) {
    return res.status(400).json(envelope(false, null, { code: 'SCORE_OUT_OF_RANGE', message: 'Score must be between 1 and 5 for AP.' }));
  }
  if (examType === 'IB' && (scoreNum < 1 || scoreNum > 7)) {
    return res.status(400).json(envelope(false, null, { code: 'SCORE_OUT_OF_RANGE', message: 'Score must be between 1 and 7 for IB.' }));
  }
  if (dateTaken && dateTaken.trim() !== '') {
    if (!/^\d{2}\/\d{4}$/.test(dateTaken.trim())) {
      return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'Date must be in MM/YYYY format.' }));
    }
    const [mm, yyyy] = dateTaken.split('/');
    const d = new Date(`${yyyy}-${mm}-01`);
    if (isNaN(d.getTime()) || d > new Date()) {
      return res.status(400).json(envelope(false, null, { code: 'VALIDATION_ERROR', message: 'Date must be a valid past month and year.' }));
    }
  }

  try {
    const dataDir = process.env.DATA_DIR;
    const now = new Date().toISOString();

    // Convert MM/YYYY to YYYY-MM
    let dateTakenISO = null;
    if (dateTaken && dateTaken.trim() !== '') {
      const [mm, yyyy] = dateTaken.split('/');
      dateTakenISO = `${yyyy}-${mm}`;
    }

    // Try academic.json first (legacy)
    const academicPath = path.join(dataDir, 'profile', 'academic.json');
    const academic = readJSON(academicPath);
    if (Array.isArray(academic.apIbScores)) {
      const idx = academic.apIbScores.findIndex(s => s.id === id);
      if (idx !== -1) {
        academic.apIbScores[idx] = {
          ...academic.apIbScores[idx],
          courseName: courseName.trim(),
          examType,
          score: scoreNum,
          examDate: dateTakenISO || academic.apIbScores[idx].examDate,
          updatedAt: now,
        };
        academic.lastUpdated = now;
        writeJSON(academicPath, academic);
        appendAudit(dataDir, 'EXAM_SCORE_EDITED', ['courseName', 'examType', 'score', 'dateTaken']);
        return res.json(envelope(true, { id, updatedAt: now }));
      }
    }

    // Try tests.json
    const testsPath = path.join(dataDir, 'profile', 'tests.json');
    const tests = readJSON(testsPath);
    if (!tests.data) tests.data = { sat: null, act: null, ap: [], ib: [], other: [] };
    if (!Array.isArray(tests.data.ap)) tests.data.ap = [];
    if (!Array.isArray(tests.data.ib)) tests.data.ib = [];

    // Search AP array
    const apIdx = tests.data.ap.findIndex(s => s.id === id);
    if (apIdx !== -1) {
      const updated = {
        ...tests.data.ap[apIdx],
        courseName: courseName.trim(),
        examType,
        score: scoreNum,
        dateTaken: dateTakenISO || tests.data.ap[apIdx].dateTaken,
        updatedAt: now,
      };
      // If examType changed to IB, move to ib array
      if (examType === 'IB') {
        tests.data.ap.splice(apIdx, 1);
        tests.data.ib.push(updated);
      } else {
        tests.data.ap[apIdx] = updated;
      }
      tests.lastUpdated = now;
      writeJSON(testsPath, tests);
      appendAudit(dataDir, 'EXAM_SCORE_EDITED', ['courseName', 'examType', 'score', 'dateTaken']);
      return res.json(envelope(true, { id, updatedAt: now }));
    }

    // Search IB array
    const ibIdx = tests.data.ib.findIndex(s => s.id === id);
    if (ibIdx !== -1) {
      const updated = {
        ...tests.data.ib[ibIdx],
        courseName: courseName.trim(),
        examType,
        score: scoreNum,
        dateTaken: dateTakenISO || tests.data.ib[ibIdx].dateTaken,
        updatedAt: now,
      };
      // If examType changed to AP, move to ap array
      if (examType === 'AP') {
        tests.data.ib.splice(ibIdx, 1);
        tests.data.ap.push(updated);
      } else {
        tests.data.ib[ibIdx] = updated;
      }
      tests.lastUpdated = now;
      writeJSON(testsPath, tests);
      appendAudit(dataDir, 'EXAM_SCORE_EDITED', ['courseName', 'examType', 'score', 'dateTaken']);
      return res.json(envelope(true, { id, updatedAt: now }));
    }

    return res.status(404).json(envelope(false, null, { code: 'NOT_FOUND', message: 'Exam score not found.' }));
  } catch (err) {
    console.error('[academic/exam-score PUT] error:', err.message);
    return res.status(500).json(envelope(false, null, { code: 'WRITE_ERROR', message: 'Failed to update exam score.' }));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Course CRUD Endpoints (STORY-003)
// ─────────────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_COURSE_LEVELS = ['AP', 'IB', 'Honors', 'Dual Enrollment', 'Regular', 'Other'];

/**
 * Validate course fields. Returns null on success or an object { status, code, message }.
 */
function validateCourseBody(body) {
  const { name, grade, score, term, level } = body;
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return { status: 422, code: 'VALIDATION_ERROR', message: 'Course name is required' };
  }
  if (name.trim().length > 200) {
    return { status: 422, code: 'VALIDATION_ERROR', message: 'Course name must be 200 characters or fewer' };
  }
  if (grade !== undefined && grade !== null && grade !== '' && String(grade).length > 5) {
    return { status: 422, code: 'VALIDATION_ERROR', message: 'Grade must be 5 characters or fewer' };
  }
  if (score !== undefined && score !== null && score !== '') {
    const s = parseFloat(score);
    if (isNaN(s) || s < 0 || s > 100) {
      return { status: 422, code: 'VALIDATION_ERROR', message: 'Score must be a number between 0 and 100' };
    }
  }
  if (term !== undefined && term !== null && term !== '' && String(term).length > 50) {
    return { status: 422, code: 'VALIDATION_ERROR', message: 'Term must be 50 characters or fewer' };
  }
  if (!level || !VALID_COURSE_LEVELS.includes(level)) {
    return { status: 422, code: 'VALIDATION_ERROR', message: 'Level must be one of: AP, IB, Honors, Dual Enrollment, Regular, Other' };
  }
  return null;
}

/**
 * GET /api/profile/academic/courses
 * Returns all courses with source tracking info.
 */
router.get('/academic/courses', (req, res) => {
  const dataDir = process.env.DATA_DIR;
  if (!dataDir) return res.status(503).json(envelope(false, null, { code: 'DATA_DIR_UNAVAILABLE', message: 'Data directory not set.' }));
  try {
    const filePath = path.join(dataDir, 'profile', 'academic.json');
    const file = readJSON(filePath);
    // Collect courses from both extraction and manual entry paths
    const topLevel = Array.isArray(file.courses) ? file.courses : [];
    const nested = (file.data && Array.isArray(file.data.courses)) ? file.data.courses : [];
    const courses = [...topLevel, ...nested];
    return res.json(envelope(true, { courses, count: courses.length }));
  } catch (err) {
    console.error('[academic/courses GET] error:', err.message);
    return res.status(500).json(envelope(false, null, { code: 'READ_ERROR', message: 'Failed to read courses.' }));
  }
});

/**
 * PUT /api/profile/academic/course/:id
 * Update a single saved course. Preserves source metadata.
 */
router.put('/academic/course/:id', (req, res) => {
  const { id } = req.params;

  // UUID validation
  if (!id || !UUID_RE.test(id)) {
    return res.status(400).json(envelope(false, null, { code: 'INVALID_ID', message: 'Invalid course ID format' }));
  }

  // Body validation
  const bodyErr = validateCourseBody(req.body);
  if (bodyErr) return res.status(bodyErr.status).json(envelope(false, null, { code: bodyErr.code, message: bodyErr.message }));

  const { name, grade, score, term, level } = req.body;

  try {
    const dataDir = process.env.DATA_DIR;
    const filePath = path.join(dataDir, 'profile', 'academic.json');
    const file = readJSON(filePath);
    const now = new Date().toISOString();

    // Search top-level courses array
    let found = false;
    if (Array.isArray(file.courses)) {
      const idx = file.courses.findIndex(c => c.id === id);
      if (idx !== -1) {
        const existing = file.courses[idx];
        file.courses[idx] = {
          ...existing,
          name: name.trim(),
          grade: (grade !== undefined && grade !== null && grade !== '') ? String(grade).trim() : (existing.grade || null),
          score: (score !== undefined && score !== null && score !== '') ? parseFloat(score) : (existing.score !== undefined ? existing.score : null),
          term: (term !== undefined && term !== null && term !== '') ? String(term).trim() : (existing.term || null),
          level,
          confirmedByStudent: true,
          updatedAt: now,
        };
        found = true;
      }
    }

    // Also search nested data.courses (manual-entry path)
    if (!found && file.data && Array.isArray(file.data.courses)) {
      const idx = file.data.courses.findIndex(c => c.id === id);
      if (idx !== -1) {
        const existing = file.data.courses[idx];
        file.data.courses[idx] = {
          ...existing,
          name: name.trim(),
          grade: (grade !== undefined && grade !== null && grade !== '') ? String(grade).trim() : (existing.grade || null),
          score: (score !== undefined && score !== null && score !== '') ? parseFloat(score) : (existing.score !== undefined ? existing.score : null),
          term: (term !== undefined && term !== null && term !== '') ? String(term).trim() : (existing.term || null),
          level,
          confirmedByStudent: true,
          updatedAt: now,
        };
        found = true;
      }
    }

    if (!found) {
      return res.status(404).json(envelope(false, null, { code: 'COURSE_NOT_FOUND', message: 'Course not found' }));
    }

    file.lastUpdated = now;
    writeJSON(filePath, file);
    appendAudit(dataDir, 'COURSE_EDITED', ['id', 'name', 'grade', 'score', 'term', 'level']);

    return res.json(envelope(true, {
      id,
      name: name.trim(),
      grade: (grade !== undefined && grade !== null && grade !== '') ? String(grade).trim() : null,
      score: (score !== undefined && score !== null && score !== '') ? parseFloat(score) : null,
      term: (term !== undefined && term !== null && term !== '') ? String(term).trim() : null,
      level,
      confirmedByStudent: true,
      updatedAt: now,
    }));
  } catch (err) {
    console.error('[academic/course PUT] error:', err.message);
    return res.status(503).json(envelope(false, null, { code: 'FILE_LOCK_TIMEOUT', message: 'Could not save — please try again' }));
  }
});

/**
 * DELETE /api/profile/academic/course/:id
 * Hard-delete a course from academic.json courses array.
 */
router.delete('/academic/course/:id', (req, res) => {
  const { id } = req.params;

  if (!id || !UUID_RE.test(id)) {
    return res.status(400).json(envelope(false, null, { code: 'INVALID_ID', message: 'Invalid course ID format' }));
  }

  try {
    const dataDir = process.env.DATA_DIR;
    const filePath = path.join(dataDir, 'profile', 'academic.json');
    const file = readJSON(filePath);
    const now = new Date().toISOString();

    let found = false;
    let courseName = '';

    if (Array.isArray(file.courses)) {
      const idx = file.courses.findIndex(c => c.id === id);
      if (idx !== -1) {
        courseName = file.courses[idx].name || '';
        file.courses.splice(idx, 1);
        found = true;
      }
    }

    if (!found && file.data && Array.isArray(file.data.courses)) {
      const idx = file.data.courses.findIndex(c => c.id === id);
      if (idx !== -1) {
        courseName = file.data.courses[idx].name || '';
        file.data.courses.splice(idx, 1);
        found = true;
      }
    }

    if (!found) {
      return res.status(404).json(envelope(false, null, { code: 'COURSE_NOT_FOUND', message: 'Course not found' }));
    }

    file.lastUpdated = now;
    writeJSON(filePath, file);
    appendAudit(dataDir, 'COURSE_DELETED', { courseId: id, courseName, timestamp: now });

    const remainingCount = (Array.isArray(file.courses) ? file.courses.length : 0) +
      (file.data && Array.isArray(file.data.courses) ? file.data.courses.length : 0);

    return res.json(envelope(true, { id, deleted: true, remainingCount }));
  } catch (err) {
    console.error('[academic/course DELETE] error:', err.message);
    return res.status(503).json(envelope(false, null, { code: 'FILE_LOCK_TIMEOUT', message: 'Could not delete — please try again' }));
  }
});

/**
 * POST /api/profile/academic/course
 * Create a new manual course entry with source.type = "manual".
 */
router.post('/academic/course', (req, res) => {
  const bodyErr = validateCourseBody(req.body);
  if (bodyErr) return res.status(bodyErr.status).json(envelope(false, null, { code: bodyErr.code, message: bodyErr.message }));

  const { name, grade, score, term, level } = req.body;

  try {
    const dataDir = process.env.DATA_DIR;
    const filePath = path.join(dataDir, 'profile', 'academic.json');
    const file = readJSON(filePath);
    const now = new Date().toISOString();

    const newCourse = {
      id: uuidv4(),
      name: name.trim(),
      grade: (grade !== undefined && grade !== null && grade !== '') ? String(grade).trim() : null,
      score: (score !== undefined && score !== null && score !== '') ? parseFloat(score) : null,
      term: (term !== undefined && term !== null && term !== '') ? String(term).trim() : null,
      level: level || 'Regular',
      confidence: 100,
      source: {
        type: 'manual',
        documentId: null,
        documentName: null,
        extractedAt: null,
      },
      excerpt: '',
      confirmedByStudent: true,
      savedAt: now,
    };

    if (!Array.isArray(file.courses)) file.courses = [];
    file.courses.push(newCourse);
    file.lastUpdated = now;
    writeJSON(filePath, file);
    appendAudit(dataDir, 'COURSE_ADDED_MANUAL', { courseName: newCourse.name, courseId: newCourse.id });

    return res.status(201).json(envelope(true, newCourse));
  } catch (err) {
    console.error('[academic/course POST] error:', err.message);
    return res.status(503).json(envelope(false, null, { code: 'FILE_LOCK_TIMEOUT', message: 'Could not save — please try again' }));
  }
});

module.exports = router;
