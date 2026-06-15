'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config');

// ─── Duration helper ──────────────────────────────────────────────────────────

function _buildDuration(achievement) {
  if (achievement.yearsInvolved) return `${achievement.yearsInvolved} year${achievement.yearsInvolved !== 1 ? 's' : ''}`;
  if (achievement.startYear && achievement.endYear) {
    const years = achievement.endYear - achievement.startYear;
    if (years > 0) return `${years} year${years !== 1 ? 's' : ''}`;
    return `${achievement.startYear}–${achievement.endYear}`;
  }
  if (achievement.startYear) return `Since ${achievement.startYear}`;
  return null;
}

// ─── Consultative prompt builder ──────────────────────────────────────────────

/**
 * Build the consultative prompt using the student's answers and focus areas.
 * Implements the exact prompt template from the story spec.
 *
 * @param {object} achievement - normalized achievement object
 * @param {object} studentAnswers - { role, challenge, growth, importance, impact }
 * @param {string[]} focusAreas - derived focus area bullets
 * @returns {string}
 */
function buildConsultativePrompt(achievement, studentAnswers, focusAreas) {
  const answers = studentAnswers || {};
  const duration = _buildDuration(achievement);

  const noAnswers = !answers.role && !answers.challenge && !answers.growth &&
    !answers.importance && !answers.impact;

  const lines = [
    'You are helping a high school student articulate one of their achievements for their college application. You are acting as a collaborative writing partner, not a ghostwriter.',
    '',
    'Achievement profile data:',
    `- Name: ${achievement.name}`,
    `- Category: ${achievement.category}`,
    `- Description: ${achievement.description || ''}`,
  ];

  if (achievement.role) lines.push(`- Role: ${achievement.role}`);
  if (achievement.hoursPerWeek != null) lines.push(`- Hours per week: ${achievement.hoursPerWeek}`);
  if (duration) lines.push(`- Duration: ${duration}`);

  lines.push('');
  lines.push('The student answered the following questions about this experience:');

  if (answers.role) lines.push(`- Their role / biggest contribution: "${answers.role}"`);
  if (answers.challenge) lines.push(`- Challenge they faced and overcame: "${answers.challenge}"`);
  if (answers.growth) lines.push(`- What they learned / how they grew: "${answers.growth}"`);
  if (answers.importance) lines.push(`- Why it was important to them: "${answers.importance}"`);
  if (answers.impact) lines.push(`- Impact it had: "${answers.impact}"`);

  if (noAnswers) {
    lines.push('The student did not answer the questions — use only the achievement profile data above.');
  }

  lines.push('');
  lines.push('Focus areas to emphasize (based on their answers and profile):');
  if (focusAreas && focusAreas.length > 0) {
    focusAreas.forEach(f => lines.push(`- ${f}`));
  } else {
    lines.push('- Use the achievement profile data as the basis.');
  }

  lines.push('');
  lines.push('Your task: Write a short paragraph (100–200 words) that helps the student articulate what this experience meant to them.');
  lines.push('');
  lines.push('Rules:');
  lines.push('1. Use second person ("You", "Your") — speak directly to the student.');
  lines.push('2. Reference at least two specific details from the achievement profile or their answers (e.g., if hours per week is 6, say "six hours a week"; if there are 8 team members, say "eight teammates").');
  lines.push('3. Sound like a thoughtful 17-year-old reflecting out loud — not a guidance counselor.');
  lines.push('4. Do NOT use: "I learned the importance of teamwork", "I grew as a person", "This experience taught me valuable life lessons", "I am a lifelong learner", "stepping outside my comfort zone", or any close paraphrase.');
  lines.push('5. Focus on one specific moment, decision, or tension — not a general summary.');
  lines.push('6. End with a question or open thought, not a conclusion ("You still wonder whether...", "It made you ask...").');
  lines.push('7. Only use facts from the achievement profile data and the student\'s answers. Do not invent any details not present above.');
  lines.push('');
  lines.push('After the paragraph, output a separate JSON block (delimited by ```json and ```) with this exact schema:');
  lines.push('{');
  lines.push('  "reasoning": "one sentence explaining what you emphasized and why (max 150 chars)",');
  lines.push('  "confidence": 0-100 integer representing how grounded the statement is in supplied data,');
  lines.push('  "focusAreas": ["list of 2–4 strings — the specific themes you actually emphasized"]');
  lines.push('}');
  lines.push('');
  lines.push('Output format:');
  lines.push('[The paragraph — no label, no quotes around it]');
  lines.push('');
  lines.push('```json');
  lines.push('{ "reasoning": "...", "confidence": 87, "focusAreas": ["...", "..."] }');
  lines.push('```');

  return lines.join('\n');
}

