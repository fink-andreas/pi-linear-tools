import { loadSettings, saveSettings } from '../src/settings.js';
import { createLinearClient } from '../src/linear-client.js';
import {
  prepareIssueStart,
  setIssueState,
  addIssueComment,
  updateIssue,
  createIssue,
  fetchProjects,
  resolveProjectRef,
  resolveTeamRef,
  getTeamWorkflowStates,
  fetchIssueDetails,
  formatIssueAsMarkdown,
  fetchIssuesByProject,
  fetchProjectMilestones,
  fetchMilestoneDetails,
  createProjectMilestone,
  updateProjectMilestone,
  deleteProjectMilestone,
  deleteIssue,
} from '../src/linear.js';

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

function upsertFlag(args, flag, value) {
  const idx = args.indexOf(flag);
  if (idx >= 0) {
    args[idx + 1] = value;
    return;
  }
  args.push(flag, value);
}

function readFlag(args, flag) {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

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
    if (settings.linearApiKey && settings.linearApiKey.trim()) {
      cachedApiKey = settings.linearApiKey.trim();
      return cachedApiKey;
    }
  } catch {
    // ignore, error below
  }

  throw new Error('LINEAR_API_KEY not set. Use /linear-tools-config --api-key <key> or set environment variable.');
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

function toTextResult(text, details = {}) {
  return {
    content: [{ type: 'text', text }],
    details,
  };
}

function ensureNonEmpty(value, fieldName) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`Missing required field: ${fieldName}`);
  return text;
}

function registerLinearTools(pi) {
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
        branch: {
          type: 'string',
          description: 'Custom branch name override (for start)',
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
    async execute(_toolCallId, params) {
      const apiKey = await getLinearApiKey();
      const client = createLinearClient(apiKey);

      switch (params.action) {
        case 'list':
          return executeIssueList(client, params);
        case 'view':
          return executeIssueView(client, params);
        case 'create':
          return executeIssueCreate(client, params);
        case 'update':
          return executeIssueUpdate(client, params);
        case 'comment':
          return executeIssueComment(client, params);
        case 'start':
          return executeIssueStart(client, pi, params);
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
    async execute(_toolCallId, params) {
      const apiKey = await getLinearApiKey();
      const client = createLinearClient(apiKey);

      switch (params.action) {
        case 'list':
          return executeProjectList(client);
        default:
          throw new Error(`Unknown action: ${params.action}`);
      }
    },
  });

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
        status: {
          type: 'string',
          enum: ['backlogged', 'planned', 'inProgress', 'paused', 'completed', 'done', 'cancelled'],
          description: 'Milestone status',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(_toolCallId, params) {
      const apiKey = await getLinearApiKey();
      const client = createLinearClient(apiKey);

      switch (params.action) {
        case 'list':
          return executeMilestoneList(client, params);
        case 'view':
          return executeMilestoneView(client, params);
        case 'create':
          return executeMilestoneCreate(client, params);
        case 'update':
          return executeMilestoneUpdate(client, params);
        case 'delete':
          return executeMilestoneDelete(client, params);
        default:
          throw new Error(`Unknown action: ${params.action}`);
      }
    },
  });
}

async function executeIssueList(client, params) {
  let projectRef = params.project;
  if (!projectRef) {
    projectRef = process.cwd().split('/').pop();
  }

  const resolved = await resolveProjectRef(client, projectRef);

  let assigneeId = null;
  if (params.assignee === 'me') {
    const viewer = await client.viewer;
    assigneeId = viewer.id;
  }

  const { issues, truncated } = await fetchIssuesByProject(client, resolved.id, params.states || null, {
    assigneeId,
    limit: params.limit || 50,
  });

  if (issues.length === 0) {
    return toTextResult(`No issues found in project "${resolved.name}"`, {
      projectId: resolved.id,
      projectName: resolved.name,
      issueCount: 0,
    });
  }

  const lines = [`## Issues in project "${resolved.name}" (${issues.length}${truncated ? '+' : ''})\n`];

  for (const issue of issues) {
    const stateLabel = issue.state?.name || 'Unknown';
    const assigneeLabel = issue.assignee?.displayName || 'Unassigned';
    const priorityLabel = issue.priority !== undefined && issue.priority !== null
      ? ['None', 'Urgent', 'High', 'Medium', 'Low'][issue.priority] || `P${issue.priority}`
      : null;

    const metaParts = [`[${stateLabel}]`, `@${assigneeLabel}`];
    if (priorityLabel) metaParts.push(priorityLabel);

    lines.push(`- **${issue.identifier}**: ${issue.title} _${metaParts.join(' ')}_`);
  }

  if (truncated) {
    lines.push('\n_Results may be truncated. Use limit parameter to fetch more._');
  }

  return toTextResult(lines.join('\n'), {
    projectId: resolved.id,
    projectName: resolved.name,
    issueCount: issues.length,
    truncated,
  });
}

