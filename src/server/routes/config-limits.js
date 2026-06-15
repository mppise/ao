'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');

const { LIMITS_DEFAULTS, PRESET_VALUES, VALID_PRESETS } = require('../../config/limitsDefaults');

const router = express.Router();

/** Absolute path to limits.json — lives inside /src/config/ */
const LIMITS_FILE = path.resolve(__dirname, '../../config/limits.json');

/** Standard response envelope */
function envelope(success, data, error = null) {
  return { success, data, error, timestamp: new Date().toISOString() };
}

/**
 * In-memory cache of the current limits.
 * Initialized at module load; updated on every successful POST.
 */
let _cachedLimits = null;

/**
 * Load limits from disk. Returns the parsed object if successful.
 * Returns null on any read/parse failure (caller should use defaults).
 * @returns {{ preset, lastUpdated, limits }|null}
 */
function loadLimitsFromDisk() {
  try {
    if (!fs.existsSync(LIMITS_FILE)) return null;
    const raw = fs.readFileSync(LIMITS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (err) {
    console.warn('[config/limits] limits.json is malformed — using defaults:', err.message);
    return null;
  }
}

/**
 * Initialize the in-memory limits cache from disk (or defaults).
 * Called once at module load.
 */
function initLimitsCache() {
  const fromDisk = loadLimitsFromDisk();
  if (fromDisk) {
    _cachedLimits = fromDisk;
  } else {
    _cachedLimits = Object.assign({ lastUpdated: null }, LIMITS_DEFAULTS);
  }
}

initLimitsCache();

/**
 * Return the current in-memory limits. Used by any server route that
 * needs to reference limits without a disk read.
 */
function getLimits() {
  return _cachedLimits;
}

// ─── GET /api/config/limits ───────────────────────────────────────────────────

router.get('/', (req, res) => {
  const fromDisk = loadLimitsFromDisk();

  if (fromDisk) {
    return res.json(envelope(true, {
      source: 'file',
      preset: fromDisk.preset,
      lastUpdated: fromDisk.lastUpdated || null,
      limits: fromDisk.limits,
    }));
  }

  // File absent or malformed — return defaults
  return res.json(envelope(true, {
    source: 'defaults',
    preset: LIMITS_DEFAULTS.preset,
    lastUpdated: null,
    limits: LIMITS_DEFAULTS.limits,
  }));
});

// ─── POST /api/config/limits ──────────────────────────────────────────────────

router.post('/', (req, res) => {
  const { preset, limits } = req.body || {};

  // Validate preset
  if (!preset || !VALID_PRESETS.includes(preset)) {
    return res.status(400).json(envelope(false, null, {
      code: 'INVALID_PRESET',
      message: 'preset must be one of: common_app, coalition_app, custom.',
    }));
  }

  // Validate limits object structure
  if (
    !limits ||
    typeof limits !== 'object' ||
    !limits.impactStatements ||
    !limits.essays ||
    !limits.questionnaireFields
  ) {
    return res.status(400).json(envelope(false, null, {
      code: 'MISSING_FIELD',
      message: 'limits object with impactStatements, essays, and questionnaireFields is required.',
    }));
  }

  // For built-in presets: override submitted limits with canonical values
  let resolvedLimits;
  if (preset === 'common_app' || preset === 'coalition_app') {
    const canonical = PRESET_VALUES[preset];
    resolvedLimits = {
      impactStatements: { unit: 'characters', min: canonical.impactStatements.min, max: canonical.impactStatements.max },
      essays: { unit: 'words', min: canonical.essays.min, max: canonical.essays.max },
      questionnaireFields: { unit: 'characters', min: canonical.questionnaireFields.min, max: canonical.questionnaireFields.max },
    };
  } else {
    // Custom preset: validate each field
    const validationError = _validateCustomLimits(limits);
    if (validationError) {
      return res.status(400).json(envelope(false, null, validationError));
    }
    resolvedLimits = {
      impactStatements: {
        unit: 'characters',
        min: Math.trunc(limits.impactStatements.min),
        max: Math.trunc(limits.impactStatements.max),
      },
      essays: {
        unit: 'words',
        min: Math.trunc(limits.essays.min),
        max: Math.trunc(limits.essays.max),
      },
      questionnaireFields: {
        unit: 'characters',
        min: Math.trunc(limits.questionnaireFields.min),
        max: Math.trunc(limits.questionnaireFields.max),
      },
    };
  }

  const now = new Date().toISOString();
  const fileData = {
    schemaVersion: '1.0.0',
    preset,
    lastUpdated: now,
    limits: resolvedLimits,
  };

  // Write atomically: temp file → rename
  try {
    const dir = path.dirname(LIMITS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const tmpPath = LIMITS_FILE + '.tmp.' + Date.now();
    fs.writeFileSync(tmpPath, JSON.stringify(fileData, null, 2), 'utf8');
    fs.renameSync(tmpPath, LIMITS_FILE);
  } catch (err) {
    console.error('[config/limits] file write failed:', err.message);
    return res.status(500).json(envelope(false, null, {
      code: 'FILE_WRITE_ERROR',
      message: 'Could not save settings. Check your data directory.',
    }));
  }

  // Update in-memory cache
  _cachedLimits = fileData;

  return res.json(envelope(true, {
    preset,
    lastUpdated: now,
    limits: resolvedLimits,
  }));
});

// ─── Validation helpers ───────────────────────────────────────────────────────

/**
 * Validate the custom limit fields.
 * @param {object} limits
 * @returns {{ code, message }|null} error object or null if valid
 */
function _validateCustomLimits(limits) {
  const sections = [
    { key: 'impactStatements', label: 'impactStatements' },
    { key: 'essays', label: 'essays' },
    { key: 'questionnaireFields', label: 'questionnaireFields' },
  ];

  for (const { key, label } of sections) {
    const section = limits[key];
    if (!section) {
      return { code: 'MISSING_FIELD', message: `limits.${label} is required.` };
    }

    const minRaw = section.min;
    const maxRaw = section.max;

    // Check min is a valid integer in range [0, 9998]
    if (!_isValidInteger(minRaw) || minRaw < 0 || minRaw > 9998) {
      return {
        code: 'VALIDATION_ERROR',
        message: `${label} min must be an integer between 0 and 9998.`,
      };
    }

    // Check max is a valid integer in range [1, 9999]
    if (!_isValidInteger(maxRaw) || maxRaw < 1 || maxRaw > 9999) {
      return {
        code: 'VALIDATION_ERROR',
        message: `${label} max must be an integer between 1 and 9999.`,
      };
    }

    // Check max > min
    if (maxRaw <= minRaw) {
      return {
        code: 'VALIDATION_ERROR',
        message: `${label} max must be greater than min.`,
      };
    }
  }

  return null;
}

/**
 * Returns true if value is a finite integer (no decimals).
 * @param {*} value
 */
function _isValidInteger(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') {
    // Reject non-numeric strings like "five hundred"
    if (isNaN(Number(value))) return false;
    // Reject decimals
    if (String(value).includes('.')) return false;
    value = Number(value);
  }
  if (typeof value !== 'number') return false;
  if (!isFinite(value)) return false;
  if (!Number.isInteger(value)) return false;
  return true;
}

module.exports = router;
module.exports.getLimits = getLimits;
