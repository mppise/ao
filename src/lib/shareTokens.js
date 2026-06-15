'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeJSON, readJSON } = require('../utils/file-io');

/**
 * Get path to .shares.json
 */
function sharesPath(dataDir) {
  return path.join(dataDir, '.shares.json');
}

/**
 * Read .shares.json, return { tokens: [] } if missing.
 */
function readShares(dataDir) {
  const p = sharesPath(dataDir);
  try {
    return readJSON(p);
  } catch (_) {
    return { tokens: [] };
  }
}

/**
 * Write .shares.json atomically.
 */
function writeShares(dataDir, data) {
  const p = sharesPath(dataDir);
  writeJSON(p, data);
}

/**
 * Generate a new share token and persist it.
 * @param {string} dataDir
 * @param {number} durationDays — 1–30
 * @returns {{ token, createdAt, expiresAt, accessCount, lastAccessedAt, revoked }}
 */
function createToken(dataDir, durationDays) {
  const token = crypto.randomBytes(16).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

  const entry = {
    token,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    accessCount: 0,
    lastAccessedAt: null,
    revoked: false,
  };

  const shares = readShares(dataDir);
  shares.tokens.push(entry);
  writeShares(dataDir, shares);
  return entry;
}

/**
 * Find a token entry by token string.
 */
function findToken(dataDir, token) {
  const shares = readShares(dataDir);
  return shares.tokens.find((t) => t.token === token) || null;
}

/**
 * Revoke a token by token string. Returns the updated entry, or null if not found.
 */
function revokeToken(dataDir, token) {
  const shares = readShares(dataDir);
  const idx = shares.tokens.findIndex((t) => t.token === token);
  if (idx === -1) return null;
  shares.tokens[idx].revoked = true;
  writeShares(dataDir, shares);
  return shares.tokens[idx];
}

/**
 * Increment accessCount and update lastAccessedAt for a token.
 * Fire-and-forget safe — swallows errors.
 */
function incrementAccess(dataDir, token) {
  try {
    const shares = readShares(dataDir);
    const idx = shares.tokens.findIndex((t) => t.token === token);
    if (idx === -1) return;
    shares.tokens[idx].accessCount = (shares.tokens[idx].accessCount || 0) + 1;
    shares.tokens[idx].lastAccessedAt = new Date().toISOString();
    writeShares(dataDir, shares);
  } catch (_) {
    /* fire-and-forget */
  }
}

/**
 * Return all token entries, with constructed URL added.
 */
function listTokens(dataDir, baseUrl) {
  const shares = readShares(dataDir);
  return shares.tokens.map((t) => ({
    ...t,
    url: `${baseUrl}/share/${t.token}`,
  }));
}

module.exports = { createToken, findToken, revokeToken, incrementAccess, listTokens, readShares };
