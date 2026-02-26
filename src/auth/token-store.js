/**
 * Secure token storage for OAuth 2.0 tokens
 *
 * Stores access and refresh tokens securely using OS keychain.
 * Falls back to environment variables for CI/headless environments.
 */

import keytar from 'keytar';
import { debug, warn, error as logError } from '../logger.js';

// Keytar service name for pi-linear-tools
const KEYTAR_SERVICE = 'pi-linear-tools';

// Keytar account name
const KEYTAR_ACCOUNT = 'linear-oauth-tokens';

/**
 * Token record structure
 *
 * @typedef {object} TokenRecord
 * @property {string} accessToken - OAuth access token
 * @property {string} refreshToken - OAuth refresh token
 * @property {number} expiresAt - Token expiry timestamp (Unix milliseconds)
 * @property {string[]} scope - Granted OAuth scopes
 * @property {string} [tokenType] - Token type (usually "Bearer")
 */

/**
 * Store tokens securely in OS keychain
 *
 * @param {TokenRecord} tokens - Token record to store
 * @returns {Promise<void>}
 * @throws {Error} If storage fails
 */
export async function storeTokens(tokens) {
  debug('Storing tokens in keychain');

  try {
    // Validate token structure
    if (!tokens.accessToken) {
      throw new Error('Missing accessToken in token record');
    }

    if (!tokens.refreshToken) {
      throw new Error('Missing refreshToken in token record');
    }

    if (!tokens.expiresAt || typeof tokens.expiresAt !== 'number') {
      throw new Error('Missing or invalid expiresAt in token record');
    }

    // Serialize tokens to JSON
    const tokenData = JSON.stringify({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scope: tokens.scope || [],
      tokenType: tokens.tokenType || 'Bearer',
    });

    // Store in keychain
    const result = await keytar.setPassword(
      KEYTAR_SERVICE,
      KEYTAR_ACCOUNT,
      tokenData
    );

    if (!result) {
      throw new Error('keytar.setPassword returned false');
    }

    debug('Tokens stored successfully', {
      expiresAt: new Date(tokens.expiresAt).toISOString(),
      scope: tokens.scope,
    });
  } catch (error) {
    logError('Failed to store tokens', {
      error: error.message,
      stack: error.stack,
    });
    throw new Error(`Failed to store tokens: ${error.message}`);
  }
}

/**
 * Retrieve tokens from OS keychain or environment variables
 *
 * Checks environment variables first (for CI/headless environments),
 * then falls back to keychain storage.
 *
 * @returns {Promise<TokenRecord|null>} Token record or null if not found
 */
