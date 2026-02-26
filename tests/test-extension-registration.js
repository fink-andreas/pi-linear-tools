#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import extension from '../extensions/pi-linear-tools.js';
import { getSettingsPath } from '../src/settings.js';
import { setTestClientFactory, resetTestClientFactory } from '../src/linear-client.js';

function createMockPi(execImpl = null) {
  const commands = new Map();
  const tools = new Map();
  const sentMessages = [];
  const sentUserMessages = [];

  return {
    commands,
    tools,
    sentMessages,
    sentUserMessages,
    registerCommand(name, definition) {
      commands.set(name, definition);
    },
    registerTool(definition) {
      tools.set(definition.name, definition);
    },
    sendMessage(message) {
      sentMessages.push(message);
    },
    sendUserMessage(message, options) {
      sentUserMessages.push({ message, options });
    },
    async exec(command, args) {
      if (!execImpl) return { code: 0, stdout: '', stderr: '' };
      return execImpl(command, args);
    },
  };
}

async function withTempHome(fn) {
  const tempHome = await mkdtemp(join(tmpdir(), 'pi-linear-tools-test-home-'));
  const prevHome = process.env.HOME;
  process.env.HOME = tempHome;
  try {
    await fn(tempHome);
  } finally {
    process.env.HOME = prevHome;
  }
}

async function testRegistration() {
  const pi = createMockPi();
  extension(pi);

  assert.ok(pi.commands.has('linear-tools-config'));
  assert.ok(pi.commands.has('linear-tools-help'));
  assert.ok(pi.commands.has('linear-tools-reload'));

  assert.ok(pi.tools.has('linear_issue'));
  assert.ok(pi.tools.has('linear_project'));
  assert.ok(pi.tools.has('linear_team'));
  assert.ok(pi.tools.has('linear_milestone'));
  assert.ok(!pi.tools.has('linear_reload_runtime'));
}

async function testConfigSavesApiKey() {
  await withTempHome(async () => {
    const pi = createMockPi();
    extension(pi);

    const config = pi.commands.get('linear-tools-config').handler;
    await config('--api-key lin_test_123', { hasUI: false });

    const settings = JSON.parse(await readFile(getSettingsPath(), 'utf-8'));
    // After migration, linearApiKey is migrated to apiKey
    assert.equal(settings.apiKey, 'lin_test_123');
  });
}

async function testConfigSavesDefaultTeam() {
  await withTempHome(async () => {
    const pi = createMockPi();
    extension(pi);

    const config = pi.commands.get('linear-tools-config').handler;
    await config('--default-team ENG', { hasUI: false });

    const settings = JSON.parse(await readFile(getSettingsPath(), 'utf-8'));
    assert.equal(settings.defaultTeam, 'ENG');
  });
}

async function testIssueToolRequiresApiKey() {
  const prev = process.env.LINEAR_API_KEY;
  delete process.env.LINEAR_API_KEY;

  try {
    await withTempHome(async () => {
      const pi = createMockPi();
      extension(pi);

      const issueTool = pi.tools.get('linear_issue');
      await assert.rejects(
        () => issueTool.execute('call-1', { action: 'list', project: 'demo' }),
        /LINEAR_API_KEY not set/
      );
    });
  } finally {
    process.env.LINEAR_API_KEY = prev;
  }
}

async function testIssueToolListUsesSdkWrapper() {
  const prev = process.env.LINEAR_API_KEY;
  process.env.LINEAR_API_KEY = 'lin_test';

  try {
    const mockClient = {
      viewer: Promise.resolve({ id: 'u1', name: 'Tester', displayName: 'Tester' }),
      projects: async () => ({
        nodes: [{ id: 'p1', name: 'demo' }],
      }),
      issues: async () => ({
        nodes: [
          {
            id: 'i1',
            identifier: 'DEM-1',
            title: 'Test issue',
            priority: 2,
            state: Promise.resolve({ id: 's1', name: 'Todo', type: 'unstarted' }),
            team: Promise.resolve({ id: 't1', key: 'ENG', name: 'ENG' }),
            project: Promise.resolve({ id: 'p1', name: 'demo' }),
            assignee: Promise.resolve({ id: 'u1', name: 'Tester', displayName: 'Tester' }),
          },
        ],
        pageInfo: { hasNextPage: false },
      }),
    };

    setTestClientFactory(() => mockClient);

    const pi = createMockPi();
    extension(pi);

    const issueTool = pi.tools.get('linear_issue');
    const result = await issueTool.execute('call-2', { action: 'list', project: 'demo' });

    assert.match(result.content[0].text, /Issues in project/);
    assert.match(result.content[0].text, /DEM-1/);
  } finally {
    resetTestClientFactory();
    process.env.LINEAR_API_KEY = prev;
  }
}

