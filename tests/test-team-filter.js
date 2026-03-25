#!/usr/bin/env node

import assert from 'node:assert/strict';

import { executeIssueList } from '../src/handlers.js';

async function testIssueListResolvesTeamAndPassesTeamIdToQuery() {
  let receivedFilter = null;

  const mockClient = {
    viewer: Promise.resolve({ id: 'viewer-1', displayName: 'Viewer' }),
    projects: async () => ({
      nodes: [{ id: 'project-1', name: 'demo-project' }],
    }),
    teams: async () => ({
      nodes: [
        { id: 'team-1', key: 'ENG', name: 'Engineering' },
        { id: 'team-2', key: 'PAT', name: 'Platform' },
      ],
    }),
    rawRequest: async (_query, variables) => {
      receivedFilter = variables.filter;
      return {
        data: {
          issues: {
            nodes: [
              {
                id: 'issue-1',
                identifier: 'PAT-1',
                title: 'Team filtered issue',
                description: '',
                url: 'https://linear.app/test/issue/PAT-1',
                branchName: null,
                priority: 2,
                state: { id: 'state-1', name: 'Backlog', type: 'backlog' },
                team: { id: 'team-2', key: 'PAT', name: 'Platform' },
                project: { id: 'project-1', name: 'demo-project' },
                projectMilestone: null,
                assignee: { id: 'user-1', name: 'Test User', displayName: 'Test User' },
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
    team: 'PAT',
    limit: 5,
  });

  assert.deepEqual(receivedFilter, {
    project: { id: { eq: 'project-1' } },
    team: { id: { eq: 'team-2' } },
  });
  assert.match(result.content[0].text, /PAT-1/);
  assert.equal(result.details.projectId, 'project-1');
  assert.equal(result.details.issueCount, 1);
}

async function testIssueListCombinesTeamStateAndAssigneeFilters() {
  let receivedFilter = null;

  const mockClient = {
    viewer: Promise.resolve({ id: 'viewer-42', displayName: 'Viewer' }),
    projects: async () => ({
      nodes: [{ id: 'project-1', name: 'demo-project' }],
    }),
    teams: async () => ({
      nodes: [{ id: 'team-2', key: 'PAT', name: 'Platform' }],
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
    team: 'PAT',
    states: ['Backlog', 'In Progress'],
    assignee: 'me',
    limit: 10,
  });

  assert.deepEqual(receivedFilter, {
    project: { id: { eq: 'project-1' } },
    state: { name: { in: ['Backlog', 'In Progress'] } },
    assignee: { id: { eq: 'viewer-42' } },
    team: { id: { eq: 'team-2' } },
  });
  assert.match(result.content[0].text, /No issues found/);
}

async function main() {
  await testIssueListResolvesTeamAndPassesTeamIdToQuery();
  await testIssueListCombinesTeamStateAndAssigneeFilters();
  console.log('✓ tests/test-team-filter.js passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
