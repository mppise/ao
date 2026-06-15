'use strict';

/**
 * Hardcoded default limits, used when limits.json is absent or unreadable.
 * These are code constants — never loaded from disk as a fallback.
 */
const LIMITS_DEFAULTS = {
  preset: 'common_app',
  limits: {
    impactStatements: { unit: 'characters', min: 100, max: 1000 },
    essays: { unit: 'words', min: 500, max: 650 },
    questionnaireFields: { unit: 'characters', min: 100, max: 500 },
  },
};

/**
 * Canonical values per built-in preset.
 * Server enforces these values regardless of what the client sends.
 */
const PRESET_VALUES = {
  common_app: {
    impactStatements: { min: 100, max: 1000 },
    essays: { min: 500, max: 650 },
    questionnaireFields: { min: 100, max: 500 },
  },
  coalition_app: {
    impactStatements: { min: 100, max: 1000 },
    essays: { min: 500, max: 650 },
    questionnaireFields: { min: 100, max: 500 },
  },
};

const VALID_PRESETS = ['common_app', 'coalition_app', 'custom'];

module.exports = { LIMITS_DEFAULTS, PRESET_VALUES, VALID_PRESETS };
