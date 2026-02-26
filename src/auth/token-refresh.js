/**
 * Token refresh manager with single-flight locking
 *
 * Manages OAuth token refresh with protection against race conditions.
 * Uses a Promise-based lock to ensure only one refresh happens at a time.
 */

import { refreshAccessToken } from './oauth.js';
import { storeTokens, clearTokens } from './token-store.js';
import { debug, warn, error as logError } from '../logger.js';

/**
 * Token refresh manager class
 *
 * Implements single-flight locking to prevent concurrent refresh attempts
 * that could invalidate tokens due to Linear's refresh token rotation.
 */
class TokenRefreshManager {
  constructor() {
    /** @type {boolean} Is a refresh currently in progress? */
    this.isRefreshing = false;

    /** @type {Promise<string>|null} The current refresh promise */
    this.refreshPromise = null;
  }

  /**
   * Refresh the access token using the refresh token
   *
   * Implements single-flight locking: if a refresh is already in progress,
   * this method will wait for the existing refresh to complete and return
   * the new access token.
   *
   * @param {string} refreshToken - The refresh token to use
   * @returns {Promise<string>} New access token
   * @throws {Error} If refresh fails
   */
  async refresh(refreshToken) {
    // If a refresh is already in progress, wait for it
    if (this.isRefreshing && this.refreshPromise) {
      debug('Refresh already in progress, waiting for existing refresh');
      try {
        return await this.refreshPromise;
      } catch (error) {
        // If the existing refresh failed, throw the error
        throw error;
      }
    }

    // Start a new refresh
    this.isRefreshing = true;

    this.refreshPromise = (async () => {
      try {
        debug('Starting token refresh');

        // Call Linear's token endpoint
        const tokenResponse = await refreshAccessToken(refreshToken);

        // Calculate expiry timestamp
        const expiresAt = Date.now() + tokenResponse.expires_in * 1000;

        // Store new tokens atomically
        const newTokens = {
          accessToken: tokenResponse.access_token,
          refreshToken: tokenResponse.refresh_token,
          expiresAt: expiresAt,
          scope: tokenResponse.scope ? tokenResponse.scope.split(' ') : [],
          tokenType: tokenResponse.token_type || 'Bearer',
        };

        await storeTokens(newTokens);

        debug('Token refresh successful', {
          expiresAt: new Date(expiresAt).toISOString(),
        });

        return newTokens.accessToken;
      } catch (error) {
        logError('Token refresh failed', {
          error: error.message,
          stack: error.stack,
        });

        // Handle invalid_grant error - refresh token expired or revoked
        if (error.message.includes('invalid_grant')) {
          warn('Refresh token expired or revoked, clearing tokens');
          await clearTokens();
        }

        throw error;
      } finally {
        // Reset the lock
        this.isRefreshing = false;
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  /**
   * Check if a refresh is currently in progress
   *
   * @returns {boolean} True if a refresh is in progress
   */
  isRefreshInProgress() {
    return this.isRefreshing;
  }

  /**
   * Reset the refresh manager state
   *
   * This is mainly for testing purposes.
   */
  reset() {
    debug('Resetting token refresh manager');
    this.isRefreshing = false;
    this.refreshPromise = null;
  }
}

// Create singleton instance
const refreshManager = new TokenRefreshManager();

/**
 * Refresh the access token using the refresh token
 *
 * This function uses a singleton TokenRefreshManager to ensure
 * single-flight locking across all calls.
 *
 * @param {string} refreshToken - The refresh token to use
 * @returns {Promise<string>} New access token
 * @throws {Error} If refresh fails
 */
export async function refreshTokens(refreshToken) {
  return refreshManager.refresh(refreshToken);
}

/**
 * Check if a token refresh is currently in progress
 *
 * @returns {boolean} True if a refresh is in progress
 */
export function isRefreshing() {
  return refreshManager.isRefreshInProgress();
}

/**
 * Reset the token refresh manager
 *
 * This is mainly for testing purposes.
 */
export function resetRefreshManager() {
  refreshManager.reset();
}

/**
 * Get a valid access token, refreshing if necessary
 *
 * This is a convenience function that combines token retrieval
 * and refresh logic.
 *
 * @param {Function} getTokensFn - Function to retrieve current tokens
 * @param {number} [bufferSeconds=60] - Seconds before expiry to trigger refresh
 * @returns {Promise<string|null>} Valid access token or null if not available
 */
export async function getValidAccessToken(
  getTokensFn,
  bufferSeconds = 60
) {
  // Get current tokens
  const tokens = await getTokensFn();

  if (!tokens) {
    debug('No tokens available');
    return null;
  }

  const now = Date.now();
  const bufferMs = bufferSeconds * 1000;
  const expiresAt = tokens.expiresAt;

  // Check if token is still valid (with buffer)
  if (now < expiresAt - bufferMs) {
    debug('Token is still valid', {
      expiresAt: new Date(expiresAt).toISOString(),
      now: new Date(now).toISOString(),
      bufferSeconds,
    });
    return tokens.accessToken;
  }

  // Token needs refresh
  debug('Token needs refresh', {
    expiresAt: new Date(expiresAt).toISOString(),
    now: new Date(now).toISOString(),
    bufferSeconds,
  });

  try {
    const newAccessToken = await refreshTokens(tokens.refreshToken);
    return newAccessToken;
  } catch (error) {
    logError('Failed to get valid access token', {
      error: error.message,
    });
    return null;
  }
}