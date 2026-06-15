'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Protected path prefixes — writing to these is blocked.
 */
const PROTECTED_PREFIXES = [
  '/System',
  '/usr',
  '/bin',
  '/etc',
  '/var',
  '/sbin',
  '/private/var',
  '/private/etc',
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  '/Windows',
];

/**
 * Check if a path starts with any protected prefix.
 * @param {string} dirPath
 * @returns {boolean}
 */
function isProtectedPath(dirPath) {
  const normalized = path.resolve(dirPath);
  return PROTECTED_PREFIXES.some((prefix) =>
    normalized === prefix || normalized.startsWith(prefix + path.sep) || normalized.startsWith(prefix + '/')
  );
}

/**
 * Create directory recursively.
 * @param {string} dirPath
 */
function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * Write JSON file atomically using write-temp-rename.
 * @param {string} filePath
 * @param {object} data
 */
function writeJSON(filePath, data) {
  ensureDir(path.dirname(filePath));
  const tmpPath = filePath + '.tmp.' + Date.now();
  const content = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

/**
 * Read and parse a JSON file.
 * @param {string} filePath
 * @returns {object}
 */
function readJSON(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content);
}

/**
 * Test write permission by creating and deleting a temp file.
 * @param {string} dirPath
 * @returns {{ ok: boolean, error?: string }}
 */
function testWritePermission(dirPath) {
  try {
    ensureDir(dirPath);
    const testFile = path.join(dirPath, '.ao_write_test_' + Date.now());
    fs.writeFileSync(testFile, 'test', 'utf8');
    fs.unlinkSync(testFile);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── Document helpers ──────────────────────────────────────────────────────────

/**
 * Generate a document ID: doc_{YYYYMMDD}_{HHmmss}_{6-char hex}
 * @returns {string}
 */
function generateDocumentId() {
  const now = new Date();
  const date = now.toISOString().replace(/[-:T]/g, '').slice(0, 15).replace(/\.\d+Z$/, '');
  const YYYYMMDD = date.slice(0, 8);
  const HHmmss = date.slice(8, 14);
  const hex = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
  return `doc_${YYYYMMDD}_${HHmmss}_${hex}`;
}

/**
 * Generate a timestamp prefix: YYYYMMDD_HHmmss
 * @returns {string}
 */
function generateTimestampPrefix() {
  const now = new Date();
  const Y = now.getUTCFullYear();
  const Mo = String(now.getUTCMonth() + 1).padStart(2, '0');
  const D = String(now.getUTCDate()).padStart(2, '0');
  const H = String(now.getUTCHours()).padStart(2, '0');
  const Mi = String(now.getUTCMinutes()).padStart(2, '0');
  const S = String(now.getUTCSeconds()).padStart(2, '0');
  return `${Y}${Mo}${D}_${H}${Mi}${S}`;
}

/**
 * Sanitize a filename component.
 * Strip non-ASCII, path traversal chars, replace spaces with underscores.
 * @param {string} name
 * @param {number} [maxLen=100]
 * @returns {string}
 */
function sanitizeFilename(name, maxLen = 100) {
  return name
    .toLowerCase()
    // Remove path traversal sequences
    .replace(/\.\.\//g, '')
    .replace(/\.\.\\/g, '')
    // Replace spaces with underscore
    .replace(/\s+/g, '_')
    // Remove characters outside safe set (preserve extension dot)
    .replace(/[^a-z0-9_\-\.]/g, '')
    // Collapse multiple dots/underscores
    .replace(/\.{2,}/g, '.')
    .slice(0, maxLen);
}

/**
 * Move (copy + delete) an uploaded temp file to the uploads directory.
 * Returns the final file path.
 * @param {string} tempPath — path where multer saved the file
 * @param {string} dataDir — DATA_DIR
 * @param {string} sanitizedFilename — target filename
 * @returns {string} final file path
 */
function moveUploadedFile(tempPath, dataDir, sanitizedFilename) {
  const uploadsDir = path.join(dataDir, 'uploads');
  ensureDir(uploadsDir);
  const finalPath = path.join(uploadsDir, sanitizedFilename);
  fs.copyFileSync(tempPath, finalPath);
  try { fs.unlinkSync(tempPath); } catch (_) { /* ignore */ }
  return finalPath;
}

/**
 * Read documents.json from DATA_DIR. Returns [] if file doesn't exist.
 * @param {string} dataDir
 * @returns {Array}
 */
function readDocuments(dataDir) {
  const p = path.join(dataDir, 'documents.json');
  try {
    return readJSON(p);
  } catch (_) {
    return [];
  }
}

/**
 * Write documents.json to DATA_DIR atomically.
 * @param {string} dataDir
 * @param {Array} docs
 */
function writeDocuments(dataDir, docs) {
  const p = path.join(dataDir, 'documents.json');
  writeJSON(p, docs);
}

/**
 * Append an entry to the audit log.
 * @param {string} dataDir
 * @param {object} entry
 */
function appendAuditLog(dataDir, entry) {
  const p = path.join(dataDir, '.audit.json');
  let log = [];
  try { log = readJSON(p); } catch (_) { /* start fresh */ }
  if (!Array.isArray(log)) log = [];
  log.push(entry);
  writeJSON(p, log);
}

module.exports = {
  isProtectedPath,
  ensureDir,
  writeJSON,
  readJSON,
  testWritePermission,
  generateDocumentId,
  generateTimestampPrefix,
  sanitizeFilename,
  moveUploadedFile,
  readDocuments,
  writeDocuments,
  appendAuditLog,
};
