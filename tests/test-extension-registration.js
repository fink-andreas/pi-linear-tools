#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import extension from '../extensions/pi-linear-tools.js';
import { getSettingsPath, loadSettings, saveSettings } from '../src/settings.js';
import { setTestClientFactory, resetTestClientFactory, markRateLimited, setTestRateLimitTracker, clearTestRateLimitTracker } from '../src/linear-client.js';
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
    assert.ok(pi.tools.has('linear_project_update'));
    assert.ok(pi.tools.has('linear_team'));
    assert.ok(pi.tools.has('linear_milestone'));
    assert.ok(!pi.tools.has('linear_reload_runtime'));

    const issueTool = pi.tools.get('linear_issue');
    assert.ok(issueTool);
    assert.equal(issueTool.description, 'Interact with Linear issues.');
    assert.ok(issueTool.parameters.properties.action.enum.includes('activity'));

    const projectTool = pi.tools.get('linear_project');
    assert.ok(projectTool);
    assert.equal(projectTool.description, 'Interact with Linear projects.');

    const projectUpdateTool = pi.tools.get('linear_project_update');
    assert.ok(projectUpdateTool);
    assert.equal(projectUpdateTool.description, 'Interact with Linear project updates.');

    const teamTool = pi.tools.get('linear_team');
    assert.ok(teamTool);
    assert.equal(teamTool.description, 'Interact with Linear teams.');

    const milestoneTool = pi.tools.get('linear_milestone');
    assert.ok(milestoneTool);
    assert.equal(milestoneTool.description, 'Interact with Linear project milestones.');
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
      assert.ok(pi.tools.has('linear_project_update'));
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

async function testIssueToolReturnsSafeResultWhenAuthMissing() {
  const prev = process.env.LINEAR_API_KEY;
  delete process.env.LINEAR_API_KEY;

  try {
    await withTempHome(async () => {
      const pi = createMockPi();
      await extension(pi);

      const issueTool = pi.tools.get('linear_issue');
      const result = await issueTool.execute('call-1', { action: 'list', project: 'demo' });

      assert.match(result.content[0].text, /No Linear authentication configured|LINEAR_API_KEY not set/);
      assert.equal(result.details.error, true);
      assert.equal(result.details.rateLimited, false);
    });
  } finally {
    process.env.LINEAR_API_KEY = prev;
  }
}

async function testIssueToolReturnsSafeResultWhenCachedRateLimited() {
  const prev = process.env.LINEAR_API_KEY;
  process.env.LINEAR_API_KEY = 'lin_test';

  try {
    const pi = createMockPi();
    await extension(pi);

    markRateLimited(Date.now() + 60 * 1000);

    const issueTool = pi.tools.get('linear_issue');
    const result = await issueTool.execute('call-rate-cached', { action: 'list', project: 'demo' });

    assert.match(result.content[0].text, /rate limit exceeded \(cached\)/i);
    assert.equal(result.details.rateLimited, true);
    assert.equal(result.details.cached, true);
  } finally {
    markRateLimited(Date.now() - 1);
    process.env.LINEAR_API_KEY = prev;
  }
}

async function testIssueToolReturnsSafeResultWhenRequestRateLimited() {
  const prev = process.env.LINEAR_API_KEY;
  process.env.LINEAR_API_KEY = 'lin_test';

  try {
    const rateLimitError = new Error('Rate limit exceeded. Only 4500 requests are allowed per 1 hour.');
    rateLimitError.type = 'Ratelimited';
    rateLimitError.requestsResetAt = Date.now() + 60 * 1000;

    const mockClient = {
      projects: async () => {
        throw rateLimitError;
      },
    };

    setTestClientFactory(() => mockClient);

    const pi = createMockPi();
    await extension(pi);

    const issueTool = pi.tools.get('linear_issue');
    const result = await issueTool.execute('call-rate-live', { action: 'list', project: 'demo' });

    assert.match(result.content[0].text, /Linear API rate limit exceeded/i);
    assert.equal(result.details.rateLimited, true);
    assert.equal(result.details.cached, false);
  } finally {
    resetTestClientFactory();
    markRateLimited(Date.now() - 1);
    process.env.LINEAR_API_KEY = prev;
  }
}

