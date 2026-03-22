/**
 * Linear SDK client factory
 *
 * Creates a configured LinearClient instance for interacting with Linear API.
 * Supports both API key and OAuth token authentication.
 */

import { LinearClient } from '@linear/sdk';
import { debug, warn, error as logError } from './logger.js';

/** @type {Function|null} Test-only client factory override */
let _testClientFactory = null;

/** @type {Map<string, {remaining: number, resetAt: number}>} Per-client rate limit tracking */
const rateLimitTracker = new Map();

/** Track globally if we've detected a rate limit error */
let globalRateLimited = false;
let globalRateLimitResetAt = null;

/**
 * Check if we know we're rate limited and should skip API calls
 * @returns {{isRateLimited: boolean, resetAt: Date|null}}
 */
export function isGloballyRateLimited() {
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
  // Try to get from tracker first
  const trackerData = rateLimitTracker.get(client.apiKey || 'default');
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
    // Legacy: API key passed as string
    clientConfig = { apiKey: auth };
    apiKey = auth;
  } else if (typeof auth === 'object' && auth !== null) {
    // Object format: { apiKey: '...' } or { accessToken: '...' }
    if (auth.accessToken) {
      clientConfig = { apiKey: auth.accessToken };
      apiKey = auth.accessToken;
      debug('Creating Linear client with OAuth access token');
    } else if (auth.apiKey) {
      clientConfig = { apiKey: auth.apiKey };
      apiKey = auth.apiKey;
      debug('Creating Linear client with API key');
    } else {
      throw new Error(
        'Auth object must contain either apiKey or accessToken'
      );
    }
  } else {
    throw new Error(
      'Invalid auth parameter: must be a string (API key) or an object with apiKey or accessToken'
    );
  }

  const client = new LinearClient(clientConfig);

  // Initialize rate limit tracking for this client
  const trackerKey = apiKey || 'default';
  if (!rateLimitTracker.has(trackerKey)) {
    rateLimitTracker.set(trackerKey, { remaining: 5000, resetAt: Date.now() + 3600000 });
  }

  // Wrap the rawRequest to capture rate limit headers
  // rawRequest is on client.client (internal GraphQL client)
  const originalRawRequest = client.client.rawRequest.bind(client.client);
  client.client.rawRequest = async function wrappedRawRequest(query, variables, requestHeaders) {
    const response = await originalRawRequest(query, variables, requestHeaders);

    // Extract rate limit headers from response
    if (response.headers) {
      const remaining = response.headers.get('X-RateLimit-Requests-Remaining');
      const resetAt = response.headers.get('X-RateLimit-Requests-Reset');

      if (remaining !== null) {
        const tracker = rateLimitTracker.get(trackerKey);
        if (tracker) {
          tracker.remaining = parseInt(remaining, 10);
        }
      }
      if (resetAt !== null) {
        const tracker = rateLimitTracker.get(trackerKey);
        if (tracker) {
          tracker.resetAt = parseInt(resetAt, 10);
        }
      }
    }

    // Check if we should warn about low rate limits
    const tracker = rateLimitTracker.get(trackerKey);
    if (tracker && tracker.remaining <= 500 && tracker.remaining > 0) {
      const usagePercent = Math.round(((5000 - tracker.remaining) / 5000) * 100);
      warn(`Linear API rate limit running low: ${tracker.remaining} requests remaining (~${usagePercent}% used). Resets at ${new Date(tracker.resetAt).toLocaleTimeString()}`, {
        remaining: tracker.remaining,
        resetTime: new Date(tracker.resetAt).toLocaleTimeString(),
        usagePercent,
      });
    }

    return response;
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