async function testMilestoneListIncludesIds() {
  const prev = process.env.LINEAR_API_KEY;
  process.env.LINEAR_API_KEY = 'lin_test';

  try {
    const mockProject = { id: 'p1', name: 'demo' };
    const mockClient = {
      projects: async () => ({
        nodes: [mockProject],
      }),
      project: async (projectId) => {
        if (projectId !== 'p1') return null;
        return {
          id: 'p1',
          name: 'demo',
          projectMilestones: async () => ({
            nodes: [
              {
                id: 'm1',
                name: 'Release v0.2.0',
                description: 'Prepare and ship release',
                progress: 25,
                order: 1,
                targetDate: '2026-06-30',
                status: 'planned',
                project: Promise.resolve(mockProject),
              },
            ],
          }),
        };
      },
    };

    setTestClientFactory(() => mockClient);

    const pi = createMockPi();
    extension(pi);

    const milestoneTool = pi.tools.get('linear_milestone');
    const result = await milestoneTool.execute('call-m1', { action: 'list', project: 'demo' });

    assert.match(result.content[0].text, /Release v0\.2\.0/);
    assert.match(result.content[0].text, /`m1`/);
  } finally {
    resetTestClientFactory();
    process.env.LINEAR_API_KEY = prev;
  }
}

async function testMilestoneDeleteIncludesName() {
  const prev = process.env.LINEAR_API_KEY;
  process.env.LINEAR_API_KEY = 'lin_test';

  try {
    const mockClient = {
      projectMilestone: async (milestoneId) => {
        if (milestoneId !== 'm1') return null;
        return { id: 'm1', name: 'Release v0.2.0' };
      },
      deleteProjectMilestone: async (milestoneId) => ({ success: milestoneId === 'm1' }),
    };

    setTestClientFactory(() => mockClient);

    const pi = createMockPi();
    extension(pi);

    const milestoneTool = pi.tools.get('linear_milestone');
    const result = await milestoneTool.execute('call-m2', { action: 'delete', milestone: 'm1' });

    assert.match(result.content[0].text, /Deleted milestone \*\*Release v0\.2\.0\*\*/);
    assert.match(result.content[0].text, /`m1`/);
    assert.equal(result.details.name, 'Release v0.2.0');
  } finally {
    resetTestClientFactory();
    process.env.LINEAR_API_KEY = prev;
  }
}

async function testInteractiveConfigWizard() {
  const prev = process.env.LINEAR_API_KEY;
  delete process.env.LINEAR_API_KEY;

  try {
    await withTempHome(async () => {
      const mockClient = {
        viewer: Promise.resolve({
          id: 'u1',
          name: 'Tester',
          displayName: 'Tester',
          organization: Promise.resolve({ id: 'w1', name: 'Workspace One', urlKey: 'workspace-one' }),
        }),
        teams: async () => ({
          nodes: [{ id: 't1', key: 'ENG', name: 'Engineering' }],
        }),
      };

      setTestClientFactory(() => mockClient);

      const pi = createMockPi();
      extension(pi);

      const config = pi.commands.get('linear-tools-config').handler;

      const ctx = {
        hasUI: true,
        ui: {
          async select(_title, options) {
            if (options.includes('OAuth')) return 'API Key';
            if (options[0].includes('Workspace One')) return options[0];
            if (options[0].includes('ENG')) return options[0];
            return undefined;
          },
          async input() {
            return 'lin_interactive_key';
          },
          notify() {},
        },
      };

      await config('', ctx);

      const settings = JSON.parse(await readFile(getSettingsPath(), 'utf-8'));
      assert.equal(settings.apiKey, 'lin_interactive_key');
      assert.equal(settings.defaultTeam, 'ENG');
      assert.equal(settings.defaultWorkspace.id, 'w1');
      assert.equal(settings.defaultWorkspace.name, 'Workspace One');
    });
  } finally {
    resetTestClientFactory();
    process.env.LINEAR_API_KEY = prev;
  }
}

async function main() {
  await testRegistration();
  await testConfigSavesApiKey();
  await testConfigSavesDefaultTeam();
  await testIssueToolRequiresApiKey();
  await testIssueToolListUsesSdkWrapper();
  await testMilestoneListIncludesIds();
  await testMilestoneDeleteIncludesName();
  await testInteractiveConfigWizard();
  console.log('✓ tests/test-extension-registration.js passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