async function testProjectToolReturnsSafeResultWhenProjectQueryRateLimited() {
  const prev = process.env.LINEAR_API_KEY;
  process.env.LINEAR_API_KEY = 'lin_test';

  try {
    const rateLimitError = new Error('Rate limit exceeded. Only 4500 requests are allowed per 1 hour.');
    rateLimitError.type = 'Ratelimited';
    rateLimitError.requestsResetAt = Date.now() + 60 * 1000;

    const mockClient = {
      projects: async () => ({
        nodes: [{ id: 'p1', name: 'demo', slugId: 'demo', archivedAt: null }],
      }),
      client: {
        rawRequest: async (query) => {
          if (query.includes('ProjectDetails')) {
            throw rateLimitError;
          }

          throw new Error(`Unexpected query: ${query}`);
        },
      },
    };

    setTestClientFactory(() => mockClient);

    const pi = createMockPi();
    await extension(pi);

    const projectTool = pi.tools.get('linear_project');
    const result = await projectTool.execute('call-project-rate-live', { action: 'view', project: 'demo' });

    assert.match(result.content[0].text, /Linear API rate limit exceeded/i);
    assert.equal(result.details.rateLimited, true);
    assert.equal(result.details.cached, false);
  } finally {
    resetTestClientFactory();
    markRateLimited(Date.now() - 1);
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
    // Use a UUID-format ID so the code recognizes it as an ID (not a name)
    const milestoneId = '0123456789012345';
    const mockClient = {
      projectMilestone: async (id) => {
        if (id !== milestoneId) return null;
        return { id: milestoneId, name: 'Release v0.2.0' };
      },
      deleteProjectMilestone: async (id) => ({ success: id === milestoneId }),
    };

    setTestClientFactory(() => mockClient);

    const pi = createMockPi();
    await extension(pi);

    const milestoneTool = pi.tools.get('linear_milestone');
    const result = await milestoneTool.execute('call-m2', { action: 'delete', milestone: milestoneId });

    assert.match(result.content[0].text, /Deleted milestone \*\*Release v0\.2\.0\*\*/);
    assert.match(result.content[0].text, new RegExp(`\`${milestoneId}\``));
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
    const result = await milestoneTool.execute('call-m3', { action: 'create', project: 'demo', name: 'Test' });

    assert.match(result.content[0].text, /Use API key auth for milestone management/);
    assert.equal(result.details.error, true);
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
  await testIssueToolReturnsSafeResultWhenAuthMissing();
  await testIssueToolReturnsSafeResultWhenCachedRateLimited();
  await testIssueToolReturnsSafeResultWhenRequestRateLimited();
  await testProjectToolReturnsSafeResultWhenProjectQueryRateLimited();
  await testIssueToolListUsesSdkWrapper();
  await testMilestoneListIncludesIds();
  await testMilestoneDeleteIncludesName();
  await testMilestoneScopeErrorHint();
  await testInteractiveConfigWizard();
  await testInteractiveConfigWizardOAuth();
  await testInteractiveConfigSwitchToApiKeyClearsOAuthTokensAndShowsRestartMessage();
  await testRateLimitDebugIncludesRateLimitInResult();
  await testRateLimitDebugExcludesRateLimitFromResult();
  console.log('✓ tests/test-extension-registration.js passed');
}

async function testRateLimitDebugIncludesRateLimitInResult() {
  await withTempHome(async () => {
    const prev = process.env.LINEAR_API_KEY;
    process.env.LINEAR_API_KEY = 'lin_test';

    try {
      // Enable rate limit debug
      await setAuthSettings({ rateLimitDebug: true });

      // Set up rate limit tracker state directly
      setTestRateLimitTracker('lin_test', {
        limit: 100,
        remaining: 50,
        resetAt: Date.now() + 3600000,
      });

      const mockClient = {
        projects: async () => ({ nodes: [] }),
        client: {
          rawRequest: async () => ({
            headers: new Map([
              ['X-RateLimit-Requests-Limit', '100'],
              ['X-RateLimit-Requests-Remaining', '50'],
              ['X-RateLimit-Requests-Reset', String(Date.now() + 3600000)],
            ]),
          }),
        },
        __piLinearTrackerKey: 'lin_test',
      };

      setTestClientFactory(() => mockClient);

      const pi = createMockPi();
      await extension(pi);

      const projectTool = pi.tools.get('linear_project');
      const result = await projectTool.execute('call-debug', { action: 'list' });

      // When rateLimitDebug is true, result should include rateLimit info
      assert.ok(result.details.rateLimit, 'Result should include rateLimit info when debug enabled');
      assert.equal(result.details.rateLimit.total, 100, 'RateLimit should use the dynamic request limit');
      assert.equal(result.details.rateLimit.remaining, 50, 'RateLimit should have remaining');
      assert.equal(result.details.rateLimit.used, 50, 'RateLimit should have used');
      assert.equal(result.details.rateLimit.usagePercent, 50, 'RateLimit should have usagePercent');
      assert.equal(result.details.rateLimit.requestsDelta, 0, 'RateLimit should include this-call request delta');

      const text = result.content?.[0]?.text || '';
      assert.match(text, /\+0 requests this call/, 'Debug text should show this-call request delta');
      assert.match(text, /request window: 50\/100 used \(50%\)/, 'Debug text should show cumulative request window usage separately');
    } finally {
      resetTestClientFactory();
      clearTestRateLimitTracker();
      await setAuthSettings({ rateLimitDebug: false });
      process.env.LINEAR_API_KEY = prev;
    }
  });
}

async function testRateLimitDebugExcludesRateLimitFromResult() {
  await withTempHome(async () => {
    const prev = process.env.LINEAR_API_KEY;
    process.env.LINEAR_API_KEY = 'lin_test';

    try {
      // Disable rate limit debug (default)
      await setAuthSettings({ rateLimitDebug: false });

      // Set up rate limit tracker state directly
      setTestRateLimitTracker('lin_test', {
        remaining: 4500,
        resetAt: Date.now() + 3600000,
      });

      const mockClient = {
        projects: async () => ({ nodes: [] }),
        client: {
          rawRequest: async () => ({
            headers: new Map([
              ['X-RateLimit-Requests-Remaining', '4500'],
              ['X-RateLimit-Requests-Reset', String(Date.now() + 3600000)],
            ]),
          }),
        },
        __piLinearTrackerKey: 'lin_test',
      };

      setTestClientFactory(() => mockClient);

      const pi = createMockPi();
      await extension(pi);

      const projectTool = pi.tools.get('linear_project');
      const result = await projectTool.execute('call-no-debug', { action: 'list' });

      // When rateLimitDebug is false, result should NOT include rateLimit info
      assert.ok(!result.details.rateLimit, 'Result should NOT include rateLimit info when debug disabled');
    } finally {
      resetTestClientFactory();
      clearTestRateLimitTracker();
      await setAuthSettings({ rateLimitDebug: false });
      process.env.LINEAR_API_KEY = prev;
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