export async function getTokens() {
  debug('Retrieving tokens');

  // First, check environment variables (for CI/headless environments)
  const envTokens = getTokensFromEnv();
  if (envTokens) {
    debug('Retrieved tokens from environment variables');
    return envTokens;
  }

  // Fall back to keychain
  try {
    const tokenData = await keytar.getPassword(
      KEYTAR_SERVICE,
      KEYTAR_ACCOUNT
    );

    if (!tokenData) {
      debug('No tokens found in keychain');
      return null;
    }

    const tokens = JSON.parse(tokenData);

    // Validate token structure
    if (!tokens.accessToken || !tokens.refreshToken || !tokens.expiresAt) {
      logError('Invalid token structure in keychain', { tokens });
      await clearTokens(); // Clear corrupted tokens
      return null;
    }

    debug('Tokens retrieved successfully', {
      expiresAt: new Date(tokens.expiresAt).toISOString(),
      scope: tokens.scope,
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scope: tokens.scope,
      tokenType: tokens.tokenType || 'Bearer',
    };
  } catch (error) {
    logError('Failed to retrieve tokens', {
      error: error.message,
      stack: error.stack,
    });
    return null;
  }
}

/**
 * Clear tokens from OS keychain
 *
 * @returns {Promise<void>}
 */
export async function clearTokens() {
  debug('Clearing tokens from keychain');

  try {
    const result = await keytar.deletePassword(
      KEYTAR_SERVICE,
      KEYTAR_ACCOUNT
    );

    if (result) {
      debug('Tokens cleared successfully');
    } else {
      debug('No tokens to clear');
    }
  } catch (error) {
    logError('Failed to clear tokens', {
      error: error.message,
      stack: error.stack,
    });
    // Don't throw - clearing is best-effort
  }
}

/**
 * Get tokens from environment variables
 *
 * For CI/headless environments where keychain is unavailable.
 *
 * Required environment variables:
 * - LINEAR_ACCESS_TOKEN: OAuth access token
 * - LINEAR_REFRESH_TOKEN: OAuth refresh token
 * - LINEAR_EXPIRES_AT: Token expiry timestamp (milliseconds since epoch)
 *
 * @returns {TokenRecord|null} Token record or null if env vars not set
 */
function getTokensFromEnv() {
  const accessToken = process.env.LINEAR_ACCESS_TOKEN;
  const refreshToken = process.env.LINEAR_REFRESH_TOKEN;
  const expiresAtStr = process.env.LINEAR_EXPIRES_AT;

  if (!accessToken || !refreshToken || !expiresAtStr) {
    return null;
  }

  const expiresAt = parseInt(expiresAtStr, 10);
  if (isNaN(expiresAt)) {
    warn('Invalid LINEAR_EXPIRES_AT value in environment');
    return null;
  }

  return {
    accessToken,
    refreshToken,
    expiresAt,
    scope: ['read', 'issues:create', 'comments:create'], // Assume default scopes
    tokenType: 'Bearer',
  };
}

/**
 * Check if tokens exist and are not expired
 *
 * @returns {Promise<boolean>} True if valid tokens exist
 */
export async function hasValidTokens() {
  const tokens = await getTokens();

  if (!tokens) {
    return false;
  }

  // Check if token is expired (with 60-second buffer)
  const now = Date.now();
  const isExpired = now >= tokens.expiresAt - 60000;

  if (isExpired) {
    debug('Tokens are expired', {
      expiresAt: new Date(tokens.expiresAt).toISOString(),
      now: new Date(now).toISOString(),
    });
    return false;
  }

  return true;
}

/**
 * Check if token needs refresh
 *
 * @param {TokenRecord} tokens - Token record to check
 * @param {number} [bufferSeconds=60] - Buffer in seconds before expiry
 * @returns {boolean} True if token needs refresh
 */
export function needsRefresh(tokens, bufferSeconds = 60) {
  const now = Date.now();
  const bufferMs = bufferSeconds * 1000;
  const needsRefresh = now >= tokens.expiresAt - bufferMs;

  if (needsRefresh) {
    debug('Token needs refresh', {
      expiresAt: new Date(tokens.expiresAt).toISOString(),
      now: new Date(now).toISOString(),
      bufferSeconds,
    });
  }

  return needsRefresh;
}

/**
 * Get access token from storage, with optional refresh
 *
 * @param {Function} refreshFn - Optional refresh function that returns new tokens
 * @returns {Promise<string|null>} Access token or null if not available
 */
export async function getAccessToken(refreshFn) {
  const tokens = await getTokens();

  if (!tokens) {
    return null;
  }

  // Check if token needs refresh
  if (needsRefresh(tokens)) {
    if (refreshFn) {
      debug('Token needs refresh, calling refresh function');
      try {
        const newTokens = await refreshFn(tokens.refreshToken);
        await storeTokens(newTokens);
        return newTokens.accessToken;
      } catch (error) {
        logError('Failed to refresh token', { error: error.message });
        return null;
      }
    } else {
      debug('Token needs refresh but no refresh function provided');
      return tokens.accessToken; // Return expired token, caller should handle
    }
  }

  return tokens.accessToken;
}