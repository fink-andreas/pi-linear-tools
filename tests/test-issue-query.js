#!/usr/bin/env node

import assert from 'node:assert/strict';

import { executeIssueList } from '../src/handlers.js';

async function testIssueListQueryPassesOrFilterForTextSearch() {
  let receivedFilter = null;

  const mockClient = {
    viewer: Promise.resolve({ id: 'viewer-1', displayName: 'Viewer' }),
    projects: async () => ({
      nodes: [{ id: 'project-1', name: 'demo-project' }],
    }),
    teams: async () => ({
      nodes: [],
    }),
    rawRequest: async (_query, variables) => {
      receivedFilter = variables.filter;
      return {
        data: {
          issues: {
            nodes: [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
        headers: new Headers(),
      };
    },
  };

  const result = await executeIssueList(mockClient, {
    project: 'demo-project',
    query: 'smoke test',
    limit: 10,
  });

  assert.deepEqual(receivedFilter, {
    project: { id: { eq: 'project-1' } },
    or: [
      { title: { contains: 'smoke test' } },
      { description: { contains: 'smoke test' } },
    ],
  });
  assert.match(result.content[0].text, /No issues found/);
}

async function testIssueListQueryCombineWithStatesAndAssignee() {
  let receivedFilter = null;

  const mockClient = {
    viewer: Promise.resolve({ id: 'viewer-42', displayName: 'Viewer' }),
    projects: async () => ({
      nodes: [{ id: 'project-1', name: 'demo-project' }],
    }),
    teams: async () => ({
      nodes: [],
    }),
    rawRequest: async (_query, variables) => {
      receivedFilter = variables.filter;
      return {
        data: {
          issues: {
            nodes: [
              {
                id: 'issue-1',
                identifier: 'PAT-2',
                title: 'Smoke test the login flow',
                description: 'We need to smoke test the new login flow',
                url: 'https://linear.app/test/issue/PAT-2',
                branchName: null,
                priority: 3,
                state: { id: 'state-1', name: 'In Progress', type: 'started' },
                team: { id: 'team-1', key: 'PAT', name: 'Platform' },
                project: { id: 'project-1', name: 'demo-project' },
                projectMilestone: null,
                assignee: { id: 'viewer-42', name: 'Viewer', displayName: 'Viewer' },
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
        headers: new Headers(),
      };
    },
  };

  const result = await executeIssueList(mockClient, {
    project: 'demo-project',
    query: 'smoke',
    states: ['In Progress'],
    assignee: 'me',
    limit: 20,
  });

  assert.deepEqual(receivedFilter, {
    project: { id: { eq: 'project-1' } },
    state: { name: { in: ['In Progress'] } },
    assignee: { id: { eq: 'viewer-42' } },
    or: [
      { title: { contains: 'smoke' } },
      { description: { contains: 'smoke' } },
    ],
  });
  assert.match(result.content[0].text, /PAT-2/);
}

async function testIssueListWithoutQueryDoesNotIncludeOrFilter() {
  let receivedFilter = null;

  const mockClient = {
    viewer: Promise.resolve({ id: 'viewer-1', displayName: 'Viewer' }),
    projects: async () => ({
      nodes: [{ id: 'project-1', name: 'demo-project' }],
    }),
    teams: async () => ({
      nodes: [],
    }),
    rawRequest: async (_query, variables) => {
      receivedFilter = variables.filter;
      return {
        data: {
          issues: {
            nodes: [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
        headers: new Headers(),
      };
    },
  };

  await executeIssueList(mockClient, {
    project: 'demo-project',
    limit: 5,
  });

  // When query is not provided, the or filter should NOT be present
  assert.deepEqual(receivedFilter, {
    project: { id: { eq: 'project-1' } },
  });
}

async function main() {
  await testIssueListQueryPassesOrFilterForTextSearch();
  await testIssueListQueryCombineWithStatesAndAssignee();
  await testIssueListWithoutQueryDoesNotIncludeOrFilter();
  console.log('✓ test-issue-query.js passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});