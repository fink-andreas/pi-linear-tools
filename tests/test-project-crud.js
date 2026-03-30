#!/usr/bin/env node

import assert from 'node:assert/strict';

import extension from '../extensions/pi-linear-tools.js';
import { setTestClientFactory, resetTestClientFactory } from '../src/linear-client.js';

function createMockPi() {
  const tools = new Map();
  return {
    tools,
    registerCommand() {},
    registerTool(definition) {
      tools.set(definition.name, definition);
    },
    sendMessage() {},
    sendUserMessage() {},
    async exec() {
      return { code: 0, stdout: '', stderr: '' };
    },
  };
}

function createProjectPayload(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Roadmap Refresh',
    description: 'Refresh shared roadmap',
    content: null,
    color: '#123456',
    icon: '🚀',
    priority: 2,
    progress: 42,
    health: 'onTrack',
    startDate: '2026-04-01',
    targetDate: '2026-06-30',
    slugId: 'roadmap-refresh',
    url: 'https://linear.app/acme/project/roadmap-refresh',
    archivedAt: null,
    completedAt: null,
    canceledAt: null,
    status: {
      id: 'ps1',
      name: 'In Progress',
      type: 'started',
      color: '#abcdef',
    },
    lead: {
      id: 'u1',
      name: 'Test User',
      displayName: 'Test User',
    },
    teams: {
      nodes: [
        { id: 't1', key: 'ENG', name: 'Engineering' },
      ],
    },
    projectMilestones: {
      nodes: [
        {
          id: 'm1',
          name: 'Phase 1',
          status: 'planned',
          progress: 10,
          targetDate: '2026-05-15',
        },
      ],
    },
    ...overrides,
  };
}

async function testProjectView() {
  const prev = process.env.LINEAR_API_KEY;
  process.env.LINEAR_API_KEY = 'lin_test';

  try {
    const mockClient = {
      projects: async () => ({
        nodes: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Roadmap Refresh' }],
      }),
      rawRequest: async (query, variables) => {
        assert.match(query, /ProjectDetails/);
        assert.equal(variables.id, '11111111-1111-4111-8111-111111111111');
        return {
          data: {
            project: createProjectPayload(),
          },
          headers: new Headers(),
        };
      },
    };

    setTestClientFactory(() => mockClient);

    const pi = createMockPi();
    await extension(pi);

    const tool = pi.tools.get('linear_project');
    const result = await tool.execute('call-project-view', {
      action: 'view',
      project: 'Roadmap Refresh',
    });

    assert.match(result.content[0].text, /Project: Roadmap Refresh/);
    assert.match(result.content[0].text, /\*\*Teams:\*\*\s+`ENG`/);
    assert.match(result.content[0].text, /Milestones \(1\)/);
  } finally {
    resetTestClientFactory();
    process.env.LINEAR_API_KEY = prev;
  }
}

async function testProjectCreate() {
  const prev = process.env.LINEAR_API_KEY;
  process.env.LINEAR_API_KEY = 'lin_test';

  try {
    const mockClient = {
      teams: async () => ({
        nodes: [{ id: 't1', key: 'ENG', name: 'Engineering' }],
      }),
      viewer: Promise.resolve({
        id: 'u1',
        name: 'Test User',
        displayName: 'Test User',
      }),
      rawRequest: async (query, variables) => {
        if (query.includes('ProjectCreate')) {
          assert.equal(variables.input.name, 'Roadmap Refresh');
          assert.deepEqual(variables.input.teamIds, ['t1']);
          assert.equal(variables.input.leadId, 'u1');
          return {
            data: {
              projectCreate: {
                success: true,
                project: { id: '11111111-1111-4111-8111-111111111111', name: 'Roadmap Refresh' },
              },
            },
            headers: new Headers(),
          };
        }

        if (query.includes('ProjectDetails')) {
          return {
            data: {
              project: createProjectPayload(),
            },
            headers: new Headers(),
          };
        }

        throw new Error(`Unexpected query: ${query}`);
      },
    };

    setTestClientFactory(() => mockClient);

    const pi = createMockPi();
    await extension(pi);

    const tool = pi.tools.get('linear_project');
    const result = await tool.execute('call-project-create', {
      action: 'create',
      name: 'Roadmap Refresh',
      teams: 'ENG',
      lead: 'me',
    });

    assert.match(result.content[0].text, /Created project \*\*Roadmap Refresh\*\*/);
    assert.equal(result.details.projectId, '11111111-1111-4111-8111-111111111111');
  } finally {
    resetTestClientFactory();
    process.env.LINEAR_API_KEY = prev;
  }
}

async function testProjectDelete() {
  const prev = process.env.LINEAR_API_KEY;
  process.env.LINEAR_API_KEY = 'lin_test';

  try {
    const mockClient = {
      projects: async () => ({
        nodes: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Roadmap Refresh' }],
      }),
      rawRequest: async (query, variables) => {
        assert.match(query, /ProjectDelete/);
        assert.equal(variables.id, '11111111-1111-4111-8111-111111111111');
        return {
          data: {
            projectDelete: {
              success: true,
              entity: { id: '11111111-1111-4111-8111-111111111111', name: 'Roadmap Refresh' },
            },
          },
          headers: new Headers(),
        };
      },
    };

    setTestClientFactory(() => mockClient);

    const pi = createMockPi();
    await extension(pi);

    const tool = pi.tools.get('linear_project');
    const result = await tool.execute('call-project-delete', {
      action: 'delete',
      project: 'Roadmap Refresh',
    });

    assert.match(result.content[0].text, /Deleted project \*\*Roadmap Refresh\*\* `11111111-1111-4111-8111-111111111111`/);
    assert.equal(result.details.success, true);
  } finally {
    resetTestClientFactory();
    process.env.LINEAR_API_KEY = prev;
  }
}

async function main() {
  await testProjectView();
  await testProjectCreate();
  await testProjectDelete();
  console.log('✓ tests/test-project-crud.js passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
