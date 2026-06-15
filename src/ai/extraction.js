'use strict';

const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config');

// ─── Classification taxonomy ───────────────────────────────────────────────────

const VALID_TYPES = [
  'Transcript', 'Course Report', 'Grade Card', 'School Report',
  'SAT Score Report', 'ACT Score Report', 'AP Exam Result', 'IB Exam Result',
  'Other Standardized Test',
  'Award Certificate', 'Honor Roll', 'Scholarship Notice', 'Competition Result',
  'Recognition Letter',
  'Club/Sports Registration', 'Leadership Role', 'Volunteer Certificate',
  'Work Experience Document', 'Activity Participation',
  'Unrecognized Document',
];

const VALID_CATEGORIES = ['Academic', 'Tests', 'Achievements', 'Activities', 'Other'];

const VALID_WARNINGS = [
  'low_quality_scan', 'non_english_text_detected', 'handwritten_content', 'partial_parse',
  'timeout', 'parse_failure',
];

// ─── Prompt template ──────────────────────────────────────────────────────────

const CLASSIFICATION_PROMPT = `You are a document classifier for a college admissions assistant application. Your job is to identify what type of academic document has been uploaded by a high school student.

Analyze the document carefully and respond with a valid JSON object only — no markdown, no explanation, just the JSON.

Document content:
{{document_content}}

Classify this document using ONLY the following taxonomy:

Academic: Transcript, Course Report, Grade Card, School Report
Tests: SAT Score Report, ACT Score Report, AP Exam Result, IB Exam Result, Other Standardized Test
Achievements: Award Certificate, Honor Roll, Scholarship Notice, Competition Result, Recognition Letter
Activities: Club/Sports Registration, Leadership Role, Volunteer Certificate, Work Experience Document, Activity Participation
Other: Unrecognized Document

Rules:
1. Choose the single most specific type that matches the document.
2. If you can see visible evidence (logos, titles, headers, stamp text), cite it in your response.
3. If the document is blurry, handwritten, or partially readable, still make your best classification but lower your confidence score accordingly and add the appropriate warning.
4. If nothing in the document matches any category, use type "Unrecognized Document" and category "Other". Set "recommendation" to an empty string "" in this case.
5. The "preview" field must be a verbatim excerpt (max 300 characters) from the actual document text or visible content. Do not paraphrase or invent. If no text is readable, set preview to an empty string.
6. The "recommendation" field must be a single human-readable sentence explaining your classification decision and recommending the document type. Format: "This looks like a [description]. Recommended type: [type] ([confidence]% confident)". For low confidence (below 50%), use: "This might be a [description], but we're not confident. Recommended type: [type] ([confidence]%)". Max 200 characters.

Respond with exactly this JSON structure:
{
  "classification": "Transcript",
  "category": "Academic",
  "confidence": 87,
  "recommendation": "This looks like a transcript. Recommended type: Transcript (87% confident)",
  "preview": "Springfield High School · Official Transcript · Cumulative GPA: 3.90 · Class of 2026",
  "evidence": "Document header reads 'Official Transcript' and includes a school seal for Springfield High School.",
  "warnings": []
}

Allowed values for "warnings": "low_quality_scan", "non_english_text_detected", "handwritten_content", "partial_parse"
confidence must be an integer from 0 to 100.`;

// ─── Fallback result ───────────────────────────────────────────────────────────

function fallbackResult(reason) {
  return {
    classification: 'Unrecognized Document',
    category: 'Other',
    confidence: 0,
    recommendation: '',
    preview: '',
    evidence: '',
    warnings: [reason],
  };
}

// ─── Validate and sanitize Gemini response ────────────────────────────────────

