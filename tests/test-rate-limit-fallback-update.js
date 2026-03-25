/**
 * Regression test: updateIssue should still succeed when post-update refresh
 * hits Linear rate limit after a successful mutation.
 */

import { updateIssue } from '../src/linear.js';

function createRateLimitedError() {
  const err = new Error('Rate limit exceeded. Only 5000 requests are allowed per 1 hour.');
  err.type = 'Ratelimited';
  err.requestsResetAt = Date.now() + 3600000;
  return err;
}

async function run() {
  let issueCalls = 0;

  const sdkIssue = {
    id: 'issue-1',
    identifier: 'ENG-123',
    title: 'Old title',
    description: 'Old description',
    priority: 3,
    state: { id: 'state-1', name: 'Backlog', type: 'backlog' },
    team: { id: 'team-1', key: 'ENG', name: 'Engineering' },
    project: { id: 'project-1', name: 'Core' },
    assignee: { id: 'user-1', name: 'User One', displayName: 'User One' },
    update: async () => ({ success: true }),
  };

  const mockClient = {
    issue: async () => {
      issueCalls += 1;
      // 1st call: resolveIssue
      // 2nd call: get fresh instance for mutation
      if (issueCalls <= 2) return sdkIssue;
      // 3rd call: post-update refresh -> rate limited
      throw createRateLimitedError();
    },
    team: async () => ({
      states: async () => ({ nodes: [{ id: 'state-1', name: 'Backlog', type: 'backlog' }] }),
    }),
  };

  const result = await updateIssue(mockClient, 'ENG-123', {
    title: 'New title',
    assigneeId: 'user-2',
  });

  if (!result.changed.includes('title') || !result.changed.includes('assigneeId')) {
    console.error('✗ changed fields missing expected values:', result.changed);
    process.exit(1);
  }

  if (result.issue.title !== 'New title') {
    console.error('✗ fallback issue title not updated:', result.issue.title);
    process.exit(1);
  }

  if (result.issue.assignee?.id !== 'user-2') {
    console.error('✗ fallback assignee not updated:', result.issue.assignee);
    process.exit(1);
  }

  if (!result.usedRateLimitFallback) {
    console.error('✗ expected usedRateLimitFallback=true but got:', result.usedRateLimitFallback);
    process.exit(1);
  }

  console.log('✓ Passed: updateIssue returns fallback payload when post-refresh is rate-limited');
}

run().catch((err) => {
  console.error('✗ Test failed:', err?.message || err);
  process.exit(1);
});
