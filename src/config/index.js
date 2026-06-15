'use strict';

const path = require('path');
const fs = require('fs');

// Load .env from project root (two levels up from src/config/)
const envPath = path.resolve(__dirname, '../../.env');

// dotenv.config returns parsed or error
const dotenv = require('dotenv');
const result = dotenv.config({ path: envPath });

if (result.error && !process.env.GEMINI_API_KEY) {
  // .env not found and no env vars set — warn but don't crash yet;
  // validation below will handle missing required vars.
  console.warn('[config] .env file not found at', envPath, '— using process environment variables only.');
}

/**
 * Validate that required environment variables are present.
 * Throws if any required var is missing.
 */
function validateConfig() {
  const required = ['GEMINI_API_KEY', 'GEMINI_MODEL'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    const msg =
      `[AO] Missing required environment variables: ${missing.join(', ')}\n` +
      `Please copy .env.example to .env and fill in the values.`;
    throw new Error(msg);
  }
}

const config = {
  geminiApiKey: process.env.GEMINI_API_KEY || null,
  geminiModel: process.env.GEMINI_MODEL || null,
  port: parseInt(process.env.PORT || '3000', 10),
  dataDir: process.env.DATA_DIR || null,
  envPath,
  validate: validateConfig,
};

module.exports = config;
