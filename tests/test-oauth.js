#!/usr/bin/env node

import assert from 'node:assert/strict';

import { OAUTH_SCOPES } from '../src/auth/constants.js';
import { buildAuthorizationUrl } from '../src/auth/oauth.js';
import { withIssueRelationScopeHint } from '../src/error-hints.js';

function testDefaultAuthorizationUrlRequestsWriteScope() {
  const authorizationUrl = new URL(buildAuthorizationUrl({
    challenge: 'test-pkce-challenge',
    state: 'test-state',
  }));

  assert.deepEqual(OAUTH_SCOPES, ['read', 'issues:create', 'comments:create', 'write']);
  assert.equal(
    authorizationUrl.searchParams.get('scope'),
    'read issues:create comments:create write'
  );
}

function testRelationScopeErrorIncludesReauthenticationGuidance() {
  const error = withIssueRelationScopeHint(
    new Error('Invalid scope: `write` required'),
    { blockedBy: ['ENG-123'] }
  );

  assert.notEqual(error.message, 'Invalid scope: `write` required');
  assert.match(error.message, /Issue relations require Linear's write scope/);
  assert.match(error.message, /pi-linear-tools auth login/);
  assert.match(error.message, /API-key users need a key with write access/);
}

function testNonRelationScopeErrorsRemainUnchanged() {
  const original = new Error('Invalid scope: `write` required');
  assert.equal(withIssueRelationScopeHint(original, { title: 'Updated title' }), original);
}

function main() {
  testDefaultAuthorizationUrlRequestsWriteScope();
  testRelationScopeErrorIncludesReauthenticationGuidance();
  testNonRelationScopeErrorsRemainUnchanged();
  console.log('✓ tests/test-oauth.js passed');
}

main();
