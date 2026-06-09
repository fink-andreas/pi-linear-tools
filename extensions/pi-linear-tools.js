import { loadSettings, saveSettings } from '../src/settings.js';
import { createLinearClient, checkAndClearRateLimit, markRateLimited, getClientRequestMetrics, getClientRateLimitInfo } from '../src/linear-client.js';
import { setQuietMode, debug } from '../src/logger.js';
import {
  resolveProjectRef,
  fetchTeams,
  fetchWorkspaces,
} from '../src/linear.js';
import { isPiCodingAgentRoot, findPiCodingAgentRoot, importFromPiRoot, parseArgs, readFlag } from '../src/shared.js';

async function importPiCodingAgent() {
  try {
    return await import('@mariozechner/pi-coding-agent');
  } catch {
    return importFromPiRoot('dist/index.js');
  }
}

async function importPiTui() {
  try {
    return await import('@mariozechner/pi-tui');
  } catch {
    // pi-tui is a dependency of pi-coding-agent and may be nested under it
    return importFromPiRoot('node_modules/@mariozechner/pi-tui/dist/index.js');
  }
}

// Optional imports for markdown rendering (provided by pi runtime)
let Markdown = null;
let Text = null;
let getMarkdownTheme = null;

try {
  const piTui = await importPiTui();
  Markdown = piTui?.Markdown || null;
  Text = piTui?.Text || null;
} catch {
  // ignore
}

try {
  const piCodingAgent = await importPiCodingAgent();
  getMarkdownTheme = piCodingAgent?.getMarkdownTheme || null;
} catch {
  // ignore
}

import {
  executeIssueList,
  executeIssueView,
  executeIssueImages,
  executeIssueDownload,
  executeIssueActivity,
  executeIssueCreate,
  executeIssueUpdate,
  executeIssueComment,
  executeIssueStart,
  executeIssueDelete,
  executeProjectList,
  executeProjectView,
  executeProjectCreate,
  executeProjectUpdate,
  executeProjectDelete,
  executeProjectArchive,
  executeProjectUnarchive,
  executeProjectUpdateList,
  executeProjectUpdateView,
  executeProjectUpdateCreate,
  executeProjectUpdateUpdate,
  executeProjectUpdateArchive,
  executeProjectUpdateUnarchive,
  executeTeamList,
  executeMilestoneList,
  executeMilestoneView,
  executeMilestoneCreate,
  executeMilestoneUpdate,
  executeMilestoneDelete,
} from '../src/handlers.js';
import { authenticate, getAccessToken, logout } from '../src/auth/index.js';
import { withMilestoneScopeHint } from '../src/error-hints.js';

let cachedApiKey = null;
const INCLUDE_USAGE_SUMMARY = String(process.env.PI_LINEAR_TOOLS_USAGE_SUMMARY || '').toLowerCase() === 'true';

async function getLinearAuth() {
  const envKey = process.env.LINEAR_API_KEY;
  if (envKey && envKey.trim()) {
    return { apiKey: envKey.trim() };
  }

  const settings = await loadSettings();
  const authMethod = settings.authMethod || 'api-key';

  if (authMethod === 'oauth') {
    const accessToken = await getAccessToken();
    if (accessToken) {
      return { accessToken };
    }
  }

  if (cachedApiKey) {
    return { apiKey: cachedApiKey };
  }

  const apiKey = settings.apiKey || settings.linearApiKey;
  if (apiKey && apiKey.trim()) {
    cachedApiKey = apiKey.trim();
    return { apiKey: cachedApiKey };
  }

  const fallbackAccessToken = await getAccessToken();
  if (fallbackAccessToken) {
    return { accessToken: fallbackAccessToken };
  }

  throw new Error(
    'No Linear authentication configured. Use /linear-tools-config --api-key <key> or run `pi-linear-tools auth login` in CLI.'
  );
}

async function createAuthenticatedClient() {
  return createLinearClient(await getLinearAuth());
}