// ─── Server-side focus area derivation ───────────────────────────────────────

/**
 * Compute what the AI will focus on given the student's answers and achievement data.
 * This is a pure server-side computation — no Gemini call.
 *
 * @param {object} achievement - normalized achievement object
 * @param {object} studentAnswers - { role, challenge, growth, importance, impact }
 * @returns {{ profileDataUsed: string[], focusAreas: string[], answersReceived: object, unansweredCount: number, achievementName: string }}
 */
function computePreviewReasoning(achievement, studentAnswers) {
  const answers = studentAnswers || {};
  const duration = _buildDuration(achievement);

  // Profile data lines
  const profileDataUsed = [`Name: ${achievement.name}`, `Category: ${achievement.category}`];
  if (duration) profileDataUsed.push(`Duration: ${duration}${achievement.hoursPerWeek != null ? ` · ${achievement.hoursPerWeek} hrs/week` : ''}`);
  else if (achievement.hoursPerWeek != null) profileDataUsed.push(`Hours per week: ${achievement.hoursPerWeek}`);
  if (achievement.description) profileDataUsed.push(`Description: ${achievement.description}`);
  if (achievement.role) profileDataUsed.push(`Role: ${achievement.role}`);

  // Focus areas from non-empty answers
  const focusAreas = [];
  const questionLabels = {
    role: 'Your role and biggest contribution',
    challenge: 'The specific challenge you faced and overcame',
    growth: 'What you learned and how you grew',
    importance: 'Why this was personally important to you',
    impact: 'The impact it had — on you, your team, or others',
  };

  let unansweredCount = 0;
  ['role', 'challenge', 'growth', 'importance', 'impact'].forEach(key => {
    if (answers[key] && answers[key].trim()) {
      focusAreas.push(questionLabels[key]);
    } else {
      unansweredCount++;
    }
  });

  // Add a profile-data note if relevant fields are present
  const profileNotes = [];
  if (achievement.role) profileNotes.push(`role: ${achievement.role}`);
  if (achievement.hoursPerWeek != null) profileNotes.push(`${achievement.hoursPerWeek} hrs/week`);
  if (duration) profileNotes.push(duration);
  if (profileNotes.length > 0) {
    focusAreas.push(`Profile data: ${profileNotes.join(', ')}`);
  }

  return {
    achievementName: achievement.name,
    profileDataUsed,
    answersReceived: {
      role: answers.role || '',
      challenge: answers.challenge || '',
      growth: answers.growth || '',
      importance: answers.importance || '',
      impact: answers.impact || '',
    },
    focusAreas,
    unansweredCount,
  };
}

// ─── Parse Gemini response ────────────────────────────────────────────────────

/**
 * Parse the Gemini response into draft text and JSON metadata.
 * @param {string} rawText
 * @returns {{ draft: string, reasoning: string|null, confidence: number|null, focusAreas: string[] }}
 */
