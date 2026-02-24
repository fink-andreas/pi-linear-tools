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

  return {
    commands,
    tools,
    sentMessages,
    registerCommand(name, definition) {
      commands.set(name, definition);
    },
    registerTool(definition) {
      tools.set(definition.name, definition);
    },
    sendMessage(message) {
      sentMessages.push(message);
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

  assert.ok(pi.tools.has('linear_issue'));
  assert.ok(pi.tools.has('linear_project'));
  assert.ok(pi.tools.has('linear_milestone'));
}

async function testConfigSavesApiKey() {
  await withTempHome(async () => {
    const pi = createMockPi();
    extension(pi);

    const config = pi.commands.get('linear-tools-config').handler;
    await config('--api-key lin_test_123', { hasUI: false });

    const settings = JSON.parse(await readFile(getSettingsPath(), 'utf-8'));
    assert.equal(settings.linearApiKey, 'lin_test_123');
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

async function main() {
  await testRegistration();
  await testConfigSavesApiKey();
  await testConfigSavesDefaultTeam();
  await testIssueToolRequiresApiKey();
  await testIssueToolListUsesSdkWrapper();
  console.log('✓ tests/test-extension-registration.js passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