async function withRequestUsageLogging(client, toolName, action, operation, rateLimitDebug = false) {
  const before = getClientRequestMetrics(client);

  try {
    const result = await operation();
    const after = getClientRequestMetrics(client);
    const rateLimitInfo = rateLimitDebug ? getClientRateLimitInfo(client) : null;

    const usageDelta = {
      tool: toolName,
      action,
      requestsDelta: after.total - before.total,
      successDelta: after.success - before.success,
      failedDelta: after.failed - before.failed,
      rateLimitedDelta: after.rateLimited - before.rateLimited,
      summary: `Linear API usage: ${after.total - before.total} req (${after.success - before.success} ok, ${after.failed - before.failed} failed, ${after.rateLimited - before.rateLimited} rate-limited)`,
    };

    debug('[pi-linear-tools] API usage per command', usageDelta);

    if (rateLimitDebug && rateLimitInfo) {
      debug('[pi-linear-tools] Rate limit status', {
        tool: toolName,
        action,
        requestsDelta: usageDelta.requestsDelta,
        rateLimitUsed: rateLimitInfo.used,
        rateLimitTotal: rateLimitInfo.total,
        rateLimitRemaining: rateLimitInfo.remaining,
        rateLimitPercent: rateLimitInfo.usagePercent,
        rateLimitResetAt: rateLimitInfo.resetTime,
      });
    }

    // When rateLimitDebug is true, always include rate limit info in result details
    // even if INCLUDE_USAGE_SUMMARY is disabled
    if (!result || typeof result !== 'object') {
      return result;
    }

    const details = (result.details && typeof result.details === 'object') ? result.details : {};

    // Add rate limit info to details if debug is enabled
    if (rateLimitDebug && rateLimitInfo) {
      details.rateLimit = {
        ...rateLimitInfo,
        requestsDelta: usageDelta.requestsDelta,
      };
    }

    if (!INCLUDE_USAGE_SUMMARY && !rateLimitDebug) {
      return {
        ...result,
        details,
      };
    }

    const content = Array.isArray(result.content)
      ? result.content.map((item, idx) => {
        if (idx !== 0 || item?.type !== 'text' || typeof item.text !== 'string') return item;
        let appendedText = item.text;

        if (INCLUDE_USAGE_SUMMARY) {
          appendedText += `\n\n_${usageDelta.summary}_`;
        }

        if (rateLimitDebug && rateLimitInfo) {
          const percent = rateLimitInfo.usagePercent === null ? 'unknown' : `${rateLimitInfo.usagePercent}%`;
          const windowUsage = rateLimitInfo.remaining === null
            ? 'request window: unknown'
            : `request window: ${rateLimitInfo.used}/${rateLimitInfo.total} used (${percent})`;
          const reset = rateLimitInfo.resetTime ? ` • Resets at ${rateLimitInfo.resetTime}` : '';
          appendedText += `\n\n---\n**Rate Limit**: +${usageDelta.requestsDelta} requests this call | ${windowUsage}${reset}`;
        }

        return {
          ...item,
          text: appendedText,
        };
      })
      : result.content;

    return {
      ...result,
      content,
      details: {
        ...details,
        ...(INCLUDE_USAGE_SUMMARY ? { apiUsage: usageDelta } : {}),
      },
    };
  } catch (error) {
    const after = getClientRequestMetrics(client);
    const rateLimitInfo = rateLimitDebug ? getClientRateLimitInfo(client) : null;

    debug('[pi-linear-tools] API usage per command (error)', {
      tool: toolName,
      action,
      requestsDelta: after.total - before.total,
      successDelta: after.success - before.success,
      failedDelta: after.failed - before.failed,
      rateLimitedDelta: after.rateLimited - before.rateLimited,
      error: String(error?.message || error || 'unknown'),
      ...(rateLimitDebug && rateLimitInfo ? {
        requestsDelta: after.total - before.total,
        rateLimitUsed: rateLimitInfo.used,
        rateLimitTotal: rateLimitInfo.total,
        rateLimitRemaining: rateLimitInfo.remaining,
        rateLimitPercent: rateLimitInfo.usagePercent,
      } : {}),
    });

    throw error;
  }
}

async function resolveDefaultTeam(projectId) {
  const settings = await loadSettings();

  if (projectId && settings.projects?.[projectId]?.scope?.team) {
    return settings.projects[projectId].scope.team;
  }

  return settings.defaultTeam || null;
}

async function runGit(pi, args) {
  if (typeof pi.exec !== 'function') {
    throw new Error('pi.exec is unavailable in this runtime; cannot run git operations');
  }

  const result = await pi.exec('git', args);
  if (result?.code !== 0) {
    const stderr = String(result?.stderr || '').trim();
    throw new Error(`git ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`);
  }
  return result;
}

async function gitBranchExists(pi, branchName) {
  if (typeof pi.exec !== 'function') return false;
  const result = await pi.exec('git', ['rev-parse', '--verify', branchName]);
  return result?.code === 0;
}

async function startGitBranchForIssue(pi, branchName, fromRef = 'HEAD', onBranchExists = 'switch') {
  const exists = await gitBranchExists(pi, branchName);

  if (!exists) {
    await runGit(pi, ['checkout', '-b', branchName, fromRef || 'HEAD']);
    return { action: 'created', branchName };
  }

  if (onBranchExists === 'suffix') {
    let suffix = 1;
    let nextName = `${branchName}-${suffix}`;

    // eslint-disable-next-line no-await-in-loop
    while (await gitBranchExists(pi, nextName)) {
      suffix += 1;
      nextName = `${branchName}-${suffix}`;
    }

    await runGit(pi, ['checkout', '-b', nextName, fromRef || 'HEAD']);
    return { action: 'created-suffix', branchName: nextName };
  }

  await runGit(pi, ['checkout', branchName]);
  return { action: 'switched', branchName };
}

