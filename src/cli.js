import { loadSettings, saveSettings } from './settings.js';
import { createLinearClient } from './linear-client.js';
import { resolveProjectRef } from './linear.js';
import { authenticate, logout, getAuthStatus, isAuthenticated } from './auth/index.js';
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
} from './handlers.js';

// ===== ARGUMENT PARSING =====

function readFlag(args, flag) {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
}

function readMultiFlag(args, flag) {
  const values = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === flag && i + 1 < args.length) {
      values.push(args[i + 1]);
    }
  }
  return values;
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

function parseArrayValue(value) {
  if (!value) return undefined;
  // Support comma-separated values
  return value.split(',').map((v) => v.trim()).filter(Boolean);
}

function parseNumber(value) {
  if (value === undefined || value === null) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function parseBoolean(value) {
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return undefined;
}

// ===== API KEY RESOLUTION =====

let cachedApiKey = null;

async function getLinearApiKey() {
  const envKey = process.env.LINEAR_API_KEY;
  if (envKey && envKey.trim()) {
    return envKey.trim();
  }

  if (cachedApiKey) {
    return cachedApiKey;
  }

  try {
    const settings = await loadSettings();
    // Support both new apiKey and legacy linearApiKey (for migration)
    const apiKey = settings.apiKey || settings.linearApiKey;
    if (apiKey && apiKey.trim()) {
      cachedApiKey = apiKey.trim();
      return cachedApiKey;
    }
  } catch {
    // ignore, error below
  }

  throw new Error('LINEAR_API_KEY not set. Run: pi-linear-tools config --api-key <key>');
}

async function resolveDefaultTeam(projectId) {
  const settings = await loadSettings();

  if (projectId && settings.projects?.[projectId]?.scope?.team) {
    return settings.projects[projectId].scope.team;
  }

  return settings.defaultTeam || null;
}

// ===== HELP OUTPUT =====

function printHelp() {
  console.log(`pi-linear-tools - Linear CLI

Usage:
  pi-linear-tools <command> [options]

Commands:
  help                          Show this help message
  auth <action>                 Manage authentication (OAuth 2.0)
  config                        Show current configuration
  config --api-key <key>        Set Linear API key (legacy)
  config --default-team <key>   Set default team
  issue <action> [options]      Manage issues
  project <action> [options]    Manage projects
  team <action> [options]       Manage teams
  milestone <action> [options]  Manage milestones

Auth Actions:
  login    Authenticate with Linear via OAuth 2.0
  logout   Clear stored authentication tokens
  status   Show current authentication status

Issue Actions:
  list [--project X] [--states X,Y] [--assignee me|all] [--limit N]
  view <issue> [--no-comments]
  create --title X [--team X] [--project X] [--description X] [--priority 0-4] [--assignee me|ID]
  update <issue> [--title X] [--description X] [--state X] [--priority 0-4]
         [--assignee me|ID] [--milestone X] [--sub-issue-of X]
  comment <issue> --body X
  start <issue> [--branch X] [--from-ref X] [--on-branch-exists switch|suffix]
  delete <issue>

Project Actions:
  list

Team Actions:
  list

Milestone Actions:
  list [--project X]
  view <milestone-id>
  create --project X --name X [--description X] [--target-date YYYY-MM-DD] [--status X]
  update <milestone-id> [--name X] [--description X] [--target-date X] [--status X]
  delete <milestone-id>

Common Flags:
  --project     Project name or ID
  --team        Team key (e.g., ENG)
  --assignee    "me" or assignee ID
  --priority    Priority 0-4 (0=None, 1=Urgent, 2=High, 3=Medium, 4=Low)
  --state       State name or ID
  --limit       Max results (default: 50)

Examples:
  pi-linear-tools auth login
  pi-linear-tools auth status
  pi-linear-tools issue list --project MyProject --states "In Progress,Backlog"
  pi-linear-tools issue view ENG-123
  pi-linear-tools issue create --title "Fix bug" --team ENG --priority 2
  pi-linear-tools issue update ENG-123 --state "In Progress" --assignee me
  pi-linear-tools issue start ENG-123
  pi-linear-tools milestone list --project MyProject
  pi-linear-tools config --api-key lin_xxx

Authentication:
  OAuth 2.0 is the recommended authentication method.
  Run 'pi-linear-tools auth login' to authenticate.
  For CI/headless environments, set environment variables:
    LINEAR_ACCESS_TOKEN, LINEAR_REFRESH_TOKEN, LINEAR_EXPIRES_AT
`);
}

function printIssueHelp() {
  console.log(`pi-linear-tools issue - Manage Linear issues

Usage:
  pi-linear-tools issue <action> [options]

Actions:
  list      List issues in a project
  view      View issue details
  create    Create a new issue
  update    Update an existing issue
  comment   Add a comment to an issue
  start     Start working on an issue (create branch, set In Progress)
  delete    Delete an issue

List Options:
  --project X      Project name or ID (default: current directory name)
  --states X,Y     Filter by state names (comma-separated)
  --assignee X     Filter by assignee: "me" or "all"
  --limit N        Max results (default: 50)

View Options:
  <issue>          Issue key (e.g., ENG-123) or ID
  --no-comments    Exclude comments from output

Create Options:
  --title X        Issue title (required)
  --team X         Team key, e.g., ENG (required if no default team)
  --project X      Project name or ID
  --description X  Issue description (markdown)
  --priority N     Priority 0-4
  --assignee X     "me" or assignee ID
  --parent-id X    Parent issue ID for sub-issues

Update Options:
  <issue>          Issue key or ID
  --title X        New title
  --description X  New description
  --state X        New state name or ID
  --priority N     New priority 0-4
  --assignee X     "me" or assignee ID
  --milestone X    Milestone name/ID, or "none" to clear
  --sub-issue-of X Parent issue key/ID, or "none" to clear

Comment Options:
  <issue>          Issue key or ID
  --body X         Comment body (markdown)

Start Options:
  <issue>          Issue key or ID
  --branch X       Custom branch name (default: issue's branch name)
  --from-ref X     Git ref to branch from (default: HEAD)
  --on-branch-exists X  "switch" or "suffix" (default: switch)

Delete Options:
  <issue>          Issue key or ID
`);
}

function printProjectHelp() {
  console.log(`pi-linear-tools project - Manage Linear projects

Usage:
  pi-linear-tools project <action>

Actions:
  list    List all accessible projects
`);
}

function printTeamHelp() {
  console.log(`pi-linear-tools team - Manage Linear teams

Usage:
  pi-linear-tools team <action>

Actions:
  list    List all accessible teams
`);
}

function printMilestoneHelp() {
  console.log(`pi-linear-tools milestone - Manage Linear project milestones

Usage:
  pi-linear-tools milestone <action> [options]

Actions:
  list      List milestones in a project
  view      View milestone details
  create    Create a new milestone
  update    Update an existing milestone
  delete    Delete a milestone

List Options:
  --project X      Project name or ID (default: current directory name)

View Options:
  <milestone-id>   Milestone ID

Create Options:
  --project X      Project name or ID (required)
  --name X         Milestone name (required)
  --description X  Milestone description
  --target-date X  Target date (YYYY-MM-DD)
  --status X       Status: backlogged, planned, inProgress, paused, completed, cancelled

Update Options:
  <milestone-id>   Milestone ID
  --name X         New name
  --description X  New description
  --target-date X  New target date
  --status X       New status

Delete Options:
  <milestone-id>   Milestone ID
`);
}

function printAuthHelp() {
  console.log(`pi-linear-tools auth - Manage Linear authentication

Usage:
  pi-linear-tools auth <action>

Actions:
  login    Authenticate with Linear via OAuth 2.0
  logout   Clear stored authentication tokens
  status   Show current authentication status

Login:
  Starts the OAuth 2.0 authentication flow:
  1. Opens your browser to Linear's authorization page
  2. You authorize the application
  3. Tokens are stored securely in your OS keychain
  4. Automatic token refresh keeps you authenticated

Logout:
  Clears stored OAuth tokens from your keychain.
  You'll need to authenticate again to access Linear.

Status:
  Shows your current authentication status:
  - Whether you're authenticated
  - Token expiry time
  - Granted OAuth scopes

Examples:
  pi-linear-tools auth login
  pi-linear-tools auth status
  pi-linear-tools auth logout

Environment Variables (for CI/headless environments):
  LINEAR_ACCESS_TOKEN     OAuth access token
  LINEAR_REFRESH_TOKEN    OAuth refresh token
  LINEAR_EXPIRES_AT       Token expiry timestamp (milliseconds)
`);
}

// ===== AUTH HANDLERS =====

async function handleAuthLogin(args) {
  const port = readFlag(args, '--port');

  try {
    const tokens = await authenticate({
      port: port ? parseInt(port, 10) : undefined,
    });

    console.log('\n✓ Authentication successful!');
    console.log(`✓ Token expires at: ${new Date(tokens.expiresAt).toLocaleString()}`);
    console.log(`✓ Granted scopes: ${tokens.scope.join(', ')}`);
    console.log('\nYou can now use pi-linear-tools commands.');
  } catch (error) {
    console.error('\n✗ Authentication failed:', error.message);
    process.exitCode = 1;
  }
}

async function handleAuthLogout() {
  try {
    await logout();
    console.log('\n✓ Logged out successfully');
    console.log('\nYou will need to authenticate again to access Linear.');
  } catch (error) {
    console.error('\n✗ Logout failed:', error.message);
    process.exitCode = 1;
  }
}

async function handleAuthStatus() {
  try {
    const status = await getAuthStatus();

    if (!status) {
      console.log('\nAuthentication status: Not authenticated');
      console.log('\nTo authenticate, run: pi-linear-tools auth login');
      console.log('\nFor CI/headless environments, set these environment variables:');
      console.log('  LINEAR_ACCESS_TOKEN');
      console.log('  LINEAR_REFRESH_TOKEN');
      console.log('  LINEAR_EXPIRES_AT');
      return;
    }

    const isAuth = await isAuthenticated();

    console.log('\nAuthentication status:', isAuth ? 'Authenticated' : 'Token expired');
    console.log(`Token expires at: ${new Date(status.expiresAt).toLocaleString()}`);

    if (status.expiresIn > 0) {
      const minutes = Math.floor(status.expiresIn / 60000);
      console.log(`Time until expiry: ${minutes} minute${minutes !== 1 ? 's' : ''}`);
    }

    console.log(`Granted scopes: ${status.scopes.join(', ')}`);
  } catch (error) {
    console.error('\n✗ Failed to get authentication status:', error.message);
    process.exitCode = 1;
  }
}

async function handleAuth(args) {
  const [action] = args;

  if (!action || action === '--help' || action === '-h') {
    printAuthHelp();
    return;
  }

  switch (action) {
    case 'login':
      return handleAuthLogin(args);
    case 'logout':
      return handleAuthLogout();
    case 'status':
      return handleAuthStatus();
    default:
      throw new Error(`Unknown auth action: ${action}`);
  }
}

// ===== CONFIG HANDLER =====

async function tryResolveProjectId(projectRef, explicitApiKey = null) {
  const envKey = process.env.LINEAR_API_KEY;
  const apiKey = explicitApiKey || (envKey && envKey.trim() ? envKey.trim() : null);

  if (!apiKey) {
    return projectRef;
  }

  try {
    const client = createLinearClient(apiKey);
    const resolved = await resolveProjectRef(client, projectRef);
    return resolved.id;
  } catch {
    return projectRef;
  }
}

async function handleConfig(args) {
  const apiKey = readFlag(args, '--api-key');
  const defaultTeam = readFlag(args, '--default-team');
  const projectTeam = readFlag(args, '--team');
  const projectName = readFlag(args, '--project');

  if (apiKey) {
    const settings = await loadSettings();
    settings.apiKey = apiKey;
    await saveSettings(settings);
    cachedApiKey = null;
    console.log('LINEAR_API_KEY saved to settings');
    return;
  }

  if (defaultTeam) {
    const settings = await loadSettings();
    settings.defaultTeam = defaultTeam;
    await saveSettings(settings);
    console.log(`Default team set to: ${defaultTeam}`);
    return;
  }

  if (projectTeam) {
    if (!projectName) {
      throw new Error('Missing required flag: --project when using --team');
    }

    const settings = await loadSettings();
    const projectId = await tryResolveProjectId(projectName, settings.linearApiKey);

    if (!settings.projects[projectId]) {
      settings.projects[projectId] = { scope: { team: null } };
    }

    if (!settings.projects[projectId].scope) {
      settings.projects[projectId].scope = { team: null };
    }

    settings.projects[projectId].scope.team = projectTeam;
    await saveSettings(settings);
    console.log(`Team for project "${projectName}" set to: ${projectTeam}`);
    return;
  }

  const settings = await loadSettings();
  const hasKey = !!(settings.apiKey || settings.linearApiKey || process.env.LINEAR_API_KEY);
  const keySource = process.env.LINEAR_API_KEY ? 'environment' : (settings.apiKey || settings.linearApiKey ? 'settings' : 'not set');

  console.log(`Configuration:
  LINEAR_API_KEY: ${hasKey ? 'configured' : 'not set'} (source: ${keySource})
  Default team: ${settings.defaultTeam || 'not set'}
  Project team mappings: ${Object.keys(settings.projects || {}).length}

Commands:
  pi-linear-tools config --api-key lin_xxx
  pi-linear-tools config --default-team ENG
  pi-linear-tools config --team ENG --project MyProject`);
}

// ===== ISSUE HANDLERS =====

async function handleIssueList(args) {
  const apiKey = await getLinearApiKey();
  const client = createLinearClient(apiKey);

  const params = {
    project: readFlag(args, '--project'),
    states: parseArrayValue(readFlag(args, '--states')),
    assignee: readFlag(args, '--assignee'),
    limit: parseNumber(readFlag(args, '--limit')),
  };

  const result = await executeIssueList(client, params);
  console.log(result.content[0].text);
}

async function handleIssueView(args) {
  const apiKey = await getLinearApiKey();
  const client = createLinearClient(apiKey);

  const positional = args.filter((a) => !a.startsWith('-'));
  if (positional.length === 0) {
    throw new Error('Missing required argument: issue key or ID');
  }

  const params = {
    issue: positional[0],
    includeComments: !hasFlag(args, '--no-comments'),
  };

  const result = await executeIssueView(client, params);
  console.log(result.content[0].text);
}

async function handleIssueCreate(args) {
  const apiKey = await getLinearApiKey();
  const client = createLinearClient(apiKey);

  const params = {
    title: readFlag(args, '--title'),
    team: readFlag(args, '--team'),
    project: readFlag(args, '--project'),
    description: readFlag(args, '--description'),
    priority: parseNumber(readFlag(args, '--priority')),
    assignee: readFlag(args, '--assignee'),
    parentId: readFlag(args, '--parent-id'),
    state: readFlag(args, '--state'),
  };

  if (!params.title) {
    throw new Error('Missing required flag: --title');
  }

  const result = await executeIssueCreate(client, params, { resolveDefaultTeam });
  console.log(result.content[0].text);
}

async function handleIssueUpdate(args) {
  const apiKey = await getLinearApiKey();
  const client = createLinearClient(apiKey);

  const positional = args.filter((a) => !a.startsWith('-'));
  if (positional.length === 0) {
    throw new Error('Missing required argument: issue key or ID');
  }

  const params = {
    issue: positional[0],
    title: readFlag(args, '--title'),
    description: readFlag(args, '--description'),
    state: readFlag(args, '--state'),
    priority: parseNumber(readFlag(args, '--priority')),
    assignee: readFlag(args, '--assignee'),
    milestone: readFlag(args, '--milestone'),
    subIssueOf: readFlag(args, '--sub-issue-of'),
  };

  const result = await executeIssueUpdate(client, params);
  console.log(result.content[0].text);
}

async function handleIssueComment(args) {
  const apiKey = await getLinearApiKey();
  const client = createLinearClient(apiKey);

  const positional = args.filter((a) => !a.startsWith('-'));
  if (positional.length === 0) {
    throw new Error('Missing required argument: issue key or ID');
  }

  const params = {
    issue: positional[0],
    body: readFlag(args, '--body'),
  };

  if (!params.body) {
    throw new Error('Missing required flag: --body');
  }

  const result = await executeIssueComment(client, params);
  console.log(result.content[0].text);
}

async function handleIssueStart(args) {
  const apiKey = await getLinearApiKey();
  const client = createLinearClient(apiKey);

  const positional = args.filter((a) => !a.startsWith('-'));
  if (positional.length === 0) {
    throw new Error('Missing required argument: issue key or ID');
  }

  const params = {
    issue: positional[0],
    branch: readFlag(args, '--branch'),
    fromRef: readFlag(args, '--from-ref'),
    onBranchExists: readFlag(args, '--on-branch-exists'),
  };

  const result = await executeIssueStart(client, params);
  console.log(result.content[0].text);
}

async function handleIssueDelete(args) {
  const apiKey = await getLinearApiKey();
  const client = createLinearClient(apiKey);

  const positional = args.filter((a) => !a.startsWith('-'));
  if (positional.length === 0) {
    throw new Error('Missing required argument: issue key or ID');
  }

  const params = {
    issue: positional[0],
  };

  const result = await executeIssueDelete(client, params);
  console.log(result.content[0].text);
}

async function handleIssue(args) {
  const [action, ...rest] = args;

  if (!action || action === '--help' || action === '-h') {
    printIssueHelp();
    return;
  }

  switch (action) {
    case 'list':
      return handleIssueList(rest);
    case 'view':
      return handleIssueView(rest);
    case 'create':
      return handleIssueCreate(rest);
    case 'update':
      return handleIssueUpdate(rest);
    case 'comment':
      return handleIssueComment(rest);
    case 'start':
      return handleIssueStart(rest);
    case 'delete':
      return handleIssueDelete(rest);
    default:
      throw new Error(`Unknown issue action: ${action}`);
  }
}

// ===== PROJECT HANDLERS =====

async function handleProjectList() {
  const apiKey = await getLinearApiKey();
  const client = createLinearClient(apiKey);

  const result = await executeProjectList(client);
  console.log(result.content[0].text);
}

async function handleProject(args) {
  const [action] = args;

  if (!action || action === '--help' || action === '-h') {
    printProjectHelp();
    return;
  }

  switch (action) {
    case 'list':
      return handleProjectList();
    default:
      throw new Error(`Unknown project action: ${action}`);
  }
}

// ===== TEAM HANDLERS =====

async function handleTeamList() {
  const apiKey = await getLinearApiKey();
  const client = createLinearClient(apiKey);

  const result = await executeTeamList(client);
  console.log(result.content[0].text);
}

async function handleTeam(args) {
  const [action] = args;

  if (!action || action === '--help' || action === '-h') {
    printTeamHelp();
    return;
  }

  switch (action) {
    case 'list':
      return handleTeamList();
    default:
      throw new Error(`Unknown team action: ${action}`);
  }
}

// ===== MILESTONE HANDLERS =====

async function handleMilestoneList(args) {
  const apiKey = await getLinearApiKey();
  const client = createLinearClient(apiKey);

  const params = {
    project: readFlag(args, '--project'),
  };

  const result = await executeMilestoneList(client, params);
  console.log(result.content[0].text);
}

async function handleMilestoneView(args) {
  const apiKey = await getLinearApiKey();
  const client = createLinearClient(apiKey);

  const positional = args.filter((a) => !a.startsWith('-'));
  if (positional.length === 0) {
    throw new Error('Missing required argument: milestone ID');
  }

  const params = {
    milestone: positional[0],
  };

  const result = await executeMilestoneView(client, params);
  console.log(result.content[0].text);
}

async function handleMilestoneCreate(args) {
  const apiKey = await getLinearApiKey();
  const client = createLinearClient(apiKey);

  const params = {
    project: readFlag(args, '--project'),
    name: readFlag(args, '--name'),
    description: readFlag(args, '--description'),
    targetDate: readFlag(args, '--target-date'),
    status: readFlag(args, '--status'),
  };

  if (!params.name) {
    throw new Error('Missing required flag: --name');
  }

  const result = await executeMilestoneCreate(client, params);
  console.log(result.content[0].text);
}

async function handleMilestoneUpdate(args) {
  const apiKey = await getLinearApiKey();
  const client = createLinearClient(apiKey);

  const positional = args.filter((a) => !a.startsWith('-'));
  if (positional.length === 0) {
    throw new Error('Missing required argument: milestone ID');
  }

  const params = {
    milestone: positional[0],
    name: readFlag(args, '--name'),
    description: readFlag(args, '--description'),
    targetDate: readFlag(args, '--target-date'),
    status: readFlag(args, '--status'),
  };

  const result = await executeMilestoneUpdate(client, params);
  console.log(result.content[0].text);
}

async function handleMilestoneDelete(args) {
  const apiKey = await getLinearApiKey();
  const client = createLinearClient(apiKey);

  const positional = args.filter((a) => !a.startsWith('-'));
  if (positional.length === 0) {
    throw new Error('Missing required argument: milestone ID');
  }

  const params = {
    milestone: positional[0],
  };

  const result = await executeMilestoneDelete(client, params);
  console.log(result.content[0].text);
}

async function handleMilestone(args) {
  const [action, ...rest] = args;

  if (!action || action === '--help' || action === '-h') {
    printMilestoneHelp();
    return;
  }

  switch (action) {
    case 'list':
      return handleMilestoneList(rest);
    case 'view':
      return handleMilestoneView(rest);
    case 'create':
      return handleMilestoneCreate(rest);
    case 'update':
      return handleMilestoneUpdate(rest);
    case 'delete':
      return handleMilestoneDelete(rest);
    default:
      throw new Error(`Unknown milestone action: ${action}`);
  }
}

// ===== MAIN CLI ENTRY =====

export async function runCli(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    return;
  }

  if (command === 'auth') {
    await handleAuth(rest);
    return;
  }

  if (command === 'config') {
    await handleConfig(rest);
    return;
  }

  if (command === 'issue') {
    await handleIssue(rest);
    return;
  }

  if (command === 'project') {
    await handleProject(rest);
    return;
  }

  if (command === 'team') {
    await handleTeam(rest);
    return;
  }

  if (command === 'milestone') {
    await handleMilestone(rest);
    return;
  }

  printHelp();
  process.exitCode = 1;
}