function parseGeminiResponse(rawText) {
  const jsonDelimiter = '```json';
  const jsonEnd = '```';

  const jsonStartIdx = rawText.indexOf(jsonDelimiter);

  let draft = rawText.trim();
  let reasoning = null;
  let confidence = null;
  let focusAreas = [];

  if (jsonStartIdx !== -1) {
    draft = rawText.slice(0, jsonStartIdx).trim();

    const jsonContentStart = jsonStartIdx + jsonDelimiter.length;
    const jsonContentEnd = rawText.indexOf(jsonEnd, jsonContentStart);
    const jsonStr = jsonContentEnd !== -1
      ? rawText.slice(jsonContentStart, jsonContentEnd).trim()
      : rawText.slice(jsonContentStart).trim();

    try {
      const parsed = JSON.parse(jsonStr);
      reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : null;
      confidence = typeof parsed.confidence === 'number' ? parsed.confidence : null;
      focusAreas = Array.isArray(parsed.focusAreas) ? parsed.focusAreas : [];
    } catch (_) {
      // JSON parse failed — return draft text; reasoning/confidence/focusAreas stay null/empty
    }
  }

  return { draft, reasoning, confidence, focusAreas };
}

// ─── Main generation function ──────────────────────────────────────────────────

/**
 * Generate a consultative impact statement draft.
 * @param {object} achievement - normalized achievement record
 * @param {object} studentAnswers - { role, challenge, growth, importance, impact }
 * @param {string[]} focusAreas - pre-derived focus areas (from computePreviewReasoning)
 * @returns {Promise<{ draft: string, reasoning: string|null, confidence: number|null, focusAreas: string[], wordCount: number, profileDataUsed: string[] }>}
 * @throws {Error} with .code set to 'AI_TIMEOUT' | 'AI_ERROR' | 'AI_EMPTY' | 'AI_TOO_SHORT'
 */
async function generateImpactStatement(achievement, studentAnswers, focusAreas) {
  const apiKey = config.geminiApiKey;
  const modelName = config.geminiModel;

  if (!apiKey || !modelName) {
    const err = new Error('Gemini API not configured.');
    err.code = 'AI_ERROR';
    throw err;
  }

  // Compute profile data used (for response)
  const preview = computePreviewReasoning(achievement, studentAnswers);
  const profileDataUsed = preview.profileDataUsed;

  const prompt = buildConsultativePrompt(achievement, studentAnswers, focusAreas || preview.focusAreas);

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  const timeoutMs = 30000;
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      const e = new Error('Draft generation timed out. Try again.');
      e.code = 'AI_TIMEOUT';
      reject(e);
    }, timeoutMs);
  });

  try {
    const generatePromise = model.generateContent(prompt);
    const result = await Promise.race([generatePromise, timeoutPromise]);
    clearTimeout(timeoutHandle);

    const rawText = result.response.text().trim();

    if (!rawText) {
      const err = new Error('Draft generation failed. You can still write your own statement.');
      err.code = 'AI_EMPTY';
      throw err;
    }

    const { draft, reasoning, confidence, focusAreas: parsedFocusAreas } = parseGeminiResponse(rawText);

    if (!draft) {
      const err = new Error('Draft generation failed. You can still write your own statement.');
      err.code = 'AI_EMPTY';
      throw err;
    }

    const wordCount = draft.split(/\s+/).filter(Boolean).length;

    if (wordCount < 50) {
      const err = new Error('Generated draft was too short. Try regenerating.');
      err.code = 'AI_TOO_SHORT';
      throw err;
    }

    // If over 400 words, trim to first 300 words
    let finalDraft = draft;
    if (wordCount > 400) {
      const words = draft.split(/\s+/);
      finalDraft = words.slice(0, 300).join(' ');
      console.warn('[impact] Gemini response exceeded 400 words — trimmed to 300.');
    }

    return {
      draft: finalDraft,
      reasoning,
      confidence,
      focusAreas: parsedFocusAreas.length > 0 ? parsedFocusAreas : (focusAreas || preview.focusAreas),
      wordCount: finalDraft.split(/\s+/).filter(Boolean).length,
      profileDataUsed,
    };
  } catch (err) {
    clearTimeout(timeoutHandle);
    if (err.code === 'AI_TIMEOUT' || err.code === 'AI_EMPTY' || err.code === 'AI_TOO_SHORT') throw err;

    const wrapped = new Error('Draft generation failed. You can still write your own statement.');
    wrapped.code = 'AI_ERROR';
    throw wrapped;
  }
}

module.exports = { generateImpactStatement, computePreviewReasoning };
