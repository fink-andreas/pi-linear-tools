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

/**
 * Create a Linear SDK client
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

  // Handle different input formats
  if (typeof auth === 'string') {
    // Legacy: API key passed as string
    clientConfig = { apiKey: auth };
  } else if (typeof auth === 'object' && auth !== null) {
    // Object format: { apiKey: '...' } or { accessToken: '...' }
    if (auth.accessToken) {
      clientConfig = { apiKey: auth.accessToken };
      debug('Creating Linear client with OAuth access token');
    } else if (auth.apiKey) {
      clientConfig = { apiKey: auth.apiKey };
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

  return new LinearClient(clientConfig);
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
