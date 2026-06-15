'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');

const config = require('../../config');
const { classifyDocument, extractDocumentData, normalizeDocumentType, VALID_TYPES, VALID_CATEGORIES } = require('../../ai/extraction');
const {
  generateDocumentId,
  generateTimestampPrefix,
  sanitizeFilename,
  moveUploadedFile,
  readDocuments,
  writeDocuments,
  appendAuditLog,
  ensureDir,
  readJSON,
  writeJSON,
} = require('../../utils/file-io');
const { mergeExtractedData, getSectionForDocType, detectDuplicateCourses } = require('../../utils/profile-merge');

const router = express.Router();

// ─── Rate limiting (in-memory, 10 req/min) ────────────────────────────────────

let rateLimitCount = 0;
let rateLimitReset = Date.now() + 60000;

function checkRateLimit() {
  const now = Date.now();
  if (now > rateLimitReset) {
    rateLimitCount = 0;
    rateLimitReset = now + 60000;
  }
  if (rateLimitCount >= 10) return false;
  rateLimitCount++;
  return true;
}

// ─── Multer setup (disk storage in OS temp dir) ───────────────────────────────

const ALLOWED_MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 20 * 1024 * 1024; // 20 MB

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const tmpDir = path.join(os.tmpdir(), 'ao-uploads');
      ensureDir(tmpDir);
      cb(null, tmpDir);
    },
    filename: (req, file, cb) => {
      cb(null, Date.now() + '_' + Math.random().toString(36).slice(2));
    },
  }),
  limits: { fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      const err = new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname);
      err.code = 'UNSUPPORTED_FILE_TYPE';
      err.status = 415;
      cb(err);
    }
  },
});

// ─── Helper: standard response ────────────────────────────────────────────────

function ok(res, data) {
  return res.json({ success: true, data, error: null, timestamp: new Date().toISOString() });
}

function fail(res, status, code, message) {
  return res.status(status).json({
    success: false,
    data: null,
    error: { code, message },
    timestamp: new Date().toISOString(),
  });
}

// ─── POST /api/documents/upload ───────────────────────────────────────────────