async function runInteractiveConfigFlow(ctx, pi) {
  const settings = await loadSettings();
  const previousAuthMethod = settings.authMethod || 'api-key';
  const envKey = process.env.LINEAR_API_KEY?.trim();

  let client;
  let apiKey = settings.apiKey?.trim() || settings.linearApiKey?.trim() || null;
  let accessToken = null;

  setQuietMode(true);
  try {
    accessToken = await getAccessToken();
  } finally {
    setQuietMode(false);
  }

  const hasWorkingAuth = !!(envKey || apiKey || accessToken);

  if (hasWorkingAuth) {
    const source = envKey ? 'environment API key' : (accessToken ? 'OAuth token' : 'stored API key');
    const logoutSelection = await ctx.ui.select(
      `Existing authentication detected (${source}). Logout and re-authenticate?`,
      ['No', 'Yes']
    );

    if (!logoutSelection) {
      ctx.ui.notify('Configuration cancelled', 'warning');
      return;
    }

    if (logoutSelection === 'Yes') {
      setQuietMode(true);
      try {
        await logout();
      } finally {
        setQuietMode(false);
      }

      settings.apiKey = null;
      if (Object.prototype.hasOwnProperty.call(settings, 'linearApiKey')) {
        delete settings.linearApiKey;
      }
      cachedApiKey = null;
      accessToken = null;
      apiKey = null;

      await saveSettings(settings);
      ctx.ui.notify('Stored authentication cleared.', 'info');

      if (envKey) {
        ctx.ui.notify('LINEAR_API_KEY is still set in environment and cannot be removed by this command.', 'warning');
      }
    } else {
      if (envKey) {
        client = createLinearClient(envKey);
      } else if (accessToken) {
        settings.authMethod = 'oauth';
        client = createLinearClient({ accessToken });
      } else if (apiKey) {
        settings.authMethod = 'api-key';
        cachedApiKey = apiKey;
        client = createLinearClient(apiKey);
      }
    }
  }

  if (!client) {
    const selectedAuthMethod = await ctx.ui.select('Select authentication method', ['API Key (recommended for full functionality)', 'OAuth']);

    if (!selectedAuthMethod) {
      ctx.ui.notify('Configuration cancelled', 'warning');
      return;
    }

    if (selectedAuthMethod === 'OAuth') {
      settings.authMethod = 'oauth';
      cachedApiKey = null;

      setQuietMode(true);
      try {
        accessToken = await getAccessToken();

        if (!accessToken) {
          ctx.ui.notify('Starting OAuth login...', 'info');
          try {
            await authenticate({
              onAuthorizationUrl: async (authUrl) => {
                pi.sendMessage({
                  customType: 'pi-linear-tools',
                  content: [
                    '### Linear OAuth login',
                    '',
                    `[Open authorization URL](${authUrl})`,
                    '',
                    'If browser did not open automatically, copy and open this URL:',
                    `\`${authUrl}\``,
                    '',
                    'After authorizing, paste the callback URL in the next prompt.',
                  ].join('\n'),
                  display: true,
                });
                ctx.ui.notify('Complete OAuth in browser, then paste callback URL in the prompt.', 'info');
              },
              manualCodeInput: async () => {
                const entered = await ctx.ui.input(
                  'Paste callback URL from browser (or type "cancel")',
                  'http://localhost:34711/callback?code=...&state=...'
                );
                const normalized = String(entered || '').trim();
                if (!normalized || normalized.toLowerCase() === 'cancel') {
                  return null;
                }
                return normalized;
              },
            });
          } catch (error) {
            if (String(error?.message || '').includes('cancelled by user')) {
              ctx.ui.notify('OAuth authentication cancelled.', 'warning');
              return;
            }
            throw error;
          }
          accessToken = await getAccessToken();
        }

        if (!accessToken) {
          throw new Error('OAuth authentication failed: no access token available after login');
        }

        client = createLinearClient({ accessToken });
      } finally {
        setQuietMode(false);
      }
    } else {
      setQuietMode(true);
      try {
        await logout();
      } finally {
        setQuietMode(false);
      }

      if (!envKey && !apiKey) {
        const promptedKey = await ctx.ui.input('Enter Linear API key', 'lin_xxx');
        const normalized = String(promptedKey || '').trim();
        if (!normalized) {
          ctx.ui.notify('No API key provided. Aborting.', 'warning');
          return;
        }

        apiKey = normalized;
      }

      const selectedApiKey = envKey || apiKey;
      settings.apiKey = selectedApiKey;
      settings.authMethod = 'api-key';
      cachedApiKey = selectedApiKey;
      client = createLinearClient(selectedApiKey);
    }
  }

  const workspaces = await fetchWorkspaces(client);

  if (workspaces.length === 0) {
    throw new Error('No workspaces available for this Linear account');
  }

  const workspaceOptions = workspaces.map((w) => `${w.name} (${w.id})`);
  const selectedWorkspaceLabel = await ctx.ui.select('Select workspace', workspaceOptions);
  if (!selectedWorkspaceLabel) {
    ctx.ui.notify('Configuration cancelled', 'warning');
    return;
  }

  const selectedWorkspace = workspaces[workspaceOptions.indexOf(selectedWorkspaceLabel)];
  settings.defaultWorkspace = {
    id: selectedWorkspace.id,
    name: selectedWorkspace.name,
  };

  const teams = await fetchTeams(client);
  if (teams.length === 0) {
    throw new Error('No teams found in selected workspace');
  }

  const teamOptions = teams.map((t) => `${t.key} - ${t.name} (${t.id})`);
  const selectedTeamLabel = await ctx.ui.select('Select default team', teamOptions);
  if (!selectedTeamLabel) {
    ctx.ui.notify('Configuration cancelled', 'warning');
    return;
  }

  const selectedTeam = teams[teamOptions.indexOf(selectedTeamLabel)];
  settings.defaultTeam = selectedTeam.key;

  await saveSettings(settings);
  ctx.ui.notify(`Configuration saved: workspace ${selectedWorkspace.name}, team ${selectedTeam.key}`, 'info');

  if (previousAuthMethod !== settings.authMethod) {
    ctx.ui.notify(
      'Authentication method changed. Please restart pi to refresh and make the correct tools available.',
      'warning'
    );
  }
}

