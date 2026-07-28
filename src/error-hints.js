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

/**
 * Adds remediation guidance when an issue-relation mutation is rejected because
 * an existing credential was issued before the default OAuth scopes included `write`.
 *
 * @param {Error} error - The error to wrap
 * @param {object} patch - Requested issue update fields
 * @returns {Error} The original error or a new error with additional hint
 */
export function withIssueRelationScopeHint(error, patch = {}) {
  const message = String(error?.message || error || 'Unknown error');
  const relationFields = ['blockedBy', 'blocking', 'relatedTo', 'duplicateOf'];
  const requestsRelation = relationFields.some((field) => {
    const value = patch[field];
    return Array.isArray(value) ? value.length > 0 : String(value || '').trim() !== '';
  });

  if (requestsRelation && /invalid scope/i.test(message) && /write/i.test(message)) {
    return new Error(
      `${message}\nHint: Issue relations require Linear's write scope. ` +
      `If you authenticated with OAuth before this scope was added, run ` +
      '`pi-linear-tools auth login` to re-authenticate. API-key users need a key with write access.'
    );
  }

  return error;
}
