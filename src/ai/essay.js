'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config');

// ─── Prompt builder ───────────────────────────────────────────────────────────

/**
 * Build the Gemini prompt from assembled profile data.
 * @param {object} profileData - { gpa, testScores, courses, achievements, activities, impactStatements }
 * @returns {string}
 */
function buildEssayPrompt(profileData) {
  const { gpa, testScores, courses, achievements, activities, impactStatements } = profileData;

  const gpaStr = gpa || 'Not provided';
  const testScoresStr = testScores || 'Not provided';
  const coursesStr = courses && courses.length > 0
    ? courses.slice(0, 10).join(', ')
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
 * Returns { gpa, testScores, courses, achievements, activities, impactStatements }
 * Missing files are silently omitted.
 * @param {string} dataDir
 * @param {object|null} [provenanceSelection] - optional filter: { includeGpa, testScoreIds, achievementIds, impactStatementIds }
 * @returns {object}
 */
function assembleProfileData(dataDir, provenanceSelection) {
  const profileDir = path.join(dataDir, 'profile');
  const sel = (provenanceSelection && typeof provenanceSelection === 'object') ? provenanceSelection : null;

  // Academic — GPA
  let gpa = null;
  let testScores = null;
  let courses = [];

  // Only include GPA if not explicitly excluded by provenance selection
  const includeGpa = !sel || sel.includeGpa !== false;
  if (includeGpa) {
    try {
      const academic = readJSON(path.join(profileDir, 'academic.json'));
      if (academic) {
        // Support both rich schema (gpa.overall.value) and simple schema (data.gpa)
        if (academic.gpa && academic.gpa.overall && academic.gpa.overall.value != null) {
          gpa = String(academic.gpa.overall.value);
        } else if (academic.data && academic.data.gpa != null) {
          gpa = String(academic.data.gpa);
          courses = academic.data.courses || [];
        }
      }
    } catch (_) { /* file absent — skip */ }
  }

  // Courses — always included (not individually toggleable per spec)
  try {
    const academic = readJSON(path.join(profileDir, 'academic.json'));
    if (academic) {
      if (academic.data && academic.data.courses) {
        courses = academic.data.courses;
      }
    }
  } catch (_) { /* skip */ }

  // Test scores — filtered by testScoreIds if provided
  try {
    const tests = readJSON(path.join(profileDir, 'tests.json'));
    if (tests) {
      // Support both rich items schema and simple data schema
      let items = [];
      if (tests.data && tests.data.items) {
        items = tests.data.items;
      } else if (Array.isArray(tests.data)) {
        items = tests.data;
      } else if (Array.isArray(tests)) {
        items = tests;
      }

      // Filter by testScoreIds if provided
      if (sel && Array.isArray(sel.testScoreIds)) {
        if (sel.testScoreIds.length === 0) {
          items = []; // empty array means exclude all
        } else {
          items = items.filter(t => sel.testScoreIds.includes(t.id));
        }
      }

      // Also handle the simple tests.data schema (sat/act/ap/other)
      if (items.length === 0 && tests.data && !tests.data.items) {
        const parts = [];
        if (tests.data.sat) parts.push(`SAT: ${tests.data.sat}`);
        if (tests.data.act) parts.push(`ACT: ${tests.data.act}`);
        if (tests.data.ap && tests.data.ap.length > 0) {
          parts.push('AP: ' + tests.data.ap.map(t => `${t.name} (${t.score})`).join(', '));
        }
        if (tests.data.other && tests.data.other.length > 0) {
          parts.push(tests.data.other.map(t => `${t.name}: ${t.score}`).join(', '));
        }
        if (parts.length > 0) testScores = parts.join(', ');
      } else if (items.length > 0) {
        testScores = items.map(t => {
          const name = t.testName || t.name || 'Test';
          const score = t.score || '';
          return `${name}: ${score}`;
        }).join(', ');
      }
    }
  } catch (_) { /* skip */ }

  // All achievement & activity IDs from disk
  let allAchievements = [];
  let allActivities = [];

  try {
    const ach = readJSON(path.join(profileDir, 'achievements.json'));
    const achData = ach && ach.data ? ach.data : ach;
    const items = (achData && achData.items) ? achData.items : (Array.isArray(achData) ? achData : []);
    allAchievements = items.map(item => ({
      id: item.id,
      name: item.title || item.name || 'Achievement',
      description: item.description || item.summary || '',
      impact_statement: null,
    }));
  } catch (_) { /* skip */ }

  try {
    const act = readJSON(path.join(profileDir, 'activities.json'));
    const actData = act && act.data ? act.data : act;
    const items = (actData && actData.items) ? actData.items : (Array.isArray(actData) ? actData : []);
    allActivities = items.map(item => ({
      id: item.id,
      name: item.activityName || item.name || 'Activity',
      role: item.role || 'participant',
      description: item.description || '',
      hoursPerWeek: item.hoursPerWeek || null,
      weeksPerYear: item.weeksPerYear || null,
    }));
  } catch (_) { /* skip */ }

  // Filter achievements & activities by achievementIds if provided
  let achievements = allAchievements;
  let activities = allActivities;
  if (sel && Array.isArray(sel.achievementIds)) {
    // achievementIds covers both achievements and activities merged together
    achievements = allAchievements.filter(a => sel.achievementIds.includes(a.id));
    activities = allActivities.filter(a => sel.achievementIds.includes(a.id));
  }

  // Impact statements — filtered by impactStatementIds if provided
  let impactStatements = [];
  try {
    const is = readJSON(path.join(profileDir, 'impact_statements.json'));
    const isData = is && is.data ? is.data : is;
    const stmts = (isData && isData.statements) ? isData.statements : (Array.isArray(isData) ? isData : []);

    let filteredStmts = stmts;
    if (sel && Array.isArray(sel.impactStatementIds)) {
      if (sel.impactStatementIds.length === 0) {
        filteredStmts = [];
      } else {
        filteredStmts = stmts.filter(s => sel.impactStatementIds.includes(s.id));
      }
    }

    impactStatements = filteredStmts.map(stmt => ({
      statement: stmt.statement,
      parentName: stmt.linkedAchievementName || stmt.achievementName || stmt.achievementId || 'Activity',
    }));

    // Link impact statements to achievements
    achievements = achievements.map(a => {
      const linked = impactStatements.find(s =>
        s.parentName && (
          s.parentName.toLowerCase().includes((a.name || '').toLowerCase().slice(0, 15)) ||
          (a.name || '').toLowerCase().includes(s.parentName.toLowerCase().slice(0, 15))
        )
      );
      return linked ? { ...a, impact_statement: linked.statement } : a;
    });
  } catch (_) { /* skip */ }

  // Size limit: truncate if assembled text is too large
  const profileData = { gpa, testScores, courses, achievements, activities, impactStatements };
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
