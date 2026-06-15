/* api-client.js — Wrapper around fetch() for AO API calls */
/* All functions return { success, data, error, timestamp } matching the server envelope. */

'use strict';

/**
 * Base fetch wrapper. Normalizes network errors into the standard envelope.
 * @param {string} url
 * @param {object} options — fetch options
 * @returns {Promise<{success: boolean, data: any, error: any, timestamp: string}>}
 */
async function apiFetch(url, options = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    const json = await res.json();
    return json;
  } catch (err) {
    return {
      success: false,
      data: null,
      error: {
        code: 'NETWORK_ERROR',
        message: 'Cannot reach the AO server. Make sure `npx ao` is still running.',
      },
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * GET /api/onboarding/status
 * Returns onboarding completion state.
 */
async function getOnboardingStatus() {
  return apiFetch('/api/onboarding/status');
}

/**
 * GET /api/onboarding/defaults
 * Returns suggested data directory path.
 */
async function getOnboardingDefaults() {
  return apiFetch('/api/onboarding/defaults');
}

/**
 * POST /api/signup
 * Create profile and write all JSON files.
 * @param {string} firstName
 * @param {string} lastName
 * @param {string} dataDir
 */
async function signup(firstName, lastName, dataDir) {
  return apiFetch('/api/signup', {
    method: 'POST',
    body: JSON.stringify({ firstName, lastName, dataDir }),
  });
}

/**
 * GET /api/profile/sections
 * Returns all 6 profile section states.
 */
async function getProfileSections() {
  return apiFetch('/api/profile/sections');
}

/**
 * GET /api/profile/section/:name
 * Returns full detail data for a single section.
 */
async function getProfileSection(name) {
  return apiFetch(`/api/profile/section/${encodeURIComponent(name)}`);
}

/**
 * POST /api/profile/academic/add
 */
async function addAcademic(data) {
  return apiFetch('/api/profile/academic/add', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * POST /api/profile/tests/add
 */
async function addTest(data) {
  return apiFetch('/api/profile/tests/add', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * POST /api/profile/achievements/add
 */
async function addAchievement(data) {
  return apiFetch('/api/profile/achievements/add', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * POST /api/profile/activities/add
 */
async function addActivity(data) {
  return apiFetch('/api/profile/activities/add', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * GET /api/profile/activities
 * Returns all activity items.
 */
async function getActivities() {
  return apiFetch('/api/profile/activities');
}

/**
 * PUT /api/profile/activities/:id
 * Updates a single activity by ID.
 * @param {string} id
 * @param {object} payload
 */
async function updateActivity(id, payload) {
  return apiFetch(`/api/profile/activities/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

/**
 * DELETE /api/profile/activities/:id
 * Removes a single activity by ID.
 * @param {string} id
 */
async function deleteActivity(id) {
  return apiFetch(`/api/profile/activities/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: {},
  });
}

/**
 * GET /api/profile/achievements
 * Returns all achievement items.
 */
async function getAchievements() {
  return apiFetch('/api/profile/achievements');
}

/**
 * PUT /api/profile/achievements/:id
 * Updates a single achievement by ID.
 * @param {string} id
 * @param {object} payload
 */
async function updateAchievement(id, payload) {
  return apiFetch(`/api/profile/achievements/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

/**
 * DELETE /api/profile/achievements/:id
 * Removes a single achievement by ID.
 * @param {string} id
 */
async function deleteAchievement(id) {
  return apiFetch(`/api/profile/achievements/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: {},
  });
}

/**
 * GET /api/profile/academic/exam-scores
 * Returns all AP and IB exam scores.
 */
async function getExamScores() {
  return apiFetch('/api/profile/academic/exam-scores');
}

/**
 * PUT /api/profile/academic/exam-score/:id
 * Updates a single AP or IB exam score by ID.
 * @param {string} id
 * @param {object} payload - { courseName, examType, score, dateTaken }
 */
async function updateExamScore(id, payload) {
  return apiFetch(`/api/profile/academic/exam-score/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

// ─── Settings API ─────────────────────────────────────────────────────────────

/**
 * GET /api/settings
 * Returns current settings (PORT, DATA_DIR, GEMINI_MODEL, geminiApiKeySet).
 */
async function getSettings() {
  return apiFetch('/api/settings');
}

/**
 * GET /api/settings/key
 * Returns the raw GEMINI_API_KEY value for display.
 */
async function getSettingsKey() {
  return apiFetch('/api/settings/key');
}

/**
 * POST /api/settings
 * Save editable settings back to .env.
 * @param {{ port: number, geminiModel: string, geminiApiKey?: string }} data
 */
async function saveSettings(data) {
  return apiFetch('/api/settings', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ─── Document upload API ──────────────────────────────────────────────────────

/**
 * POST /api/documents/upload
 * Upload a document file with section context for AI classification.
 * @param {File} file - Browser File object
 * @param {string} sourceSection - 'academic' | 'tests' | 'achievements' | 'activities'
 * @returns {Promise<object>}
 */
async function uploadDocument(file, sourceSection) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('sourceSection', sourceSection);

  try {
    const res = await fetch('/api/documents/upload', {
      method: 'POST',
      body: formData,
      // No Content-Type header — let browser set multipart boundary
    });
    const json = await res.json();
    return json;
  } catch (err) {
    return {
      success: false,
      data: null,
      error: {
        code: 'NETWORK_ERROR',
        message: 'Cannot reach the AO server. Make sure `npx ao` is still running.',
      },
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * GET /api/documents/pending
 * Returns documents awaiting confirmation.
 */
async function getPendingDocuments() {
  return apiFetch('/api/documents/pending');
}

/**
 * POST /api/documents/confirm
 * Confirm a document classification.
 * @param {string} documentId
 * @param {string} confirmedType
 * @param {string} confirmedCategory
 */
async function confirmDocumentClassification(documentId, confirmedType, confirmedCategory) {
  return apiFetch('/api/documents/confirm', {
    method: 'POST',
    body: JSON.stringify({ documentId, confirmedType, confirmedCategory }),
  });
}

/**
 * DELETE /api/documents/:id
 * Discard a pending document.
 * @param {string} documentId
 */
async function discardDocument(documentId) {
  return apiFetch(`/api/documents/${encodeURIComponent(documentId)}`, {
    method: 'DELETE',
    headers: {},
  });
}

// ─── Extraction API ───────────────────────────────────────────────────────────

/**
 * POST /api/documents/:documentId/extract
 * Trigger Gemini Vision extraction on a classified document.
 * @param {string} documentId
 */
async function extractDocument(documentId) {
  return apiFetch(`/api/documents/${encodeURIComponent(documentId)}/extract`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/**
 * GET /api/documents/:documentId/extraction-preview
 * Get pending extraction for browser-refresh recovery.
 * @param {string} documentId
 */
async function getExtractionPreview(documentId) {
  return apiFetch(`/api/documents/${encodeURIComponent(documentId)}/extraction-preview`);
}

/**
 * PUT /api/documents/:documentId/extraction-fields/:fieldName
 * Update a single field in the pending extraction.
 * @param {string} documentId
 * @param {string} fieldName
 * @param {string|number} value
 * @param {boolean} confirmedByStudent
 */
async function updateExtractionField(documentId, fieldName, value, confirmedByStudent) {
  return apiFetch(
    `/api/documents/${encodeURIComponent(documentId)}/extraction-fields/${encodeURIComponent(fieldName)}`,
    {
      method: 'PUT',
      body: JSON.stringify({ value, confirmedByStudent }),
    }
  );
}

/**
 * POST /api/documents/:documentId/review
 * Submit confirmed extraction fields to be saved to the student profile.
 * @param {string} documentId
 * @param {Array} confirmedFields - array of { name, value, confirmedByStudent, skipped }
 */
async function reviewAndSaveExtraction(documentId, confirmedFields, options) {
  const body = { fields: confirmedFields };
  if (options && options.coursesMergeMode) body.coursesMergeMode = options.coursesMergeMode;
  return apiFetch(`/api/documents/${encodeURIComponent(documentId)}/review`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * GET /api/documents/:documentId/duplicate-check
 * Check if extracted courses would create duplicates with existing profile data.
 * @param {string} documentId
 */
async function checkDuplicateCourses(documentId) {
  return apiFetch(`/api/documents/${encodeURIComponent(documentId)}/duplicate-check`);
}

/**
 * POST /api/profile/academic/add-exam-score
 * Add an AP or IB exam score manually.
 * @param {object} payload - { examType, courseName, score, examDate, linkedCourseName }
 */
async function addExamScore(payload) {
  return apiFetch('/api/profile/academic/add-exam-score', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * DELETE /api/profile/academic/exam-score/:id
 * Delete an AP/IB exam score by ID.
 * @param {string} id
 */
async function deleteExamScore(id) {
  return apiFetch(`/api/profile/academic/exam-score/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: {},
  });
}

/**
 * DELETE /api/documents/:documentId/extraction-fields/:fieldName
 * Mark a field as deleted in the pending extraction.
 * @param {string} documentId
 * @param {string} fieldName
 */
async function deleteExtractionField(documentId, fieldName) {
  return apiFetch(
    `/api/documents/${encodeURIComponent(documentId)}/extraction-fields/${encodeURIComponent(fieldName)}`,
    { method: 'DELETE', headers: {} }
  );
}

/**
 * PUT /api/documents/:documentId/extraction-fields/:fieldName (ignoreWarning mode)
 * Suppress a specific warning string in the pending extraction field.
 * @param {string} documentId
 * @param {string} fieldName
 * @param {string} warningText
 */
async function ignoreExtractionFieldWarning(documentId, fieldName, warningText) {
  return apiFetch(
    `/api/documents/${encodeURIComponent(documentId)}/extraction-fields/${encodeURIComponent(fieldName)}`,
    {
      method: 'PUT',
      body: JSON.stringify({ ignoreWarning: warningText }),
    }
  );
}

// ─── Impact Statements API ────────────────────────────────────────────────────

/**
 * GET /api/impact-statements/available
 * Returns achievements/activities without saved impact statements.
 */
async function getAvailableForImpact() {
  return apiFetch('/api/impact-statements/available');
}

/**
 * POST /api/impact-statements/generate
 * Generate an AI draft impact statement for an achievement.
 * @param {string} achievementId
 * @param {object} [studentAnswers] - optional questionnaire answers { role, challenge, growth, importance, impact }
 */
async function generateImpactStatementDraft(achievementId, studentAnswers) {
  const body = { achievementId };
  if (studentAnswers) body.studentAnswers = studentAnswers;
  return apiFetch('/api/impact-statements/generate', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * POST /api/impact-statements/preview-reasoning
 * Get a preview of the AI reasoning for an impact statement.
 * @param {string} achievementId
 * @param {object} studentAnswers - { role, challenge, growth, importance, impact }
 */
async function previewImpactReasoning(achievementId, studentAnswers) {
  return apiFetch('/api/impact-statements/preview-reasoning', {
    method: 'POST',
    body: JSON.stringify({ achievementId, studentAnswers }),
  });
}

/**
 * GET /api/essays/provenance
 * Fetch essay data provenance (what profile data will be used).
 */
async function getEssayProvenance() {
  return apiFetch('/api/essays/provenance');
}

/**
 * POST /api/impact-statements/save
 * Save a new impact statement.
 * @param {string} achievementId
 * @param {string} statement - student's edited text
 * @param {string|null} aiDraft - the original AI draft, or null
 * @param {boolean} aiGenerated
 * @param {boolean} editedByStudent
 * @param {object} [generatedFrom] - { studentAnswers, profileDataUsed, focusAreas }
 * @param {string|null} [reasoning] - AI reasoning line
 */
async function saveImpactStatement(achievementId, statement, aiDraft, aiGenerated, editedByStudent, generatedFrom, reasoning) {
  const body = { achievementId, statement, aiDraft, aiGenerated, editedByStudent };
  if (generatedFrom) body.generatedFrom = generatedFrom;
  if (reasoning != null) body.reasoning = reasoning;
  return apiFetch('/api/impact-statements/save', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * GET /api/impact-statements
 * Returns all saved impact statements.
 */
async function getImpactStatements() {
  return apiFetch('/api/impact-statements');
}

/**
 * PUT /api/impact-statements/:id
 * Update an existing impact statement's text.
 * @param {string} id - statement UUID
 * @param {string} statement - new text
 */
async function updateImpactStatement(id, statement) {
  return apiFetch(`/api/impact-statements/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ statement }),
  });
}

/**
 * DELETE /api/impact-statements/:id
 * Delete an impact statement.
 * @param {string} id - statement UUID
 */
async function deleteImpactStatement(id) {
  return apiFetch(`/api/impact-statements/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: {},
  });
}

// ─── Essays API ───────────────────────────────────────────────────────────────

/**
 * POST /api/essays/generate
 * Trigger AI essay generation from student's profile.
 * @param {object} [provenanceSelection] - optional { includeGpa, testScoreIds, achievementIds, impactStatementIds }
 */
async function generateEssay(provenanceSelection) {
  const body = {};
  if (provenanceSelection) body.provenanceSelection = provenanceSelection;
  return apiFetch('/api/essays/generate', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * POST /api/essays/save
 * Save a student-edited essay (first save — transitions draft → saved).
 * @param {string} id - draft UUID
 * @param {string} studentEdit - student's text
 */
async function saveEssay(id, studentEdit) {
  return apiFetch('/api/essays/save', {
    method: 'POST',
    body: JSON.stringify({ id, studentEdit }),
  });
}

/**
 * GET /api/essays
 * List all essay drafts.
 */
async function listEssays() {
  return apiFetch('/api/essays');
}

/**
 * PUT /api/essays/:id
 * Update an existing saved essay.
 * @param {string} id - draft UUID
 * @param {string} studentEdit - updated text
 */
async function updateEssay(id, studentEdit) {
  return apiFetch(`/api/essays/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ studentEdit }),
  });
}

/**
 * GET /api/essays/:id
 * Fetch a single essay draft by ID.
 * @param {string} id - draft UUID
 */
async function getEssayById(id) {
  return apiFetch(`/api/essays/${encodeURIComponent(id)}`);
}

/**
 * DELETE /api/essays/:id
 * Delete an essay draft.
 * @param {string} id - draft UUID
 */
async function deleteEssay(id) {
  return apiFetch(`/api/essays/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: {},
  });
}

// ─── Config Limits API (STORY-007) ───────────────────────────────────────────

/**
 * GET /api/config/limits
 * Returns current word/character limits configuration.
 */
async function getLimitsConfig() {
  return apiFetch('/api/config/limits');
}

/**
 * POST /api/config/limits
 * Save new limits configuration.
 * @param {{ preset: string, limits: object }} payload
 */
async function saveLimitsConfig(payload) {
  return apiFetch('/api/config/limits', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ─── Course CRUD API (STORY-003) ─────────────────────────────────────────────

/**
 * GET /api/profile/academic/courses
 * Returns all courses with source tracking.
 */
async function getCourses() {
  return apiFetch('/api/profile/academic/courses');
}

/**
 * PUT /api/profile/academic/course/:id
 * Update a saved course. Preserves source metadata.
 * @param {string} id - course UUID
 * @param {{ name, grade, score, term, level }} data
 */
async function updateCourse(id, data) {
  return apiFetch(`/api/profile/academic/course/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

/**
 * DELETE /api/profile/academic/course/:id
 * Permanently remove a course.
 * @param {string} id - course UUID
 */
async function deleteCourse(id) {
  return apiFetch(`/api/profile/academic/course/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: {},
  });
}

/**
 * POST /api/profile/academic/course
 * Create a manual course entry with source.type = "manual".
 * @param {{ name, grade, score, term, level }} data
 */
async function createCourse(data) {
  return apiFetch('/api/profile/academic/course', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
