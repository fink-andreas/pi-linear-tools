/**
 * Linear SDK client factory
 *
 * Creates a configured LinearClient instance for interacting with Linear API.
 * Supports both API key and OAuth token authentication.
 */

import { LinearClient } from '@linear/sdk';
import { debug, warn, info } from './logger.js';

/** @type {Function|null} Test-only client factory override */
let _testClientFactory = null;

/** @type {Map<string, {remaining: number, resetAt: number}>} Per-client rate limit tracking */
const rateLimitTracker = new Map();

/** @type {Map<string, {total: number, success: number, failed: number, rateLimited: number, windowStart: number, lastSummaryAt: number}>} */
const requestMetrics = new Map();

/** Track globally if we've detected a rate limit error */
let globalRateLimited = false;
let globalRateLimitResetAt = null;

const REQUEST_SUMMARY_INTERVAL = 50;
const REQUEST_SUMMARY_MIN_MS = 15000;

function getTrackerKey(apiKey) {
  return apiKey || 'default';
}

function getTrackerKeyFromClient(client) {
  return client?.__piLinearTrackerKey || client?.apiKey || 'default';
}

function getRequestMetric(trackerKey) {
  let metric = requestMetrics.get(trackerKey);
  if (!metric) {
    metric = {
      total: 0,
      success: 0,
      failed: 0,
      rateLimited: 0,
      windowStart: Date.now(),
      lastSummaryAt: 0,
    };
    requestMetrics.set(trackerKey, metric);
  }
  return metric;
}

function maybeLogRequestSummary(trackerKey) {
  const metric = requestMetrics.get(trackerKey);
  const tracker = rateLimitTracker.get(trackerKey);
  if (!metric || !tracker) return;

  const now = Date.now();
  const shouldLogByCount = metric.total % REQUEST_SUMMARY_INTERVAL === 0;
  const shouldLogByTime = now - metric.lastSummaryAt >= REQUEST_SUMMARY_MIN_MS;

  if (!shouldLogByCount && !shouldLogByTime) return;

  metric.lastSummaryAt = now;
  const used = Math.max(0, 5000 - (tracker.remaining ?? 5000));

  info('[pi-linear-tools] Linear API usage summary', {
    trackerKey,
    requestsTotal: metric.total,
    requestsSuccess: metric.success,
    requestsFailed: metric.failed,
    requestsRateLimited: metric.rateLimited,
    requestsRemaining: tracker.remaining,
    requestsUsed: used,
    resetAt: tracker.resetAt,
    resetTime: tracker.resetAt ? new Date(tracker.resetAt).toLocaleTimeString() : null,
  });
}

function extractOperationName(query) {
  if (!query || typeof query !== 'string') return 'unknown';
  const compact = query.replace(/\s+/g, ' ').trim();
  const match = compact.match(/^(query|mutation)\s+([a-zA-Z0-9_]+)/i);
  return match?.[2] || 'anonymous';
}

/**
 * Clear rate limit state if the window has expired
 * @returns {{isRateLimited: boolean, resetAt: Date|null}}
 */
export function checkAndClearRateLimit() {
  if (!globalRateLimited || !globalRateLimitResetAt) {
    return { isRateLimited: false, resetAt: null };
  }

  // Check if rate limit window has passed
  if (Date.now() >= globalRateLimitResetAt) {
    globalRateLimited = false;
    globalRateLimitResetAt = null;
    return { isRateLimited: false, resetAt: null };
  }

  return { isRateLimited: true, resetAt: new Date(globalRateLimitResetAt) };
}

/**
 * @deprecated Use checkAndClearRateLimit() instead
 * @returns {{isRateLimited: boolean, resetAt: Date|null}}
 */
export function isGloballyRateLimited() {
  return checkAndClearRateLimit();
}

/**
 * Mark that we've hit the rate limit
 * @param {number} resetAt - Reset timestamp in milliseconds
 */
export function markRateLimited(resetAt) {
  globalRateLimited = true;
  globalRateLimitResetAt = resetAt;
  warn('[pi-linear-tools] Rate limit hit - will skip API calls until reset', {
    resetAt: new Date(resetAt).toLocaleTimeString(),
  });
}

/**
 * Extract rate limit info from SDK client response
 * The Linear SDK stores response metadata on the client after requests
 * @param {LinearClient} client - Linear SDK client
 * @returns {{remaining: number|null, resetAt: number|null, resetTime: string|null}}
 */
export function getClientRateLimit(client) {
  const trackerData = rateLimitTracker.get(getTrackerKeyFromClient(client));
  if (trackerData) {
    return {
      remaining: trackerData.remaining,
      resetAt: trackerData.resetAt,
      resetTime: trackerData.resetAt ? new Date(trackerData.resetAt).toLocaleTimeString() : null,
    };
  }

  return { remaining: null, resetAt: null, resetTime: null };
}

/**
 * Expose per-client request counters for diagnostics
 */
export function getClientRequestMetrics(client) {
  const key = getTrackerKeyFromClient(client);
  const metric = requestMetrics.get(key);
  if (!metric) {
    return {
      total: 0,
      success: 0,
      failed: 0,
      rateLimited: 0,
      windowStart: null,
    };
  }

  return {
    total: metric.total,
    success: metric.success,
    failed: metric.failed,
    rateLimited: metric.rateLimited,
    windowStart: metric.windowStart,
  };
}