router.post('/upload', (req, res, next) => {
  const singleUpload = upload.single('file');
  singleUpload(req, res, async (err) => {
    // Multer errors
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return fail(res, 413, 'FILE_TOO_LARGE', 'File exceeds 20 MB limit. Please compress the file and try again.');
      }
      if (err.code === 'UNSUPPORTED_FILE_TYPE') {
        return fail(res, 415, 'UNSUPPORTED_FILE_TYPE', 'Unsupported file type. Please upload a PDF, JPG, PNG, or WEBP file.');
      }
      return next(err);
    }

    const { sourceSection } = req.body;

    // Validate sourceSection
    const validSections = ['academic', 'tests', 'achievements', 'activities'];
    if (!sourceSection || !validSections.includes(sourceSection)) {
      if (req.file) { try { fs.unlinkSync(req.file.path); } catch (_) {} }
      return fail(res, 400, 'INVALID_SECTION', 'sourceSection must be one of: academic, tests, achievements, activities');
    }

    // Validate file present
    if (!req.file) {
      return fail(res, 400, 'NO_FILE', 'No file was provided.');
    }

    // Validate DATA_DIR
    const dataDir = config.dataDir;
    if (!dataDir) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      return fail(res, 500, 'STORAGE_ERROR', 'DATA_DIR is not configured.');
    }

    // Rate limit check
    if (!checkRateLimit()) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      return fail(res, 429, 'RATE_LIMIT', 'Too many requests. Please wait a moment and try again.');
    }

    const timestamp = generateTimestampPrefix();
    const originalName = req.file.originalname || 'upload';
    const ext = path.extname(originalName).toLowerCase() || '';
    const baseName = path.basename(originalName, ext);
    const sanitizedBase = sanitizeFilename(baseName, 80);
    const sanitizedExt = ext.replace(/[^a-z0-9.]/g, '');
    const sanitizedFilename = `${timestamp}_${sanitizedBase}${sanitizedExt}`.slice(0, 200);
    const docId = generateDocumentId();
    const sanitizedOriginal = sanitizeFilename(originalName, 100);

    // Move file from temp to DATA_DIR/uploads
    let finalPath;
    try {
      finalPath = moveUploadedFile(req.file.path, dataDir, sanitizedFilename);
    } catch (ioErr) {
      console.error('[documents] file write error:', ioErr.message);
      return fail(res, 500, 'STORAGE_ERROR', 'Unable to save file. Please check your data directory and try again.');
    }

    // Process file content for Gemini
    let imageBuffer = null;
    let pdfText = null;
    const mimeType = req.file.mimetype;

    // For both PDFs and images: use raw buffer for Gemini Vision
    // Gemini Vision can handle PDF text extraction directly
    if (mimeType !== 'application/pdf') {
      // Image: resize with sharp for performance
      try {
        const sharp = require('sharp');
        imageBuffer = await sharp(finalPath)
          .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();
      } catch (sharpErr) {
        console.error('[documents] sharp error:', sharpErr.message);
        // Fall back to raw file
        imageBuffer = fs.readFileSync(finalPath);
      }
    }

    // Call Gemini
    let classification;
    try {
      classification = await classifyDocument({
        mimeType,
        imageBuffer,
        pdfText,
        rawBuffer: mimeType === 'application/pdf' ? fs.readFileSync(finalPath) : null,
      });
    } catch (aiErr) {
      if (aiErr.code === 'AI_AUTH_ERROR') {
        return fail(res, 500, 'AI_AUTH_ERROR', 'AI service is unavailable. Please check your GEMINI_API_KEY in .env.');
      }
      if (aiErr.code === 'RATE_LIMIT') {
        return fail(res, 429, 'RATE_LIMIT', 'Too many requests. Please wait a moment and try again.');
      }
      // Other AI errors — degrade gracefully
      classification = {
        classification: 'Unrecognized Document',
        category: 'Other',
        confidence: 0,
        recommendation: '',
        preview: '',
        evidence: '',
        warnings: ['parse_failure'],
      };
    }

    // Build document record
    const now = new Date().toISOString();
    const docRecord = {
      id: docId,
      filename: sanitizedFilename,
      originalName: sanitizedOriginal,
      uploadedAt: now,
      filePath: finalPath,
      fileSize: req.file.size,
      mimeType,
      status: 'pending_confirmation',
      classification: {
        type: classification.classification,
        category: classification.category,
        confidence: classification.confidence,
        recommendation: classification.recommendation || '',
        preview: classification.preview,
        evidence: classification.evidence || '',
        warnings: classification.warnings,
        classifiedAt: new Date().toISOString(),
        modelUsed: config.geminiModel,
      },
      confirmedBy: null,
      confirmedAt: null,
      confirmedType: null,
      confirmedCategory: null,
      sourceSection,
    };

    // Write to documents.json
    try {
      const docs = readDocuments(dataDir);
      docs.push(docRecord);
      writeDocuments(dataDir, docs);
    } catch (writeErr) {
      console.error('[documents] documents.json write error:', writeErr.message);
      return fail(res, 500, 'STORAGE_ERROR', 'Unable to save document record. Please try again.');
    }

    return ok(res, {
      documentId: docId,
      filename: sanitizedFilename,
      originalName: sanitizedOriginal,
      classification: {
        type: classification.classification,
        category: classification.category,
        confidence: classification.confidence,
        recommendation: classification.recommendation || '',
        preview: classification.preview,
        warnings: classification.warnings,
      },
    });
  });
});

// ─── GET /api/documents/pending ──────────────────────────────────────────────

router.get('/pending', (req, res) => {
  const dataDir = config.dataDir;
  if (!dataDir) {
    return ok(res, { documents: [] });
  }
  const docs = readDocuments(dataDir);
  const pending = docs
    .filter(d => d.status === 'pending_confirmation')
    .map(d => ({
      documentId: d.id,
      originalName: d.originalName,
      classification: d.classification
        ? {
            type: d.classification.type,
            category: d.classification.category,
            confidence: d.classification.confidence,
            recommendation: d.classification.recommendation || '',
            preview: d.classification.preview,
            warnings: d.classification.warnings,
          }
        : null,
      uploadedAt: d.uploadedAt,
    }));
  return ok(res, { documents: pending });
});