function sanitizeResponse(raw) {
  let result = { ...raw };

  if (!VALID_TYPES.includes(result.classification)) {
    result.classification = 'Unrecognized Document';
    result.category = 'Other';
  }
  if (!VALID_CATEGORIES.includes(result.category)) {
    result.category = 'Other';
  }
  if (typeof result.confidence !== 'number' || result.confidence < 0 || result.confidence > 100) {
    result.confidence = 0;
  } else {
    result.confidence = Math.round(result.confidence);
  }
  // Validate and synthesize recommendation
  if (typeof result.recommendation !== 'string') {
    // Gemini omitted it — synthesize from classification and confidence
    if (result.classification === 'Unrecognized Document') {
      result.recommendation = '';
    } else if (result.confidence < 50) {
      result.recommendation = `This might be a ${result.classification}, but we're not confident. Recommended type: ${result.classification} (${result.confidence}%)`;
    } else {
      result.recommendation = `This looks like a ${result.classification}. Recommended type: ${result.classification} (${result.confidence}% confident)`;
    }
  }
  // Ensure empty recommendation for Unrecognized Document
  if (result.classification === 'Unrecognized Document') {
    result.recommendation = '';
  }
  // Truncate to 200 chars
  if (result.recommendation.length > 200) {
    result.recommendation = result.recommendation.slice(0, 197) + '...';
  }

  if (typeof result.preview !== 'string') {
    result.preview = '';
  }
  if (result.preview.length > 300) {
    result.preview = result.preview.slice(0, 297) + '...';
  }
  if (!Array.isArray(result.warnings)) {
    result.warnings = [];
  } else {
    result.warnings = result.warnings.filter(w => VALID_WARNINGS.includes(w));
  }

  return result;
}

// ─── Parse JSON from Gemini text response ────────────────────────────────────

function parseGeminiJson(text) {
  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(cleaned);
}

// ─── Main classification function ─────────────────────────────────────────────

/**
 * Classify a document using Gemini Vision.
 *
 * @param {object} opts
 * @param {string} opts.mimeType - MIME type of the file
 * @param {Buffer|null} opts.imageBuffer - Resized image buffer (for image files)
 * @param {string|null} opts.pdfText - Extracted text (for PDFs)
 * @param {Buffer|null} opts.rawBuffer - Raw file buffer (fallback for scanned PDFs)
 * @returns {Promise<object>} classification result
 */
async function classifyDocument({ mimeType, imageBuffer, pdfText, rawBuffer }) {
  const model = config.geminiModel;
  if (!model) {
    throw new Error('GEMINI_MODEL not configured');
  }
  if (!config.geminiApiKey) {
    const err = new Error('GEMINI_API_KEY not configured');
    err.code = 'AI_AUTH_ERROR';
    throw err;
  }

  const genAI = new GoogleGenerativeAI(config.geminiApiKey);
  const gemini = genAI.getGenerativeModel({ model });

  let parts = [];
  let promptText;

  if (mimeType === 'application/pdf') {
    if (pdfText && pdfText.trim().length > 0) {
      // Text-based PDF
      const excerpt = pdfText.slice(0, 5000);
      promptText = CLASSIFICATION_PROMPT.replace('{{document_content}}', excerpt);
      parts = [{ text: promptText }];
    } else {
      // Scanned PDF — send raw bytes as inline data
      const b64 = (rawBuffer || Buffer.alloc(0)).toString('base64');
      promptText = CLASSIFICATION_PROMPT.replace(
        '{{document_content}}',
        '[Image provided as inline data — analyze the visual content of the image above.]'
      );
      parts = [
        { inlineData: { mimeType: 'application/pdf', data: b64 } },
        { text: promptText },
      ];
    }
  } else {
    // Image file — use imageBuffer (already resized + JPEG)
    const b64 = (imageBuffer || rawBuffer || Buffer.alloc(0)).toString('base64');
    promptText = CLASSIFICATION_PROMPT.replace(
      '{{document_content}}',
      '[Image provided as inline data — analyze the visual content of the image above.]'
    );
    parts = [
      { inlineData: { mimeType: 'image/jpeg', data: b64 } },
      { text: promptText },
    ];
  }

  // Attempt classification with 45-second timeout
  async function attempt() {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(Object.assign(new Error('Gemini timeout'), { code: 'TIMEOUT' })), 45000);
    });
    const callPromise = gemini.generateContent({ contents: [{ role: 'user', parts }] });
    const result = await Promise.race([callPromise, timeoutPromise]);
    const text = result.response.text();
    return parseGeminiJson(text);
  }

  // First attempt
  try {
    const raw = await attempt();
    return sanitizeResponse(raw);
  } catch (err) {
    if (err.code === 'TIMEOUT') {
      return fallbackResult('timeout');
    }
    if (err.code === 'AI_AUTH_ERROR' || (err.message && err.message.includes('API_KEY'))) {
      const authErr = new Error('GEMINI_API_KEY is invalid or unauthorized');
      authErr.code = 'AI_AUTH_ERROR';
      throw authErr;
    }
    if (err.status === 429 || (err.message && err.message.includes('429'))) {
      const rateErr = new Error('Gemini rate limit exceeded');
      rateErr.code = 'RATE_LIMIT';
      throw rateErr;
    }

    // JSON parse failure — retry once with same parts
    try {
      const raw = await attempt();
      return sanitizeResponse(raw);
    } catch (retryErr) {
      if (retryErr.code === 'TIMEOUT') return fallbackResult('timeout');
      return fallbackResult('parse_failure');
    }
  }
}

