/**
 * OAuth 2.0 client for Linear authentication
 *
 * Implements OAuth 2.0 Authorization Code flow with PKCE for Linear.
 * Uses public client mode (no client_secret).
 */

import { debug, warn, error as logError } from '../logger.js';

// OAuth configuration
const OAUTH_CONFIG = {
  // Linear OAuth endpoints
  authUrl: 'https://linear.app/oauth/authorize',
  tokenUrl: 'https://api.linear.app/oauth/token',
  revokeUrl: 'https://api.linear.app/oauth/revoke',

  // Client configuration
  clientId: 'a3e177176c6697611367f1a2405d4a34',
  redirectUri: 'http://localhost:34711/callback',

  // OAuth scopes - minimal required scopes
  scopes: ['read', 'issues:create', 'comments:create'],

  // Prompt consent to allow workspace reselection
  prompt: 'consent',
};

/**
 * Build the OAuth authorization URL
 *
 * @param {object} params - OAuth parameters
 * @param {string} params.challenge - PKCE code challenge
 * @param {string} params.state - CSRF state parameter
 * @param {string} [params.redirectUri] - Optional override for redirect URI
 * @param {string} [params.scopes] - Optional override for scopes
 * @returns {string} Complete authorization URL
 */
export function buildAuthorizationUrl({
  challenge,
  state,
  redirectUri = OAUTH_CONFIG.redirectUri,
  scopes = OAUTH_CONFIG.scopes,
}) {
  const url = new URL(OAUTH_CONFIG.authUrl);

  // Required OAuth parameters
  url.searchParams.append('client_id', OAUTH_CONFIG.clientId);
  url.searchParams.append('redirect_uri', redirectUri);
  url.searchParams.append('response_type', 'code');
  url.searchParams.append('scope', scopes.join(' '));

  // PKCE parameters
  url.searchParams.append('code_challenge', challenge);
  url.searchParams.append('code_challenge_method', 'S256');

  // Security parameters
  url.searchParams.append('state', state);

  // Force consent screen (allows workspace selection)
  url.searchParams.append('prompt', OAUTH_CONFIG.prompt);

  debug('Built authorization URL', {
    url: url.toString(),
    clientId: OAUTH_CONFIG.clientId,
    redirectUri,
    scopes: scopes.join(' '),
  });

  return url.toString();
}

/**
 * Exchange authorization code for access token
 *
 * @param {object} params - Token exchange parameters
 * @param {string} params.code - Authorization code from callback
 * @param {string} params.verifier - PKCE code verifier
 * @param {string} [params.redirectUri] - Optional override for redirect URI
 * @returns {Promise<object>} Token response with access_token, refresh_token, expires_in, scope
 */
export async function exchangeCodeForToken({
  code,
  verifier,
  redirectUri = OAUTH_CONFIG.redirectUri,
}) {
  debug('Exchanging code for token', { redirectUri });

  // Build request body (form-urlencoded as required by OAuth spec)
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: redirectUri,
    client_id: OAUTH_CONFIG.clientId,
    code_verifier: verifier,
  });

  try {
    const response = await fetch(OAUTH_CONFIG.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logError('Token exchange failed', {
        status: response.status,
        statusText: response.statusText,
        response: errorText,
      });

      throw new Error(
        `Token exchange failed: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();

    debug('Token exchange successful', {
      hasAccessToken: !!data.access_token,
      hasRefreshToken: !!data.refresh_token,
      expiresIn: data.expires_in,
      scope: data.scope,
    });

    // Validate required fields
    if (!data.access_token) {
      throw new Error('Token response missing access_token');
    }

    if (!data.refresh_token) {
      throw new Error('Token response missing refresh_token');
    }

    if (!data.expires_in) {
      throw new Error('Token response missing expires_in');
    }

    return data;
  } catch (error) {
    logError('Token exchange error', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Refresh access token using refresh token
 *
 * @param {string} refreshToken - Refresh token from initial token response
 * @returns {Promise<object>} New token response with access_token, refresh_token, expires_in, scope
 */
export async function refreshAccessToken(refreshToken) {
  debug('Refreshing access token');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: OAUTH_CONFIG.clientId,
  });

  try {
    const response = await fetch(OAUTH_CONFIG.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));

      debug('Token refresh failed', {
        status: response.status,
        error: errorData.error,
        errorDescription: errorData.error_description,
      });

      // Handle specific OAuth errors
      if (errorData.error === 'invalid_grant') {
        // Refresh token expired or revoked
        throw new Error(
          'invalid_grant: Refresh token expired or revoked. Please re-authenticate.'
        );
      }

      throw new Error(
        `Token refresh failed: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();

    debug('Token refresh successful', {
      hasAccessToken: !!data.access_token,
      hasRefreshToken: !!data.refresh_token,
      expiresIn: data.expires_in,
    });

    // Validate required fields
    if (!data.access_token) {
      throw new Error('Refresh response missing access_token');
    }

    if (!data.refresh_token) {
      throw new Error('Refresh response missing refresh_token');
    }

    if (!data.expires_in) {
      throw new Error('Refresh response missing expires_in');
    }

    return data;
  } catch (error) {
    logError('Token refresh error', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Revoke a token (access or refresh token)
 *
 * @param {string} token - Token to revoke
 * @param {string} [tokenTypeHint] - Optional hint: 'access_token' or 'refresh_token'
 * @returns {Promise<void>}
 */
export async function revokeToken(token, tokenTypeHint) {
  debug('Revoking token', { hasTokenHint: !!tokenTypeHint });

  const body = new URLSearchParams({
    token: token,
    client_id: OAUTH_CONFIG.clientId,
  });

  if (tokenTypeHint) {
    body.append('token_type_hint', tokenTypeHint);
  }

  try {
    const response = await fetch(OAUTH_CONFIG.revokeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      warn('Token revocation failed', {
        status: response.status,
        statusText: response.statusText,
      });
      // Don't throw - revocation is best-effort
      return;
    }

    debug('Token revoked successfully');
  } catch (error) {
    warn('Token revocation error', { error: error.message });
    // Don't throw - revocation is best-effort
  }
}

/**
 * Get OAuth configuration
 *
 * @returns {object} OAuth configuration object
 */
export function getOAuthConfig() {
  return { ...OAUTH_CONFIG };
}