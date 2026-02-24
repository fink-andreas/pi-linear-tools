#!/usr/bin/env node

/**
 * Full integration test for assignee fix
 * Simulates the complete flow from tool parameter to Linear API call
 */

import { updateIssue } from '../src/linear.js';

// Mock client that simulates Linear SDK behavior
const createMockClient = () => {
  const viewer = { id: 'viewer-123', name: 'Test User', displayName: 'Test User' };
  const issues = new Map();

  const createMockIssue = (id) => ({
    id,
    identifier: 'TEST-123',
    title: 'Test Issue',
    description: 'Test description',
    state: { id: 'state-1', name: 'Backlog', type: 'backlog' },
    team: { id: 'team-1', key: 'TEST', name: 'Test Team' },
    assignee: null,
    project: null,
    priority: null,
    url: 'https://linear.app/test/TEST-123/test-issue',
    branchName: 'test/test-issue',
    // Update method
    update: async (input) => {
      const issue = issues.get(id) || createMockIssue(id);

      // Apply updates
      if (input.title !== undefined) issue.title = input.title;
      if (input.description !== undefined) issue.description = input.description;
      if (input.priority !== undefined) issue.priority = input.priority;
      if (input.stateId !== undefined) {
        issue.state = { id: input.stateId, name: 'In Progress', type: 'started' };
      }
      if (input.assigneeId !== undefined) {
        issue.assignee = input.assigneeId === viewer.id
          ? viewer
          : { id: input.assigneeId, name: 'Other User', displayName: 'Other User' };
      }

      issues.set(id, issue);

      return {
        success: true,
        issue: issue,
      };
    },
  });

  return {
    viewer,
    // Mock issue lookup
    issue: async (id) => {
      if (issues.has(id)) {
        return issues.get(id);
      }
      // Create and return a fresh mock issue
      const freshIssue = createMockIssue(id);
      issues.set(id, freshIssue);
      return freshIssue;
    },
  };
};

// Simulate the executeIssueUpdate function from the extension
async function executeIssueUpdate(client, params) {
  const issue = String(params.issue || '').trim();
  if (!issue) {
    throw new Error('Missing required field: issue');
  }

  const updatePatch = {
    title: params.title,
    description: params.description,
    priority: params.priority,
    state: params.state,
  };

  // Handle assignee parameter - THIS IS THE KEY PART OF THE FIX
  if (params.assignee === 'me') {
    const viewer = await client.viewer;
    updatePatch.assigneeId = viewer.id;
  } else if (params.assignee) {
    updatePatch.assigneeId = params.assignee;
  }

  const result = await updateIssue(client, issue, updatePatch);

  const friendlyChanges = result.changed.map((field) => {
    if (field === 'stateId') return 'state';
    if (field === 'assigneeId') return 'assignee';
    return field;
  });

  const changeSummaryParts = [];

  if (friendlyChanges.includes('state') && result.issue?.state?.name) {
    changeSummaryParts.push(`state: ${result.issue.state.name}`);
  }

  if (friendlyChanges.includes('assignee')) {
    const assigneeLabel = result.issue?.assignee?.displayName || 'Unassigned';
    changeSummaryParts.push(`assignee: ${assigneeLabel}`);
  }

  for (const field of friendlyChanges) {
    if (field !== 'state' && field !== 'assignee') changeSummaryParts.push(field);
  }

  const suffix = changeSummaryParts.length > 0
    ? ` (${changeSummaryParts.join(', ')})`
    : '';

  return {
    text: `Updated issue ${result.issue.identifier}${suffix}`,
    issue: result.issue,
    changed: friendlyChanges,
  };
}

