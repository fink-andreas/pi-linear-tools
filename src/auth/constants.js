/**
 * OAuth constants for pi-linear-tools
 */

// Linear OAuth application client ID
export const OAUTH_CLIENT_ID = 'a3e177176c6697611367f1a2405d4a34';

// OAuth scopes - minimal required scopes.
// `write` is included so issue relations (blockedBy / blocking / relatedTo / duplicateOf) work:
// those go through the `issueRelationCreate` mutation, which Linear gates behind the `write`
// scope, whereas `issueUpdate` (title/description/state/assignee/parentId) is permitted under
// `issues:create`. Without `write`, the `linear_issue` tool accepts the relation params but
// Linear rejects them with "Invalid scope: `write` required". See upstream issue #27.
export const OAUTH_SCOPES = ['read', 'issues:create', 'comments:create', 'write'];
