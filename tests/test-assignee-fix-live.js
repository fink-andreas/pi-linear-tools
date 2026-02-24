#!/usr/bin/env node

/**
 * Test script to verify assignee fix works with real Linear API
 * This tests the actual functions used by the extension
 */

import { createLinearClient } from '../src/linear-client.js';
import { createIssue, updateIssue } from '../src/linear.js';

const apiKey = process.env.LINEAR_API_KEY;

if (!apiKey) {
  console.error('Error: LINEAR_API_KEY environment variable is not set');
  process.exit(1);
}

const client = createLinearClient(apiKey);

async function testAssigneeFix() {
  console.log('Testing assignee fix with live Linear API...\n');

  try {
    // Step 1: Get viewer ID (for "me")
    const viewer = await client.viewer;
    console.log(`Current user: ${viewer.displayName} (${viewer.id})\n`);

    // Step 2: Get teams
    const teams = await client.teams();
    const team = teams.nodes[0];

    if (!team) {
      console.error('Error: No teams found');
      process.exit(1);
    }

    console.log(`Using team: ${team.key} (${team.name})\n`);

    // Step 3: Create a new issue
    console.log('Step 1: Creating new issue...');
    const createResult = await createIssue(client, {
      teamId: team.id,
      title: 'Test issue for assignee fix',
      description: 'Testing if the assignee update works after the fix',
    });

    console.log(`✓ Created issue: ${createResult.identifier} - ${createResult.title}`);
    console.log(`  Assignee: ${createResult.assignee?.displayName || 'Unassigned'}\n`);

    // Step 4: Try to assign to "me"
    console.log('Step 2: Assigning issue to "me"...');
    const updateResult = await updateIssue(client, createResult.identifier, {
      assigneeId: viewer.id,
    });

    console.log(`✓ Updated issue: ${updateResult.issue.identifier}`);
    console.log(`  Changed fields: ${updateResult.changed.join(', ')}`);
    console.log(`  Assignee: ${updateResult.issue.assignee?.displayName || 'Unassigned'}\n`);

    // Verify the assignee was set
    if (updateResult.issue.assignee?.id === viewer.id) {
      console.log('✅ SUCCESS: Issue was assigned correctly to the current user!');
      console.log('\nTest completed successfully!');
    } else {
      console.log('❌ FAILED: Issue was not assigned correctly');
      console.log(`  Expected assignee ID: ${viewer.id}`);
      console.log(`  Actual assignee ID: ${updateResult.issue.assignee?.id || 'null'}`);
      process.exit(1);
    }

  } catch (err) {
    console.error('❌ Test failed:', err.message);
    if (err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

testAssigneeFix();