async function runTests() {
  console.log('Testing full assignee fix flow...\n');
  console.log('=' .repeat(60));

  const client = createMockClient();
  const viewer = await client.viewer;

  console.log(`\nCurrent user: ${viewer.displayName} (${viewer.id})\n`);

  let testsPassed = 0;
  let testsFailed = 0;

  // Test 1: Assign issue to "me"
  console.log('Test 1: Assign issue to "me"');
  console.log('-'.repeat(40));
  try {
    const result = await executeIssueUpdate(client, {
      issue: 'TEST-123',
      assignee: 'me',
    });

    console.log(`✓ Result: ${result.text}`);
    console.log(`  Changed fields: ${result.changed.join(', ')}`);
    console.log(`  Assignee: ${result.issue.assignee?.displayName || 'Unassigned'}`);

    if (result.changed.includes('assignee') &&
        result.issue.assignee?.id === viewer.id) {
      console.log('✅ PASSED: Issue correctly assigned to "me"');
      testsPassed++;
    } else {
      console.log('❌ FAILED: Issue not assigned correctly');
      testsFailed++;
    }
  } catch (err) {
    console.log(`❌ FAILED: ${err.message}`);
    testsFailed++;
  }

  console.log();

  // Test 2: Update title and assign to "me"
  console.log('Test 2: Update title and assign to "me"');
  console.log('-'.repeat(40));
  try {
    const result = await executeIssueUpdate(client, {
      issue: 'TEST-123',
      title: 'Updated Title',
      assignee: 'me',
    });

    console.log(`✓ Result: ${result.text}`);
    console.log(`  Changed fields: ${result.changed.join(', ')}`);
    console.log(`  Title: ${result.issue.title}`);
    console.log(`  Assignee: ${result.issue.assignee?.displayName || 'Unassigned'}`);

    if (result.changed.includes('title') &&
        result.changed.includes('assignee') &&
        result.issue.title === 'Updated Title' &&
        result.issue.assignee?.id === viewer.id) {
      console.log('✅ PASSED: Both title and assignee updated correctly');
      testsPassed++;
    } else {
      console.log('❌ FAILED: Not all fields updated correctly');
      testsFailed++;
    }
  } catch (err) {
    console.log(`❌ FAILED: ${err.message}`);
    testsFailed++;
  }

  console.log();

  // Test 3: Assign to specific user ID
  console.log('Test 3: Assign to specific user ID');
  console.log('-'.repeat(40));
  try {
    const result = await executeIssueUpdate(client, {
      issue: 'TEST-123',
      assignee: 'user-456',
    });

    console.log(`✓ Result: ${result.text}`);
    console.log(`  Changed fields: ${result.changed.join(', ')}`);
    console.log(`  Assignee: ${result.issue.assignee?.displayName || 'Unassigned'}`);

    if (result.changed.includes('assignee') &&
        result.issue.assignee?.id === 'user-456') {
      console.log('✅ PASSED: Issue correctly assigned to specific user');
      testsPassed++;
    } else {
      console.log('❌ FAILED: Issue not assigned to correct user');
      testsFailed++;
    }
  } catch (err) {
    console.log(`❌ FAILED: ${err.message}`);
    testsFailed++;
  }

  console.log();

  // Test 4: Update without assignee (should still work)
  console.log('Test 4: Update without assignee (title only)');
  console.log('-'.repeat(40));
  try {
    const result = await executeIssueUpdate(client, {
      issue: 'TEST-123',
      title: 'Another Title',
    });

    console.log(`✓ Result: ${result.text}`);
    console.log(`  Changed fields: ${result.changed.join(', ')}`);

    if (result.changed.includes('title') &&
        !result.changed.includes('assignee')) {
      console.log('✅ PASSED: Title updated without assignee');
      testsPassed++;
    } else {
      console.log('❌ FAILED: Update failed or included unexpected fields');
      testsFailed++;
    }
  } catch (err) {
    console.log(`❌ FAILED: ${err.message}`);
    testsFailed++;
  }

  console.log();

  // Test 5: Update with no fields should throw error
  console.log('Test 5: Update with no fields (should throw error)');
  console.log('-'.repeat(40));
  try {
    await executeIssueUpdate(client, {
      issue: 'TEST-123',
    });
    console.log('❌ FAILED: Should have thrown error for no update fields');
    testsFailed++;
  } catch (err) {
    if (err.message === 'No update fields provided') {
      console.log(`✓ Error correctly thrown: ${err.message}`);
      console.log('✅ PASSED: Error thrown for no update fields');
      testsPassed++;
    } else {
      console.log(`❌ FAILED: Wrong error message: ${err.message}`);
      testsFailed++;
    }
  }

  console.log();
  console.log('=' .repeat(60));
  console.log(`\nTest Results: ${testsPassed} passed, ${testsFailed} failed\n`);

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runTests();