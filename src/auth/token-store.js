/**
 * Secure token storage for OAuth 2.0 tokens
 *
 * Stores access and refresh tokens securely using OS keychain.
 * Falls back to local file storage when keychain is unavailable,
 * and supports environment variables for CI/headless environments.
 */

import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { debug, warn, error as logError } from '../logger.js';

// Keytar service name for pi-linear-tools
const KEYTAR_SERVICE = 'pi-linear-tools';

// Keytar account name
const KEYTAR_ACCOUNT = 'linear-oauth-tokens';

// In-memory fallback for environments without keychain
let inMemoryTokens = null;

// Lazy-loaded keytar module
let keytarModule = null;

function getTokenFilePath() {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
  return join(homeDir, '.pi', 'agent', 'extensions', 'pi-linear-tools', 'oauth-tokens.json');
}

function normalizeTokens(tokens, source = 'unknown') {
  if (!tokens || !tokens.accessToken || !tokens.refreshToken || !tokens.expiresAt) {
    logError(`Invalid token structure in ${source}`, { tokens });
    return null;
  }

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    scope: tokens.scope || [],
    tokenType: tokens.tokenType || 'Bearer',
  };
}

async function readTokensFromFile() {
  const tokenFilePath = getTokenFilePath();

  try {
    const content = await readFile(tokenFilePath, 'utf-8');
    const parsed = JSON.parse(content);
    const tokens = normalizeTokens(parsed, 'fallback token file');

    if (!tokens) {
      await unlink(tokenFilePath).catch(() => {});
      return null;
    }

    debug('Tokens retrieved from fallback token file', {
      path: tokenFilePath,
      expiresAt: new Date(tokens.expiresAt).toISOString(),
    });

    return tokens;
  } catch {
    return null;
  }
}

async function writeTokensToFile(tokenData) {
  const tokenFilePath = getTokenFilePath();
  const parentDir = dirname(tokenFilePath);

  await mkdir(parentDir, { recursive: true, mode: 0o700 });
  await writeFile(tokenFilePath, tokenData, { encoding: 'utf-8', mode: 0o600 });

  warn('Stored OAuth tokens in fallback file storage because keychain is unavailable', {
    path: tokenFilePath,
  });
}

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

  // Always keep the latest tokens in memory for this process.
  // This ensures refreshed tokens immediately override env-sourced tokens.
  inMemoryTokens = tokenData;

  // Persist to keychain when available
  if (useKeytar) {
    try {
      const result = await keytarModule.setPassword(
        KEYTAR_SERVICE,
        KEYTAR_ACCOUNT,
        tokenData
      );

      if (!result) {
        throw new Error('keytar.setPassword returned false');
      }

      // Clean up fallback file if keychain works again
      await unlink(getTokenFilePath()).catch(() => {});
    } catch (error) {
      warn('Failed to store tokens in keychain, falling back to file storage', {
        error: error.message,
      });
      await writeTokensToFile(tokenData);
    }
  } else {
    await writeTokensToFile(tokenData);
  }

  debug('Tokens stored successfully', {
    expiresAt: new Date(tokens.expiresAt).toISOString(),
    scope: tokens.scope,
  });
}

/**
 * Retrieve tokens from in-memory cache, environment variables, or keychain.
 *
 * Precedence is:
 * 1) in-memory cache (latest tokens in this process, e.g. after refresh)
 * 2) environment variables (CI/headless bootstrap)
 * 3) keychain
 *
 * @returns {Promise<TokenRecord|null>} Token record or null if not found
 */
export async function getTokens() {
  debug('Retrieving tokens');

  if (inMemoryTokens) {
    try {
      const parsed = JSON.parse(inMemoryTokens);
      const tokens = normalizeTokens(parsed, 'memory');

      if (!tokens) {
        inMemoryTokens = null;
      } else {
        debug('Tokens retrieved from in-memory storage', {
          expiresAt: new Date(tokens.expiresAt).toISOString(),
        });

        return tokens;
      }
    } catch (error) {
      logError('Invalid token JSON in memory', { error: error.message });
      inMemoryTokens = null;
    }
  }

  const envTokens = getTokensFromEnv();
  if (envTokens) {
    debug('Retrieved tokens from environment variables');
    return envTokens;
  }

  const useKeytar = await isKeytarAvailable();

  if (useKeytar) {
    try {
      const tokenData = await keytarModule.getPassword(
        KEYTAR_SERVICE,
        KEYTAR_ACCOUNT
      );

      if (tokenData) {
        const parsed = JSON.parse(tokenData);
        const tokens = normalizeTokens(parsed, 'keychain');

        if (!tokens) {
          await clearTokens(); // Clear corrupted tokens
          return null;
        }

        debug('Tokens retrieved successfully', {
          expiresAt: new Date(tokens.expiresAt).toISOString(),
          scope: tokens.scope,
        });

        return tokens;
      }

      debug('No tokens found in keychain');
    } catch (error) {
      warn('Failed to retrieve tokens from keychain, trying fallback storage', {
        error: error.message,
      });
    }
  }

  const fileTokens = await readTokensFromFile();
  if (fileTokens) {
    inMemoryTokens = JSON.stringify(fileTokens);
    return fileTokens;
  }

  debug('No tokens found');
  return null;
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

  // Clear fallback file storage
  await unlink(getTokenFilePath()).catch(() => {});

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