async function executeIssueView(client, params) {
  const issue = ensureNonEmpty(params.issue, 'issue');
  const includeComments = params.includeComments !== false;

  const issueData = await fetchIssueDetails(client, issue, { includeComments });
  const markdown = formatIssueAsMarkdown(issueData, { includeComments });

  return {
    content: [{ type: 'text', text: markdown }],
    details: {
      issueId: issueData.id,
      identifier: issueData.identifier,
      title: issueData.title,
      state: issueData.state,
      url: issueData.url,
    },
  };
}

async function executeIssueCreate(client, params) {
  const title = ensureNonEmpty(params.title, 'title');

  let projectRef = params.project;
  if (!projectRef) {
    projectRef = process.cwd().split('/').pop();
  }

  let projectId = null;
  let resolvedProject = null;
  try {
    resolvedProject = await resolveProjectRef(client, projectRef);
    projectId = resolvedProject.id;
  } catch {
    // continue without project
  }

  let teamRef = params.team;
  if (!teamRef) {
    teamRef = await resolveDefaultTeam(projectId);
  }

  if (!teamRef) {
    throw new Error('Missing required field: team. Set a default with /linear-tools-config --default-team <team-key> or provide team parameter.');
  }

  const team = await resolveTeamRef(client, teamRef);

  const createInput = {
    teamId: team.id,
    title,
  };

  if (params.description) {
    createInput.description = params.description;
  }

  if (params.priority !== undefined && params.priority !== null) {
    createInput.priority = params.priority;
  }

  if (params.parentId) {
    createInput.parentId = params.parentId;
  }

  if (params.assignee === 'me') {
    const viewer = await client.viewer;
    createInput.assigneeId = viewer.id;
  } else if (params.assignee) {
    createInput.assigneeId = params.assignee;
  }

  if (params.state) {
    const states = await getTeamWorkflowStates(client, team.id);
    const target = params.state.trim().toLowerCase();
    const state = states.find((s) => s.name.toLowerCase() === target || s.id === params.state);
    if (state) {
      createInput.stateId = state.id;
    }
  }

  if (resolvedProject) {
    createInput.projectId = resolvedProject.id;
  }

  const issue = await createIssue(client, createInput);

  const identifier = issue.identifier || issue.id || 'unknown';
  const projectLabel = issue.project?.name || 'No project';
  const priorityLabel = issue.priority !== undefined && issue.priority !== null
    ? ['None', 'Urgent', 'High', 'Medium', 'Low'][issue.priority] || `P${issue.priority}`
    : null;
  const stateLabel = issue.state?.name || 'Unknown';
  const assigneeLabel = issue.assignee?.displayName || 'Unassigned';

  const metaParts = [`Team: ${team.name}`, `Project: ${projectLabel}`, `State: ${stateLabel}`, `Assignee: ${assigneeLabel}`];
  if (priorityLabel) metaParts.push(`Priority: ${priorityLabel}`);

  return toTextResult(
    `Created issue **${identifier}**: ${issue.title}\n${metaParts.join(' | ')}`,
    {
      issueId: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      team: issue.team,
      project: issue.project,
      state: issue.state,
      assignee: issue.assignee,
      url: issue.url,
    }
  );
}

