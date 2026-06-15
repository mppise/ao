'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

/** Project root .env path */
const ENV_PATH = path.resolve(__dirname, '../../../.env');

/** Package version */
let APP_VERSION = '1.0.0';
try {
  const pkg = require('../../../package.json');
  APP_VERSION = pkg.version || '1.0.0';
} catch (_) {}

/** Standard response envelope */
function envelope(success, data, error = null) {
  return { success, data, error, timestamp: new Date().toISOString() };
}

/**
 * Read all key=value pairs from .env file.
 * Returns an object with string values.
 */
function readEnvFile() {
  if (!fs.existsSync(ENV_PATH)) return {};
  const content = fs.readFileSync(ENV_PATH, 'utf8');
  const result = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    result[key] = val;
  }
  return result;
}

/**
 * Write key=value pairs back to .env, preserving comments and existing lines.
 * Uses atomic write (write to .tmp then rename).
 * @param {object} updates - key/value pairs to set
 */
function writeEnvFile(updates) {
  let content = '';
  if (fs.existsSync(ENV_PATH)) {
    content = fs.readFileSync(ENV_PATH, 'utf8');
  }

  const lines = content.split('\n');
  const updatedKeys = new Set();

  const newLines = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) return line;
    const key = trimmed.slice(0, eqIdx).trim();
    if (key in updates) {
      updatedKeys.add(key);
      return `${key}=${updates[key]}`;
    }
    return line;
  });

  // Append any keys not already in file
  for (const [key, val] of Object.entries(updates)) {
    if (!updatedKeys.has(key)) {
      newLines.push(`${key}=${val}`);
    }
  }

  const newContent = newLines.join('\n');
  const tmpPath = ENV_PATH + '.tmp.' + Date.now();
  fs.writeFileSync(tmpPath, newContent, 'utf8');
  fs.renameSync(tmpPath, ENV_PATH);
}

/**
 * GET /api/settings
 * Returns non-sensitive settings for display in the Settings screen.
 */
router.get('/', (req, res) => {
  try {
    const env = readEnvFile();
    const port = parseInt(env.PORT || process.env.PORT || '3000', 10);
    const dataDir = env.DATA_DIR || process.env.DATA_DIR || '';
    const geminiModel = env.GEMINI_MODEL || process.env.GEMINI_MODEL || '';
    const geminiApiKeySet = !!(env.GEMINI_API_KEY || process.env.GEMINI_API_KEY);

    return res.json(envelope(true, {
      port: isNaN(port) ? 3000 : port,
      dataDir,
      geminiModel,
      geminiApiKeySet,
    }));
  } catch (err) {
    console.error('[settings] GET error:', err.message);
    return res.status(500).json(envelope(false, null, {
      code: 'READ_ERROR',
      message: 'Could not read settings. Check that the .env file is accessible.',
    }));
  }
});

/**
 * GET /api/settings/key
 * Returns the raw GEMINI_API_KEY value for display when user clicks Show.
 * Kept separate to avoid leaking in normal settings load.
 */
router.get('/key', (req, res) => {
  try {
    const env = readEnvFile();
    const geminiApiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
    return res.json(envelope(true, { geminiApiKey }));
  } catch (err) {
    console.error('[settings/key] GET error:', err.message);
    return res.status(500).json(envelope(false, null, {
      code: 'READ_ERROR',
      message: 'Could not read API key from .env.',
    }));
  }
});

/**
 * POST /api/settings
 * Saves editable settings (PORT, GEMINI_MODEL, optionally GEMINI_API_KEY) to .env.
 */
router.post('/', (req, res) => {
  const { port, geminiModel, geminiApiKey } = req.body || {};

  // Validate port
  const portNum = parseInt(port, 10);
  if (isNaN(portNum) || portNum < 1024 || portNum > 65535) {
    return res.status(400).json(envelope(false, null, {
      code: 'VALIDATION_ERROR',
      message: 'Port must be a number between 1024 and 65535.',
    }));
  }

  // Validate geminiModel
  if (!geminiModel || typeof geminiModel !== 'string' || geminiModel.trim().length === 0 || geminiModel.trim().length > 60) {
    return res.status(400).json(envelope(false, null, {
      code: 'VALIDATION_ERROR',
      message: 'Model name is required (max 60 characters).',
    }));
  }

  // Validate geminiApiKey if provided
  if (geminiApiKey !== undefined && geminiApiKey !== null) {
    if (typeof geminiApiKey !== 'string' || geminiApiKey.trim().length === 0 || geminiApiKey.trim().length > 256) {
      return res.status(400).json(envelope(false, null, {
        code: 'VALIDATION_ERROR',
        message: 'API key must be between 1 and 256 characters.',
      }));
    }
  }

  try {
    const env = readEnvFile();
    const oldPort = parseInt(env.PORT || process.env.PORT || '3000', 10);

    const updates = {
      PORT: String(portNum),
      GEMINI_MODEL: geminiModel.trim(),
    };
    if (geminiApiKey !== undefined && geminiApiKey !== null && geminiApiKey.trim()) {
      updates.GEMINI_API_KEY = geminiApiKey.trim();
    }

    writeEnvFile(updates);

    // Update process.env so the running server reflects changes immediately
    process.env.PORT = String(portNum);
    process.env.GEMINI_MODEL = geminiModel.trim();
    if (updates.GEMINI_API_KEY) process.env.GEMINI_API_KEY = updates.GEMINI_API_KEY;

    const portChanged = portNum !== oldPort;
    const saved = ['port', 'geminiModel'];
    if (updates.GEMINI_API_KEY) saved.push('geminiApiKey');

    return res.json(envelope(true, { saved, portChanged }));
  } catch (err) {
    console.error('[settings] POST error:', err.message);
    return res.status(500).json(envelope(false, null, {
      code: 'WRITE_ERROR',
      message: 'Failed to save settings. Check that the .env file is writable.',
    }));
  }
});

/**
 * GET /api/settings/export
 * Returns a downloadable config snapshot with GEMINI_API_KEY redacted.
 */
router.get('/export', (req, res) => {
  try {
    const env = readEnvFile();
    const port = parseInt(env.PORT || process.env.PORT || '3000', 10);
    const dataDir = env.DATA_DIR || process.env.DATA_DIR || '';
    const geminiModel = env.GEMINI_MODEL || process.env.GEMINI_MODEL || '';

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const filename = `ao-config-export-${today}.json`;

    const exportData = {
      exportedAt: new Date().toISOString(),
      appVersion: APP_VERSION,
      config: {
        port: isNaN(port) ? 3000 : port,
        dataDir,
        geminiModel,
        geminiApiKey: '[REDACTED]',
      },
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(JSON.stringify(exportData, null, 2));
  } catch (err) {
    console.error('[settings/export] error:', err.message);
    return res.status(500).json(envelope(false, null, {
      code: 'EXPORT_ERROR',
      message: 'Could not generate config export.',
    }));
  }
});

module.exports = router;
