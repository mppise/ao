'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config');

// ─── Prompt builder ───────────────────────────────────────────────────────────

/**
 * Build the Gemini prompt from assembled profile data.
 * @param {object} profileData - { gpa, testScores, apIbScores, courses, achievements, activities, impactStatements }
 * @returns {string}
 */
function buildEssayPrompt(profileData) {
  const { gpa, testScores, apIbScores, courses, achievements, activities, impactStatements } = profileData;

  const gpaStr = gpa || 'Not provided';
  const testScoresStr = testScores || 'Not provided';
  const apIbStr = apIbScores || 'Not provided';
  const coursesStr = courses && courses.length > 0
    ? courses.slice(0, 10).map(c => {
        if (typeof c === 'string') return c;
        // Object schema: { name, grade, level }
        let label = c.name || '';
        if (c.level) label += ` (${c.level})`;
        if (c.grade != null) label += ` — ${c.grade}`;
        return label;
      }).filter(Boolean).join(', ')
    : 'Not provided';

  const achievementsStr = achievements && achievements.length > 0
    ? achievements.map(a => {
        let line = `- ${a.name}: ${a.description || ''}`;
        if (a.impact_statement) line += `. Impact: "${a.impact_statement}"`;
        return line;
      }).join('\n')
    : 'None provided';

  const activitiesStr = activities && activities.length > 0
    ? activities.map(a => {
        let line = `- ${a.name} (${a.role || 'participant'}): ${a.description || ''}`;
        if (a.hoursPerWeek != null) line += `. ${a.hoursPerWeek} hrs/wk`;
        if (a.weeksPerYear != null) line += `, ${a.weeksPerYear} wks/yr`;
        line += '.';
        return line;
      }).join('\n')
    : 'None provided';

  const impactStatementsStr = impactStatements && impactStatements.length > 0
    ? impactStatements.map(s => `- "${s.statement}" (about: ${s.parentName})`).join('\n')
    : 'None provided';

  return `You are helping a high-school senior write their Common App personal statement.
Your job is to write a FIRST DRAFT (500–650 words) that uses ONLY the data provided below.

RULES:
- Use ONLY achievements, activities, and experiences listed below. Do NOT invent, assume, or hallucinate any detail not explicitly provided.
- Write in first person, as the student.
- Sound like a thoughtful 17-year-old reflecting honestly, NOT like a guidance counselor or a corporate bio.
- BANNED phrases (never use these or close variants): "lifelong learner", "passionate about", "I have always been", "dedicated to excellence", "I am committed to", "making a difference", "giving back to the community", "pursuit of knowledge", "I strive to".
- Open with a specific, concrete hook — a moment, a detail, or a scene from ONE of the listed achievements or activities. No generic opening.
- Weave in at least 3 specific achievements or activities by name and detail. Use exact names as provided below.
- Reference impact statements to show reflection on what was learned or felt — these are the student's own words about why something mattered.
- End with a forward-looking sentence or two about what the student wants to carry forward (values, goals, direction) — grounded in what was described.
- Do NOT use bullet points. Flowing paragraphs only.
- Do NOT add a title or heading. Start directly with the hook sentence.
- Target: between 500 and 650 words. Count carefully.

STUDENT PROFILE DATA:
---
Academic:
GPA: ${gpaStr}
Test scores: ${testScoresStr}
AP/IB Exam Scores: ${apIbStr}
Notable courses: ${coursesStr}

Achievements:
${achievementsStr}

Activities:
${activitiesStr}

Impact statements:
${impactStatementsStr}
---

Write the essay draft now. Only output the essay text — no preamble, no explanation, no word count at the end.`;
}

// ─── Profile data assembler ───────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const { readJSON } = require('../utils/file-io');

const MAX_PROFILE_TEXT = 8000;

/**
 * Read and assemble profile data from disk for essay generation.
 * Returns { gpa, testScores, apIbScores, courses, achievements, activities, impactStatements }
 * Missing files are silently omitted.
 * @param {string} dataDir
 * @param {object|null} [provenanceSelection] - optional filter: { includeGpa, testScoreIds, achievementIds, impactStatementIds }
 * @returns {object}
 */
