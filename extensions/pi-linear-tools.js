import { loadSettings, saveSettings } from '../src/settings.js';
import { createLinearClient } from '../src/linear-client.js';
import { setQuietMode } from '../src/logger.js';
import {
  resolveProjectRef,
  fetchTeams,
  fetchWorkspaces,
} from '../src/linear.js';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function isPiCodingAgentRoot(dir) {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg?.name === '@mariozechner/pi-coding-agent';
  } catch {
    return false;
  }
}

function findPiCodingAgentRoot() {
  const entry = process.argv?.[1];
  if (!entry) return null;

  // Method 1: walk up from argv1 (works when argv1 is .../pi-coding-agent/dist/cli.js)
  {
    let dir = path.dirname(entry);
    for (let i = 0; i < 20; i += 1) {
      if (isPiCodingAgentRoot(dir)) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  // Method 2: npm global layout guess (works when argv1 is .../<prefix>/bin/pi)
  // <prefix>/bin/pi  ->  <prefix>/lib/node_modules/@mariozechner/pi-coding-agent
  {
    const binDir = path.dirname(entry);
    const prefix = path.resolve(binDir, '..');
    const candidate = path.join(prefix, 'lib', 'node_modules', '@mariozechner', 'pi-coding-agent');
    if (isPiCodingAgentRoot(candidate)) {
      return candidate;
    }
  }

  // Method 3: common global node_modules locations
  for (const candidate of [
    '/usr/local/lib/node_modules/@mariozechner/pi-coding-agent',
    '/usr/lib/node_modules/@mariozechner/pi-coding-agent',
  ]) {
    if (isPiCodingAgentRoot(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function importFromPiRoot(relativePathFromPiRoot) {
  const piRoot = findPiCodingAgentRoot();

  if (!piRoot) throw new Error('Unable to locate @mariozechner/pi-coding-agent installation');

  const absPath = path.join(piRoot, relativePathFromPiRoot);
  return import(pathToFileURL(absPath).href);
}

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
  executeIssueCreate,
  executeIssueUpdate,
  executeIssueComment,
  executeIssueStart,
  executeIssueDelete,
  executeProjectList,
  executeTeamList,
  executeMilestoneList,
  executeMilestoneView,
  executeMilestoneCreate,
  executeMilestoneUpdate,
  executeMilestoneDelete,
} from '../src/handlers.js';
import { authenticate, getAccessToken, logout } from '../src/auth/index.js';

function parseArgs(argsString) {
  if (!argsString || !argsString.trim()) return [];
  const tokens = argsString.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  return tokens.map((t) => {
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
      return t.slice(1, -1);
    }
    return t;
  });
}

function readFlag(args, flag) {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

let cachedApiKey = null;

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

function withMilestoneScopeHint(error) {
  const message = String(error?.message || error || 'Unknown error');

  if (/invalid scope/i.test(message) && /write/i.test(message)) {
    return new Error(
      `${message}\nHint: Milestone create/update/delete require Linear write scope. ` +
      `Use API key auth for milestone management: /linear-tools-config --api-key <key>`
    );
  }

  return error;
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
    const selectedAuthMethod = await ctx.ui.select('Select authentication method', ['API Key (recommended for full functionlaity)', 'OAuth']);

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
  if (typeof pi.registerTool !== 'function') return;

  pi.registerTool({
    name: 'linear_issue',
    label: 'Linear Issue',
    description: 'Interact with Linear issues. Actions: list, view, create, update, comment, start, delete',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'view', 'create', 'update', 'comment', 'start', 'delete'],
          description: 'Action to perform on issue(s)',
        },
        issue: {
          type: 'string',
          description: 'Issue key (ABC-123) or Linear issue ID (for view, update, comment, start, delete)',
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
          type: 'number',
          description: 'Maximum number of issues to list (default: 50)',
        },
        includeComments: {
          type: 'boolean',
          description: 'Include comments when viewing issue (default: true)',
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
          type: 'number',
          description: 'Priority 0..4 (for create, update)',
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
      const client = await createAuthenticatedClient();

      switch (params.action) {
        case 'list':
          return executeIssueList(client, params);
        case 'view':
          return executeIssueView(client, params);
        case 'create':
          return executeIssueCreate(client, params, { resolveDefaultTeam });
        case 'update':
          return executeIssueUpdate(client, params);
        case 'comment':
          return executeIssueComment(client, params);
        case 'start':
          return executeIssueStart(client, params, {
            gitExecutor: async (branchName, fromRef, onBranchExists) => {
              return startGitBranchForIssue(pi, branchName, fromRef, onBranchExists);
            },
          });
        case 'delete':
          return executeIssueDelete(client, params);
        default:
          throw new Error(`Unknown action: ${params.action}`);
      }
    },
  });

  pi.registerTool({
    name: 'linear_project',
    label: 'Linear Project',
    description: 'Interact with Linear projects. Actions: list',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list'],
          description: 'Action to perform on project(s)',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    renderResult: renderMarkdownResult,
    async execute(_toolCallId, params) {
      const client = await createAuthenticatedClient();

      switch (params.action) {
        case 'list':
          return executeProjectList(client);
        default:
          throw new Error(`Unknown action: ${params.action}`);
      }
    },
  });

  pi.registerTool({
    name: 'linear_team',
    label: 'Linear Team',
    description: 'Interact with Linear teams. Actions: list',
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
      const client = await createAuthenticatedClient();

      switch (params.action) {
        case 'list':
          return executeTeamList(client);
        default:
          throw new Error(`Unknown action: ${params.action}`);
      }
    },
  });

  if (await shouldExposeMilestoneTool()) {
    pi.registerTool({
      name: 'linear_milestone',
      label: 'Linear Milestone',
      description: 'Interact with Linear project milestones. Actions: list, view, create, update, delete',
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
        const client = await createAuthenticatedClient();

        try {
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
        } catch (error) {
          throw withMilestoneScopeHint(error);
        }
      },
    });
  }
}

export default async function piLinearToolsExtension(pi) {
  pi.registerCommand('linear-tools-config', {
    description: 'Configure pi-linear-tools settings (API key and default team mappings)',
    handler: async (argsText, ctx) => {
      const args = parseArgs(argsText);
      const apiKey = readFlag(args, '--api-key');
      const defaultTeam = readFlag(args, '--default-team');
      const projectTeam = readFlag(args, '--team');
      const projectName = readFlag(args, '--project');

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

      if (!apiKey && !defaultTeam && !projectTeam && !projectName && ctx?.hasUI && ctx?.ui) {
        await runInteractiveConfigFlow(ctx, pi);
        return;
      }

      const settings = await loadSettings();
      const hasKey = !!(settings.apiKey || settings.linearApiKey || process.env.LINEAR_API_KEY);
      const keySource = process.env.LINEAR_API_KEY ? 'environment' : (settings.apiKey || settings.linearApiKey ? 'settings' : 'not set');

      pi.sendMessage({
        customType: 'pi-linear-tools',
        content: `Configuration:\n  LINEAR_API_KEY: ${hasKey ? 'configured' : 'not set'} (source: ${keySource})\n  Default workspace: ${settings.defaultWorkspace?.name || 'not set'}\n  Default team: ${settings.defaultTeam || 'not set'}\n  Project team mappings: ${Object.keys(settings.projects || {}).length}\n\nCommands:\n  /linear-tools-config --api-key lin_xxx\n  /linear-tools-config --default-team ENG\n  /linear-tools-config --team ENG --project MyProject\n\nNote: environment LINEAR_API_KEY takes precedence over settings file.`,
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
        '  linear_issue (list/view/create/update/comment/start/delete)',
        '  linear_project (list)',
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
}
