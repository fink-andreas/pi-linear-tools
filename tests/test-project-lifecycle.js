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

function createProjectPayload() {
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
      nodes: [{ id: 't1', key: 'ENG', name: 'Engineering' }],
    },
    projectMilestones: {
      nodes: [],
    },
  };
}

async function testProjectArchiveAndUnarchive() {
  const prev = process.env.LINEAR_API_KEY;
  process.env.LINEAR_API_KEY = 'lin_test';

  try {
    const mockClient = {
      projects: async () => ({
        nodes: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Roadmap Refresh' }],
      }),
      rawRequest: async (query, variables) => {
        if (query.includes('ProjectArchive')) {
          assert.equal(variables.id, '11111111-1111-4111-8111-111111111111');
          return {
            data: {
              projectArchive: {
                success: true,
                entity: { id: variables.id, name: 'Roadmap Refresh' },
              },
            },
            headers: new Headers(),
          };
        }

        if (query.includes('ProjectUnarchive')) {
          assert.equal(variables.id, '11111111-1111-4111-8111-111111111111');
          return {
            data: {
              projectUnarchive: {
                success: true,
                entity: { id: variables.id, name: 'Roadmap Refresh' },
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

    const projectTool = pi.tools.get('linear_project');

    const archiveResult = await projectTool.execute('call-project-archive', {
      action: 'archive',
      project: 'Roadmap Refresh',
    });
    assert.match(archiveResult.content[0].text, /Archived project \*\*Roadmap Refresh\*\*/);

    const unarchiveResult = await projectTool.execute('call-project-unarchive', {
      action: 'unarchive',
      project: '11111111-1111-4111-8111-111111111111',
    });
    assert.match(unarchiveResult.content[0].text, /Unarchived project \*\*Roadmap Refresh\*\*/);
  } finally {
    resetTestClientFactory();
    process.env.LINEAR_API_KEY = prev;
  }
}

async function testProjectUpdateTool() {
  const prev = process.env.LINEAR_API_KEY;
  process.env.LINEAR_API_KEY = 'lin_test';

  try {
    const mockClient = {
      projects: async () => ({
        nodes: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Roadmap Refresh' }],
      }),
      rawRequest: async (query, variables) => {
        if (query.includes('ProjectUpdatesByProject')) {
          return {
            data: {
              project: {
                id: '11111111-1111-4111-8111-111111111111',
                name: 'Roadmap Refresh',
                projectUpdates: {
                  nodes: [
                    {
                      id: '22222222-2222-4222-8222-222222222222',
                      body: 'Weekly progress update',
                      health: 'onTrack',
                      createdAt: '2026-03-30T00:00:00.000Z',
                      updatedAt: '2026-03-30T00:00:00.000Z',
                      archivedAt: null,
                      url: 'https://linear.app/acme/update/1',
                      slugId: 'weekly-progress-update',
                      isDiffHidden: false,
                      isStale: false,
                      user: {
                        id: 'u1',
                        name: 'Test User',
                        displayName: 'Test User',
                      },
                    },
                  ],
                },
              },
            },
            headers: new Headers(),
          };
        }

        if (query.includes('ProjectUpdateCreate')) {
          assert.equal(variables.input.projectId, '11111111-1111-4111-8111-111111111111');
          assert.equal(variables.input.health, 'onTrack');
          return {
            data: {
              projectUpdateCreate: {
                success: true,
                projectUpdate: { id: '22222222-2222-4222-8222-222222222222' },
              },
            },
            headers: new Headers(),
          };
        }

        if (query.includes('ProjectUpdateDetails')) {
          return {
            data: {
              projectUpdate: {
                id: '22222222-2222-4222-8222-222222222222',
                body: 'Weekly progress update',
                health: 'onTrack',
                createdAt: '2026-03-30T00:00:00.000Z',
                updatedAt: '2026-03-30T00:00:00.000Z',
                archivedAt: null,
                editedAt: null,
                url: 'https://linear.app/acme/update/1',
                slugId: 'weekly-progress-update',
                isDiffHidden: false,
                isStale: false,
                project: {
                  id: '11111111-1111-4111-8111-111111111111',
                  name: 'Roadmap Refresh',
                },
                user: {
                  id: 'u1',
                  name: 'Test User',
                  displayName: 'Test User',
                },
              },
            },
            headers: new Headers(),
          };
        }

        if (query.includes('ProjectUpdateArchive')) {
          return {
            data: {
              projectUpdateArchive: {
                success: true,
                entity: { id: '22222222-2222-4222-8222-222222222222' },
              },
            },
            headers: new Headers(),
          };
        }

        if (query.includes('ProjectUpdateUnarchive')) {
          return {
            data: {
              projectUpdateUnarchive: {
                success: true,
                entity: { id: '22222222-2222-4222-8222-222222222222' },
              },
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

    const projectUpdateTool = pi.tools.get('linear_project_update');

    const listResult = await projectUpdateTool.execute('call-project-update-list', {
      action: 'list',
      project: 'Roadmap Refresh',
    });
    assert.match(listResult.content[0].text, /Project updates for "Roadmap Refresh"/);
    assert.match(listResult.content[0].text, /Weekly progress update/);

    const createResult = await projectUpdateTool.execute('call-project-update-create', {
      action: 'create',
      project: 'Roadmap Refresh',
      body: 'Weekly progress update',
      health: 'onTrack',
    });
    assert.match(createResult.content[0].text, /Created project update \*\*22222222-2222-4222-8222-222222222222\*\*/);

    const archiveResult = await projectUpdateTool.execute('call-project-update-archive', {
      action: 'archive',
      projectUpdate: '22222222-2222-4222-8222-222222222222',
    });
    assert.match(archiveResult.content[0].text, /Archived project update \*\*22222222-2222-4222-8222-222222222222\*\*/);

    const unarchiveResult = await projectUpdateTool.execute('call-project-update-unarchive', {
      action: 'unarchive',
      projectUpdate: '22222222-2222-4222-8222-222222222222',
    });
    assert.match(unarchiveResult.content[0].text, /Unarchived project update \*\*22222222-2222-4222-8222-222222222222\*\*/);
  } finally {
    resetTestClientFactory();
    process.env.LINEAR_API_KEY = prev;
  }
}

async function main() {
  await testProjectArchiveAndUnarchive();
  await testProjectUpdateTool();
  console.log('✓ tests/test-project-lifecycle.js passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