// ─── Extraction prompt templates ──────────────────────────────────────────────

const EXTRACTION_COMMON_PREFIX = `You are a document data extraction assistant for a student profile application. Your task is to extract specific structured data from the student document provided.

CRITICAL RULES — follow exactly:
1. Extract ONLY facts that are explicitly visible in the document. Do NOT infer, calculate, or assume any value.
2. For every extracted field, provide a verbatim excerpt (1–2 sentences) from the document as proof.
3. For every field, provide a confidence score from 0 to 100 reflecting how certain you are the extracted value is correct:
   - 90–100: Text is clear, unambiguous, machine-printed
   - 70–89: Text is legible but slightly degraded or somewhat ambiguous
   - 50–69: Text is partially unclear, handwritten, or the value required interpretation
   - 0–49: Text is very unclear, possibly wrong due to OCR error, or highly uncertain
4. If a field is NOT present in the document, return value: null, confidence: 0, excerpt: "".
5. If any section of the document appears handwritten, blurry, or unclear, add a warning in the warnings array for affected fields.
6. Never invent or hallucinate data. If you are unsure, lower the confidence score and add a warning.
7. Return ONLY valid JSON matching the schema below. No markdown. No explanation text.

Return this JSON structure:
{
  "documentType": "{{DOCUMENT_TYPE}}",
  "overallConfidence": <integer 0–100 reflecting overall document readability>,
  "fields": [
    {
      "name": "<field_key>",
      "label": "<Human Readable Label>",
      "value": <extracted value or null>,
      "confidence": <0–100>,
      "excerpt": "<verbatim quote from document>",
      "warnings": []
    }
  ]
}`;

const TRANSCRIPT_PROMPT = EXTRACTION_COMMON_PREFIX.replace('{{DOCUMENT_TYPE}}', 'transcript') + `

Extract the following fields from this academic transcript. Each field must follow the rules above.

Fields to extract:
1. name: "school_name", label: "School Name" — The full name of the school or institution issuing the transcript.
2. name: "gpa_overall", label: "GPA — Overall" — The cumulative or overall GPA as a decimal number (e.g., 3.90). Note: "1.5O" may be an OCR error for "1.50" — include a warning if digits and letters look similar.
3. name: "gpa_scale", label: "GPA Scale" — The scale used (e.g., 4.0, 4.5, 5.0, 100.0).
4. name: "class_rank", label: "Class Rank" — The student's rank and class size (e.g., "15 of 320"). If only rank is shown, return just the rank with a warning that class size is unknown.
5. name: "graduation_year", label: "Graduation Year" — The expected or actual graduation year as a 4-digit integer.
6. name: "disciplinary_notes", label: "Disciplinary / Attendance Notes" — Any notes on absences, suspensions, or disciplinary actions. Return null if no such section exists.
7. name: "courses", label: "Courses and Grades" — Return as a JSON array containing EVERY course listed on the transcript. This is critical: do not omit any course. Each element is an object with these fields:
   - "name": full course name as printed (e.g., "AP Calculus BC", "English 101", "Honors Biology") — required string
   - "grade": letter grade earned (e.g., "A+", "A", "B+", "B", "C", "D", "F") — string or null if not shown; add a warning if grade is missing
   - "score": numeric score or points if shown on the transcript (e.g., 98, 87.5) — number or null if not shown
   - "term": semester or term when the course was taken (e.g., "Fall 2022", "Spring 2023", "2022-2023") — string or null if not shown
   - "level": course level designation (e.g., "AP", "IB", "Honors", "Regular", "Dual Enrollment") — infer from the course name prefix or transcript labels; return "Regular" if no special designation is apparent; null only if truly indeterminate

For the courses field, format the value as a JSON array (not a string). Confidence applies to the overall course list legibility. If a section of the transcript is blurry or cut off, add a warning on the courses field noting that some courses may have been missed.

Example courses value:
[
  {"name": "AP Calculus BC", "grade": "A+", "score": 98, "term": "Fall 2022", "level": "AP"},
  {"name": "English 101", "grade": "B+", "score": null, "term": "Spring 2023", "level": "Regular"},
  {"name": "Honors Biology", "grade": "A", "score": 94, "term": "Fall 2022", "level": "Honors"}
]`;