async function executeIssueUpdate(client, params) {
  const issue = ensureNonEmpty(params.issue, 'issue');

  const updatePatch = {
    title: params.title,
    description: params.description,
    priority: params.priority,
    state: params.state,
  };

  // Handle assignee parameter
  if (params.assignee === 'me') {
    const viewer = await client.viewer;
    updatePatch.assigneeId = viewer.id;
  } else if (params.assignee) {
    updatePatch.assigneeId = params.assignee;
  }

  const result = await updateIssue(client, issue, updatePatch);

  const friendlyChanges = result.changed.map((field) => {
    if (field === 'stateId') return 'state';
    if (field === 'assigneeId') return 'assignee';
    return field;
  });
  const changeSummaryParts = [];

  if (friendlyChanges.includes('state') && result.issue?.state?.name) {
    changeSummaryParts.push(`state: ${result.issue.state.name}`);
  }

  if (friendlyChanges.includes('assignee')) {
    const assigneeLabel = result.issue?.assignee?.displayName || 'Unassigned';
    changeSummaryParts.push(`assignee: ${assigneeLabel}`);
  }

  for (const field of friendlyChanges) {
    if (field !== 'state' && field !== 'assignee') changeSummaryParts.push(field);
  }

  const suffix = changeSummaryParts.length > 0
    ? ` (${changeSummaryParts.join(', ')})`
    : '';

  return toTextResult(
    `Updated issue ${result.issue.identifier}${suffix}`,
    {
      issueId: result.issue.id,
      identifier: result.issue.identifier,
      changed: friendlyChanges,
      state: result.issue.state,
      priority: result.issue.priority,
    }
  );
}

async function executeIssueComment(client, params) {
  const issue = ensureNonEmpty(params.issue, 'issue');
  const body = ensureNonEmpty(params.body, 'body');
  const result = await addIssueComment(client, issue, body, params.parentCommentId);

  return toTextResult(
    `Added comment to issue ${result.issue.identifier}`,
    {
      issueId: result.issue.id,
      identifier: result.issue.identifier,
      commentId: result.comment.id,
    }
  );
}

async function executeIssueStart(client, pi, params) {
  const issue = ensureNonEmpty(params.issue, 'issue');
  const prepared = await prepareIssueStart(client, issue);

  const desiredBranch = params.branch || prepared.branchName;
  if (!desiredBranch) {
    throw new Error(
      `No branch name resolved for issue ${prepared.issue.identifier}. Provide the 'branch' parameter explicitly.`
    );
  }

  const gitResult = await startGitBranchForIssue(
    pi,
    desiredBranch,
    params.fromRef || 'HEAD',
    params.onBranchExists || 'switch'
  );

  const updatedIssue = await setIssueState(client, prepared.issue.id, prepared.startedState.id);

  const compactTitle = String(updatedIssue.title || prepared.issue?.title || '').trim().toLowerCase();
  const summary = compactTitle
    ? `Started issue ${updatedIssue.identifier} (${compactTitle})`
    : `Started issue ${updatedIssue.identifier}`;

  return toTextResult(summary, {
    issueId: updatedIssue.id,
    identifier: updatedIssue.identifier,
    state: updatedIssue.state,
    startedState: prepared.startedState,
    git: gitResult,
  });
}

async function executeIssueDelete(client, params) {
  const issue = ensureNonEmpty(params.issue, 'issue');
  const result = await deleteIssue(client, issue);

  return toTextResult(
    `Deleted issue **${result.identifier}**`,
    {
      issueId: result.issueId,
      identifier: result.identifier,
      success: result.success,
    }
  );
}

async function executeProjectList(client) {
  const projects = await fetchProjects(client);

  if (projects.length === 0) {
    return toTextResult('No projects found', { projectCount: 0 });
  }

  const lines = [`## Projects (${projects.length})\n`];

  for (const project of projects) {
    lines.push(`- **${project.name}** \`${project.id}\``);
  }

  return toTextResult(lines.join('\n'), {
    projectCount: projects.length,
    projects: projects.map((p) => ({ id: p.id, name: p.name })),
  });
}