// ─── POST /api/documents/confirm ─────────────────────────────────────────────

router.post('/confirm', (req, res) => {
  const { documentId, confirmedType, confirmedCategory } = req.body;
  const dataDir = config.dataDir;

  if (!dataDir) {
    return fail(res, 500, 'STORAGE_ERROR', 'DATA_DIR is not configured.');
  }
  if (!documentId) {
    return fail(res, 400, 'DOCUMENT_NOT_FOUND', 'Document not found.');
  }
  if (!confirmedType || !VALID_TYPES.includes(confirmedType)) {
    return fail(res, 400, 'INVALID_TYPE', 'Invalid document type.');
  }
  if (!confirmedCategory || !VALID_CATEGORIES.includes(confirmedCategory)) {
    return fail(res, 400, 'INVALID_CATEGORY', 'Invalid document category.');
  }

  let docs;
  try {
    docs = readDocuments(dataDir);
  } catch (e) {
    return fail(res, 500, 'STORAGE_ERROR', 'Unable to read documents. Please try again.');
  }

  const idx = docs.findIndex(d => d.id === documentId);
  if (idx === -1) {
    return fail(res, 404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
  }

  const doc = docs[idx];
  if (doc.status === 'confirmed' || doc.status === 'discarded') {
    return fail(res, 409, 'INVALID_STATUS', 'Document has already been processed.');
  }

  const now = new Date().toISOString();
  docs[idx] = {
    ...doc,
    status: 'confirmed',
    confirmedBy: 'student',
    confirmedAt: now,
    confirmedType,
    confirmedCategory,
  };

  try {
    writeDocuments(dataDir, docs);
    appendAuditLog(dataDir, {
      action: 'document_confirmed',
      documentId,
      type: confirmedType,
      category: confirmedCategory,
      timestamp: now,
    });
  } catch (writeErr) {
    return fail(res, 500, 'STORAGE_ERROR', 'Unable to save confirmation. Please try again.');
  }

  return ok(res, {
    documentId,
    status: 'confirmed',
    confirmedType,
    confirmedCategory,
    confirmedAt: now,
  });
});

// ─── GET /api/documents/confirmed-list ───────────────────────────────────────

router.get('/confirmed-list', (req, res) => {
  const dataDir = config.dataDir;
  if (!dataDir) return ok(res, { documents: [] });
  const docs = readDocuments(dataDir);
  const confirmed = docs
    .filter(d => d.status === 'confirmed')
    .map(d => ({
      documentId: d.id,
      originalName: d.originalName,
      classification: d.classification,
      confirmedType: d.confirmedType,
      confirmedCategory: d.confirmedCategory,
      uploadedAt: d.uploadedAt,
    }));
  return ok(res, { documents: confirmed });
});

// ─── Helpers: document ID validation ─────────────────────────────────────────

function isValidDocId(id) {
  // Accept both UUID format and our custom doc_YYYYMMDD_HHmmss_hex format
  if (!id || typeof id !== 'string') return false;
  // Reject path traversal chars
  if (id.includes('..') || id.includes('/') || id.includes('\\')) return false;
  // Accept UUID or doc_ prefix format
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const docRe = /^doc_\d{8}_\d{6}_[0-9a-f]{6}$/;
  return uuidRe.test(id) || docRe.test(id);
}

// ─── POST /api/documents/:documentId/extract ─────────────────────────────────

router.post('/:documentId/extract', async (req, res) => {
  const { documentId } = req.params;
  const dataDir = config.dataDir;

  if (!isValidDocId(documentId)) {
    return fail(res, 400, 'INVALID_DOCUMENT_ID', 'Invalid document ID.');
  }
  if (!dataDir) {
    return fail(res, 500, 'STORAGE_ERROR', 'DATA_DIR is not configured.');
  }

  // Rate limit
  if (!checkRateLimit()) {
    return fail(res, 429, 'RATE_LIMITED', 'Too many requests. Please wait and try again.');
  }

  // Find document record
  let docs;
  try { docs = readDocuments(dataDir); } catch (e) {
    return fail(res, 500, 'STORAGE_ERROR', 'Unable to read documents.');
  }
  const doc = docs.find(d => d.id === documentId);
  if (!doc) {
    return fail(res, 404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
  }

  // Determine document type from classification
  if (!doc.classification) {
    return fail(res, 422, 'CLASSIFICATION_MISSING', 'Document has not been classified yet.');
  }

  const documentType = normalizeDocumentType(
    doc.confirmedType || doc.classification.type,
    doc.confirmedCategory || doc.classification.category
  );

  // Read file bytes
  const filePath = doc.filePath;
  if (!fs.existsSync(filePath)) {
    return fail(res, 404, 'DOCUMENT_NOT_FOUND', 'Document file not found on disk.');
  }

  const mimeType = doc.mimeType;
  let imageBuffer = null;
  let pdfText = null;
  let rawBuffer = null;

  if (mimeType === 'application/pdf') {
    // PDF: use raw buffer for Gemini Vision (it handles PDF text extraction natively)
    rawBuffer = fs.readFileSync(filePath);
    pdfText = '';
  } else {
    try {
      const sharp = require('sharp');
      imageBuffer = await sharp(filePath)
        .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
    } catch (e) {
      imageBuffer = fs.readFileSync(filePath);
    }
  }

  // Call Gemini extraction
  let extractionResult;
  try {
    extractionResult = await extractDocumentData({ documentType, mimeType, imageBuffer, pdfText, rawBuffer });
  } catch (aiErr) {
    if (aiErr.code === 'EXTRACTION_TIMEOUT') {
      return fail(res, 504, 'EXTRACTION_TIMEOUT', 'Extraction timed out. Please try again.');
    }
    if (aiErr.code === 'RATE_LIMITED') {
      return fail(res, 429, 'RATE_LIMITED', 'Too many requests. Please wait and try again.');
    }
    if (aiErr.code === 'AI_AUTH_ERROR') {
      return fail(res, 500, 'AI_AUTH_ERROR', 'AI service unavailable. Check your GEMINI_API_KEY.');
    }
    return fail(res, 502, 'AI_EXTRACTION_FAILED', 'Could not analyze document. Check file quality or enter data manually.');
  }

  const now = new Date().toISOString();
  const extractionData = {
    documentId,
    documentFilename: doc.originalName || doc.filename,
    documentType,
    extractedAt: now,
    fields: extractionResult.fields,
  };

  // Write pending extraction file to disk before responding
  const extractionPath = path.join(dataDir, 'uploads', `${documentId}.extraction.json`);
  try {
    ensureDir(path.join(dataDir, 'uploads'));
    writeJSON(extractionPath, extractionData);
  } catch (writeErr) {
    console.error('[documents] extraction write error:', writeErr.message);
    return fail(res, 500, 'STORAGE_ERROR', 'Unable to save extraction data.');
  }

  // Audit log
  try {
    appendAuditLog(dataDir, {
      action: 'document_extracted',
      documentId,
      documentType,
      fieldCount: extractionResult.fields.length,
      timestamp: now,
    });
  } catch (_) {}

  return ok(res, {
    documentId,
    documentType,
    extractedAt: now,
    fields: extractionResult.fields,
  });
});

// ─── GET /api/documents/:documentId/extraction-preview ───────────────────────

router.get('/:documentId/extraction-preview', (req, res) => {
  const { documentId } = req.params;
  const dataDir = config.dataDir;

  if (!isValidDocId(documentId)) {
    return fail(res, 400, 'INVALID_DOCUMENT_ID', 'Invalid document ID.');
  }
  if (!dataDir) return ok(res, null);

  const extractionPath = path.join(dataDir, 'uploads', `${documentId}.extraction.json`);
  if (!fs.existsSync(extractionPath)) {
    return ok(res, null);
  }

  try {
    const data = readJSON(extractionPath);
    return ok(res, data);
  } catch (_) {
    return ok(res, null);
  }
});

// ─── PUT /api/documents/:documentId/extraction-fields/:fieldName ──────────────

router.put('/:documentId/extraction-fields/:fieldName', (req, res) => {
  const { documentId, fieldName } = req.params;
  const { value, confirmedByStudent, ignoreWarning } = req.body;
  const dataDir = config.dataDir;

  if (!isValidDocId(documentId)) {
    return fail(res, 400, 'INVALID_DOCUMENT_ID', 'Invalid document ID.');
  }
  if (!dataDir) return fail(res, 500, 'STORAGE_ERROR', 'DATA_DIR is not configured.');

  // Determine operation: ignoreWarning OR value update
  const isIgnoreWarning = ignoreWarning !== undefined;

  if (isIgnoreWarning) {
    if (typeof ignoreWarning !== 'string' || ignoreWarning.trim() === '') {
      return fail(res, 422, 'VALIDATION_ERROR', 'ignoreWarning must be a non-empty string.');
    }
  } else {
    // Validate value
    if (value === '' || value === null || value === undefined) {
      return fail(res, 422, 'VALIDATION_ERROR', 'Field value cannot be empty.');
    }
    if (typeof value === 'string' && value.length > 2000) {
      return fail(res, 422, 'VALIDATION_ERROR', 'Field value exceeds maximum length.');
    }
  }

  // Load pending extraction
  const extractionPath = path.join(dataDir, 'uploads', `${documentId}.extraction.json`);
  if (!fs.existsSync(extractionPath)) {
    return fail(res, 404, 'EXTRACTION_NOT_FOUND', 'No pending extraction found for this document.');
  }

  let extractionData;
  try { extractionData = readJSON(extractionPath); } catch (e) {
    return fail(res, 500, 'STORAGE_ERROR', 'Unable to read extraction data.');
  }

  const fieldIdx = extractionData.fields.findIndex(f => f.name === fieldName);
  if (fieldIdx === -1) {
    return fail(res, 404, 'FIELD_NOT_FOUND', 'Field not found in extraction.');
  }

  if (isIgnoreWarning) {
    // Append to ignoredWarnings without removing from warnings
    if (!Array.isArray(extractionData.fields[fieldIdx].ignoredWarnings)) {
      extractionData.fields[fieldIdx].ignoredWarnings = [];
    }
    if (!extractionData.fields[fieldIdx].ignoredWarnings.includes(ignoreWarning)) {
      extractionData.fields[fieldIdx].ignoredWarnings.push(ignoreWarning);
    }
  } else {
    extractionData.fields[fieldIdx].value = value;
    extractionData.fields[fieldIdx].confirmedByStudent = confirmedByStudent === true || confirmedByStudent === 'true';
  }

  try { writeJSON(extractionPath, extractionData); } catch (e) {
    return fail(res, 500, 'STORAGE_ERROR', 'Unable to update extraction data.');
  }

  if (isIgnoreWarning) {
    return ok(res, {
      fieldName,
      ignoredWarnings: extractionData.fields[fieldIdx].ignoredWarnings,
    });
  }

  return ok(res, {
    fieldName,
    value,
    confirmedByStudent: extractionData.fields[fieldIdx].confirmedByStudent,
  });
});

// ─── DELETE /api/documents/:documentId/extraction-fields/:fieldName ───────────

router.delete('/:documentId/extraction-fields/:fieldName', (req, res) => {
  const { documentId, fieldName } = req.params;
  const dataDir = config.dataDir;

  if (!isValidDocId(documentId)) {
    return fail(res, 400, 'INVALID_DOCUMENT_ID', 'Invalid document ID.');
  }
  if (!dataDir) return fail(res, 500, 'STORAGE_ERROR', 'DATA_DIR is not configured.');

  const extractionPath = path.join(dataDir, 'uploads', `${documentId}.extraction.json`);
  if (!fs.existsSync(extractionPath)) {
    return fail(res, 404, 'EXTRACTION_NOT_FOUND', 'No pending extraction found for this document.');
  }

  let extractionData;
  try { extractionData = readJSON(extractionPath); } catch (e) {
    return fail(res, 500, 'STORAGE_ERROR', 'Unable to read extraction data.');
  }

  const fieldIdx = extractionData.fields.findIndex(f => f.name === fieldName);
  if (fieldIdx === -1) {
    return fail(res, 404, 'FIELD_NOT_FOUND', 'Field not found in extraction.');
  }

  extractionData.fields[fieldIdx].deleted = true;

  try { writeJSON(extractionPath, extractionData); } catch (e) {
    return fail(res, 500, 'STORAGE_ERROR', 'Unable to update extraction data.');
  }

  return ok(res, { fieldName, deleted: true });
});

// ─── GET /api/documents/:documentId/duplicate-check ──────────────────────────
// Check if extracted courses would create duplicates against existing profile data.

router.get('/:documentId/duplicate-check', (req, res) => {
  const { documentId } = req.params;
  const dataDir = config.dataDir;

  if (!isValidDocId(documentId)) {
    return fail(res, 400, 'INVALID_DOCUMENT_ID', 'Invalid document ID.');
  }
  if (!dataDir) return fail(res, 500, 'STORAGE_ERROR', 'DATA_DIR is not configured.');

  const extractionPath = path.join(dataDir, 'uploads', `${documentId}.extraction.json`);
  if (!fs.existsSync(extractionPath)) {
    return ok(res, { hasDuplicates: false, duplicates: [] });
  }

  let extractionData;
  try { extractionData = readJSON(extractionPath); } catch (_) {
    return ok(res, { hasDuplicates: false, duplicates: [] });
  }

  // Only transcripts have courses; skip otherwise
  if (extractionData.documentType !== 'transcript') {
    return ok(res, { hasDuplicates: false, duplicates: [] });
  }

  // Get existing courses
  const { readProfileSection } = require('../../utils/profile-merge');
  const existingProfile = readProfileSection(dataDir, 'academic');
  const existingCourses = Array.isArray(existingProfile.courses) ? existingProfile.courses : [];

  if (existingCourses.length === 0) {
    return ok(res, { hasDuplicates: false, duplicates: [] });
  }

  // Find courses field in extraction
  const coursesField = extractionData.fields.find(f => f.name === 'courses' && !f.deleted && !f.skipped);
  if (!coursesField || !coursesField.value) {
    return ok(res, { hasDuplicates: false, duplicates: [] });
  }

  let incomingCourses = coursesField.value;
  if (!Array.isArray(incomingCourses)) {
    try { incomingCourses = JSON.parse(incomingCourses); } catch (_) { incomingCourses = []; }
  }

  const duplicates = detectDuplicateCourses(existingCourses, incomingCourses);

  return ok(res, {
    hasDuplicates: duplicates.length > 0,
    duplicateCount: duplicates.length,
    totalIncoming: incomingCourses.length,
    duplicates: duplicates.map(d => ({ courseName: d.incomingCourseName })),
  });
});

// ─── POST /api/documents/:documentId/review ──────────────────────────────────

router.post('/:documentId/review', async (req, res) => {
  const { documentId } = req.params;
  const { fields: submittedFields, coursesMergeMode } = req.body;
  const dataDir = config.dataDir;

  if (!isValidDocId(documentId)) {
    return fail(res, 400, 'INVALID_DOCUMENT_ID', 'Invalid document ID.');
  }
  if (!dataDir) return fail(res, 500, 'STORAGE_ERROR', 'DATA_DIR is not configured.');

  // Validate fields array
  if (!Array.isArray(submittedFields)) {
    return fail(res, 400, 'VALIDATION_ERROR', 'fields must be an array.');
  }
  for (const f of submittedFields) {
    if (!f.name || typeof f.name !== 'string') {
      return fail(res, 400, 'VALIDATION_ERROR', 'Each field must have a non-empty name string.');
    }
    if (typeof f.skipped !== 'boolean') {
      return fail(res, 400, 'VALIDATION_ERROR', 'Each field must have a boolean skipped property.');
    }
    if (typeof f.confirmedByStudent !== 'boolean') {
      return fail(res, 400, 'VALIDATION_ERROR', 'Each field must have a boolean confirmedByStudent property.');
    }
  }

  // Find document record
  let docs;
  try { docs = readDocuments(dataDir); } catch (e) {
    return fail(res, 500, 'STORAGE_ERROR', 'Unable to read documents.');
  }
  const doc = docs.find(d => d.id === documentId);
  if (!doc) {
    return fail(res, 404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
  }

  // Load pending extraction
  const extractionPath = path.join(dataDir, 'uploads', `${documentId}.extraction.json`);
  if (!fs.existsSync(extractionPath)) {
    return fail(res, 404, 'EXTRACTION_NOT_FOUND', 'No pending extraction to save.');
  }

  let extractionData;
  try { extractionData = readJSON(extractionPath); } catch (e) {
    return fail(res, 500, 'STORAGE_ERROR', 'Unable to read extraction data.');
  }

  // Merge submitted field decisions onto the extraction
  const submittedMap = {};
  for (const f of submittedFields) submittedMap[f.name] = f;

  const mergedFields = extractionData.fields.map(f => {
    const submitted = submittedMap[f.name];
    if (!submitted) return f;
    return {
      ...f,
      value: submitted.value !== undefined ? submitted.value : f.value,
      confirmedByStudent: submitted.confirmedByStudent,
      skipped: submitted.skipped,
      deleted: submitted.deleted === true || f.deleted === true,
    };
  });

  // Validate: low-confidence fields must be acknowledged (skip deleted fields)
  for (const f of mergedFields) {
    if (f.deleted) continue;
    if (f.confidence < 70 && !f.skipped && !f.confirmedByStudent) {
      return fail(res, 422, 'UNACKNOWLEDGED_LOW_CONFIDENCE',
        'All fields with confidence below 70 must be accepted or skipped before saving.');
    }
  }

  // Merge into profile
  const documentType = extractionData.documentType;
  const sourceDoc = extractionData.documentFilename;
  const sourceUploadedAt = doc.uploadedAt;

  const mergeOpts = { documentId };
  if (coursesMergeMode === 'merge' || coursesMergeMode === 'add_new') {
    mergeOpts.coursesMergeMode = coursesMergeMode;
  }

  let mergeResult;
  try {
    mergeResult = mergeExtractedData(dataDir, documentType, mergedFields, sourceDoc, sourceUploadedAt, mergeOpts);
  } catch (mergeErr) {
    console.error('[documents] profile merge error:', mergeErr.message);
    return fail(res, 503, 'FILE_LOCK_TIMEOUT', 'Could not save — please try again.');
  }

  const now = new Date().toISOString();

  // Audit log
  try {
    appendAuditLog(dataDir, {
      action: 'extraction_saved_to_profile',
      documentId,
      documentType,
      profileSection: mergeResult.section,
      fieldsSaved: mergeResult.fieldsSaved,
      fieldsSkipped: mergeResult.fieldsSkipped,
      fieldsDeleted: mergeResult.fieldsDeleted || 0,
      transformWarnings: mergeResult.transformWarnings || [],
      timestamp: now,
    });
  } catch (_) {}

  // Delete pending extraction file
  try { fs.unlinkSync(extractionPath); } catch (_) {}

  return ok(res, {
    documentId,
    profileSection: mergeResult.section,
    fieldsSaved: mergeResult.fieldsSaved,
    fieldsSkipped: mergeResult.fieldsSkipped,
    fieldsDeleted: mergeResult.fieldsDeleted || 0,
    transformWarnings: mergeResult.transformWarnings || [],
    duplicatesDetected: mergeResult.duplicatesDetected || 0,
    savedAt: now,
  });
});

// ─── DELETE /api/documents/:id ────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  const documentId = req.params.id;
  const dataDir = config.dataDir;

  if (!dataDir) {
    return fail(res, 500, 'STORAGE_ERROR', 'DATA_DIR is not configured.');
  }

  let docs;
  try {
    docs = readDocuments(dataDir);
  } catch (e) {
    return fail(res, 500, 'STORAGE_ERROR', 'Unable to read documents. Please try again.');
  }

  const idx = docs.findIndex(d => d.id === documentId);
  if (idx === -1) {
    return fail(res, 404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
  }

  const doc = docs[idx];
  if (doc.status === 'confirmed') {
    return fail(res, 409, 'INVALID_STATUS', 'Cannot discard a confirmed document.');
  }

  const now = new Date().toISOString();
  docs[idx] = { ...doc, status: 'discarded' };

  try {
    writeDocuments(dataDir, docs);
    appendAuditLog(dataDir, {
      action: 'document_discarded',
      documentId,
      timestamp: now,
    });
  } catch (writeErr) {
    return fail(res, 500, 'STORAGE_ERROR', 'Unable to discard document. Please try again.');
  }

  return ok(res, { documentId, status: 'discarded' });
});

module.exports = router;
