/**
 * Test that assignee can be updated on an issue
 */

import { updateIssue } from '../src/linear.js';

// Mock the client
const mockClient = {
  viewer: { id: 'viewer-123' },
  issue: async (id) => ({
    id,
    identifier: 'TEST-123',
    title: 'Test Issue',
    update: async (input) => {
      if (input.assigneeId === 'viewer-123') {
        return {
          success: true,
          issue: {
            id,
            identifier: 'TEST-123',
            title: 'Test Issue',
            state: { id: 'state-1', name: 'Backlog', type: 'backlog' },
            assignee: { id: 'viewer-123', name: 'Test User', displayName: 'Test User' },
          },
        };
      }
      return {
        success: true,
        issue: {
          id,
          identifier: 'TEST-123',
          title: 'Test Issue',
          state: { id: 'state-1', name: 'Backlog', type: 'backlog' },
        },
      };
    },
  }),
  team: async () => ({}),
};

async function testAssigneeUpdate() {
  console.log('Testing assignee update...');

  // Test 1: Update with assigneeId
  try {
    const result = await updateIssue(mockClient, 'TEST-123', {
      assigneeId: 'viewer-123',
    });

    if (result.changed.includes('assigneeId')) {
      console.log('✓ Test 1 passed: assigneeId can be updated');
    } else {
      console.log('✗ Test 1 failed: assigneeId not in changed fields');
      process.exit(1);
    }
  } catch (err) {
    console.log('✗ Test 1 failed:', err.message);
    process.exit(1);
  }

  // Test 2: Update without assigneeId (should work for other fields)
  try {
    const result = await updateIssue(mockClient, 'TEST-123', {
      title: 'Updated Title',
    });

    if (result.changed.includes('title')) {
      console.log('✓ Test 2 passed: title can be updated without assignee');
    } else {
      console.log('✗ Test 2 failed: title not in changed fields');
      process.exit(1);
    }
  } catch (err) {
    console.log('✗ Test 2 failed:', err.message);
    process.exit(1);
  }

  // Test 3: Update with both assigneeId and title
  try {
    const result = await updateIssue(mockClient, 'TEST-123', {
      title: 'Updated Title',
      assigneeId: 'viewer-123',
    });

    if (result.changed.includes('title') && result.changed.includes('assigneeId')) {
      console.log('✓ Test 3 passed: both title and assigneeId can be updated');
    } else {
      console.log('✗ Test 3 failed: not all fields in changed fields');
      console.log('  Changed fields:', result.changed);
      process.exit(1);
    }
  } catch (err) {
    console.log('✗ Test 3 failed:', err.message);
    process.exit(1);
  }

  // Test 4: Update with no fields should throw error
  try {
    await updateIssue(mockClient, 'TEST-123', {});
    console.log('✗ Test 4 failed: should have thrown error for no update fields');
    process.exit(1);
  } catch (err) {
    if (err.message === 'No update fields provided') {
      console.log('✓ Test 4 passed: error thrown for no update fields');
    } else {
      console.log('✗ Test 4 failed: wrong error message:', err.message);
      process.exit(1);
    }
  }

  console.log('\nAll tests passed!');
}

testAssigneeUpdate().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});