async function executeMilestoneList(client, params) {
  let projectRef = params.project;
  if (!projectRef) {
    projectRef = process.cwd().split('/').pop();
  }

  const resolved = await resolveProjectRef(client, projectRef);
  const milestones = await fetchProjectMilestones(client, resolved.id);

  if (milestones.length === 0) {
    return toTextResult(`No milestones found in project "${resolved.name}"`, {
      projectId: resolved.id,
      projectName: resolved.name,
      milestoneCount: 0,
    });
  }

  const lines = [`## Milestones in project "${resolved.name}" (${milestones.length})\n`];

  const sorted = [...milestones].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  for (const milestone of sorted) {
    const statusEmoji = {
      backlogged: '📋',
      planned: '📅',
      inProgress: '🚀',
      paused: '⏸️',
      completed: '✅',
      done: '✅',
      cancelled: '❌',
    }[milestone.status] || '📌';

    const progressLabel = milestone.progress !== undefined && milestone.progress !== null
      ? `${milestone.progress}%`
      : 'N/A';

    const dateLabel = milestone.targetDate
      ? ` → ${milestone.targetDate.split('T')[0]}`
      : '';

    lines.push(`- ${statusEmoji} **${milestone.name}** _[${milestone.status}]_ (${progressLabel})${dateLabel}`);
    if (milestone.description) {
      lines.push(`  ${milestone.description.split('\n')[0].slice(0, 100)}${milestone.description.length > 100 ? '...' : ''}`);
    }
  }

  return toTextResult(lines.join('\n'), {
    projectId: resolved.id,
    projectName: resolved.name,
    milestoneCount: milestones.length,
    milestones: milestones.map((m) => ({ id: m.id, name: m.name, status: m.status, progress: m.progress })),
  });
}

async function executeMilestoneView(client, params) {
  const milestoneId = ensureNonEmpty(params.milestone, 'milestone');

  const milestoneData = await fetchMilestoneDetails(client, milestoneId);

  const lines = [];
  lines.push(`# Milestone: ${milestoneData.name}`);

  const metaParts = [];
  if (milestoneData.project?.name) {
    metaParts.push(`**Project:** ${milestoneData.project.name}`);
  }
  metaParts.push(`**Status:** ${milestoneData.status}`);
  if (milestoneData.progress !== undefined && milestoneData.progress !== null) {
    metaParts.push(`**Progress:** ${milestoneData.progress}%`);
  }
  if (milestoneData.targetDate) {
    metaParts.push(`**Target Date:** ${milestoneData.targetDate.split('T')[0]}`);
  }

  if (metaParts.length > 0) {
    lines.push('');
    lines.push(metaParts.join(' | '));
  }

  if (milestoneData.description) {
    lines.push('');
    lines.push(milestoneData.description);
  }

  if (milestoneData.issues?.length > 0) {
    lines.push('');
    lines.push(`## Issues (${milestoneData.issues.length})`);
    lines.push('');

    for (const issue of milestoneData.issues) {
      const stateLabel = issue.state?.name || 'Unknown';
      const assigneeLabel = issue.assignee?.displayName || 'Unassigned';
      const priorityLabel = issue.priority !== undefined && issue.priority !== null
        ? ['None', 'Urgent', 'High', 'Medium', 'Low'][issue.priority] || `P${issue.priority}`
        : null;

      const meta = [`[${stateLabel}]`, `@${assigneeLabel}`];
      if (priorityLabel) meta.push(priorityLabel);
      if (issue.estimate !== undefined && issue.estimate !== null) meta.push(`${issue.estimate}pt`);

      lines.push(`- **${issue.identifier}**: ${issue.title} _${meta.join(' ')}_`);
    }
  } else {
    lines.push('');
    lines.push('_No issues associated with this milestone._');
  }

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    details: {
      milestoneId: milestoneData.id,
      name: milestoneData.name,
      status: milestoneData.status,
      progress: milestoneData.progress,
      project: milestoneData.project,
      issueCount: milestoneData.issues?.length || 0,
    },
  };
}

