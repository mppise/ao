// @story STORY-001 | non-blocking .env initialization
'use strict';

const express = require('express');
const router = express.Router();
const config = require('../../config/index');

/** Standard response envelope */
function envelope(success, data, error = null) {
  return { success, data, error, timestamp: new Date().toISOString() };
}

/**
 * GET /api/config/init
 * Returns whether GEMINI_API_KEY and GEMINI_MODEL are configured.
 * The UI uses this on load to decide whether to show the setup modal.
 */
// @entry GET /api/config/init | check if Gemini credentials are configured
// @contract output: {configured: boolean, geminiModel: string|null} | errors: 500
router.get('/', (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL;
  const configured = !!(apiKey && apiKey.trim() && model && model.trim());
  return res.json(envelope(true, {
    configured,
    geminiModel: model ? model.trim() : null,
  }));
});

/**
 * POST /api/config/init
 * Saves GEMINI_API_KEY and GEMINI_MODEL to the .env file and updates process.env.
 * Body: { geminiApiKey: string, geminiModel: string }
 */
// @entry POST /api/config/init | save Gemini API key and model to .env
// @contract input: {geminiApiKey: string, geminiModel: string} → output: {configured: true} | errors: 400 validation, 500 write failure
router.post('/', (req, res) => {
  const { geminiApiKey, geminiModel } = req.body || {};

  // Validate API key
  if (!geminiApiKey || typeof geminiApiKey !== 'string' || geminiApiKey.trim().length === 0) {
    return res.status(400).json(envelope(false, null, {
      code: 'VALIDATION_ERROR',
      message: 'Gemini API key is required.',
    }));
  }
  if (geminiApiKey.trim().length > 256) {
    return res.status(400).json(envelope(false, null, {
      code: 'VALIDATION_ERROR',
      message: 'API key must not exceed 256 characters.',
    }));
  }

  // Validate model name
  if (!geminiModel || typeof geminiModel !== 'string' || geminiModel.trim().length === 0) {
    return res.status(400).json(envelope(false, null, {
      code: 'VALIDATION_ERROR',
      message: 'Gemini model name is required.',
    }));
  }
  if (geminiModel.trim().length > 60) {
    return res.status(400).json(envelope(false, null, {
      code: 'VALIDATION_ERROR',
      message: 'Model name must not exceed 60 characters.',
    }));
  }

  try {
    config.writeEnvConfig({
      GEMINI_API_KEY: geminiApiKey.trim(),
      GEMINI_MODEL: geminiModel.trim(),
    });

    return res.json(envelope(true, { configured: true }));
  } catch (err) {
    console.error('[config-init] POST write error:', err.message);
    return res.status(500).json(envelope(false, null, {
      code: 'WRITE_ERROR',
      message: 'Failed to save settings to .env. Check that the app directory is writable.',
    }));
  }
});

module.exports = router;
