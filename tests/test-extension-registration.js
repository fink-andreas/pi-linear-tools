#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import extension from '../extensions/pi-linear-tools.js';
import { getSettingsPath, loadSettings, saveSettings } from '../src/settings.js';
import { setTestClientFactory, resetTestClientFactory } from '../src/linear-client.js';
import { storeTokens, getTokens } from '../src/auth/token-store.js';

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

async function setAuthSettings(overrides = {}) {
  const current = await loadSettings();
  await saveSettings({ ...current, ...overrides });
}

async function testRegistrationIncludesMilestoneWithDefaultApiKeyMode() {
  await withTempHome(async () => {
    const pi = createMockPi();
    await extension(pi);

    assert.ok(pi.commands.has('linear-tools-config'));
    assert.ok(pi.commands.has('linear-tools-help'));
    assert.ok(pi.commands.has('linear-tools-reload'));

    assert.ok(pi.tools.has('linear_issue'));
    assert.ok(pi.tools.has('linear_project'));
    assert.ok(pi.tools.has('linear_team'));
    assert.ok(pi.tools.has('linear_milestone'));
    assert.ok(!pi.tools.has('linear_reload_runtime'));
  });
}

async function testRegistrationHidesMilestoneForOAuthWithoutApiKey() {
  const prevApi = process.env.LINEAR_API_KEY;
  delete process.env.LINEAR_API_KEY;

  try {
    await withTempHome(async () => {
      await setAuthSettings({ authMethod: 'oauth', apiKey: null });

      const pi = createMockPi();
      await extension(pi);

      assert.ok(pi.tools.has('linear_issue'));
      assert.ok(pi.tools.has('linear_project'));
      assert.ok(pi.tools.has('linear_team'));
      assert.ok(!pi.tools.has('linear_milestone'));
    });
  } finally {
    process.env.LINEAR_API_KEY = prevApi;
  }
}

async function testRegistrationShowsMilestoneWhenOAuthHasApiKeyOverride() {
  const prevApi = process.env.LINEAR_API_KEY;
  process.env.LINEAR_API_KEY = 'lin_env_override';

  try {
    await withTempHome(async () => {
      await setAuthSettings({ authMethod: 'oauth', apiKey: null });

      const pi = createMockPi();
      await extension(pi);

      assert.ok(pi.tools.has('linear_milestone'));
    });
  } finally {
    process.env.LINEAR_API_KEY = prevApi;
  }
}