const TEST_RESULT_PROMPT = EXTRACTION_COMMON_PREFIX.replace('{{DOCUMENT_TYPE}}', 'test_result') + `

First determine which exam this score report is for. Look for exam name, logo, or header text. Then extract the relevant fields below.

If this is an SAT score report, extract:
1. name: "sat_math", label: "SAT Math Score" — Integer, 200–800.
2. name: "sat_ebrw", label: "SAT Evidence-Based Reading & Writing Score" — Integer, 200–800.
3. name: "sat_total", label: "SAT Total Score" — Integer, 400–1600.
4. name: "sat_date", label: "SAT Test Date" — ISO 8601 date string (YYYY-MM-DD). If only month/year given, use the first of the month.

If this is an ACT score report, extract:
1. name: "act_english", label: "ACT English Score" — Integer, 1–36.
2. name: "act_math", label: "ACT Math Score" — Integer, 1–36.
3. name: "act_reading", label: "ACT Reading Score" — Integer, 1–36.
4. name: "act_science", label: "ACT Science Score" — Integer, 1–36.
5. name: "act_composite", label: "ACT Composite Score" — Integer, 1–36.
6. name: "act_date", label: "ACT Test Date" — ISO 8601 date string.

If this is an AP score report, extract one or more entries:
name: "ap_scores", label: "AP Exam Scores" — Array of objects: [{ "examName": "<string>", "score": <1–5 integer>, "date": "<YYYY-MM-DD>" }].

If this is an IB score report, extract:
name: "ib_scores", label: "IB Subject Scores" — Array of objects: [{ "subject": "<string>", "level": "HL or SL", "score": <1–7 integer>, "date": "<YYYY-MM-DD>" }].

If the exam type cannot be determined, extract:
name: "other_exam", label: "Other Exam Results" — Object: { "examName": "<string>", "results": "<string>", "date": "<YYYY-MM-DD or null>" }.

For all fields, apply the common rules (excerpt, confidence, warnings).`;

const CERTIFICATE_PROMPT = EXTRACTION_COMMON_PREFIX.replace('{{DOCUMENT_TYPE}}', 'certificate') + `

Extract the following fields from this award, certificate, or honor document:

1. name: "award_name", label: "Award / Honor Name" — Full name of the award or recognition.
2. name: "issuing_organization", label: "Issuing Organization" — Name of the entity granting the award.
3. name: "date_awarded", label: "Date Awarded" — ISO 8601 date string. If only year is shown, return "<YYYY>-01-01" with a warning.
4. name: "award_category", label: "Category" — Best-fit category from this list ONLY: "academic", "sports", "arts", "community_service", "leadership", "stem", "other". Do NOT invent new categories.
5. name: "recipient_name", label: "Recipient Name" — The name of the student receiving the award as it appears on the document.

Note: Do NOT store recipient_name in the student profile (FERPA constraint). Extract it only so the student can verify this document belongs to them. The backend will discard this field before persisting.`;

