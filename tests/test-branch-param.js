/**
 * Test to verify branch handling in executeIssueStart
 * 
 * The branch parameter has been removed - we always use Linear's
 * suggested branchName to ensure local branches match what Linear expects
 * for PR auto-linking and workflow automation.
 */

import { executeIssueStart } from '../src/handlers.js';

// Mock LinearClient
const mockTeam = {
  id: 'team-id',
  key: 'TEST',
  name: 'Test Team',
  states: async () => ({
    nodes: [
      { id: 'state-1', name: 'Backlog', type: 'unstarted' },
      { id: 'state-2', name: 'In Progress', type: 'started' },
    ],
  }),
};

const mockClient = {
  issue: async (id) => ({
    id: 'test-issue-id',
    identifier: 'TEST-123',
    title: 'Test Issue',
    branchName: 'default/test-branch-name',
    team: mockTeam,
    state: { id: 'state-1', name: 'Backlog', type: 'unstarted' },
    update: async () => ({ success: true, issue: { id: 'test-issue-id' } }),
  }),
  team: async () => mockTeam,
};

// Test 1: Default branch name from Linear should always be used
async function testDefaultBranch() {
  console.log('Test 1: Linear\'s branchName is always used');
  
  let capturedBranchName = null;
  
  const options = {
    gitExecutor: async (branchName, fromRef, onBranchExists) => {
      capturedBranchName = branchName;
      return { action: 'created', branchName };
    },
  };
  
  const params = {
    issue: 'TEST-123',
    // No branch parameter - it has been removed
  };
  
  try {
    await executeIssueStart(mockClient, params, options);
    
    if (capturedBranchName === 'default/test-branch-name') {
      console.log('  ✓ PASS: Linear\'s branchName was used:', capturedBranchName);
      return true;
    } else {
      console.log('  ✗ FAIL: Expected "default/test-branch-name" but got:', capturedBranchName);
      return false;
    }
  } catch (error) {
    console.log('  ✗ FAIL: Error:', error.message);
    return false;
  }
}

// Test 2: fromRef parameter should be passed through
async function testFromRef() {
  console.log('Test 2: fromRef parameter is passed through');
  
  let capturedFromRef = null;
  
  const options = {
    gitExecutor: async (branchName, fromRef, onBranchExists) => {
      capturedFromRef = fromRef;
      return { action: 'created', branchName };
    },
  };
  
  const params = {
    issue: 'TEST-123',
    fromRef: 'main',
  };
  
  try {
    await executeIssueStart(mockClient, params, options);
    
    if (capturedFromRef === 'main') {
      console.log('  ✓ PASS: fromRef was passed:', capturedFromRef);
      return true;
    } else {
      console.log('  ✗ FAIL: Expected "main" but got:', capturedFromRef);
      return false;
    }
  } catch (error) {
    console.log('  ✗ FAIL: Error:', error.message);
    return false;
  }
}

// Test 3: onBranchExists parameter should be passed through
async function testOnBranchExists() {
  console.log('Test 3: onBranchExists parameter is passed through');
  
  let capturedOnBranchExists = null;
  
  const options = {
    gitExecutor: async (branchName, fromRef, onBranchExists) => {
      capturedOnBranchExists = onBranchExists;
      return { action: 'created', branchName };
    },
  };
  
  const params = {
    issue: 'TEST-123',
    onBranchExists: 'suffix',
  };
  
  try {
    await executeIssueStart(mockClient, params, options);
    
    if (capturedOnBranchExists === 'suffix') {
      console.log('  ✓ PASS: onBranchExists was passed:', capturedOnBranchExists);
      return true;
    } else {
      console.log('  ✗ FAIL: Expected "suffix" but got:', capturedOnBranchExists);
      return false;
    }
  } catch (error) {
    console.log('  ✗ FAIL: Error:', error.message);
    return false;
  }
}

// Run all tests
async function runTests() {
  console.log('=== Branch Parameter Tests (branch param removed) ===\n');
  
  const results = [
    await testDefaultBranch(),
    await testFromRef(),
    await testOnBranchExists(),
  ];
  
  console.log('\n=== Summary ===');
  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log(`${passed}/${total} tests passed`);
  
  if (passed === total) {
    console.log('\n✓ All tests passed!');
    process.exit(0);
  } else {
    console.log('\n✗ Some tests failed');
    process.exit(1);
  }
}

runTests().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
