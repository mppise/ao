'use strict';

const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { writeJSON, ensureDir } = require('./file-io');

/**
 * Initialize a new student profile on disk.
 * Creates DATA_DIR/profile/ subdirectory and writes all JSON files.
 *
 * @param {string} firstName
 * @param {string} lastName
 * @param {string} dataDir  — absolute path to data directory
 * @returns {string[]} list of created file paths (relative to dataDir)
 */
function initializeProfile(firstName, lastName, dataDir) {
  const now = new Date().toISOString();
  const displayName = [firstName, lastName].filter(Boolean).join(' ').trim();
  const profileDir = path.join(dataDir, 'profile');

  ensureDir(dataDir);
  ensureDir(profileDir);
  ensureDir(path.join(dataDir, '.logs'));

  // .metadata.json
  const metadata = {
    schemaVersion: '1.0.0',
    createdAt: now,
    updatedAt: now,
    student: {
      firstName,
      lastName: lastName || '',
      displayName,
    },
  };
  writeJSON(path.join(dataDir, '.metadata.json'), metadata);

  // .audit.json
  const audit = {
    entries: [
      {
        traceId: uuidv4(),
        timestamp: now,
        action: 'PROFILE_CREATED',
        affectedFields: [
          'metadata',
          'academic',
          'tests',
          'achievements',
          'activities',
          'impact_statements',
          'essays',
        ],
        actor: 'system',
      },
    ],
  };
  writeJSON(path.join(dataDir, '.audit.json'), audit);

  // profile/academic.json
  writeJSON(path.join(profileDir, 'academic.json'), {
    schemaVersion: '1.0.0',
    lastUpdated: now,
    data: {
      gpa: null,
      gpaScale: null,
      classRank: null,
      classSize: null,
      school: null,
      graduationYear: null,
      courses: [],
    },
    sources: [],
  });

  // profile/tests.json
  writeJSON(path.join(profileDir, 'tests.json'), {
    schemaVersion: '1.0.0',
    lastUpdated: now,
    data: {
      sat: null,
      act: null,
      ap: [],
      other: [],
    },
    sources: [],
  });

  // profile/achievements.json
  writeJSON(path.join(profileDir, 'achievements.json'), {
    schemaVersion: '1.0.0',
    lastUpdated: now,
    data: {
      items: [],
    },
    sources: [],
  });

  // profile/activities.json
  writeJSON(path.join(profileDir, 'activities.json'), {
    schemaVersion: '1.0.0',
    lastUpdated: now,
    data: {
      items: [],
    },
    sources: [],
  });

  // profile/impact_statements.json
  writeJSON(path.join(profileDir, 'impact_statements.json'), {
    schemaVersion: '1.0.0',
    lastUpdated: now,
    data: {
      statements: [],
    },
    aiGenerated: true,
    generatedAt: null,
  });

  // profile/essays.json
  writeJSON(path.join(profileDir, 'essays.json'), {
    schemaVersion: '1.0.0',
    lastUpdated: now,
    data: {
      drafts: [],
    },
    aiGenerated: true,
    generatedAt: null,
  });

  return [
    '.metadata.json',
    '.audit.json',
    'profile/academic.json',
    'profile/tests.json',
    'profile/achievements.json',
    'profile/activities.json',
    'profile/impact_statements.json',
    'profile/essays.json',
  ];
}

/**
 * Append an entry to .audit.json.
 * @param {string} dataDir
 * @param {string} action
 * @param {string[]} affectedFields
 */
function appendAudit(dataDir, action, affectedFields) {
  const auditPath = path.join(dataDir, '.audit.json');
  let audit = [];
  try {
    audit = require('./file-io').readJSON(auditPath);
  } catch (_) {
    // file missing — start fresh
  }
  if (!Array.isArray(audit)) audit = [];
  audit.push({
    traceId: uuidv4(),
    timestamp: new Date().toISOString(),
    action,
    affectedFields,
    actor: 'system',
  });
  require('./file-io').writeJSON(auditPath, audit);
}

module.exports = { initializeProfile, appendAudit };