/**
 * Check and warn about low rate limit for a client
 * Call this after making API requests to check if limits are getting low
 * @param {LinearClient} client - Linear SDK client
 * @returns {boolean} True if warning was issued
 */
export function checkAndWarnRateLimit(client) {
  const { remaining, resetTime } = getClientRateLimit(client);

  if (remaining !== null && remaining <= 500) {
    const usagePercent = Math.round(((5000 - remaining) / 5000) * 100);
    warn(`Linear API rate limit running low: ${remaining} requests remaining (~${usagePercent}% used). Resets at ${resetTime}`, {
      remaining,
      resetTime,
      usagePercent,
    });
    return true;
  }

  return false;
}

/**
 * Create a Linear SDK client with rate limit tracking
 *
 * Supports two authentication methods:
 * 1. API Key: Pass as string or { apiKey: '...' }
 * 2. OAuth Token: Pass as { accessToken: '...' }
 *
 * @param {string|object} auth - Authentication credential
 * @param {string} [auth.apiKey] - Linear API key (for API key auth)
 * @param {string} [auth.accessToken] - OAuth access token (for OAuth auth)
 * @returns {LinearClient} Configured Linear client
 */
export function createLinearClient(auth) {
  // Allow test override
  if (_testClientFactory) {
    return _testClientFactory(auth);
  }

  let clientConfig;
  let apiKey = null;

  // Handle different input formats
  if (typeof auth === 'string') {
    clientConfig = { apiKey: auth };
    apiKey = auth;
  } else if (typeof auth === 'object' && auth !== null) {
    if (auth.accessToken) {
      clientConfig = { apiKey: auth.accessToken };
      apiKey = auth.accessToken;
      debug('Creating Linear client with OAuth access token');
    } else if (auth.apiKey) {
      clientConfig = { apiKey: auth.apiKey };
      apiKey = auth.apiKey;
      debug('Creating Linear client with API key');
    } else {
      throw new Error('Auth object must contain either apiKey or accessToken');
    }
  } else {
    throw new Error('Invalid auth parameter: must be a string (API key) or an object with apiKey or accessToken');
  }

  const client = new LinearClient(clientConfig);

  const trackerKey = getTrackerKey(apiKey);
  client.__piLinearTrackerKey = trackerKey;
  if (!rateLimitTracker.has(trackerKey)) {
    rateLimitTracker.set(trackerKey, { remaining: 5000, resetAt: Date.now() + 3600000 });
  }
  getRequestMetric(trackerKey);

  // Wrap internal rawRequest to capture request counts + rate limit metadata
  const originalRawRequest = client.client.rawRequest.bind(client.client);
  client.client.rawRequest = async function wrappedRawRequest(query, variables, requestHeaders) {
    const metric = getRequestMetric(trackerKey);
    metric.total += 1;

    debug('[pi-linear-tools] Linear request', {
      trackerKey,
      requestNumber: metric.total,
      operation: extractOperationName(query),
    });

    try {
      const response = await originalRawRequest(query, variables, requestHeaders);
      metric.success += 1;

      if (response.headers) {
        const remaining = response.headers.get('X-RateLimit-Requests-Remaining');
        const resetAt = response.headers.get('X-RateLimit-Requests-Reset');

        const tracker = rateLimitTracker.get(trackerKey);
        if (tracker && remaining !== null) {
          tracker.remaining = parseInt(remaining, 10);
        }
        if (tracker && resetAt !== null) {
          tracker.resetAt = parseInt(resetAt, 10);
        }
      }

      const tracker = rateLimitTracker.get(trackerKey);
      if (tracker && tracker.remaining <= 500 && tracker.remaining > 0) {
        const usagePercent = Math.round(((5000 - tracker.remaining) / 5000) * 100);
        warn(`Linear API rate limit running low: ${tracker.remaining} requests remaining (~${usagePercent}% used). Resets at ${new Date(tracker.resetAt).toLocaleTimeString()}`, {
          remaining: tracker.remaining,
          resetTime: new Date(tracker.resetAt).toLocaleTimeString(),
          usagePercent,
        });
      }

      maybeLogRequestSummary(trackerKey);
      return response;
    } catch (error) {
      metric.failed += 1;

      const message = String(error?.message || error || 'unknown');
      const isRateLimited = error?.type === 'Ratelimited' || message.toLowerCase().includes('rate limit');

      if (isRateLimited) {
        metric.rateLimited += 1;
        const resetAt = Number(error?.requestsResetAt) || Date.now() + 3600000;
        const remaining = Number.isFinite(error?.requestsRemaining) ? error.requestsRemaining : 0;
        rateLimitTracker.set(trackerKey, {
          remaining,
          resetAt,
        });
        markRateLimited(resetAt);
      }

      maybeLogRequestSummary(trackerKey);
      throw error;
    }
  };

  return client;
}

/**
 * Set a mock client factory for testing (TEST ONLY)
 * @param {Function|null} factory - Factory function that returns a mock client
 */
export function setTestClientFactory(factory) {
  _testClientFactory = factory;
}

/**
 * Reset test client factory
 */
export function resetTestClientFactory() {
  _testClientFactory = null;
}