async function shouldExposeMilestoneTool() {
  const settings = await loadSettings();
  const authMethod = settings.authMethod || 'api-key';
  const apiKeyFromSettings = (settings.apiKey || settings.linearApiKey || '').trim();
  const apiKeyFromEnv = (process.env.LINEAR_API_KEY || '').trim();
  const hasApiKey = !!(apiKeyFromEnv || apiKeyFromSettings);

  return authMethod === 'api-key' || hasApiKey;
}

/**
 * Render tool result as markdown
 */
function toToolTextResult(text, details = {}) {
  return {
    content: [{ type: 'text', text }],
    details,
  };
}

function buildRateLimitToolResult(error, options = {}) {
  const { cached = false, viaCachedPreCheck = false } = options;
  const resetTimestamp = error?.requestsResetAt || Date.now() + 3600000;
  const resetTime = new Date(resetTimestamp).toLocaleTimeString();

  markRateLimited(resetTimestamp);

  return toToolTextResult(
    viaCachedPreCheck
      ? `Linear API rate limit exceeded (cached — this request was not sent to Linear).

The rate limit resets at: ${resetTime}

Please wait before making more requests.`
      : cached
        ? `Linear API rate limit exceeded (cached).

The rate limit resets at: ${resetTime}

Please wait before making more requests.`
        : `Linear API rate limit exceeded.

The rate limit resets at: ${resetTime}

Please wait before making more requests, or reduce the frequency of API calls.`,
    {
      error: true,
      errorType: 'Ratelimited',
      rateLimited: true,
      cached: viaCachedPreCheck || cached,
      requestsResetAt: resetTimestamp,
      resetTime,
    }
  );
}

function handleToolExecutionError(error, operationLabel, options = {}) {
  const transformedError = options.transformError ? options.transformError(error) : error;
  const errorType = error?.type || transformedError?.type || '';
  const errorMessage = String(transformedError?.message || transformedError || 'Unknown error');

  if (errorType === 'Ratelimited' || errorMessage.toLowerCase().includes('rate limit')) {
    return buildRateLimitToolResult(transformedError, { viaCachedPreCheck: options.viaCachedPreCheck });
  }

  if (errorMessage.includes('Linear API error:')) {
    throw transformedError;
  }

  throw new Error(`${operationLabel}: ${errorMessage}`);
}

function buildGenericToolErrorResult(error, operationLabel) {
  const errorType = error?.type || error?.name || 'Error';
  const errorMessage = String(error?.message || error || 'Unknown error');

  return toToolTextResult(`${operationLabel}: ${errorMessage}`, {
    error: true,
    errorType,
    rateLimited: false,
  });
}

async function executeToolSafely(operationLabel, operation, options = {}) {
  try {
    return await operation();
  } catch (error) {
    debug('[pi-linear-tools] tool execution failed', {
      operationLabel,
      errorType: error?.type || error?.name || null,
      error: String(error?.message || error || 'unknown'),
    });

    try {
      return handleToolExecutionError(error, operationLabel, options);
    } catch (handledError) {
      debug('[pi-linear-tools] returning generic safe tool error result', {
        operationLabel,
        errorType: handledError?.type || handledError?.name || null,
        error: String(handledError?.message || handledError || 'unknown'),
      });
      return buildGenericToolErrorResult(handledError, operationLabel);
    }
  }
}

function renderMarkdownResult(result, _options, _theme) {
  const text = result.content?.[0]?.text || '';

  // Fall back to plain text if markdown packages not available
  if (!Markdown || !getMarkdownTheme) {
    const lines = text.split('\n');
    return {
      render: (width) => lines.map((line) => (width && line.length > width ? line.slice(0, width) : line)),
      invalidate: () => {},
    };
  }

  // Return Markdown component directly - the TUI will call its render() method
  try {
    const mdTheme = getMarkdownTheme();
    return new Markdown(text, 0, 0, mdTheme, _theme ? { color: (t) => _theme.fg('toolOutput', t) } : undefined);
  } catch (error) {
    // If markdown rendering fails for any reason, show a visible error so we can diagnose.
    const msg = `[pi-linear-tools] Markdown render failed: ${String(error?.message || error)}`;
    if (Text) {
      return new Text((_theme ? _theme.fg('error', msg) : msg) + `\n\n` + text, 0, 0);
    }
    const lines = (msg + '\n\n' + text).split('\n');
    return {
      render: (width) => lines.map((line) => (width && line.length > width ? line.slice(0, width) : line)),
      invalidate: () => {},
    };
  }
}

