/**
 * Local HTTP callback server for OAuth 2.0 authorization flow
 *
 * Creates an ephemeral HTTP server on localhost to receive the OAuth callback
 * from Linear after user authorization.
 */

import http from 'node:http';
import { URL } from 'node:url';
import { debug, warn, error as logError } from '../logger.js';

// Default callback server configuration
const SERVER_CONFIG = {
  port: 34711,
  host: '127.0.0.1', // Bind to localhost only for security
  timeout: 5 * 60 * 1000, // 5 minutes
};

/**
 * HTML page to show on successful authentication
 */
const SUCCESS_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Authentication Successful</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        .container {
            text-align: center;
            padding: 40px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            backdrop-filter: blur(10px);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
        }
        h1 {
            margin: 0 0 16px 0;
            font-size: 32px;
        }
        p {
            font-size: 18px;
            opacity: 0.9;
            margin: 0;
        }
        .icon {
            font-size: 64px;
            margin-bottom: 24px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">✓</div>
        <h1>Authentication Successful</h1>
        <p>You may safely close this window and return to your terminal.</p>
    </div>
</body>
</html>
`;

/**
 * HTML page to show on authentication error
 */
const ERROR_HTML = (errorMessage) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Authentication Failed</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            color: white;
        }
        .container {
            text-align: center;
            padding: 40px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            backdrop-filter: blur(10px);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            max-width: 500px;
        }
        h1 {
            margin: 0 0 16px 0;
            font-size: 32px;
        }
        p {
            font-size: 18px;
            opacity: 0.9;
            margin: 0 0 24px 0;
        }
        .error {
            background: rgba(0, 0, 0, 0.2);
            padding: 16px;
            border-radius: 8px;
            font-family: monospace;
            font-size: 14px;
            word-break: break-all;
        }
        .icon {
            font-size: 64px;
            margin-bottom: 24px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">✕</div>
        <h1>Authentication Failed</h1>
        <p>An error occurred during authentication:</p>
        <div class="error">${errorMessage}</div>
    </div>
</body>
</html>
`;

/**
 * Start callback server and wait for OAuth callback
 *
 * @param {object} options - Server options
 * @param {string} options.expectedState - Expected state parameter (for CSRF validation)
 * @param {number} [options.port] - Port to listen on (default: 34711)
 * @param {number} [options.timeout] - Timeout in milliseconds (default: 5 minutes)
 * @returns {Promise<object>} Callback result with code and state
 * @throws {Error} If callback fails, times out, or state validation fails
 */
export async function waitForCallback({
  expectedState,
  port = SERVER_CONFIG.port,
  timeout = SERVER_CONFIG.timeout,
}) {
  debug('Starting callback server', { port, expectedState });

  return new Promise((resolve, reject) => {
    let server;
    let timeoutId;

    // Create timeout handler
    const timeoutHandler = () => {
      debug('Callback server timeout');
      if (server) {
        server.close();
      }
      reject(new Error('OAuth callback timed out. Please try again.'));
    };

    // Start timeout
    timeoutId = setTimeout(timeoutHandler, timeout);

    // Create HTTP server
    server = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`);

      debug('Received request', { path: parsedUrl.pathname });

      // Only handle the callback path
      if (parsedUrl.pathname === '/callback') {
        const code = parsedUrl.searchParams.get('code');
        const state = parsedUrl.searchParams.get('state');
        const error = parsedUrl.searchParams.get('error');
        const errorDescription = parsedUrl.searchParams.get(
          'error_description'
        );

        // Check for OAuth error
        if (error) {
          debug('OAuth error received', {
            error,
            errorDescription,
          });

          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(
            ERROR_HTML(
              errorDescription || error || 'Unknown OAuth error'
            )
          );

          clearTimeout(timeoutId);
          server.close();
          reject(new Error(`OAuth error: ${errorDescription || error}`));
          return;
        }

        // Check for authorization code
        if (!code) {
          debug('Missing authorization code');

          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(ERROR_HTML('Missing authorization code in callback'));

          clearTimeout(timeoutId);
          server.close();
          reject(new Error('Missing authorization code in callback'));
          return;
        }

        // Validate state parameter (CSRF protection)
        if (!state || state !== expectedState) {
          debug('State validation failed', {
            received: state,
            expected: expectedState,
          });

          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(
            ERROR_HTML('Security error: State mismatch. Possible CSRF attack.')
          );

          clearTimeout(timeoutId);
          server.close();
          reject(
            new Error('State validation failed. Possible CSRF attack.')
          );
          return;
        }

        // Success!
        debug('OAuth callback successful', { hasCode: !!code });

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(SUCCESS_HTML);

        clearTimeout(timeoutId);

        // Close server after a short delay to ensure response is sent
        setTimeout(() => {
          server.close();
        }, 100);

        resolve({ code, state });
      } else {
        // Return 404 for other paths
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });

    // Handle server errors
    server.on('error', (err) => {
      logError('Callback server error', {
        error: err.message,
        code: err.code,
      });

      clearTimeout(timeoutId);

      if (err.code === 'EADDRINUSE') {
        reject(
          new Error(
            `Port ${port} is already in use. Please check if another process is using it.`
          )
        );
      } else if (err.code === 'EACCES') {
        reject(
          new Error(
            `Permission denied to bind to port ${port}. Try a different port.`
          )
        );
      } else {
        reject(new Error(`Failed to start callback server: ${err.message}`));
      }
    });

    // Start listening
    server.listen(port, SERVER_CONFIG.host, () => {
      debug('Callback server listening', {
        host: SERVER_CONFIG.host,
        port,
      });
    });
  });
}

/**
 * Get callback URL for OAuth authorization
 *
 * @param {number} [port] - Port number (default: 34711)
 * @returns {string} Full callback URL
 */
export function getCallbackUrl(port = SERVER_CONFIG.port) {
  return `http://localhost:${port}/callback`;
}