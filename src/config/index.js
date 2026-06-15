// @story STORY-001 | non-blocking .env initialization
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

/**
 * Write one or more key=value pairs to the .env file at project root.
 * Preserves comments and all existing lines; appends new keys.
 * Also updates process.env immediately so the running server picks up changes.
 * @param {object} updates - e.g. { GEMINI_API_KEY: '...', GEMINI_MODEL: '...' }
 */
function writeEnvConfig(updates) {
  let content = '';
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf8');
  }

  const lines = content.split('\n');
  const updatedKeys = new Set();

  const newLines = lines.map((line) => {
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

  for (const [key, val] of Object.entries(updates)) {
    if (!updatedKeys.has(key)) {
      newLines.push(`${key}=${val}`);
    }
  }

  const newContent = newLines.join('\n');
  const tmpPath = envPath + '.tmp.' + Date.now();
  fs.writeFileSync(tmpPath, newContent, 'utf8');
  fs.renameSync(tmpPath, envPath);

  // Reflect changes in current process immediately
  for (const [key, val] of Object.entries(updates)) {
    process.env[key] = val;
  }
  // Refresh exported config fields
  config.geminiApiKey = process.env.GEMINI_API_KEY || null;
  config.geminiModel = process.env.GEMINI_MODEL || null;
}

const config = {
  geminiApiKey: process.env.GEMINI_API_KEY || null,
  geminiModel: process.env.GEMINI_MODEL || null,
  port: parseInt(process.env.PORT || '3000', 10),
  dataDir: process.env.DATA_DIR || null,
  envPath,
  validate: validateConfig,
  writeEnvConfig,
};

module.exports = config;
