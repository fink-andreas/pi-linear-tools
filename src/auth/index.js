/**
 * OAuth 2.0 authentication orchestrator for pi-linear-tools
 *
 * Orchestrates the complete OAuth flow including PKCE generation,
 * local callback server, token exchange, and storage.
 */

import { generatePkceParams } from './pkce.js';
import { buildAuthorizationUrl, exchangeCodeForToken } from './oauth.js';
import { waitForCallback } from './callback-server.js';
import { storeTokens, getTokens, clearTokens, hasValidTokens } from './token-store.js';
import { getValidAccessToken } from './token-refresh.js';
import { debug, info, warn, error as logError } from '../logger.js';

function parseManualCallbackInput(rawInput) {
  const value = String(rawInput || '').trim();
  if (!value) return null;

  if (value.startsWith('http://') || value.startsWith('https://')) {
    const parsed = new URL(value);
    return {
      code: parsed.searchParams.get('code'),
      state: parsed.searchParams.get('state'),
    };
  }

  if (value.includes('code=')) {
    const parsed = new URL(value.startsWith('?') ? `http://localhost/${value}` : `http://localhost/?${value}`);
    return {
      code: parsed.searchParams.get('code'),
      state: parsed.searchParams.get('state'),
    };
  }

  return { code: value, state: null };
}

/**
 * Perform the complete OAuth authentication flow
 *
 * This function:
 * 1. Generates PKCE parameters
 * 2. Starts a local callback server
 * 3. Opens the browser with the authorization URL
 * 4. Waits for the callback
 * 5. Exchanges the authorization code for tokens
 * 6. Stores the tokens securely
 *
 * @param {object} options - Authentication options
 * @param {Function} [options.openBrowser] - Function to open browser (default: use 'open' package)
 * @param {number} [options.port] - Port for callback server (default: 34711)
 * @param {number} [options.timeout] - Timeout for callback in milliseconds (default: 5 minutes)
 * @param {Function} [options.onAuthorizationUrl] - Optional callback invoked with the authorization URL
 * @param {Function} [options.manualCodeInput] - Optional async callback for manual callback URL/code input
 * @returns {Promise<object>} Authentication result with tokens
 * @throws {Error} If authentication fails
 */
export async function authenticate({
  openBrowser,
  port = 34711,
  timeout = 5 * 60 * 1000,
  onAuthorizationUrl,
  manualCodeInput,
} = {}) {
  debug('Starting OAuth authentication flow', { port, timeout });

  try {
    // Step 1: Generate PKCE parameters
    const pkceParams = generatePkceParams();
    debug('Generated PKCE parameters', {
      challengeLength: pkceParams.challenge.length,
      stateLength: pkceParams.state.length,
    });

    // Step 2: Build authorization URL
    const authUrl = buildAuthorizationUrl({
      challenge: pkceParams.challenge,
      state: pkceParams.state,
      redirectUri: `http://localhost:${port}/callback`,
    });

    debug('Built authorization URL');

    const abortController = new AbortController();

    // Step 3: Start callback server (this will wait for the callback)
    const callbackPromise = waitForCallback({
      expectedState: pkceParams.state,
      port,
      timeout,
      signal: abortController.signal,
    });

    if (typeof onAuthorizationUrl === 'function') {
      await onAuthorizationUrl(authUrl);
    }

    let shouldPromptManual = false;

    // Step 4: Open browser with authorization URL
    if (openBrowser) {
      await openBrowser(authUrl);
      info('Opening browser for authentication...');
    } else {
      // Default: use 'open' package if available
      try {
        const { default: open } = await import('open');
        await open(authUrl);
        info('Opening browser for authentication...');
      } catch (error) {
        warn('Failed to open browser automatically', { error: error.message });
        if (typeof onAuthorizationUrl !== 'function') {
          info('Please open the following URL in your browser:');
          console.log(authUrl);
        }
        shouldPromptManual = true;
      }
    }

    // Step 5: Wait for callback (or optional manual input fallback)
    info('Waiting for authentication callback...');

    let callback;
    if (typeof manualCodeInput === 'function' && shouldPromptManual) {
      const manualPromise = (async () => {
        const raw = await manualCodeInput({ authUrl, expectedState: pkceParams.state, port });
        const parsed = parseManualCallbackInput(raw);

        if (!parsed || !parsed.code) {
          throw new Error('OAuth authentication cancelled by user.');
        }

        if (parsed.state && parsed.state !== pkceParams.state) {
          throw new Error('State validation failed. Possible CSRF attack.');
        }

        return { code: parsed.code, state: parsed.state || pkceParams.state };
      })();

      callback = await Promise.race([callbackPromise, manualPromise]);
      abortController.abort();
    } else {
      callback = await callbackPromise;
    }

    debug('Received callback', { hasCode: !!callback.code });

    // Step 6: Exchange code for tokens
    info('Exchanging authorization code for tokens...');
    const tokenResponse = await exchangeCodeForToken({
      code: callback.code,
      verifier: pkceParams.verifier,
      redirectUri: `http://localhost:${port}/callback`,
    });

    debug('Token exchange successful');

    // Step 7: Store tokens securely
    const expiresAt = Date.now() + tokenResponse.expires_in * 1000;
    const tokens = {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresAt: expiresAt,
      scope: tokenResponse.scope ? tokenResponse.scope.split(' ') : [],
      tokenType: tokenResponse.token_type || 'Bearer',
    };

    await storeTokens(tokens);
    debug('Tokens stored successfully');

    info('Authentication successful!');
    info(`Token expires at: ${new Date(expiresAt).toISOString()}`);

    return tokens;
  } catch (error) {
    logError('OAuth authentication failed', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Get a valid access token, refreshing if necessary
 *
 * @returns {Promise<string|null>} Valid access token or null if not authenticated
 */
export async function getAccessToken() {
  return getValidAccessToken(getTokens);
}

/**
 * Check if the user is authenticated
 *
 * @returns {Promise<boolean>} True if authenticated with valid tokens
 */
export async function isAuthenticated() {
  return hasValidTokens();
}

/**
 * Get authentication status
 *
 * @returns {Promise<object|null>} Authentication status or null if not authenticated
 */
export async function getAuthStatus() {
  const tokens = await getTokens();

  if (!tokens) {
    return null;
  }

  const now = Date.now();
  const isExpired = now >= tokens.expiresAt;

  return {
    authenticated: !isExpired,
    expiresAt: new Date(tokens.expiresAt).toISOString(),
    expiresIn: Math.max(0, tokens.expiresAt - now),
    scopes: tokens.scope,
  };
}

/**
 * Logout (clear stored tokens)
 *
 * @returns {Promise<void>}
 */
export async function logout() {
  info('Logging out...');
  await clearTokens();
  info('Logged out successfully');
}

/**
 * Re-authenticate (logout and then authenticate)
 *
 * @param {object} options - Authentication options (passed to authenticate())
 * @returns {Promise<object>} Authentication result with tokens
 */
export async function reAuthenticate(options) {
  info('Re-authenticating...');
  await logout();
  return authenticate(options);
}