async function registerLinearTools(pi) {
  if (typeof pi.registerTool !== 'function') {
    console.warn('[pi-linear-tools] pi.registerTool not available');
    return;
  }

  pi.registerTool({
    name: 'linear_issue',
    label: 'Linear Issue',
    description: 'Interact with Linear issues.',
    promptSnippet: 'Interact with Linear issues (list, view, images, download, activity, create, update, comment, start, delete)',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'view', 'images', 'download', 'activity', 'create', 'update', 'comment', 'start', 'delete'],
          description: 'Action to perform on issue(s)',
        },
        issue: {
          type: 'string',
          description: 'Issue key (ABC-123) or Linear issue ID (for view, images, download, activity, update, comment, start, delete)',
        },
        project: {
          type: 'string',
          description: 'Project name or ID for listing/creating issues (default: current repo directory name)',
        },
        states: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by state names for listing',
        },
        assignee: {
          type: 'string',
          description: 'For list: "me" or "all". For create/update: "me" or assignee ID.',
        },
        assigneeId: {
          type: 'string',
          description: 'Optional explicit assignee ID alias for update/create debugging/compatibility.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of issues, activity entries, or images to fetch',
        },
        includeComments: {
          type: 'boolean',
          description: 'Include comments when viewing an issue or fetching images (default: true)',
        },
        attachmentId: {
          type: 'string',
          description: 'Attachment ID to download (for download). Use exactly one attachment selector when multiple attachments exist.',
        },
        attachmentTitle: {
          type: 'string',
          description: 'Attachment title to download (for download). Must uniquely match an issue attachment.',
        },
        attachmentUrl: {
          type: 'string',
          description: 'Attachment URL to download (for download). Must uniquely match an issue attachment.',
        },
        attachmentIndex: {
          type: 'integer',
          description: '1-based attachment index from the issue attachment list (for download).',
          minimum: 1,
        },
        directory: {
          type: 'string',
          description: 'Relative destination directory for attachment downloads. Missing directories are created.',
        },
        filename: {
          type: 'string',
          description: 'Optional output filename for attachment downloads. Unsafe characters are sanitized.',
        },
        overwrite: {
          type: 'boolean',
          description: 'Overwrite existing file during download (default: false). Requires allow_overwrite_files=true in config.',
        },
        maxBytes: {
          type: 'integer',
          description: 'Maximum bytes to fetch. For images, applies per image with a 10 MiB handler limit. For download, default/max is 52428800.',
          minimum: 1,
          maximum: 52428800,
        },
        title: {
          type: 'string',
          description: 'Issue title (required for create, optional for update)',
        },
        description: {
          type: 'string',
          description: 'Issue description in markdown (for create, update)',
        },
        priority: {
          description: 'Issue priority: 0=None, 1=Urgent, 2=High, 3=Medium, 4=Low (Linear-native scale), or one of: none, urgent, high, medium, low (for create/update)',
          oneOf: [
            {
              type: 'integer',
              minimum: 0,
              maximum: 4,
              multipleOf: 1,
            },
            {
              type: 'string',
              enum: ['none', 'urgent', 'high', 'medium', 'low'],
            },
          ],
        },
        includeArchived: {
          type: 'boolean',
          description: 'Include archived resources when listing activity or project updates',
        },
        state: {
          type: 'string',
          description: 'Target state name or ID (for create, update)',
        },
        milestone: {
          type: 'string',
          description: 'For update: milestone name/ID, or "none" to clear milestone assignment.',
        },
        projectMilestoneId: {
          type: 'string',
          description: 'Optional explicit milestone ID alias for update.',
        },
        subIssueOf: {
          type: 'string',
          description: 'For update: set this issue as sub-issue of the given issue key/ID, or "none" to clear parent.',
        },
        parentOf: {
          type: 'array',
          items: { type: 'string' },
          description: 'For update: set listed issues as children of this issue.',
        },
        blockedBy: {
          type: 'array',
          items: { type: 'string' },
          description: 'For update: add "blocked by" dependencies (issues that block this issue).',
        },
        blocking: {
          type: 'array',
          items: { type: 'string' },
          description: 'For update: add "blocking" dependencies (issues this issue blocks).',
        },
        relatedTo: {
          type: 'array',
          items: { type: 'string' },
          description: 'For update: add related issue links.',
        },
        duplicateOf: {
          type: 'string',
          description: 'For update: mark this issue as duplicate of the given issue key/ID.',
        },
        estimate: {
          type: 'integer',
          description: 'Estimate/story points for the issue (non-negative integer, for create/update)',
          minimum: 0,
        },
        team: {
          type: 'string',
          description: 'Team key (e.g. ENG) or name (optional if default team configured)',
        },
        parentId: {
          type: 'string',
          description: 'Parent issue ID for sub-issues (for create)',
        },
        body: {
          type: 'string',
          description: 'Comment body in markdown (for comment)',
        },
        parentCommentId: {
          type: 'string',
          description: 'Parent comment ID for reply (for comment)',
        },
        fromRef: {
          type: 'string',
          description: 'Git ref to branch from (default: HEAD, for start)',
        },
        onBranchExists: {
          type: 'string',
          enum: ['switch', 'suffix'],
          description: 'When branch exists: switch to it or create suffixed branch (for start)',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    renderResult: renderMarkdownResult,
    async execute(_toolCallId, params) {
      return executeToolSafely('Linear issue operation failed', async () => {
        // Pre-check: skip API calls if we know we're rate limited
        const { isRateLimited, resetAt } = checkAndClearRateLimit();
        if (isRateLimited) {
          return buildRateLimitToolResult({ requestsResetAt: resetAt.getTime(), type: 'Ratelimited' }, { cached: true });
        }

        const settings = await loadSettings();
        const rateLimitDebug = settings.rateLimitDebug || false;
        const client = await createAuthenticatedClient();

        return await withRequestUsageLogging(client, 'linear_issue', params.action, async () => {
          switch (params.action) {
            case 'list':
              return await executeIssueList(client, params);
            case 'view':
              return await executeIssueView(client, params);
            case 'images':
              return await executeIssueImages(client, params);
            case 'download':
              return await executeIssueDownload(client, params, { settings });
            case 'activity':
              return await executeIssueActivity(client, params);
            case 'create':
              return await executeIssueCreate(client, params, { resolveDefaultTeam });
            case 'update':
              return await executeIssueUpdate(client, params);
            case 'comment':
              return await executeIssueComment(client, params);
            case 'start':
              return await executeIssueStart(client, params, {
                gitExecutor: async (branchName, fromRef, onBranchExists) => {
                  return startGitBranchForIssue(pi, branchName, fromRef, onBranchExists);
                },
              });
            case 'delete':
              return await executeIssueDelete(client, params);
            default:
              throw new Error(`Unknown action: ${params.action}`);
          }
        }, rateLimitDebug);
      });
    },
  });

  pi.registerTool({
    name: 'linear_project',
    label: 'Linear Project',
    description: 'Interact with Linear projects.',
    promptSnippet: 'Interact with Linear projects (list, view, create, update, delete, archive, unarchive)',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'view', 'create', 'update', 'delete', 'archive', 'unarchive'],
          description: 'Action to perform on project(s)',
        },
        project: {
          type: 'string',
          description: 'Project name or ID (for view, update, delete)',
        },
        name: {
          type: 'string',
          description: 'Project name (required for create, optional for update)',
        },
        teams: {
          type: 'string',
          description: 'Comma-separated team keys or IDs (required for create, optional for update)',
        },
        description: {
          type: 'string',
          description: 'Project description in markdown',
        },
        lead: {
          type: 'string',
          description: 'Project lead user ID, "me", or "none" when updating',
        },
        priority: {
          type: 'integer',
          description: 'Priority 0-4',
          minimum: 0,
          maximum: 4,
          multipleOf: 1,
        },
        color: {
          type: 'string',
          description: 'Project color (hex)',
        },
        icon: {
          type: 'string',
          description: 'Project icon',
        },
        startDate: {
          type: 'string',
          description: 'Planned start date (YYYY-MM-DD)',
        },
        targetDate: {
          type: 'string',
          description: 'Planned target date (YYYY-MM-DD)',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    renderResult: renderMarkdownResult,
    async execute(_toolCallId, params) {
      return executeToolSafely('Linear project operation failed', async () => {
        // Pre-check: skip API calls if we know we're rate limited
        const { isRateLimited, resetAt } = checkAndClearRateLimit();
        if (isRateLimited) {
          return buildRateLimitToolResult({ requestsResetAt: resetAt.getTime(), type: 'Ratelimited' }, { cached: true });
        }

        const settings = await loadSettings();
        const rateLimitDebug = settings.rateLimitDebug || false;
        const client = await createAuthenticatedClient();

        return await withRequestUsageLogging(client, 'linear_project', params.action, async () => {
          switch (params.action) {
            case 'list':
              return await executeProjectList(client);
            case 'view':
              return await executeProjectView(client, params);
            case 'create':
              return await executeProjectCreate(client, params);
            case 'update':
              return await executeProjectUpdate(client, params);
            case 'delete':
              return await executeProjectDelete(client, params);
            case 'archive':
              return await executeProjectArchive(client, params);
            case 'unarchive':
              return await executeProjectUnarchive(client, params);
            default:
              throw new Error(`Unknown action: ${params.action}`);
          }
        }, rateLimitDebug);
      });
    },
  });

  pi.registerTool({
    name: 'linear_project_update',
    label: 'Linear Project Update',
    description: 'Interact with Linear project updates.',
    promptSnippet: 'Interact with Linear project updates (list, view, create, update, archive, unarchive)',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'view', 'create', 'update', 'archive', 'unarchive'],
          description: 'Action to perform on project update(s)',
        },
        project: {
          type: 'string',
          description: 'Project name or ID (for list, create)',
        },
        projectUpdate: {
          type: 'string',
          description: 'Project update ID (for view, update, archive, unarchive)',
        },
        body: {
          type: 'string',
          description: 'Project update body in markdown',
        },
        health: {
          type: 'string',
          description: 'Project update health: onTrack, atRisk, or offTrack',
          enum: ['onTrack', 'atRisk', 'offTrack'],
        },
        isDiffHidden: {
          type: 'boolean',
          description: 'Whether to hide the diff on the update',
        },
        limit: {
          type: 'integer',
          description: 'Max updates to list',
          minimum: 1,
          multipleOf: 1,
        },
        includeArchived: {
          type: 'boolean',
          description: 'Whether archived updates should be included when listing',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    renderResult: renderMarkdownResult,
    async execute(_toolCallId, params) {
      return executeToolSafely('Linear project update operation failed', async () => {
        // Pre-check: skip API calls if we know we're rate limited
        const { isRateLimited, resetAt } = checkAndClearRateLimit();
        if (isRateLimited) {
          return buildRateLimitToolResult({ requestsResetAt: resetAt.getTime(), type: 'Ratelimited' }, { cached: true });
        }

        const settings = await loadSettings();
        const rateLimitDebug = settings.rateLimitDebug || false;
        const client = await createAuthenticatedClient();

        return await withRequestUsageLogging(client, 'linear_project_update', params.action, async () => {
          switch (params.action) {
            case 'list':
              return await executeProjectUpdateList(client, params);
            case 'view':
              return await executeProjectUpdateView(client, params);
            case 'create':
              return await executeProjectUpdateCreate(client, params);
            case 'update':
              return await executeProjectUpdateUpdate(client, params);
            case 'archive':
              return await executeProjectUpdateArchive(client, params);
            case 'unarchive':
              return await executeProjectUpdateUnarchive(client, params);
            default:
              throw new Error(`Unknown action: ${params.action}`);
          }
        }, rateLimitDebug);
      });
    },
  });

  pi.registerTool({
    name: 'linear_team',
    label: 'Linear Team',
    description: 'Interact with Linear teams.',
    promptSnippet: 'Interact with Linear teams (list)',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list'],
          description: 'Action to perform on team(s)',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    renderResult: renderMarkdownResult,
    async execute(_toolCallId, params) {
      return executeToolSafely('Linear team operation failed', async () => {
        const settings = await loadSettings();
        const rateLimitDebug = settings.rateLimitDebug || false;
        const client = await createAuthenticatedClient();

        return await withRequestUsageLogging(client, 'linear_team', params.action, async () => {
          switch (params.action) {
            case 'list':
              return await executeTeamList(client);
            default:
              throw new Error(`Unknown action: ${params.action}`);
          }
        }, rateLimitDebug);
      });
    },
  });

  if (await shouldExposeMilestoneTool()) {
    pi.registerTool({
      name: 'linear_milestone',
      label: 'Linear Milestone',
      description: 'Interact with Linear project milestones.',
      promptSnippet: 'Interact with Linear milestones (list, view, create, update, delete)',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'view', 'create', 'update', 'delete'],
            description: 'Action to perform on milestone(s)',
          },
          milestone: {
            type: 'string',
            description: 'Milestone ID (for view, update, delete)',
          },
          project: {
            type: 'string',
            description: 'Project name or ID (for list, create)',
          },
          name: {
            type: 'string',
            description: 'Milestone name (required for create, optional for update)',
          },
          description: {
            type: 'string',
            description: 'Milestone description in markdown',
          },
          targetDate: {
            type: 'string',
            description: 'Target completion date (ISO 8601 date)',
          },
        },
        required: ['action'],
        additionalProperties: false,
      },
      renderResult: renderMarkdownResult,
      async execute(_toolCallId, params) {
        return executeToolSafely('Linear milestone operation failed', async () => {
          // Pre-check: skip API calls if we know we're rate limited
          const { isRateLimited, resetAt } = checkAndClearRateLimit();
          if (isRateLimited) {
            return buildRateLimitToolResult({ requestsResetAt: resetAt.getTime(), type: 'Ratelimited' }, { viaCachedPreCheck: true });
          }

          const settings = await loadSettings();
          const rateLimitDebug = settings.rateLimitDebug || false;
          const client = await createAuthenticatedClient();


          return await withRequestUsageLogging(client, 'linear_milestone', params.action, async () => {
            switch (params.action) {
              case 'list':
                return await executeMilestoneList(client, params);
              case 'view':
                return await executeMilestoneView(client, params);
              case 'create':
                return await executeMilestoneCreate(client, params);
              case 'update':
                return await executeMilestoneUpdate(client, params);
              case 'delete':
                return await executeMilestoneDelete(client, params);
              default:
                throw new Error(`Unknown action: ${params.action}`);
            }
          }, rateLimitDebug);
        }, {
          transformError: withMilestoneScopeHint,
        });
      },
    });
  }
}