function assembleProfileData(dataDir, provenanceSelection) {
  const profileDir = path.join(dataDir, 'profile');
  const sel = (provenanceSelection && typeof provenanceSelection === 'object') ? provenanceSelection : null;

  // ── Academic (academic.json) ────────────────────────────────────────────────
  // The file is written in two schemas:
  //   Init schema:  { data: { gpa, courses: [], apIbScores: [] }, sources: [] }
  //   Merged schema: { gpa: { overall: { value, confidence } }, courses: [{ name, grade, level }],
  //                    apIbScores: [...] }  (top-level, no data wrapper)
  let gpa = null;
  let courses = [];
  let apIbScores = null;

  const includeGpa = !sel || sel.includeGpa !== false;

  try {
    const academic = readJSON(path.join(profileDir, 'academic.json'));
    if (academic) {
      // ── GPA ──────────────────────────────────────────────────────────────
      if (includeGpa) {
        // Merged schema: gpa.overall.value
        if (academic.gpa && academic.gpa.overall && academic.gpa.overall.value != null) {
          gpa = String(academic.gpa.overall.value);
        // Init schema: data.gpa
        } else if (academic.data && academic.data.gpa != null) {
          gpa = String(academic.data.gpa);
        // Flat top-level fallback
        } else if (academic.gpa != null && typeof academic.gpa !== 'object') {
          gpa = String(academic.gpa);
        }
      }

      // ── Courses (always included per spec — not individually toggleable) ──
      // Merged schema: top-level courses[]
      if (Array.isArray(academic.courses) && academic.courses.length > 0) {
        courses = academic.courses;
      // Init schema: data.courses[]
      } else if (academic.data && Array.isArray(academic.data.courses)) {
        courses = academic.data.courses;
      }

      // ── AP/IB Exam Scores (always included per spec) ──
      // Merged schema: top-level apIbScores[]
      let apIbList = [];
      if (Array.isArray(academic.apIbScores) && academic.apIbScores.length > 0) {
        apIbList = academic.apIbScores;
      // Init schema: data.apIbScores[]
      } else if (academic.data && Array.isArray(academic.data.apIbScores)) {
        apIbList = academic.data.apIbScores;
      }
      if (apIbList.length > 0) {
        apIbScores = apIbList.map(item =>
          `${item.examType || 'AP'} ${item.courseName || item.examName || ''}: ${item.score}`
        ).join(', ');
      }
    }
  } catch (_) { /* file absent — skip */ }

  // ── Test scores (tests.json) ────────────────────────────────────────────────
  // Init schema:   { data: { sat: null, act: null, ap: [], ib: [], other: [] } }
  // Merged schema: { sat: { score: { math, ebrw, total }, dateTaken, confidence },
  //                  act: { score: { english, math, reading, science, composite } },
  //                  ap:  [{ examName, score }], ib: [{ subject, level, score }],
  //                  other: [...] }  — all at top-level, no data wrapper
  let testScores = null;

  try {
    const testsFile = readJSON(path.join(profileDir, 'tests.json'));
    if (testsFile) {
      // Normalise: prefer top-level merged schema, fall back to data wrapper
      const tests = (testsFile.sat !== undefined || testsFile.act !== undefined ||
                     testsFile.ap !== undefined || testsFile.ib !== undefined)
        ? testsFile
        : (testsFile.data || {});

      const parts = [];

      // SAT
      if (tests.sat && tests.sat.score) {
        const total = tests.sat.score.total != null
          ? tests.sat.score.total
          : (tests.sat.score.math != null && tests.sat.score.ebrw != null
              ? tests.sat.score.math + tests.sat.score.ebrw
              : null);
        if (total != null) parts.push({ id: 'sat', label: `SAT: ${total}` });
      } else if (tests.sat != null && typeof tests.sat !== 'object') {
        parts.push({ id: 'sat', label: `SAT: ${tests.sat}` });
      }

      // ACT
      if (tests.act && tests.act.score) {
        const composite = tests.act.score.composite != null ? tests.act.score.composite : null;
        if (composite != null) parts.push({ id: 'act', label: `ACT: ${composite}` });
      } else if (tests.act != null && typeof tests.act !== 'object') {
        parts.push({ id: 'act', label: `ACT: ${tests.act}` });
      }

      // AP scores (may be in tests.json or academic.json apIbScores)
      if (Array.isArray(tests.ap)) {
        tests.ap.forEach(a => parts.push({
          id: a.id || `ap-${a.examName}`,
          label: `AP ${a.examName || a.name || ''}: ${a.score}`,
        }));
      }

      // IB scores
      if (Array.isArray(tests.ib)) {
        tests.ib.forEach(a => parts.push({
          id: a.id || `ib-${a.subject}`,
          label: `IB ${a.subject || ''} (${a.level || ''}): ${a.score}`,
        }));
      }

      // Other exams
      if (Array.isArray(tests.other)) {
        tests.other.forEach(o => parts.push({
          id: o.id || `other-${o.examName}`,
          label: `${o.examName || 'Exam'}: ${o.results || o.score || ''}`,
        }));
      }

      // Apply testScoreIds filter if provided
      let filteredParts = parts;
      if (sel && Array.isArray(sel.testScoreIds)) {
        if (sel.testScoreIds.length === 0) {
          filteredParts = [];
        } else {
          filteredParts = parts.filter(p => sel.testScoreIds.includes(p.id));
        }
      }

      if (filteredParts.length > 0) {
        testScores = filteredParts.map(p => p.label).join(', ');
      }
    }
  } catch (_) { /* skip */ }

  // ── Achievements (achievements.json) ────────────────────────────────────────
  // Init schema:   { data: { items: [] } }
  // Merged schema: { achievements: [{ id, awardName, title, description, category }] }
  let allAchievements = [];

  try {
    const achFile = readJSON(path.join(profileDir, 'achievements.json'));
    if (achFile) {
      // Merged schema: top-level achievements[]
      let items = Array.isArray(achFile.achievements) ? achFile.achievements
        // Init schema: data.items[]
        : (achFile.data && Array.isArray(achFile.data.items)) ? achFile.data.items
        : [];
      allAchievements = items.map(item => ({
        id: item.id,
        name: item.awardName || item.title || item.name || 'Achievement',
        description: item.description || item.summary || '',
        impact_statement: null,
      }));
    }
  } catch (_) { /* skip */ }

  // ── Activities (activities.json) ────────────────────────────────────────────
  // Init schema:   { data: { items: [] } }
  // Merged schema: { activities: [{ id, activityName, title, role, description, hoursPerWeek, weeksPerYear }] }
  let allActivities = [];

  try {
    const actFile = readJSON(path.join(profileDir, 'activities.json'));
    if (actFile) {
      // Merged schema: top-level activities[]
      let items = Array.isArray(actFile.activities) ? actFile.activities
        // Init schema: data.items[]
        : (actFile.data && Array.isArray(actFile.data.items)) ? actFile.data.items
        : [];
      allActivities = items.map(item => ({
        id: item.id,
        name: item.activityName || item.title || item.name || 'Activity',
        role: item.role || 'participant',
        description: item.description || '',
        hoursPerWeek: item.hoursPerWeek != null ? item.hoursPerWeek : null,
        weeksPerYear: item.weeksPerYear != null ? item.weeksPerYear : null,
      }));
    }
  } catch (_) { /* skip */ }

  // ── Filter achievements & activities by achievementIds if provided ───────────
  // achievementIds covers both achievements and activities merged together
  let achievements = allAchievements;
  let activities = allActivities;
  if (sel && Array.isArray(sel.achievementIds)) {
    achievements = allAchievements.filter(a => sel.achievementIds.includes(a.id));
    activities = allActivities.filter(a => sel.achievementIds.includes(a.id));
  }

  // ── Impact statements (impact_statements.json) ──────────────────────────────
  // Schema: { data: { statements: [{ id, statement, linkedAchievementName }] } }
  //      or: { statements: [...] }  (flat)
  let impactStatements = [];

  try {
    const isFile = readJSON(path.join(profileDir, 'impact_statements.json'));
    if (isFile) {
      const isData = isFile.data || isFile;
      const stmts = Array.isArray(isData.statements) ? isData.statements
        : (Array.isArray(isData) ? isData : []);

      let filteredStmts = stmts;
      if (sel && Array.isArray(sel.impactStatementIds)) {
        if (sel.impactStatementIds.length === 0) {
          filteredStmts = [];
        } else {
          filteredStmts = stmts.filter(s => sel.impactStatementIds.includes(s.id));
        }
      }

      impactStatements = filteredStmts
        .filter(stmt => stmt.statement)
        .map(stmt => ({
          statement: stmt.statement,
          parentName: stmt.linkedAchievementName || stmt.achievementName || stmt.achievementId || 'Activity',
        }));

      // Link first impact statement to each achievement for the achievements block
      achievements = achievements.map(a => {
        const linked = impactStatements.find(s =>
          s.parentName && (
            s.parentName.toLowerCase().includes((a.name || '').toLowerCase().slice(0, 15)) ||
            (a.name || '').toLowerCase().includes(s.parentName.toLowerCase().slice(0, 15))
          )
        );
        return linked ? { ...a, impact_statement: linked.statement } : a;
      });
    }
  } catch (_) { /* skip */ }

  // ── Size limit: truncate if assembled text is too large ─────────────────────
  const profileData = { gpa, testScores, apIbScores, courses, achievements, activities, impactStatements };
  const textLen = JSON.stringify(profileData).length;
  if (textLen > MAX_PROFILE_TEXT) {
    console.warn(`[essay] Profile data exceeds ${MAX_PROFILE_TEXT} chars (${textLen}). Truncating.`);
    // First: drop courses beyond top 5
    if (courses.length > 5) {
      profileData.courses = courses.slice(0, 5);
    }
    const textLen2 = JSON.stringify(profileData).length;
    if (textLen2 > MAX_PROFILE_TEXT) {
      // Second: drop activity descriptions
      profileData.activities = profileData.activities.map(a => ({ name: a.name, role: a.role }));
    }
  }

  return profileData;
}

