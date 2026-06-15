'use strict';

/**
 * Global default limits, used when limits.json is absent or unreadable.
 * One configuration applied to all generations (no presets).
 * All measurements are in WORDS for consistency.
 */
const LIMITS_DEFAULTS = {
  limits: {
    impactStatements: { unit: 'words', min: 100, max: 200 },
    essays: { unit: 'words', min: 500, max: 650 },
    questionnaireFields: { unit: 'words', min: 50, max: 100 },
  },
};

module.exports = { LIMITS_DEFAULTS };
