'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Static files
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
const onboardingRouter = require('./routes/onboarding');
const profileRouter = require('./routes/profile');

// /api/onboarding/status, /api/onboarding/defaults
app.use('/api/onboarding', onboardingRouter);

// /api/signup (top-level — called from Screen 3)
const { signupHandler } = require('./routes/onboarding');
app.post('/api/signup', signupHandler);

// /api/profile/sections, /api/profile/academic/add, etc.
app.use('/api/profile', profileRouter);

// /api/settings, /api/settings/key, POST /api/settings, /api/settings/export
const settingsRouter = require('./routes/settings');
app.use('/api/settings', settingsRouter);

// /api/documents/upload, /api/documents/pending, /api/documents/confirm, /api/documents/:id
const documentsRouter = require('./routes/documents');
app.use('/api/documents', documentsRouter);

// /api/impact-statements/* — impact statement generation and management
const impactStatementsRouter = require('./routes/impact-statements');
app.use('/api/impact-statements', impactStatementsRouter);

// /api/export/json, /api/export/pdf
const exportRouter = require('./routes/export');
app.use('/api/export', exportRouter);

// /api/share/generate, /api/share/list, DELETE /api/share/:token
const shareRouter = require('./routes/share');
app.use('/api/share', shareRouter);

// GET /share/:token — public read-only profile view (not under /api/)
app.get('/share/:token', ...shareRouter.publicShareHandler);

// /api/essays/generate, /api/essays/save, GET /api/essays, PUT/DELETE /api/essays/:id
const essaysRouter = require('./routes/essays');
app.use('/api/essays', essaysRouter);

// /api/config/limits — GET returns current limits; POST saves new limits
const configLimitsRouter = require('./routes/config-limits');
app.use('/api/config/limits', configLimitsRouter);

// SPA fallback: serve index.html for all non-API GET routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      success: false,
      data: null,
      error: { code: 'NOT_FOUND', message: 'Endpoint not found.' },
      timestamp: new Date().toISOString(),
    });
  }
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[server] unhandled error:', err.message);
  res.status(500).json({
    success: false,
    data: null,
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
    timestamp: new Date().toISOString(),
  });
});

module.exports = app;
