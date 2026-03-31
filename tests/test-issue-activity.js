#!/usr/bin/env node

import assert from 'node:assert/strict';

import { executeIssueActivity } from '../src/handlers.js';

function createMockIssue() {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    identifier: 'ERF-1',
    title: 'Test issue',
    url: 'https://linear.app/example/issue/ERF-1/test-issue',
  };
}

async function testIssueActivitySupportsIssueUrl() {
  const seenLookups = [];
  const mockClient = {
    issue: async (lookup) => {
      seenLookups.push(lookup);
      if (lookup === 'ERF-1') {
        return createMockIssue();
      }
      return null;
    },
    rawRequest: async (query, variables) => {
      if (!query.includes('IssueActivity')) {
        throw new Error(`Unexpected query: ${query}`);
      }

      assert.equal(variables.id, '11111111-1111-4111-8111-111111111111');
      assert.equal(variables.first, 10);
      assert.equal(variables.includeArchived, false);

      return {
        data: {
          issue: {
            id: '11111111-1111-4111-8111-111111111111',
            identifier: 'ERF-1',
            title: 'Test issue',
            url: 'https://linear.app/example/issue/ERF-1/test-issue',
            history: {
              nodes: [
                {
                  id: 'hist-1',
                  createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
                  updatedAt: new Date().toISOString(),
                  actor: {
                    id: 'user-1',
                    name: 'Austin',
                    displayName: 'Austin',
                  },
                  fromState: { id: 'state-1', name: 'Backlog' },
                  toState: { id: 'state-2', name: 'In Progress' },
                  fromAssignee: null,
                  toAssignee: null,
                  fromTitle: null,
                  toTitle: null,
                  fromPriority: null,
                  toPriority: null,
                  fromProject: null,
                  toProject: null,
                  fromProjectMilestone: null,
                  toProjectMilestone: null,
                  addedLabels: [],
                  removedLabels: [],
                  relationChanges: [],
                  attachment: null,
                  archived: false,
                  archivedAt: null,
                  autoArchived: false,
                  autoClosed: false,
                  trashed: null,
                  updatedDescription: false,
                },
                {
                  id: 'hist-2',
                  createdAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
                  updatedAt: new Date().toISOString(),
                  actor: {
                    id: 'user-1',
                    name: 'Austin',
                    displayName: 'Austin',
                  },
                  fromState: null,
                  toState: null,
                  fromAssignee: null,
                  toAssignee: {
                    id: 'user-1',
                    name: 'Austin',
                    displayName: 'Austin',
                  },
                  fromTitle: null,
                  toTitle: null,
                  fromPriority: null,
                  toPriority: null,
                  fromProject: null,
                  toProject: null,
                  fromProjectMilestone: null,
                  toProjectMilestone: null,
                  addedLabels: [],
                  removedLabels: [],
                  relationChanges: [],
                  attachment: null,
                  archived: false,
                  archivedAt: null,
                  autoArchived: false,
                  autoClosed: false,
                  trashed: null,
                  updatedDescription: false,
                },
              ],
            },
          },
        },
        headers: new Headers(),
      };
    },
  };

  const result = await executeIssueActivity(mockClient, {
    issue: 'https://linear.app/test123aadd2/issue/ERF-1/test',
    limit: 10,
  });

  assert.deepEqual(seenLookups, ['ERF-1']);
  assert.match(result.content[0].text, /# Activity for ERF-1: Test issue/);
  assert.match(result.content[0].text, /Austin/);
  assert.match(result.content[0].text, /moved state from Backlog to In Progress/);
  assert.match(result.content[0].text, /assigned to Austin/);
  console.log('✓ issue activity supports issue URL and formats history');
}

async function main() {
  await testIssueActivitySupportsIssueUrl();
  console.log('✓ tests/test-issue-activity.js passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