// ─── Word count helper ────────────────────────────────────────────────────────

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ─── Main generator ───────────────────────────────────────────────────────────

/**
 * Generate an essay draft from the student's profile.
 * @param {string} dataDir
 * @param {object|null} [provenanceSelection] - optional filter: { includeGpa, testScoreIds, achievementIds, impactStatementIds }
 * @returns {Promise<string>} — essay text
 * @throws {Error} with .code set to 'AI_TIMEOUT' | 'AI_ERROR' | 'AI_TOO_SHORT' | 'INSUFFICIENT_PROFILE_DATA'
 */
async function generateEssayDraft(dataDir, provenanceSelection) {
  const apiKey = config.geminiApiKey;
  const modelName = config.geminiModel;

  if (!apiKey || !modelName) {
    const err = new Error('Gemini API not configured.');
    err.code = 'AI_ERROR';
    throw err;
  }

  const profileData = assembleProfileData(dataDir, provenanceSelection || null);
  const totalItems = (profileData.achievements || []).length + (profileData.activities || []).length;
  if (totalItems === 0) {
    const err = new Error('Add at least one achievement or activity to your profile before generating a personal statement.');
    err.code = 'INSUFFICIENT_PROFILE_DATA';
    throw err;
  }

  const prompt = buildEssayPrompt(profileData);

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  async function callGemini(extraInstruction) {
    const fullPrompt = extraInstruction ? prompt + '\n\n' + extraInstruction : prompt;
    const timeoutMs = 30000;
    let timeoutHandle;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => {
        const e = new Error('Personal statement generation timed out after 30 seconds. Please try again.');
        e.code = 'AI_TIMEOUT';
        reject(e);
      }, timeoutMs);
    });

    try {
      const generatePromise = model.generateContent(fullPrompt);
      const result = await Promise.race([generatePromise, timeoutPromise]);
      clearTimeout(timeoutHandle);
      return result.response.text().trim();
    } catch (err) {
      clearTimeout(timeoutHandle);
      if (err.code === 'AI_TIMEOUT') throw err;
      const wrapped = new Error('The AI service returned an error. Check your API key and try again.');
      wrapped.code = 'AI_ERROR';
      throw wrapped;
    }
  }

  let text = await callGemini(null);
  let wc = countWords(text);

  if (wc < 400) {
    // Retry once
    text = await callGemini('The previous draft was too short. Write a complete 500–650 word version.');
    wc = countWords(text);
    if (wc < 400) {
      const err = new Error('The AI returned an incomplete draft. Please try again.');
      err.code = 'AI_ERROR';
      throw err;
    }
  }

  return text;
}

module.exports = { generateEssayDraft, assembleProfileData };
