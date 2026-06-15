'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { isProtectedPath, testWritePermission, readJSON } = require('../../utils/file-io');
const { initializeProfile } = require('../../utils/profile-init');

const router = express.Router();

/** Standard response envelope */
function envelope(success, data, error = null) {
  return { success, data, error, timestamp: new Date().toISOString() };
}

/**
 * GET /api/onboarding/status
 * Check if onboarding has been completed.
 */
router.get('/status', (req, res) => {
  const dataDir = process.env.DATA_DIR || null;

  if (!dataDir) {
    return res.json(envelope(true, { onboardingComplete: false, reason: 'DATA_DIR_NOT_SET' }));
  }

  const metaPath = path.join(dataDir, '.metadata.json');
  if (!fs.existsSync(metaPath)) {
    return res.json(envelope(true, { onboardingComplete: false, reason: 'PROFILE_NOT_FOUND' }));
  }

  try {
    const meta = readJSON(metaPath);
    return res.json(
      envelope(true, {
        onboardingComplete: true,
        student: meta.student,
      })
    );
  } catch (err) {
    return res.json(envelope(true, { onboardingComplete: false, reason: 'PROFILE_NOT_FOUND' }));
  }
});

/**
 * GET /api/onboarding/defaults
 * Return suggested default data directory.
 */
router.get('/defaults', (req, res) => {
  const suggestedDataDir = path.join(os.homedir(), 'ao-profile');
  return res.json(envelope(true, { suggestedDataDir }));
});

/**
 * Write or update DATA_DIR in the .env file.
 * @param {string} dataDir
 */
function writeDataDirToEnv(dataDir) {
  const envPath = path.resolve(__dirname, '../../../.env');
  let content = '';
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf8');
  }

  const dataDirLine = `DATA_DIR=${dataDir}`;

  if (/^DATA_DIR=/m.test(content)) {
    content = content.replace(/^DATA_DIR=.*/m, dataDirLine);
  } else {
    content = content.trimEnd() + '\n' + dataDirLine + '\n';
  }

  const tmpPath = envPath + '.tmp.' + Date.now();
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, envPath);
}

/**
 * Signup request handler — used both as router.post and exported for direct mount.
 */
function signupHandler(req, res) {
  const { firstName, lastName = '', dataDir } = req.body || {};

  const namePattern = /^[A-Za-z'\- ]{1,50}$/;
  const lastNamePattern = /^[A-Za-z'\- ]{0,50}$/;

  if (!firstName || typeof firstName !== 'string' || firstName.trim() === '') {
    return res.status(400).json(
      envelope(false, null, { code: 'VALIDATION_ERROR', message: 'First name is required.' })
    );
  }
  if (!namePattern.test(firstName.trim())) {
    return res.status(400).json(
      envelope(false, null, {
        code: 'VALIDATION_ERROR',
        message: 'Name may only contain letters, hyphens, apostrophes, and spaces.',
      })
    );
  }
  if (lastName && !lastNamePattern.test(lastName.trim())) {
    return res.status(400).json(
      envelope(false, null, {
        code: 'VALIDATION_ERROR',
        message: 'Last name may only contain letters, hyphens, apostrophes, and spaces.',
      })
    );
  }

  if (!dataDir || typeof dataDir !== 'string' || dataDir.trim() === '') {
    return res.status(400).json(
      envelope(false, null, { code: 'INVALID_PATH', message: 'A directory path is required.' })
    );
  }

  const trimmedDir = dataDir.trim();

  const isAbsolute =
    trimmedDir.startsWith('/') || /^[A-Za-z]:[\\\/]/.test(trimmedDir);
  if (!isAbsolute) {
    return res.status(400).json(
      envelope(false, null, {
        code: 'INVALID_PATH',
        message: 'Directory path must be an absolute path (e.g., /Users/yourname/ao-profile).',
      })
    );
  }

  if (isProtectedPath(trimmedDir)) {
    return res.status(403).json(
      envelope(false, null, {
        code: 'PROTECTED_PATH',
        message: 'That path is a protected system directory. Please choose a folder in your home directory.',
      })
    );
  }

  const metaPath = path.join(trimmedDir, '.metadata.json');
  if (fs.existsSync(metaPath)) {
    try {
      const existingMeta = readJSON(metaPath);
      return res.status(409).json(
        envelope(
          false,
          {
            existingProfile: {
              firstName: existingMeta.student.firstName,
              displayName: existingMeta.student.displayName,
              createdAt: existingMeta.createdAt,
            },
          },
          { code: 'PROFILE_EXISTS', message: 'A profile already exists at this path.' }
        )
      );
    } catch (_) {
      // Can't read — treat as non-existent
    }
  }

  const writeTest = testWritePermission(trimmedDir);
  if (!writeTest.ok) {
    return res.status(500).json(
      envelope(false, null, {
        code: 'WRITE_ERROR',
        message:
          'AO could not create or write to that directory. Check folder permissions and try again.',
      })
    );
  }

  let filesCreated;
  try {
    filesCreated = initializeProfile(firstName.trim(), lastName.trim(), trimmedDir);
  } catch (err) {
    console.error('[signup] profile init error:', err.message);
    return res.status(500).json(
      envelope(false, null, {
        code: 'WRITE_ERROR',
        message:
          'AO could not create or write to that directory. Check folder permissions and try again.',
      })
    );
  }

  try {
    writeDataDirToEnv(trimmedDir);
  } catch (err) {
    console.error('[signup] .env write error:', err.message);
    return res.status(500).json(
      envelope(false, null, {
        code: 'WRITE_ERROR',
        message: `Could not update .env. Please add DATA_DIR=${trimmedDir} manually to the .env file in AO's installation directory.`,
      })
    );
  }

  process.env.DATA_DIR = trimmedDir;

  const displayName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ').trim();
  return res.status(201).json(
    envelope(true, {
      dataDir: trimmedDir,
      student: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        displayName,
      },
      filesCreated,
    })
  );
}

// Also mount signup on the onboarding router (so /api/onboarding/signup works too if needed)
router.post('/signup', signupHandler);

module.exports = router;
module.exports.signupHandler = signupHandler;
