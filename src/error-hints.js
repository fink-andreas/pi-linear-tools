/**
 * Error hint utilities
 *
 * Provides helpful hints for common error scenarios.
 */

/**
 * Wraps errors related to milestone operations with helpful scope hints
 *
 * @param {Error} error - The error to wrap
 * @returns {Error} The original error or a new error with additional hint
 */
export function withMilestoneScopeHint(error) {
  const message = String(error?.message || error || 'Unknown error');

  if (/invalid scope/i.test(message) && /write/i.test(message)) {
    return new Error(
      `${message}\nHint: Milestone create/update/delete require Linear write scope. ` +
      `Use API key auth for milestone management: /linear-tools-config --api-key <key>`
    );
  }

  return error;
}
