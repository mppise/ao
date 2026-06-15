#!/usr/bin/env node
'use strict';

const path = require('path');

// Load config (reads .env from project root)
let config;
try {
  config = require('../src/config/index');
  config.validate();
} catch (err) {
  console.error('\n[AO] Startup failed:\n' + err.message);
  console.error('\nPlease copy .env.example to .env and fill in GEMINI_API_KEY and GEMINI_MODEL.\n');
  process.exit(1);
}

const app = require('../src/server/index');

const port = config.port || 3000;
const host = '127.0.0.1';

const server = app.listen(port, host, () => {
  const url = `http://localhost:${port}`;
  console.log(`\nAO is running at ${url}. Press Ctrl+C to stop.\n`);
  openBrowser(url);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[AO] Port ${port} is in use. Set PORT= in .env to use a different port.\n`);
  } else {
    console.error(`\n[AO] Server error: ${err.message}\n`);
  }
  process.exit(1);
});

/**
 * Open the default system browser to the given URL.
 * @param {string} url
 */
function openBrowser(url) {
  const { exec } = require('child_process');
  const platform = process.platform;

  let cmd;
  if (platform === 'darwin') {
    cmd = `open "${url}"`;
  } else if (platform === 'win32') {
    cmd = `start "" "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }

  exec(cmd, (err) => {
    if (err) {
      console.warn(`[AO] Could not open browser automatically. Visit ${url} manually.`);
    }
  });
}
