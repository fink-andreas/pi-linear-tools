/**
 * Regression coverage for linear_issue comment result rendering.
 */

import { executeIssueComment } from '../src/handlers.js';

function createMockClient() {
  const calls = [];

  return {
    calls,
    issue: async (ref) => ({
      id: 'issue-1',
      identifier: ref,
      title: 'Comment output test',
      state: { id: 'state-1', name: 'Backlog', type: 'backlog' },
    }),
    createComment: async (input) => {
      calls.push(input);
      return {
        success: true,
        comment: {
          id: 'comment-1',
          body: input.body,
        },
      };
    },
  };
}

async function testShortCommentRendered() {
  const client = createMockClient();
  const body = 'Implemented and merged to `main`.\n\nReady for review.';
  const result = await executeIssueComment(client, {
    issue: 'INN-305',
    body,
  });

  const text = result.content[0].text;

  if (!text.includes('Added comment to issue INN-305')) {
    throw new Error(`Missing success line: ${text}`);
  }

  if (text.includes('\nComment:\n')) {
    throw new Error(`Comment label should not be rendered: ${text}`);
  }

  if (!text.includes(`Added comment to issue INN-305\n\n${body}`)) {
    throw new Error(`Missing submitted comment body: ${text}`);
  }

  if (result.details.commentBody !== body) {
    throw new Error('Full comment body was not preserved in details');
  }

  if (result.details.commentPreview !== body || result.details.commentPreviewTruncated !== false) {
    throw new Error('Short comment preview details are incorrect');
  }

  if (client.calls[0].body !== body) {
    throw new Error('Submitted body was not sent to Linear');
  }
}

async function testLongCommentPreviewCapped() {
  const client = createMockClient();
  const body = `${'A'.repeat(520)}\nThis should remain only in details.`;
  const result = await executeIssueComment(client, {
    issue: 'INN-305',
    body,
  });

  const text = result.content[0].text;

  if (text.includes('\nComment:\n')) {
    throw new Error(`Comment label should not be rendered: ${text}`);
  }

  if (text.includes('This should remain only in details.')) {
    throw new Error('Long comment preview was not capped');
  }

  if (!result.details.commentPreview.endsWith('...')) {
    throw new Error('Truncated comment preview should end with ellipsis');
  }

  if (result.details.commentPreviewTruncated !== true) {
    throw new Error('Long comment preview should be marked truncated');
  }

  if (result.details.commentBody !== body) {
    throw new Error('Full long comment body was not preserved in details');
  }
}

async function run() {
  console.log('Testing issue comment result rendering...');

  await testShortCommentRendered();
  console.log('✓ Short comment body is rendered and preserved in details');

  await testLongCommentPreviewCapped();
  console.log('✓ Long comment body is capped in text and preserved in details');

  console.log('\nAll tests passed!');
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