export default async function piLinearToolsExtension(pi) {
  // Safety wrapper: never let extension errors crash pi
  try {
  pi.registerCommand('linear-tools-config', {
    description: 'Configure pi-linear-tools settings (API key, default team, rate limit debug, file overwrite guard)',
    handler: async (argsText, ctx) => {
      const args = parseArgs(argsText);
      const apiKey = readFlag(args, '--api-key');
      const defaultTeam = readFlag(args, '--default-team');
      const projectTeam = readFlag(args, '--team');
      const projectName = readFlag(args, '--project');
      const rateLimitDebug = readFlag(args, '--rate-limit-debug');
      const allowOverwriteFiles = readFlag(args, '--allow-overwrite-files');

      if (apiKey) {
        const settings = await loadSettings();
        const previousAuthMethod = settings.authMethod || 'api-key';
        settings.apiKey = apiKey;
        settings.authMethod = 'api-key';
        await saveSettings(settings);
        cachedApiKey = null;
        if (ctx?.hasUI) {
          ctx.ui.notify('LINEAR_API_KEY saved to settings', 'info');
          if (previousAuthMethod !== settings.authMethod) {
            ctx.ui.notify(
              'Authentication method changed. Please restart pi to refresh and make the correct tools available.',
              'warning'
            );
          }
        }
        return;
      }

      if (rateLimitDebug) {
        const settings = await loadSettings();
        const enabled = rateLimitDebug === 'true' || rateLimitDebug === '1';
        settings.rateLimitDebug = enabled;
        await saveSettings(settings);
        if (ctx?.hasUI) {
          ctx.ui.notify(`Rate limit debug ${enabled ? 'enabled' : 'disabled'}`, 'info');
        }
        return;
      }

      if (allowOverwriteFiles) {
        const settings = await loadSettings();
        const enabled = allowOverwriteFiles === 'true' || allowOverwriteFiles === '1';
        settings.allow_overwrite_files = enabled;
        await saveSettings(settings);
        if (ctx?.hasUI) {
          ctx.ui.notify(`File overwrite guard ${enabled ? 'allows overwrites' : 'blocks overwrites'}`, 'info');
        }
        return;
      }

      if (defaultTeam) {
        const settings = await loadSettings();
        settings.defaultTeam = defaultTeam;
        await saveSettings(settings);
        if (ctx?.hasUI) {
          ctx.ui.notify(`Default team set to: ${defaultTeam}`, 'info');
        }
        return;
      }

      if (projectTeam && projectName) {
        const settings = await loadSettings();

        let projectId = projectName;
        try {
          const client = await createAuthenticatedClient();
          const resolved = await resolveProjectRef(client, projectName);
          projectId = resolved.id;
        } catch {
          // keep provided value as project ID/name key
        }

        if (!settings.projects[projectId]) {
          settings.projects[projectId] = {
            scope: {
              team: null,
            },
          };
        }

        if (!settings.projects[projectId].scope) {
          settings.projects[projectId].scope = { team: null };
        }

        settings.projects[projectId].scope.team = projectTeam;
        await saveSettings(settings);

        if (ctx?.hasUI) {
          ctx.ui.notify(`Team for project "${projectName}" set to: ${projectTeam}`, 'info');
        }
        return;
      }

      if (!apiKey && !defaultTeam && !projectTeam && !projectName && !rateLimitDebug && !allowOverwriteFiles && ctx?.hasUI && ctx?.ui) {
        await runInteractiveConfigFlow(ctx, pi);
        return;
      }

      // Show current settings if no valid action was specified
      if (apiKey || defaultTeam || projectTeam || projectName || rateLimitDebug || allowOverwriteFiles) {
        // Actions above already handled and returned
        return;
      }

      const settings = await loadSettings();
      const hasKey = !!(settings.apiKey || settings.linearApiKey || process.env.LINEAR_API_KEY);
      const keySource = process.env.LINEAR_API_KEY ? 'environment' : (settings.apiKey || settings.linearApiKey ? 'settings' : 'not set');

      pi.sendMessage({
        customType: 'pi-linear-tools',
        content: `Configuration:\n  LINEAR_API_KEY: ${hasKey ? 'configured' : 'not set'} (source: ${keySource})\n  Default workspace: ${settings.defaultWorkspace?.name || 'not set'}\n  Default team: ${settings.defaultTeam || 'not set'}\n  Rate limit debug: ${settings.rateLimitDebug ? 'enabled' : 'disabled'}\n  Allow overwrite files: ${settings.allow_overwrite_files ? 'enabled' : 'disabled'}\n  Project team mappings: ${Object.keys(settings.projects || {}).length}\n\nCommands:\n  /linear-tools-config --api-key lin_xxx\n  /linear-tools-config --default-team ENG\n  /linear-tools-config --team ENG --project MyProject\n  /linear-tools-config --rate-limit-debug true|false\n  /linear-tools-config --allow-overwrite-files true|false\n\nNote: environment LINEAR_API_KEY takes precedence over settings file.`,
        display: true,
      });
    },
  });

  pi.registerCommand('linear-tools-reload', {
    description: 'Reload extension runtime (extensions, skills, prompts, themes)',
    handler: async (_args, ctx) => {
      if (ctx?.hasUI) {
        ctx.ui.notify('Reloading runtime...', 'info');
      }
      await ctx.reload();
    },
  });

  pi.registerCommand('linear-tools-help', {
    description: 'Show pi-linear-tools commands and tools',
    handler: async (_args, ctx) => {
      if (ctx?.hasUI) {
        ctx.ui.notify('pi-linear-tools extension commands available', 'info');
      }

      const showMilestoneTool = await shouldExposeMilestoneTool();
      const toolLines = [
        'LLM-callable tools:',
        '  linear_issue (list/view/images/download/activity/create/update/comment/start/delete)',
        '  linear_project (list/view/create/update/delete/archive/unarchive)',
        '  linear_project_update (list/view/create/update/archive/unarchive)',
        '  linear_team (list)',
      ];

      if (showMilestoneTool) {
        toolLines.push('  linear_milestone (list/view/create/update/delete)');
      } else {
        toolLines.push('  linear_milestone hidden: requires API key auth');
      }

      pi.sendMessage({
        customType: 'pi-linear-tools',
        content: [
          'Commands:',
          '  /linear-tools-config --api-key <key>',
          '  /linear-tools-config --default-team <team-key>',
          '  /linear-tools-config --team <team-key> --project <project-name-or-id>',
          '  /linear-tools-config --rate-limit-debug true|false',
          '  /linear-tools-config --allow-overwrite-files true|false',
          '  /linear-tools-help',
          '  /linear-tools-reload',
          '',
          ...toolLines,
        ].join('\n'),
        display: true,
      });
    },
  });

  await registerLinearTools(pi);
  } catch (error) {
    // Safety: never let extension initialization crash pi
    console.error('[pi-linear-tools] Extension initialization failed:', error?.message || error);
  }
}