const ACTIVITY_PROMPT = EXTRACTION_COMMON_PREFIX.replace('{{DOCUMENT_TYPE}}', 'activity') + `

Extract the following fields from this activity participation document, letter, or certificate:

1. name: "activity_name", label: "Activity Name" — Full name of the club, sport, program, or activity.
2. name: "role", label: "Role" — The student's role (e.g., "Participant", "Team Captain", "President", "Volunteer"). If not stated, return null.
3. name: "organization", label: "Organization / School" — Name of the organizing body or school.
4. name: "hours_per_week", label: "Hours per Week" — Numeric value. If stated as a range (e.g., "5–8 hours"), return the lower bound as a number and add a warning. If not stated, return null.
5. name: "duration", label: "Duration / Date Range" — Free-text date range as it appears in the document (e.g., "September 2023 – June 2026"). If not stated, return null.
6. name: "date_start", label: "Start Date" — ISO 8601 date string parsed from duration, or null.
7. name: "date_end", label: "End Date" — ISO 8601 date string parsed from duration, or null if ongoing.`;

/**
 * Get extraction prompt for a document type.
 * @param {string} documentType - 'transcript' | 'test_result' | 'certificate' | 'activity'
 * @returns {string}
 */
function getExtractionPrompt(documentType) {
  switch (documentType) {
    case 'transcript': return TRANSCRIPT_PROMPT;
    case 'test_result': return TEST_RESULT_PROMPT;
    case 'certificate': return CERTIFICATE_PROMPT;
    case 'activity': return ACTIVITY_PROMPT;
    default: return TRANSCRIPT_PROMPT;
  }
}

/**
 * Normalize the documentType from various sources to the expected extraction keys.
 * STORY-002 classification types (e.g. "Transcript") → STORY-003 extraction types (e.g. "transcript").
 * @param {string} rawType - classified type from STORY-002
 * @param {string} rawCategory - classified category from STORY-002
 * @returns {string}
 */
function normalizeDocumentType(rawType, rawCategory) {
  const type = (rawType || '').toLowerCase();
  const category = (rawCategory || '').toLowerCase();

  if (type.includes('transcript') || type.includes('grade card') || type.includes('course report') || type.includes('school report')) {
    return 'transcript';
  }
  if (type.includes('sat') || type.includes('act') || type.includes('ap exam') || type.includes('ib exam') || type.includes('standardized test')) {
    return 'test_result';
  }
  if (type.includes('award') || type.includes('certificate') || type.includes('honor') || type.includes('scholarship') || type.includes('competition') || type.includes('recognition')) {
    return 'certificate';
  }
  if (type.includes('club') || type.includes('sport') || type.includes('volunteer') || type.includes('work') || type.includes('activity') || type.includes('participation') || type.includes('leadership')) {
    return 'activity';
  }

  // Fall back on category
  if (category === 'academic') return 'transcript';
  if (category === 'tests') return 'test_result';
  if (category === 'achievements') return 'certificate';
  if (category === 'activities') return 'activity';

  return 'transcript';
}

/**
 * Validate and sanitize an extraction response from Gemini.
 * - Ensures fields is an array
 * - Ensures each field has required keys
 * - Overrides confidence to 50 if confidence >= 70 but excerpt is empty (hallucination guard)
 * @param {object} raw
 * @returns {object}
 */
function sanitizeExtractionResponse(raw) {
  if (!raw || typeof raw !== 'object') {
    return { documentType: 'unknown', overallConfidence: 0, fields: [] };
  }

  const fields = Array.isArray(raw.fields) ? raw.fields : [];

  const sanitizedFields = fields.map(f => {
    const confidence = (typeof f.confidence === 'number' && f.confidence >= 0 && f.confidence <= 100)
      ? Math.round(f.confidence)
      : 0;
    const excerpt = typeof f.excerpt === 'string' ? f.excerpt.slice(0, 300) : '';

    // Hallucination guard: if high confidence but no excerpt, downgrade
    let finalConfidence = confidence;
    const warnings = Array.isArray(f.warnings) ? f.warnings.filter(w => typeof w === 'string') : [];
    if (confidence >= 70 && excerpt === '' && f.value !== null) {
      finalConfidence = 50;
      warnings.push('excerpt_missing_confidence_overridden');
    }

    return {
      name: typeof f.name === 'string' ? f.name.trim() : 'unknown_field',
      label: typeof f.label === 'string' ? f.label.trim() : 'Unknown Field',
      value: f.value !== undefined ? f.value : null,
      confidence: finalConfidence,
      excerpt,
      warnings,
      confirmedByStudent: false,
      skipped: false,
    };
  });

  return {
    documentType: typeof raw.documentType === 'string' ? raw.documentType : 'unknown',
    overallConfidence: typeof raw.overallConfidence === 'number' ? Math.round(raw.overallConfidence) : 0,
    fields: sanitizedFields,
  };
}

