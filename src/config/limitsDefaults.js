'use strict';

/**
 * Global default limits, used when limits.json is absent or unreadable.
 * One configuration applied to all generations (no presets).
 */
const LIMITS_DEFAULTS = {
  limits: {
    impactStatements: { unit: 'characters', min: 100, max: 1000 },
    essays: { unit: 'words', min: 500, max: 650 },
    questionnaireFields: { unit: 'characters', min: 100, max: 500 },
  },
};

module.exports = { LIMITS_DEFAULTS };