async function testConfigSavesApiKey() {
  await withTempHome(async () => {
    const pi = createMockPi();
    await extension(pi);

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
    await extension(pi);

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
      await extension(pi);

      const issueTool = pi.tools.get('linear_issue');
      await assert.rejects(
        () => issueTool.execute('call-1', { action: 'list', project: 'demo' }),
        /No Linear authentication configured|LINEAR_API_KEY not set/
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
    await extension(pi);

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
    await extension(pi);

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
    await extension(pi);

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

async function testMilestoneScopeErrorHint() {
  const prev = process.env.LINEAR_API_KEY;
  process.env.LINEAR_API_KEY = 'lin_test';

  try {
    const mockClient = {
      projects: async () => ({
        nodes: [{ id: 'p1', name: 'demo' }],
      }),
      createProjectMilestone: async () => {
        throw new Error('Invalid scope: `write` required');
      },
    };

    setTestClientFactory(() => mockClient);

    const pi = createMockPi();
    await extension(pi);

    const milestoneTool = pi.tools.get('linear_milestone');
    await assert.rejects(
      () => milestoneTool.execute('call-m3', { action: 'create', project: 'demo', name: 'Test' }),
      /Use API key auth for milestone management/
    );
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
      await extension(pi);

      const config = pi.commands.get('linear-tools-config').handler;

      const ctx = {
        hasUI: true,
        ui: {
          async select(_title, options) {
            if (options.some((option) => option.startsWith('API Key'))) return options.find((option) => option.startsWith('API Key'));
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

async function testInteractiveConfigWizardOAuth() {
  const prevApi = process.env.LINEAR_API_KEY;
  const prevAccess = process.env.LINEAR_ACCESS_TOKEN;
  const prevRefresh = process.env.LINEAR_REFRESH_TOKEN;
  const prevExpires = process.env.LINEAR_EXPIRES_AT;

  delete process.env.LINEAR_API_KEY;
  process.env.LINEAR_ACCESS_TOKEN = 'oauth_access_test';
  process.env.LINEAR_REFRESH_TOKEN = 'oauth_refresh_test';
  process.env.LINEAR_EXPIRES_AT = String(Date.now() + 60 * 60 * 1000);

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
      await extension(pi);

      const config = pi.commands.get('linear-tools-config').handler;

      const ctx = {
        hasUI: true,
        ui: {
          async select(_title, options) {
            if (options.includes('No') && options.includes('Yes')) return 'No';
            if (options.includes('OAuth')) return 'OAuth';
            if (options[0].includes('Workspace One')) return options[0];
            if (options[0].includes('ENG')) return options[0];
            return undefined;
          },
          async input() {
            throw new Error('API key prompt should not be shown for OAuth flow');
          },
          notify() {},
        },
      };

      await config('', ctx);

      const settings = JSON.parse(await readFile(getSettingsPath(), 'utf-8'));
      assert.equal(settings.authMethod, 'oauth');
      assert.equal(settings.defaultTeam, 'ENG');
      assert.equal(settings.defaultWorkspace.id, 'w1');
      assert.equal(settings.defaultWorkspace.name, 'Workspace One');
    });
  } finally {
    resetTestClientFactory();
    process.env.LINEAR_API_KEY = prevApi;
    process.env.LINEAR_ACCESS_TOKEN = prevAccess;
    process.env.LINEAR_REFRESH_TOKEN = prevRefresh;
    process.env.LINEAR_EXPIRES_AT = prevExpires;
  }
}

async function testInteractiveConfigSwitchToApiKeyClearsOAuthTokensAndShowsRestartMessage() {
  const prevApi = process.env.LINEAR_API_KEY;
  const prevAccess = process.env.LINEAR_ACCESS_TOKEN;
  const prevRefresh = process.env.LINEAR_REFRESH_TOKEN;
  const prevExpires = process.env.LINEAR_EXPIRES_AT;

  delete process.env.LINEAR_API_KEY;
  delete process.env.LINEAR_ACCESS_TOKEN;
  delete process.env.LINEAR_REFRESH_TOKEN;
  delete process.env.LINEAR_EXPIRES_AT;

  try {
    await withTempHome(async () => {
      await setAuthSettings({ authMethod: 'oauth', apiKey: null });

      await storeTokens({
        accessToken: 'oauth_access_existing',
        refreshToken: 'oauth_refresh_existing',
        expiresAt: Date.now() + 60 * 60 * 1000,
        scope: ['read'],
        tokenType: 'Bearer',
      });

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
      await extension(pi);

      const config = pi.commands.get('linear-tools-config').handler;
      let reloadCalled = false;
      const notifications = [];

      const ctx = {
        hasUI: true,
        async reload() {
          reloadCalled = true;
        },
        ui: {
          async select(_title, options) {
            if (options.includes('No') && options.includes('Yes')) return 'Yes';
            if (options.includes('OAuth') && options.some((option) => option.startsWith('API Key'))) {
              return options.find((option) => option.startsWith('API Key'));
            }
            if (options[0].includes('Workspace One')) return options[0];
            if (options[0].includes('ENG')) return options[0];
            return undefined;
          },
          async input(title) {
            if (title.includes('Enter Linear API key')) return 'lin_api_switched';
            throw new Error(`Unexpected input prompt: ${title}`);
          },
          notify(message, level) {
            notifications.push({ message, level });
          },
        },
      };

      await config('', ctx);

      const settings = JSON.parse(await readFile(getSettingsPath(), 'utf-8'));
      assert.equal(settings.authMethod, 'api-key');
      assert.equal(settings.apiKey, 'lin_api_switched');
      assert.equal(await getTokens(), null);
      assert.equal(reloadCalled, false);
      assert.ok(
        notifications.some((entry) =>
          String(entry.message).includes('Please restart pi to refresh and make the correct tools available.')
        )
      );
    });
  } finally {
    resetTestClientFactory();
    process.env.LINEAR_API_KEY = prevApi;
    process.env.LINEAR_ACCESS_TOKEN = prevAccess;
    process.env.LINEAR_REFRESH_TOKEN = prevRefresh;
    process.env.LINEAR_EXPIRES_AT = prevExpires;
  }
}

async function main() {
  await testRegistrationIncludesMilestoneWithDefaultApiKeyMode();
  await testRegistrationHidesMilestoneForOAuthWithoutApiKey();
  await testRegistrationShowsMilestoneWhenOAuthHasApiKeyOverride();
  await testConfigSavesApiKey();
  await testConfigSavesDefaultTeam();
  await testIssueToolRequiresApiKey();
  await testIssueToolListUsesSdkWrapper();
  await testMilestoneListIncludesIds();
  await testMilestoneDeleteIncludesName();
  await testMilestoneScopeErrorHint();
  await testInteractiveConfigWizard();
  await testInteractiveConfigWizardOAuth();
  await testInteractiveConfigSwitchToApiKeyClearsOAuthTokensAndShowsRestartMessage();
  console.log('✓ tests/test-extension-registration.js passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
