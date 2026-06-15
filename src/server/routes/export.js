'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { readJSON } = require('../../utils/file-io');
const { streamProfileZip, getExistingProfileFiles } = require('../../lib/zipExport');
const { generateProfilePDF } = require('../../lib/pdfExport');

const router = express.Router();

/** Standard error envelope */
function errEnvelope(code, message) {
  return {
    success: false,
    data: null,
    error: { code, message },
    timestamp: new Date().toISOString(),
  };
}

/** Check if request is from localhost */
function isLocalhost(req) {
  const addr = req.socket.remoteAddress || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/** Format date as YYYYMMDD */
function yyyymmdd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** Get firstName from .metadata.json, fallback to "profile" */
function getFirstName(dataDir) {
  try {
    const meta = readJSON(path.join(dataDir, 'profile', '.metadata.json'));
    // metadata may be nested under 'student' or at top level
    const fn = (meta && (meta.firstName || (meta.student && meta.student.firstName)));
    return fn || 'profile';
  } catch (_) {
    // Try top-level metadata
    try {
      const meta = readJSON(path.join(dataDir, '.metadata.json'));
      return (meta && meta.firstName) || 'profile';
    } catch (_) {
      return 'profile';
    }
  }
}

// ── POST /api/export/json ────────────────────────────────────────────────────

router.post('/json', (req, res) => {
  if (!isLocalhost(req)) {
    return res.status(403).json(errEnvelope('FORBIDDEN', 'Export is only available from localhost.'));
  }

  const dataDir = process.env.DATA_DIR || null;
  if (!dataDir) {
    return res.status(500).json(errEnvelope('DATA_DIR_MISSING', 'Data directory is not configured.'));
  }

  const profileDir = path.join(dataDir, 'profile');
  if (!fs.existsSync(profileDir)) {
    return res.status(404).json(errEnvelope('PROFILE_NOT_FOUND', 'No profile data found to export.'));
  }

  const { allMissing } = getExistingProfileFiles(dataDir);
  if (allMissing) {
    return res.status(404).json(errEnvelope('PROFILE_EMPTY', 'Profile is empty — add data before exporting.'));
  }

  const firstName = getFirstName(dataDir);
  const dateStr = yyyymmdd(new Date());
  const filename = `ao-profile-${firstName}-${dateStr}.zip`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  streamProfileZip(dataDir, res).catch((err) => {
    console.error('[export/json] zip error:', err.message);
    if (!res.headersSent) {
      res.status(500).json(errEnvelope('ZIP_FAILED', 'Could not create zip archive. Check disk space.'));
    }
  });
});

// ── POST /api/export/pdf ─────────────────────────────────────────────────────

router.post('/pdf', (req, res) => {
  if (!isLocalhost(req)) {
    return res.status(403).json(errEnvelope('FORBIDDEN', 'Export is only available from localhost.'));
  }

  const dataDir = process.env.DATA_DIR || null;
  if (!dataDir) {
    return res.status(500).json(errEnvelope('DATA_DIR_MISSING', 'Data directory is not configured.'));
  }

  const profileDir = path.join(dataDir, 'profile');
  if (!fs.existsSync(profileDir)) {
    return res.status(404).json(errEnvelope('PROFILE_EMPTY', 'No profile data found to export.'));
  }

  const { allMissing } = getExistingProfileFiles(dataDir);
  if (allMissing) {
    return res.status(404).json(errEnvelope('PROFILE_EMPTY', 'No profile data found to export.'));
  }

  const firstName = getFirstName(dataDir);
  const dateStr = yyyymmdd(new Date());
  const filename = `ao-profile-${firstName}-${dateStr}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  generateProfilePDF(dataDir, res).catch((err) => {
    console.error('[export/pdf] error:', err.message);
    if (!res.headersSent) {
      res.status(500).json(errEnvelope('PDF_FAILED', 'Could not generate PDF. Try again or use JSON export.'));
    }
  });
});

module.exports = router;
