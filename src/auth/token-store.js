/**
 * Secure token storage for OAuth 2.0 tokens
 *
 * Stores access and refresh tokens securely using OS keychain.
 * Falls back to environment variables for CI/headless environments.
 */

import { debug, warn, error as logError } from '../logger.js';

// Keytar service name for pi-linear-tools
const KEYTAR_SERVICE = 'pi-linear-tools';

// Keytar account name
const KEYTAR_ACCOUNT = 'linear-oauth-tokens';

// In-memory fallback for environments without keychain
let inMemoryTokens = null;

// Lazy-loaded keytar module
let keytarModule = null;

/**
 * Check if keytar is available
 *
 * @returns {boolean} True if keytar is available
 */
async function isKeytarAvailable() {
  if (keytarModule !== null) {
    return keytarModule !== false;
  }

  try {
    const module = await import('keytar');
    keytarModule = module.default;
    debug('keytar module loaded successfully');
    return true;
  } catch (error) {
    warn('keytar module not available, using fallback storage', { error: error.message });
    keytarModule = false;
    return false;
  }
}

/**
 * Store tokens securely in OS keychain or in-memory fallback
 *
 * @param {TokenRecord} tokens - Token record to store
 * @returns {Promise<void>}
 * @throws {Error} If storage fails
 */
export async function storeTokens(tokens) {
  const useKeytar = await isKeytarAvailable();
  debug('Storing tokens', { method: useKeytar ? 'keychain' : 'in-memory' });

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

  // Store in keychain or fallback to memory
  if (useKeytar) {
    const result = await keytarModule.setPassword(
      KEYTAR_SERVICE,
      KEYTAR_ACCOUNT,
      tokenData
    );

    if (!result) {
      throw new Error('keytar.setPassword returned false');
    }
  } else {
    // Fallback to in-memory storage
    inMemoryTokens = tokenData;
    warn('Using in-memory token storage (not persistent across sessions)');
  }

  debug('Tokens stored successfully', {
    expiresAt: new Date(tokens.expiresAt).toISOString(),
    scope: tokens.scope,
  });
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

  // Fall back to keychain or in-memory storage
  const useKeytar = await isKeytarAvailable();

  if (useKeytar) {
    try {
      const tokenData = await keytarModule.getPassword(
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
  } else if (inMemoryTokens) {
    // Use in-memory fallback
    const tokens = JSON.parse(inMemoryTokens);

    // Validate token structure
    if (!tokens.accessToken || !tokens.refreshToken || !tokens.expiresAt) {
      logError('Invalid token structure in memory', { tokens });
      inMemoryTokens = null;
      return null;
    }

    debug('Tokens retrieved from in-memory storage', {
      expiresAt: new Date(tokens.expiresAt).toISOString(),
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scope: tokens.scope,
      tokenType: tokens.tokenType || 'Bearer',
    };
  } else {
    debug('No tokens found');
    return null;
  }
}

/**
 * Clear tokens from OS keychain or in-memory storage
 *
 * @returns {Promise<void>}
 */
export async function clearTokens() {
  debug('Clearing tokens');

  const useKeytar = await isKeytarAvailable();

  if (useKeytar) {
    try {
      const result = await keytarModule.deletePassword(
        KEYTAR_SERVICE,
        KEYTAR_ACCOUNT
      );

      if (result) {
        debug('Tokens cleared successfully from keychain');
      } else {
        debug('No tokens to clear from keychain');
      }
    } catch (error) {
      logError('Failed to clear tokens', {
        error: error.message,
        stack: error.stack,
      });
      // Don't throw - clearing is best-effort
    }
  }

  // Clear in-memory tokens
  inMemoryTokens = null;
  debug('In-memory tokens cleared');
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