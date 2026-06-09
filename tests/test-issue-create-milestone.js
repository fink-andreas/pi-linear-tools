#!/usr/bin/env node

/**
 * Tests issue create milestone assignment.
 */

import { executeIssueCreate } from '../src/handlers.js';
import { createIssue } from '../src/linear.js';

function createMockClient() {
  const calls = {
    createIssue: [],
  };
  const team = { id: 'team-1', key: 'ENG', name: 'Engineering' };
  const project = { id: 'project-1', name: 'Product' };
  const milestone = { id: 'milestone-1', name: 'Reviews', status: 'started', progress: 0, sortOrder: 1 };

  return {
    apiKey: `test-create-milestone-${Math.random()}`,
    calls,
    teams: async () => ({ nodes: [team] }),
    projects: async () => ({ nodes: [project] }),
    project: async (id) => {
      if (id !== project.id) return null;
      return {
        ...project,
        projectMilestones: async () => ({ nodes: [milestone] }),
      };
    },
    createIssue: async (input) => {
      calls.createIssue.push(input);
      return {
        success: true,
        issue: { id: 'issue-1' },
      };
    },
    issue: async (id) => ({
      id,
      identifier: 'ENG-123',
      title: 'Create with milestone',
      description: null,
      url: 'https://linear.app/example/ENG-123/create-with-milestone',
      priority: null,
      state: { id: 'state-1', name: 'Todo', type: 'unstarted' },
      team,
      project,
      projectMilestone: calls.createIssue[0]?.projectMilestoneId
        ? { id: calls.createIssue[0].projectMilestoneId, name: 'Reviews' }
        : null,
      assignee: null,
    }),
  };
}

async function testCreateIssueForwardsExplicitProjectMilestoneId() {
  const client = createMockClient();

  await createIssue(client, {
    teamId: 'team-1',
    title: 'Create with explicit milestone ID',
    projectMilestoneId: 'milestone-explicit',
  });

  if (client.calls.createIssue[0]?.projectMilestoneId !== 'milestone-explicit') {
    throw new Error(`Expected projectMilestoneId to be forwarded, got ${JSON.stringify(client.calls.createIssue[0])}`);
  }
}

async function testCreateIssueGraphqlForwardsProjectMilestoneId() {
  let rawRequestCalls = 0;
  const client = {
    apiKey: 'test-create-milestone-graphql',
    rawRequest: async (query, variables) => {
      rawRequestCalls += 1;
      if (!query.includes('mutation IssueCreate')) {
        throw new Error('Expected IssueCreate mutation');
      }
      if (variables.input.projectMilestoneId !== 'milestone-graphql') {
        throw new Error(`Expected GraphQL input to include projectMilestoneId, got ${JSON.stringify(variables.input)}`);
      }
      return {
        data: {
          issueCreate: {
            success: true,
            issue: {
              id: 'issue-graphql',
              identifier: 'ENG-124',
              title: variables.input.title,
              projectMilestone: { id: 'milestone-graphql', name: 'Reviews' },
            },
          },
        },
        headers: new Headers(),
      };
    },
  };

  const issue = await createIssue(client, {
    teamId: 'team-1',
    title: 'Create with GraphQL milestone',
    projectMilestoneId: 'milestone-graphql',
  });

  if (rawRequestCalls !== 1 || issue.projectMilestone?.id !== 'milestone-graphql') {
    throw new Error(`Expected GraphQL create milestone result, got ${JSON.stringify({ rawRequestCalls, issue })}`);
  }
}

async function testExecuteIssueCreateResolvesMilestoneName() {
  const client = createMockClient();

  const result = await executeIssueCreate(client, {
    title: 'Create with milestone',
    team: 'ENG',
    project: 'Product',
    milestone: 'Reviews',
  });

  if (client.calls.createIssue[0]?.projectMilestoneId !== 'milestone-1') {
    throw new Error(`Expected resolved milestone ID, got ${JSON.stringify(client.calls.createIssue[0])}`);
  }

  if (result.details?.projectMilestone?.id !== 'milestone-1') {
    throw new Error(`Expected created issue details to include milestone, got ${JSON.stringify(result.details)}`);
  }
}

async function testExecuteIssueCreateRequiresProjectForMilestoneName() {
  const client = createMockClient();

  try {
    await executeIssueCreate(client, {
      title: 'Create with milestone but no project',
      team: 'ENG',
      milestone: 'Reviews',
    });
  } catch (error) {
    if (!String(error.message).includes('Provide project when assigning milestone by name')) {
      throw error;
    }
    return;
  }

  throw new Error('Expected create with milestone name but no project to fail');
}

async function run() {
  await testCreateIssueForwardsExplicitProjectMilestoneId();
  console.log('✓ createIssue forwards explicit projectMilestoneId');

  await testCreateIssueGraphqlForwardsProjectMilestoneId();
  console.log('✓ createIssue GraphQL forwards projectMilestoneId');

  await testExecuteIssueCreateResolvesMilestoneName();
  console.log('✓ executeIssueCreate resolves milestone name');

  await testExecuteIssueCreateRequiresProjectForMilestoneName();
  console.log('✓ executeIssueCreate requires project for milestone name');
}

run().catch((error) => {
  console.error('✗ Issue create milestone tests failed');
  console.error(error);
  process.exit(1);
});
