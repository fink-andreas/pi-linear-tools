/**
 * Test issue priority mapping and string aliases.
 */

import { createIssue, updateIssue } from '../src/linear.js';

function createIssueObject(id, overrides = {}) {
  return {
    id,
    identifier: 'PRI-1',
    title: 'Priority test issue',
    description: null,
    url: null,
    branchName: null,
    priority: overrides.priority ?? null,
    estimate: null,
    state: { id: 'state-1', name: 'Backlog', type: 'backlog' },
    team: { id: 'team-1', key: 'PRI', name: 'Priority' },
    project: null,
    projectMilestone: null,
    assignee: null,
    update: overrides.update,
  };
}

function createMockClient() {
  const calls = {
    createIssue: [],
    updateIssue: [],
  };

  let createdPriority = null;
  let updatedPriority = 0;

  const client = {
    calls,
    async createIssue(input) {
      calls.createIssue.push(input);
      createdPriority = input.priority;
      return {
        success: true,
        issue: { id: 'created-issue-1' },
      };
    },
    async issue(id) {
      return createIssueObject(id, {
        priority: id === 'created-issue-1' ? createdPriority : updatedPriority,
        update: async (input) => {
          calls.updateIssue.push(input);
          if (Object.prototype.hasOwnProperty.call(input, 'priority')) {
            updatedPriority = input.priority;
          }
          return {
            success: true,
            issue: createIssueObject(id, { priority: updatedPriority }),
          };
        },
      });
    },
  };

  return client;
}

async function testCreateAcceptsStringAlias() {
  const client = createMockClient();
  const issue = await createIssue(client, {
    teamId: 'team-1',
    title: 'Priority alias create',
    priority: 'urgent',
  });

  if (client.calls.createIssue[0].priority !== 1) {
    throw new Error(`Expected urgent alias to create priority 1, got ${client.calls.createIssue[0].priority}`);
  }

  if (issue.priority !== 1) {
    throw new Error(`Expected created issue priority 1, got ${issue.priority}`);
  }
}

async function testCreateKeepsNumericPriorityCompatibility() {
  const client = createMockClient();
  await createIssue(client, {
    teamId: 'team-1',
    title: 'Priority numeric create',
    priority: 2,
  });

  if (client.calls.createIssue[0].priority !== 2) {
    throw new Error(`Expected numeric priority 2 to be preserved, got ${client.calls.createIssue[0].priority}`);
  }
}

async function testUpdateAcceptsStringAliasCaseInsensitively() {
  const client = createMockClient();
  const result = await updateIssue(client, 'PRI-1', {
    priority: 'Low',
  });

  if (client.calls.updateIssue[0].priority !== 4) {
    throw new Error(`Expected low alias to update priority 4, got ${client.calls.updateIssue[0].priority}`);
  }

  if (!result.changed.includes('priority')) {
    throw new Error('Expected changed fields to include priority');
  }

  if (result.issue.priority !== 4) {
    throw new Error(`Expected updated issue priority 4, got ${result.issue.priority}`);
  }
}

async function testInvalidPriorityStringFails() {
  const client = createMockClient();

  try {
    await createIssue(client, {
      teamId: 'team-1',
      title: 'Invalid priority create',
      priority: 'critical',
    });
    throw new Error('Expected invalid priority string to throw');
  } catch (err) {
    if (!String(err.message).includes('Invalid priority: critical')) {
      throw err;
    }
  }

  if (client.calls.createIssue.length !== 0) {
    throw new Error('Invalid create priority should fail before createIssue API call');
  }
}

async function run() {
  console.log('Testing issue priority aliases...');

  await testCreateAcceptsStringAlias();
  console.log('✓ createIssue accepts string priority aliases');

  await testCreateKeepsNumericPriorityCompatibility();
  console.log('✓ createIssue preserves numeric priority values');

  await testUpdateAcceptsStringAliasCaseInsensitively();
  console.log('✓ updateIssue accepts string priority aliases case-insensitively');

  await testInvalidPriorityStringFails();
  console.log('✓ invalid priority strings fail before create API calls');

  console.log('\nAll tests passed!');
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
