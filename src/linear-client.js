/**
 * Linear SDK client factory
 *
 * Creates a configured LinearClient instance for interacting with Linear API.
 */

import { LinearClient } from '@linear/sdk';

/** @type {Function|null} Test-only client factory override */
let _testClientFactory = null;

/**
 * Create a Linear SDK client
 * @param {string} apiKey - Linear API key
 * @returns {LinearClient} Configured Linear client
 */
export function createLinearClient(apiKey) {
  // Allow test override
  if (_testClientFactory) {
    return _testClientFactory(apiKey);
  }

  if (!apiKey || typeof apiKey !== 'string') {
    throw new Error('Linear API key is required');
  }

  return new LinearClient({ apiKey });
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
