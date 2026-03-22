/**
 * PKCE (Proof Key for Code Exchange) helpers for OAuth 2.0
 *
 * Implements the PKCE extension as specified in RFC 7636.
 * Used for secure OAuth authentication without client_secret (public client).
 */

import crypto from 'node:crypto';
import { debug, warn, error as logError } from '../logger.js';

/**
 * Generate a random code verifier for PKCE (RFC 7636: 43-128 chars, base64url)
 * @returns {string} Code verifier
 */
export function generateCodeVerifier() {
  // 32 bytes = ~43 base64url characters
  const verifier = crypto.randomBytes(32).toString('base64url');
  debug('Generated code verifier', { length: verifier.length });
  return verifier;
}

/**
 * Generate a code challenge from verifier (SHA-256, S256 method)
 * @param {string} verifier - Code verifier
 * @returns {string} Code challenge
 */
export function generateCodeChallenge(verifier) {
  const challenge = crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url');
  debug('Generated code challenge', { challengeLength: challenge.length });
  return challenge;
}

/**
 * Generate a random state parameter for CSRF protection
 * @returns {string} Hex-encoded state
 */
export function generateState() {
  const state = crypto.randomBytes(16).toString('hex');
  debug('Generated state parameter', { state });
  return state;
}

/**
 * Validate OAuth callback state matches expected
 * @param {string} receivedState - From callback
 * @param {string} expectedState - Generated at flow start
 * @returns {boolean} True if match
 */
export function validateState(receivedState, expectedState) {
  const isValid = receivedState === expectedState;
  if (!isValid) {
    debug('State validation failed', { received: receivedState, expected: expectedState });
  }
  return isValid;
}

/**
 * Generate all PKCE parameters for OAuth flow
 * @returns {{verifier: string, challenge: string, state: string}}
 */
export function generatePkceParams() {
  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  const state = generateState();
  debug('Generated PKCE parameters', {
    verifierLength: verifier.length,
    challengeLength: challenge.length,
    stateLength: state.length,
  });
  return { verifier, challenge, state };
}
