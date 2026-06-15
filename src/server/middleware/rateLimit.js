'use strict';

/**
 * Simple in-memory rate limiter.
 * counters: Map<ip, { count, windowStart }>
 */

const counters = new Map();

/**
 * Create a rate limit middleware.
 * @param {number} maxRequests
 * @param {number} windowMs
 * @returns Express middleware
 */
function createRateLimiter(maxRequests, windowMs) {
  return function rateLimitMiddleware(req, res, next) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    if (!counters.has(ip)) {
      counters.set(ip, { count: 0, windowStart: now });
    }

    const entry = counters.get(ip);
    if (now - entry.windowStart > windowMs) {
      entry.count = 0;
      entry.windowStart = now;
    }

    entry.count++;

    if (entry.count > maxRequests) {
      return res.status(429).json({
        success: false,
        data: null,
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait and try again.' },
        timestamp: new Date().toISOString(),
      });
    }

    next();
  };
}

// Pre-built limiters
const shareGenerateRateLimit = createRateLimiter(20, 5 * 60 * 1000);   // 20/5min
const shareViewRateLimit = createRateLimiter(60, 60 * 1000);            // 60/min

module.exports = { createRateLimiter, shareGenerateRateLimit, shareViewRateLimit };