async function executeMilestoneCreate(client, params) {
  const name = ensureNonEmpty(params.name, 'name');

  let projectRef = params.project;
  if (!projectRef) {
    projectRef = process.cwd().split('/').pop();
  }

  const resolved = await resolveProjectRef(client, projectRef);

  const createInput = {
    projectId: resolved.id,
    name,
  };

  if (params.description) {
    createInput.description = params.description;
  }

  if (params.targetDate) {
    createInput.targetDate = params.targetDate;
  }

  if (params.status) {
    createInput.status = params.status;
  }

  const milestone = await createProjectMilestone(client, createInput);

  const statusEmoji = {
    backlogged: '📋',
    planned: '📅',
    inProgress: '🚀',
    paused: '⏸️',
    completed: '✅',
    done: '✅',
    cancelled: '❌',
  }[milestone.status] || '📌';

  return toTextResult(
    `Created milestone ${statusEmoji} **${milestone.name}** _[${milestone.status}]_ in project "${resolved.name}"`,
    {
      milestoneId: milestone.id,
      name: milestone.name,
      status: milestone.status,
      project: milestone.project,
    }
  );
}

async function executeMilestoneUpdate(client, params) {
  const milestoneId = ensureNonEmpty(params.milestone, 'milestone');

  const result = await updateProjectMilestone(client, milestoneId, {
    name: params.name,
    description: params.description,
    targetDate: params.targetDate,
    status: params.status,
  });

  const friendlyChanges = result.changed;
  const suffix = friendlyChanges.length > 0
    ? ` (${friendlyChanges.join(', ')})`
    : '';

  const statusEmoji = {
    backlogged: '📋',
    planned: '📅',
    inProgress: '🚀',
    paused: '⏸️',
    completed: '✅',
    done: '✅',
    cancelled: '❌',
  }[result.milestone.status] || '📌';

  return toTextResult(
    `Updated milestone ${statusEmoji} **${result.milestone.name}**${suffix}`,
    {
      milestoneId: result.milestone.id,
      name: result.milestone.name,
      status: result.milestone.status,
      changed: friendlyChanges,
    }
  );
}

async function executeMilestoneDelete(client, params) {
  const milestoneId = ensureNonEmpty(params.milestone, 'milestone');
  const result = await deleteProjectMilestone(client, milestoneId);

  return toTextResult(
    `Deleted milestone \`${milestoneId}\``,
    {
      milestoneId: result.milestoneId,
      success: result.success,
    }
  );
}

export default function piLinearToolsExtension(pi) {
  registerLinearTools(pi);

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
        settings.linearApiKey = apiKey;
        await saveSettings(settings);
        cachedApiKey = null;
        if (ctx?.hasUI) {
          ctx.ui.notify('LINEAR_API_KEY saved to settings', 'info');
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
          const resolvedKey = await getLinearApiKey();
          const client = createLinearClient(resolvedKey);
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

      const settings = await loadSettings();
      const hasKey = !!(settings.linearApiKey || process.env.LINEAR_API_KEY);
      const keySource = process.env.LINEAR_API_KEY ? 'environment' : (settings.linearApiKey ? 'settings' : 'not set');

      pi.sendMessage({
        customType: 'pi-linear-tools',
        content: `Configuration:\n  LINEAR_API_KEY: ${hasKey ? 'configured' : 'not set'} (source: ${keySource})\n  Default team: ${settings.defaultTeam || 'not set'}\n  Project team mappings: ${Object.keys(settings.projects || {}).length}\n\nCommands:\n  /linear-tools-config --api-key lin_xxx\n  /linear-tools-config --default-team ENG\n  /linear-tools-config --team ENG --project MyProject\n\nNote: environment LINEAR_API_KEY takes precedence over settings file.`,
        display: true,
      });
    },
  });

  pi.registerCommand('linear-tools-help', {
    description: 'Show pi-linear-tools commands and tools',
    handler: async (_args, ctx) => {
      if (ctx?.hasUI) {
        ctx.ui.notify('pi-linear-tools extension commands available', 'info');
      }

      pi.sendMessage({
        customType: 'pi-linear-tools',
        content: [
          'Commands:',
          '  /linear-tools-config --api-key <key>',
          '  /linear-tools-config --default-team <team-key>',
          '  /linear-tools-config --team <team-key> --project <project-name-or-id>',
          '  /linear-tools-help',
          '',
          'LLM-callable tools:',
          '  linear_issue (list/view/create/update/comment/start/delete)',
          '  linear_project (list)',
          '  linear_milestone (list/view/create/update/delete)',
        ].join('\n'),
        display: true,
      });
    },
  });
}