/**
 * Extract structured data from a classified document using Gemini Vision.
 *
 * @param {object} opts
 * @param {string} opts.documentType - normalized document type
 * @param {string} opts.mimeType - MIME type of the file
 * @param {Buffer|null} opts.imageBuffer - Resized image buffer (for image files)
 * @param {string|null} opts.pdfText - Extracted text (for PDFs)
 * @param {Buffer|null} opts.rawBuffer - Raw file buffer (fallback for scanned PDFs)
 * @returns {Promise<object>} extraction result with fields array
 */
async function extractDocumentData({ documentType, mimeType, imageBuffer, pdfText, rawBuffer }) {
  const model = config.geminiModel;
  if (!model) throw new Error('GEMINI_MODEL not configured');
  if (!config.geminiApiKey) {
    const err = new Error('GEMINI_API_KEY not configured');
    err.code = 'AI_AUTH_ERROR';
    throw err;
  }

  const genAI = new GoogleGenerativeAI(config.geminiApiKey);
  const gemini = genAI.getGenerativeModel({ model });

  const promptText = getExtractionPrompt(documentType);
  let parts = [];

  if (mimeType === 'application/pdf') {
    if (pdfText && pdfText.trim().length > 0) {
      // Text-based PDF — embed text into prompt
      const excerpt = pdfText.slice(0, 8000);
      parts = [{ text: `Document text content:\n\n${excerpt}\n\n${promptText}` }];
    } else {
      // Scanned PDF — send raw bytes
      const b64 = (rawBuffer || Buffer.alloc(0)).toString('base64');
      parts = [
        { inlineData: { mimeType: 'application/pdf', data: b64 } },
        { text: promptText },
      ];
    }
  } else {
    // Image file
    const b64 = (imageBuffer || rawBuffer || Buffer.alloc(0)).toString('base64');
    parts = [
      { inlineData: { mimeType: 'image/jpeg', data: b64 } },
      { text: promptText },
    ];
  }

  async function attempt() {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        const err = new Error('Gemini extraction timeout');
        err.code = 'EXTRACTION_TIMEOUT';
        reject(err);
      }, 30000);
    });
    const callPromise = gemini.generateContent({ contents: [{ role: 'user', parts }] });
    const result = await Promise.race([callPromise, timeoutPromise]);
    const text = result.response.text();
    return parseGeminiJson(text);
  }

  // First attempt
  try {
    const raw = await attempt();
    return sanitizeExtractionResponse(raw);
  } catch (err) {
    if (err.code === 'EXTRACTION_TIMEOUT') throw err;
    if (err.code === 'AI_AUTH_ERROR' || (err.message && err.message.includes('API_KEY'))) {
      const authErr = new Error('GEMINI_API_KEY is invalid or unauthorized');
      authErr.code = 'AI_AUTH_ERROR';
      throw authErr;
    }
    if (err.status === 429 || (err.message && err.message.includes('429'))) {
      const rateErr = new Error('Gemini rate limit exceeded');
      rateErr.code = 'RATE_LIMITED';
      throw rateErr;
    }

    // Retry once after 2 seconds
    await new Promise(r => setTimeout(r, 2000));
    try {
      const raw = await attempt();
      return sanitizeExtractionResponse(raw);
    } catch (retryErr) {
      if (retryErr.code === 'EXTRACTION_TIMEOUT') throw retryErr;
      const extractErr = new Error('AI extraction failed after retry');
      extractErr.code = 'AI_EXTRACTION_FAILED';
      throw extractErr;
    }
  }
}

module.exports = {
  classifyDocument,
  extractDocumentData,
  normalizeDocumentType,
  getExtractionPrompt,
  CLASSIFICATION_PROMPT,
  VALID_TYPES,
  VALID_CATEGORIES,
};
