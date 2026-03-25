/**
 * Tests for API usage reduction (caching + ID fast paths)
 */

import {
  fetchProjects,
  fetchTeams,
  fetchViewer,
  getTeamWorkflowStates,
  resolveProjectRef,
  resolveTeamRef,
} from '../src/linear.js';

async function run() {
  // Test 1: projects are cached
  {
    let projectsCalls = 0;
    const client = {
      apiKey: 'k1',
      projects: async () => {
        projectsCalls += 1;
        return { nodes: [{ id: 'p1', name: 'Project 1' }] };
      },
    };

    await fetchProjects(client);
    await fetchProjects(client);

    if (projectsCalls !== 1) {
      console.error('✗ projects cache failed, calls =', projectsCalls);
      process.exit(1);
    }
    console.log('✓ projects cache');
  }

  // Test 2: teams are cached
  {
    let teamsCalls = 0;
    const client = {
      apiKey: 'k2',
      teams: async () => {
        teamsCalls += 1;
        return { nodes: [{ id: 't1', key: 'ENG', name: 'Engineering' }] };
      },
    };

    await fetchTeams(client);
    await fetchTeams(client);

    if (teamsCalls !== 1) {
      console.error('✗ teams cache failed, calls =', teamsCalls);
      process.exit(1);
    }
    console.log('✓ teams cache');
  }

  // Test 3: viewer is cached
  {
    let viewerReads = 0;
    const client = { apiKey: 'k3' };
    Object.defineProperty(client, 'viewer', {
      get() {
        viewerReads += 1;
        return Promise.resolve({ id: 'u1', name: 'User', displayName: 'User' });
      },
    });

    await fetchViewer(client);
    await fetchViewer(client);

    if (viewerReads !== 1) {
      console.error('✗ viewer cache failed, reads =', viewerReads);
      process.exit(1);
    }
    console.log('✓ viewer cache');
  }

  // Test 4: team states are cached
  {
    let teamCalls = 0;
    let statesCalls = 0;
    const client = {
      apiKey: 'k4',
      team: async () => {
        teamCalls += 1;
        return {
          states: async () => {
            statesCalls += 1;
            return { nodes: [{ id: 's1', name: 'Backlog', type: 'backlog' }] };
          },
        };
      },
    };

    await getTeamWorkflowStates(client, 'team-1');
    await getTeamWorkflowStates(client, 'team-1');

    if (teamCalls !== 1 || statesCalls !== 1) {
      console.error('✗ team states cache failed', { teamCalls, statesCalls });
      process.exit(1);
    }
    console.log('✓ team states cache');
  }

  // Test 5: resolve project by ID uses direct lookup path
  {
    let projectCalls = 0;
    let projectsCalls = 0;
    const id = '12345678-1234-1234-1234-123456789abc';
    const client = {
      apiKey: 'k5',
      project: async (ref) => {
        projectCalls += 1;
        if (ref === id) return { id, name: 'Direct Project' };
        return null;
      },
      projects: async () => {
        projectsCalls += 1;
        return { nodes: [{ id, name: 'Project from list' }] };
      },
    };

    const p = await resolveProjectRef(client, id);
    if (p.id !== id || projectCalls !== 1 || projectsCalls !== 0) {
      console.error('✗ resolveProjectRef ID fast path failed', { p, projectCalls, projectsCalls });
      process.exit(1);
    }
    console.log('✓ resolveProjectRef ID fast path');
  }

  // Test 6: resolve team by ID uses direct lookup path
  {
    let teamCalls = 0;
    let teamsCalls = 0;
    const id = 'abcdef12-1234-1234-1234-abcdef123456';
    const client = {
      apiKey: 'k6',
      team: async (ref) => {
        teamCalls += 1;
        if (ref === id) return { id, key: 'ENG', name: 'Engineering' };
        return null;
      },
      teams: async () => {
        teamsCalls += 1;
        return { nodes: [{ id, key: 'ENG', name: 'Engineering' }] };
      },
    };

    const t = await resolveTeamRef(client, id);
    if (t.id !== id || teamCalls !== 1 || teamsCalls !== 0) {
      console.error('✗ resolveTeamRef ID fast path failed', { t, teamCalls, teamsCalls });
      process.exit(1);
    }
    console.log('✓ resolveTeamRef ID fast path');
  }

  console.log('\n✓ API usage caching tests passed');
}

run().catch((err) => {
  console.error('✗ test-api-usage-caching failed:', err?.message || err);
  process.exit(1);
});
