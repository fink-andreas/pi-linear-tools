/**
 * Regression test: linear_milestone view should return a safe tool result
 * when Linear rate-limits the milestone details fetch (including SDK lazy loads).
 */

import { setTestClientFactory, resetTestClientFactory, markRateLimited } from '../src/linear-client.js';

function createRateLimitedError() {
  const err = new Error('Rate limit exceeded. Only 5000 requests are allowed per 1 hour.');
  err.type = 'Ratelimited';
  err.requestsResetAt = Date.now() + 3600000;
  return err;
}

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

async function loadExtension(mocks) {
  setTestClientFactory(() => mocks);
  const ext = await import('../extensions/pi-linear-tools.js');
  return ext.default;
}

async function run() {
  // ─── Test 1: Milestone view rate-limited at client.projectMilestone() level ───
  {
    markRateLimited(Date.now() - 1); // clear cached rate limit
    const rateLimitError = createRateLimitedError();

    const mocks = {
      projectMilestone: async () => {
        throw rateLimitError;
      },
      projects: async () => ({
        nodes: [{ id: 'p1', name: 'demo', slugId: 'demo', archivedAt: null }],
      }),
    };

    const extension = await loadExtension(mocks);
    const pi = createMockPi();
    await extension(pi);

    const milestoneTool = pi.tools.get('linear_milestone');
    const result = await milestoneTool.execute('call-milestone-rate-1', {
      action: 'view',
      milestone: '0123456789012345',
      project: 'demo',
    });

    if (!result.content?.[0]?.text) {
      console.error('✗ Test 1 FAIL: result has no text content:', result);
      process.exit(1);
    }

    if (!result.content[0].text.includes('Linear API rate limit exceeded')) {
      console.error('✗ Test 1 FAIL: result text does not mention rate limit:', result.content[0].text);
      process.exit(1);
    }

    if (!result.details.rateLimited) {
      console.error('✗ Test 1 FAIL: result.details.rateLimited is not true:', result.details);
      process.exit(1);
    }

    if (result.details.cached) {
      console.error('✗ Test 1 FAIL: result.details.cached should be false for live rate limit:', result.details);
      process.exit(1);
    }

    console.log('✓ Test 1: milestone view returns safe rate-limit result when milestone fetch is rate-limited');
  }

  // ─── Test 2: Milestone view rate-limited during milestone.issues() lazy load ──
  // NOTE: fetchMilestoneDetails currently catches the issues() error and falls back
  // to an empty issues list, so the milestone renders but issues are missing.
  // This is the CRASH PATH described in the PLAN — the error should be propagated.
  {
    markRateLimited(Date.now() - 1);
    const rateLimitError = createRateLimitedError();

    const mocks = {
      projectMilestone: async (id) => {
        if (id !== '0123456789012345') return null;
        return {
          id: '0123456789012345',
          name: 'Release v0.2.0',
          description: 'Ship the release',
          progress: 50,
          sortOrder: 1,
          targetDate: '2026-06-30',
          status: 'inProgress',
          project: Promise.resolve({ id: 'p1', name: 'demo' }),
          issues: async () => {
            throw rateLimitError;
          },
        };
      },
      projects: async () => ({
        nodes: [{ id: 'p1', name: 'demo', slugId: 'demo', archivedAt: null }],
      }),
    };

    const extension = await loadExtension(mocks);
    const pi = createMockPi();
    await extension(pi);

    const milestoneTool = pi.tools.get('linear_milestone');
    let result;
    let threw = false;
    let thrownError = null;

    try {
      result = await milestoneTool.execute('call-milestone-rate-2', {
        action: 'view',
        milestone: '0123456789012345',
        project: 'demo',
      });
    } catch (err) {
      threw = true;
      thrownError = err;
    }

    if (threw) {
      // Before the fix: issues() rate limit escapes and crashes
      console.error('✗ Test 2 FAIL: milestone view threw (rate-limit error escaped):', thrownError?.message);
      process.exit(1);
    }

    // After the fix: should return a safe rate-limit result
    if (!result.content?.[0]?.text) {
      console.error('✗ Test 2 FAIL: result has no text content:', result);
      process.exit(1);
    }

    if (!result.content[0].text.toLowerCase().includes('rate limit')) {
      // Before the fix: milestone renders normally (error swallowed silently)
      console.error('✗ Test 2 FAIL: rate-limit error was swallowed; result does not mention rate limit:', result.content[0].text);
      process.exit(1);
    }

    if (!result.details.rateLimited) {
      console.error('✗ Test 2 FAIL: result.details.rateLimited is not true:', result.details);
      process.exit(1);
    }

    console.log('✓ Test 2: milestone view returns safe rate-limit result when issues lazy-load is rate-limited');
  }

  // ─── Test 3: Per-issue state/assignee lazy-load rate-limit errors ────────────
  // These are caught by safeResolveRelation and fall back to null.
  // Acceptable current behavior — milestone still renders with partial issue data.
  {
    markRateLimited(Date.now() - 1);
    const rateLimitError = createRateLimitedError();

    const mocks = {
      projectMilestone: async (id) => {
        if (id !== '0123456789012345') return null;
        return {
          id: '0123456789012345',
          name: 'Release v0.2.0',
          description: 'Ship the release',
          progress: 50,
          sortOrder: 1,
          targetDate: '2026-06-30',
          status: 'inProgress',
          project: Promise.resolve({ id: 'p1', name: 'demo' }),
          issues: async () => ({
            nodes: [
              {
                id: 'issue-1',
                identifier: 'DEMO-1',
                title: 'Test issue',
                priority: 3,
                estimate: 5,
                state: async () => {
                  throw rateLimitError;
                },
                assignee: async () => {
                  throw rateLimitError;
                },
              },
            ],
          }),
        };
      },
      projects: async () => ({
        nodes: [{ id: 'p1', name: 'demo', slugId: 'demo', archivedAt: null }],
      }),
    };

    const extension = await loadExtension(mocks);
    const pi = createMockPi();
    await extension(pi);

    const milestoneTool = pi.tools.get('linear_milestone');
    let result;
    let threw = false;
    let thrownError = null;

    try {
      result = await milestoneTool.execute('call-milestone-rate-3', {
        action: 'view',
        milestone: '0123456789012345',
        project: 'demo',
      });
    } catch (err) {
      threw = true;
      thrownError = err;
    }

    if (threw) {
      console.error('✗ Test 3 FAIL: milestone view threw:', thrownError?.message);
      process.exit(1);
    }

    if (!result.content?.[0]?.text || !result.content[0].text.includes('Release v0.2.0')) {
      console.error('✗ Test 3 FAIL: milestone name missing from result:', result?.content?.[0]?.text);
      process.exit(1);
    }

    // safeResolveRelation catches per-issue errors — acceptable degradation
    console.log('✓ Test 3: milestone view gracefully handles per-issue lazy-load rate-limit errors');
  }

  // ─── Test 4: Cached rate-limit pre-check on milestone tool ───────────────────
  {
    markRateLimited(Date.now() - 1);

    const mocks = {
      projectMilestone: async () => {
        throw new Error('Should not be reached — cached rate limit should short-circuit');
      },
      projects: async () => ({
        nodes: [{ id: 'p1', name: 'demo', slugId: 'demo', archivedAt: null }],
      }),
    };

    // Set a cached rate limit that is still valid
    markRateLimited(Date.now() + 60 * 1000);

    const extension = await loadExtension(mocks);
    const pi = createMockPi();
    await extension(pi);

    const milestoneTool = pi.tools.get('linear_milestone');
    const result = await milestoneTool.execute('call-milestone-cached', {
      action: 'view',
      milestone: '0123456789012345',
      project: 'demo',
    });

    if (!result.content?.[0]?.text) {
      console.error('✗ Test 4 FAIL: result has no text content:', result);
      process.exit(1);
    }

    if (!result.content[0].text.toLowerCase().includes('rate limit')) {
      console.error('✗ Test 4 FAIL: result text does not mention rate limit:', result.content[0].text);
      process.exit(1);
    }

    if (!result.details.rateLimited) {
      console.error('✗ Test 4 FAIL: result.details.rateLimited is not true:', result.details);
      process.exit(1);
    }

    if (!result.details.cached) {
      console.error('✗ Test 4 FAIL: result.details.cached should be true for cached rate limit:', result.details);
      process.exit(1);
    }

    console.log('✓ Test 4: milestone tool uses cached rate-limit pre-check');

    markRateLimited(Date.now() - 1); // clean up
  }

  resetTestClientFactory();
  console.log('\n✓ tests/test-milestone-rate-limit.js passed');
}

run().catch((err) => {
  console.error('✗ Test failed:', err?.message || err);
  process.exit(1);
});
