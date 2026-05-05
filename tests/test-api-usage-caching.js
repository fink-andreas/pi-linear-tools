/**
 * Tests for API usage reduction (caching + ID fast paths)
 */

import {
  createIssue,
  deleteIssue,
  fetchIssueDetails,
  fetchIssueImages,
  fetchProjectMilestones,
  fetchProjects,
  fetchTeams,
  fetchViewer,
  getTeamWorkflowStates,
  resolveIssue,
  resolveProjectRef,
  resolveTeamRef,
  setIssueState,
  updateIssue,
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

  // Test 5: resolve project by ID uses minimal GraphQL lookup path
  {
    let rawRequestCalls = 0;
    let projectsCalls = 0;
    const id = '12345678-1234-1234-1234-123456789abc';
    const client = {
      apiKey: 'k5',
      rawRequest: async (_query, variables) => {
        rawRequestCalls += 1;
        if (variables.id !== id) {
          throw new Error(`Unexpected project id: ${variables.id}`);
        }
        return {
          data: {
            project: { id, name: 'Direct Project', slugId: 'direct-project', archivedAt: null },
          },
          headers: new Headers(),
        };
      },
      projects: async () => {
        projectsCalls += 1;
        return { nodes: [{ id, name: 'Project from list' }] };
      },
    };

    const p = await resolveProjectRef(client, id);
    if (p.id !== id || rawRequestCalls !== 1 || projectsCalls !== 0) {
      console.error('✗ resolveProjectRef ID fast path failed', { p, rawRequestCalls, projectsCalls });
      process.exit(1);
    }
    console.log('✓ resolveProjectRef ID fast path');
  }

  // Test 6: fetch project milestones uses narrow GraphQL query
  {
    let rawRequestCalls = 0;
    const projectId = '87654321-1234-1234-1234-123456789abc';
    const client = {
      apiKey: 'k5b',
      rawRequest: async (_query, variables) => {
        rawRequestCalls += 1;
        if (variables.id !== projectId) {
          throw new Error(`Unexpected project id: ${variables.id}`);
        }
        return {
          data: {
            project: {
              id: projectId,
              name: 'Milestone Project',
              projectMilestones: {
                nodes: [
                  {
                    id: 'm1',
                    name: 'Alpha',
                    description: 'First milestone',
                    progress: 50,
                    order: 1,
                    targetDate: '2026-05-01',
                    status: 'planned',
                  },
                ],
              },
            },
          },
          headers: new Headers(),
        };
      },
    };

    const milestones = await fetchProjectMilestones(client, projectId);
    if (rawRequestCalls !== 1 || milestones.length !== 1 || milestones[0].project?.id !== projectId) {
      console.error('✗ fetchProjectMilestones GraphQL path failed', { rawRequestCalls, milestones });
      process.exit(1);
    }
    console.log('✓ fetchProjectMilestones GraphQL path');
  }

  // Test 7: resolve issue by identifier uses narrow GraphQL query
  {
    let rawRequestCalls = 0;
    const client = {
      apiKey: 'k5c',
      rawRequest: async (_query, variables) => {
        rawRequestCalls += 1;
        if (variables.teamKey !== 'ENG' || variables.number !== 123) {
          throw new Error(`Unexpected issue lookup: ${JSON.stringify(variables)}`);
        }
        return {
          data: {
            issues: {
              nodes: [
                {
                  id: 'issue-1',
                  identifier: 'ENG-123',
                  title: 'GraphQL issue',
                  state: { id: 'state-1', name: 'Backlog', type: 'backlog' },
                  team: { id: 'team-1', key: 'ENG', name: 'Engineering' },
                  project: { id: 'project-1', name: 'Core' },
                },
              ],
            },
          },
          headers: new Headers(),
        };
      },
    };

    const issue = await resolveIssue(client, 'ENG-123');
    if (rawRequestCalls !== 1 || issue.identifier !== 'ENG-123' || issue.team?.key !== 'ENG') {
      console.error('✗ resolveIssue GraphQL path failed', { rawRequestCalls, issue });
      process.exit(1);
    }
    console.log('✓ resolveIssue GraphQL path');
  }

  // Test 8: updateIssue uses narrow GraphQL refetch after mutation when available
  {
    let issueCalls = 0;
    let rawRequestCalls = 0;
    const sdkIssue = {
      id: '12345678-1234-1234-1234-123456789abd',
      identifier: 'ENG-124',
      title: 'Old title',
      state: { id: 'state-1', name: 'Backlog', type: 'backlog' },
      team: { id: 'team-1', key: 'ENG', name: 'Engineering' },
      project: { id: 'project-1', name: 'Core' },
      update: async () => ({ success: true }),
    };
    const client = {
      apiKey: 'k5d',
      issue: async () => {
        issueCalls += 1;
        return sdkIssue;
      },
      rawRequest: async (query, variables) => {
        rawRequestCalls += 1;
        if (query.includes('mutation IssueUpdate')) {
          if (variables.id !== sdkIssue.id || variables.input.title !== 'Updated title') {
            throw new Error(`Unexpected issue update variables: ${JSON.stringify(variables)}`);
          }
          return {
            data: {
              issueUpdate: {
                success: true,
                issue: {
                  id: sdkIssue.id,
                  identifier: 'ENG-124',
                  title: 'Updated title',
                  state: { id: 'state-1', name: 'Backlog', type: 'backlog' },
                  team: { id: 'team-1', key: 'ENG', name: 'Engineering' },
                  project: { id: 'project-1', name: 'Core' },
                },
              },
            },
            headers: new Headers(),
          };
        }

        if (variables.id) {
          if (variables.id !== sdkIssue.id) {
            throw new Error(`Unexpected issue id: ${variables.id}`);
          }
          return {
            data: {
              issue: {
                id: sdkIssue.id,
                identifier: 'ENG-124',
                title: 'Updated title',
                state: { id: 'state-1', name: 'Backlog', type: 'backlog' },
                team: { id: 'team-1', key: 'ENG', name: 'Engineering' },
                project: { id: 'project-1', name: 'Core' },
              },
            },
            headers: new Headers(),
          };
        }

        if (variables.teamKey === 'ENG' && variables.number === 124) {
          return {
            data: {
              issues: {
                nodes: [
                  {
                    id: sdkIssue.id,
                    identifier: 'ENG-124',
                    title: 'Old title',
                    state: { id: 'state-1', name: 'Backlog', type: 'backlog' },
                    team: { id: 'team-1', key: 'ENG', name: 'Engineering' },
                    project: { id: 'project-1', name: 'Core' },
                  },
                ],
              },
            },
            headers: new Headers(),
          };
        }

        throw new Error(`Unexpected rawRequest variables: ${JSON.stringify(variables)}`);
      },
    };

    const result = await updateIssue(client, 'ENG-124', { title: 'Updated title' });
    if (issueCalls !== 0 || rawRequestCalls !== 3 || result.issue.title !== 'Updated title' || result.usedRateLimitFallback) {
      console.error('✗ updateIssue narrow refetch path failed', { issueCalls, rawRequestCalls, result });
      process.exit(1);
    }
    console.log('✓ updateIssue narrow refetch path');
  }

  // Test 9: resolve team by ID uses minimal GraphQL lookup path
  {
    let rawRequestCalls = 0;
    let teamsCalls = 0;
    const id = 'abcdef12-1234-1234-1234-abcdef123456';
    const client = {
      apiKey: 'k6',
      rawRequest: async (_query, variables) => {
        rawRequestCalls += 1;
        if (variables.id !== id) {
          throw new Error(`Unexpected team id: ${variables.id}`);
        }
        return {
          data: {
            team: { id, key: 'ENG', name: 'Engineering' },
          },
          headers: new Headers(),
        };
      },
      teams: async () => {
        teamsCalls += 1;
        return { nodes: [{ id, key: 'ENG', name: 'Engineering' }] };
      },
    };

    const t = await resolveTeamRef(client, id);
    if (t.id !== id || rawRequestCalls !== 1 || teamsCalls !== 0) {
      console.error('✗ resolveTeamRef ID fast path failed', { t, rawRequestCalls, teamsCalls });
      process.exit(1);
    }
    console.log('✓ resolveTeamRef ID fast path');
  }

  // Test 10: team states use narrow GraphQL query and cache
  {
    let rawRequestCalls = 0;
    const teamId = 'fedcba98-1234-1234-1234-abcdef123456';
    const client = {
      apiKey: 'k7',
      rawRequest: async (_query, variables) => {
        rawRequestCalls += 1;
        if (variables.id !== teamId) {
          throw new Error(`Unexpected team id: ${variables.id}`);
        }
        return {
          data: {
            team: {
              id: teamId,
              key: 'ENG',
              name: 'Engineering',
              states: {
                nodes: [
                  { id: 'state-1', name: 'Backlog', type: 'backlog' },
                  { id: 'state-2', name: 'In Progress', type: 'started' },
                ],
              },
            },
          },
          headers: new Headers(),
        };
      },
    };

    const states1 = await getTeamWorkflowStates(client, teamId);
    const states2 = await getTeamWorkflowStates(client, teamId);
    if (rawRequestCalls !== 1 || states1.length !== 2 || states2[1].type !== 'started') {
      console.error('✗ getTeamWorkflowStates GraphQL path failed', { rawRequestCalls, states1, states2 });
      process.exit(1);
    }
    console.log('✓ getTeamWorkflowStates GraphQL path');
  }

  // Test 11: fetchIssueDetails without comments uses narrow query and omits comment payload
  {
    const issueId = '99999999-1234-1234-1234-123456789abc';
    let rawRequestCalls = 0;
    const client = {
      apiKey: 'k8',
      rawRequest: async (query, variables) => {
        rawRequestCalls += 1;
        if (variables.id !== issueId) {
          throw new Error(`Unexpected issue id: ${variables.id}`);
        }
        if (query.includes('comments(first: 100)')) {
          throw new Error('Comments query should not be requested when includeComments=false');
        }
        return {
          data: {
            issue: {
              id: issueId,
              identifier: 'ENG-200',
              title: 'Detailed issue',
              description: 'Issue body',
              url: 'https://linear.app/example/issue/ENG-200',
              branchName: 'feature/eng-200',
              priority: 2,
              estimate: 3,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-02T00:00:00.000Z',
              state: { id: 'state-1', name: 'Backlog', color: '#ccc', type: 'backlog' },
              team: { id: 'team-1', key: 'ENG', name: 'Engineering' },
              project: { id: 'project-1', name: 'Core' },
              projectMilestone: { id: 'milestone-1', name: 'Alpha' },
              assignee: { id: 'user-1', name: 'User', displayName: 'User' },
              creator: { id: 'user-2', name: 'Creator', displayName: 'Creator' },
              labels: { nodes: [{ id: 'label-1', name: 'bug', color: '#f00' }] },
              parent: { id: 'parent-1', identifier: 'ENG-100', title: 'Parent', state: { id: 'state-2', name: 'Done', color: '#0f0' } },
              children: { nodes: [{ id: 'child-1', identifier: 'ENG-201', title: 'Child', state: { id: 'state-3', name: 'Todo', color: '#00f' } }] },
              attachments: { nodes: [{ id: 'att-1', title: 'Spec', url: 'https://example.com/spec', subtitle: 'docs', sourceType: 'notion', createdAt: '2026-01-01T00:00:00.000Z' }] },
            },
          },
          headers: new Headers(),
        };
      },
    };

    const details = await fetchIssueDetails(client, issueId, { includeComments: false });
    if (rawRequestCalls !== 1 || details.comments.length !== 0 || details.attachments.length !== 1 || details.parent?.identifier !== 'ENG-100') {
      console.error('✗ fetchIssueDetails narrow no-comments path failed', { rawRequestCalls, details });
      process.exit(1);
    }
    console.log('✓ fetchIssueDetails narrow no-comments path');
  }

  // Test 12: fetchIssueDetails with comments uses comment query path
  {
    const issueId = '99999999-1234-1234-1234-123456789abd';
    let rawRequestCalls = 0;
    const client = {
      apiKey: 'k9',
      rawRequest: async (query, variables) => {
        rawRequestCalls += 1;
        if (variables.id !== issueId) {
          throw new Error(`Unexpected issue id: ${variables.id}`);
        }
        if (!query.includes('comments(first: 100)')) {
          throw new Error('Comments query should be requested when includeComments=true');
        }
        return {
          data: {
            issue: {
              id: issueId,
              identifier: 'ENG-202',
              title: 'Detailed issue with comments',
              state: { id: 'state-1', name: 'Backlog', color: '#ccc', type: 'backlog' },
              team: { id: 'team-1', key: 'ENG', name: 'Engineering' },
              labels: { nodes: [] },
              children: { nodes: [] },
              attachments: { nodes: [] },
              comments: {
                nodes: [
                  {
                    id: 'comment-1',
                    body: 'hello',
                    createdAt: '2026-01-03T00:00:00.000Z',
                    updatedAt: '2026-01-03T00:00:00.000Z',
                    user: { id: 'user-1', name: 'User', displayName: 'User' },
                    externalUser: null,
                    parent: null,
                  },
                ],
              },
            },
          },
          headers: new Headers(),
        };
      },
    };

    const details = await fetchIssueDetails(client, issueId, { includeComments: true });
    if (rawRequestCalls !== 1 || details.comments.length !== 1 || details.comments[0].body !== 'hello') {
      console.error('✗ fetchIssueDetails comment query path failed', { rawRequestCalls, details });
      process.exit(1);
    }
    console.log('✓ fetchIssueDetails comment query path');
  }

  // Test 13: fetchIssueImages extracts markdown images and authenticates Linear uploads
  {
    const issueId = '99999999-1234-1234-1234-123456789abe';
    const imageUrl = 'https://uploads.linear.app/workspace/asset/image-id';
    let rawRequestCalls = 0;
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;

    const client = {
      apiKey: 'lin_test_raw_key',
      __piLinearTrackerKey: 'lin_test_raw_key',
      rawRequest: async (_query, variables) => {
        rawRequestCalls += 1;
        if (variables.id !== issueId) {
          throw new Error(`Unexpected issue id: ${variables.id}`);
        }
        return {
          data: {
            issue: {
              id: issueId,
              identifier: 'ENG-203',
              title: 'Issue with image',
              description: `Screenshot ![screen](${imageUrl})`,
              url: 'https://linear.app/example/issue/ENG-203',
              state: { id: 'state-1', name: 'Backlog', color: '#ccc', type: 'backlog' },
              team: { id: 'team-1', key: 'ENG', name: 'Engineering' },
              labels: { nodes: [] },
              children: { nodes: [] },
              attachments: { nodes: [] },
              comments: { nodes: [] },
            },
          },
          headers: new Headers(),
        };
      },
    };

    try {
      globalThis.fetch = async (url, options = {}) => {
        fetchCalls += 1;
        if (url !== imageUrl) {
          throw new Error(`Unexpected fetch URL: ${url}`);
        }
        if (options.headers?.authorization !== 'lin_test_raw_key') {
          return new Response('{"error":"unauthorized"}', { status: 401, headers: { 'content-type': 'application/json' } });
        }
        return new Response(Buffer.from('png-bytes'), { status: 200, headers: { 'content-type': 'image/png', 'content-length': '9' } });
      };

      const result = await fetchIssueImages(client, issueId, { includeComments: true });
      if (rawRequestCalls !== 1 || fetchCalls !== 2 || result.images.length !== 1 || result.images[0].mimeType !== 'image/png') {
        console.error('✗ fetchIssueImages authenticated upload path failed', { rawRequestCalls, fetchCalls, result });
        process.exit(1);
      }
      console.log('✓ fetchIssueImages authenticated upload path');
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // Test 14: createIssue uses GraphQL mutation path when available
  {
    let rawRequestCalls = 0;
    const client = {
      apiKey: 'k10',
      rawRequest: async (query, variables) => {
        rawRequestCalls += 1;
        if (!query.includes('mutation IssueCreate')) {
          throw new Error('Expected IssueCreate mutation');
        }
        if (variables.input.teamId !== 'team-1' || variables.input.title !== 'Created issue') {
          throw new Error(`Unexpected create input: ${JSON.stringify(variables.input)}`);
        }
        return {
          data: {
            issueCreate: {
              success: true,
              issue: {
                id: 'issue-create-1',
                identifier: 'ENG-300',
                title: 'Created issue',
                team: { id: 'team-1', key: 'ENG', name: 'Engineering' },
              },
            },
          },
          headers: new Headers(),
        };
      },
    };

    const issue = await createIssue(client, { teamId: 'team-1', title: 'Created issue' });
    if (rawRequestCalls !== 1 || issue.identifier !== 'ENG-300') {
      console.error('✗ createIssue GraphQL path failed', { rawRequestCalls, issue });
      process.exit(1);
    }
    console.log('✓ createIssue GraphQL path');
  }

  // Test 14: setIssueState uses GraphQL mutation path when available
  {
    let rawRequestCalls = 0;
    const client = {
      apiKey: 'k11',
      rawRequest: async (query, variables) => {
        rawRequestCalls += 1;
        if (!query.includes('mutation IssueUpdate')) {
          throw new Error('Expected IssueUpdate mutation');
        }
        if (variables.id !== 'issue-state-1' || variables.input.stateId !== 'state-2') {
          throw new Error(`Unexpected update input: ${JSON.stringify(variables)}`);
        }
        return {
          data: {
            issueUpdate: {
              success: true,
              issue: {
                id: 'issue-state-1',
                identifier: 'ENG-301',
                title: 'Stateful issue',
                state: { id: 'state-2', name: 'In Progress', type: 'started' },
              },
            },
          },
          headers: new Headers(),
        };
      },
    };

    const issue = await setIssueState(client, 'issue-state-1', 'state-2');
    if (rawRequestCalls !== 1 || issue.state?.id !== 'state-2') {
      console.error('✗ setIssueState GraphQL path failed', { rawRequestCalls, issue });
      process.exit(1);
    }
    console.log('✓ setIssueState GraphQL path');
  }

  // Test 15: deleteIssue uses GraphQL mutation path when available
  {
    let rawRequestCalls = 0;
    const client = {
      apiKey: 'k12',
      rawRequest: async (query, variables) => {
        rawRequestCalls += 1;
        if (query.includes('query IssueMinimalByTeamAndNumber')) {
          return {
            data: {
              issues: {
                nodes: [{ id: 'issue-delete-1', identifier: 'ENG-302', title: 'Delete me' }],
              },
            },
            headers: new Headers(),
          };
        }
        if (!query.includes('mutation IssueDelete')) {
          throw new Error('Expected IssueDelete mutation');
        }
        if (variables.id !== 'issue-delete-1') {
          throw new Error(`Unexpected delete id: ${variables.id}`);
        }
        return {
          data: {
            issueDelete: {
              success: true,
              entity: { id: 'issue-delete-1', identifier: 'ENG-302' },
            },
          },
          headers: new Headers(),
        };
      },
    };

    const result = await deleteIssue(client, 'ENG-302');
    if (rawRequestCalls !== 2 || !result.success || result.identifier !== 'ENG-302') {
      console.error('✗ deleteIssue GraphQL path failed', { rawRequestCalls, result });
      process.exit(1);
    }
    console.log('✓ deleteIssue GraphQL path');
  }

  console.log('\n✓ API usage caching tests passed');
}

run().catch((err) => {
  console.error('✗ test-api-usage-caching failed:', err?.message || err);
  process.exit(1);
});
