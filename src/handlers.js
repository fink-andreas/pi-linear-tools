/**
 * Shared handlers for Linear tools
 *
 * These handlers are used by both the pi extension and CLI.
 * All handlers are pure functions that accept a LinearClient and parameters.
 */

import { createLinearClient } from './linear-client.js';
import {
  prepareIssueStart,
  setIssueState,
  addIssueComment,
  updateIssue,
  createIssue,
  fetchProjects,
  fetchTeams,
  fetchWorkspaces,
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
} from './linear.js';
import { debug } from './logger.js';

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

// ===== GIT OPERATIONS (for issue start) =====

/**
 * Run a git command using child_process
 * @param {string[]} args - Git arguments
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
async function runGitCommand(args) {
  const { spawn } = await import('child_process');
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (data) => { stdout += data; });
    proc.stderr.on('data', (data) => { stderr += data; });
    proc.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
    proc.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Check if a git branch exists
 * @param {string} branchName - Branch name to check
 * @returns {Promise<boolean>}
 */
async function gitBranchExists(branchName) {
  const result = await runGitCommand(['rev-parse', '--verify', branchName]);
  return result.code === 0;
}

/**
 * Start a git branch for an issue
 * @param {string} branchName - Desired branch name
 * @param {string} fromRef - Git ref to branch from
 * @param {string} onBranchExists - Action when branch exists: 'switch' or 'suffix'
 * @returns {Promise<{action: string, branchName: string}>}
 */
async function startGitBranch(branchName, fromRef = 'HEAD', onBranchExists = 'switch') {
  const exists = await gitBranchExists(branchName);

  if (!exists) {
    const result = await runGitCommand(['checkout', '-b', branchName, fromRef || 'HEAD']);
    if (result.code !== 0) {
      const stderr = result.stderr.trim();
      throw new Error(`git checkout -b failed${stderr ? `: ${stderr}` : ''}`);
    }
    return { action: 'created', branchName };
  }

  if (onBranchExists === 'suffix') {
    let suffix = 1;
    let nextName = `${branchName}-${suffix}`;

    // eslint-disable-next-line no-await-in-loop
    while (await gitBranchExists(nextName)) {
      suffix += 1;
      nextName = `${branchName}-${suffix}`;
    }

    const result = await runGitCommand(['checkout', '-b', nextName, fromRef || 'HEAD']);
    if (result.code !== 0) {
      const stderr = result.stderr.trim();
      throw new Error(`git checkout -b failed${stderr ? `: ${stderr}` : ''}`);
    }
    return { action: 'created-suffix', branchName: nextName };
  }

  const result = await runGitCommand(['checkout', branchName]);
  if (result.code !== 0) {
    const stderr = result.stderr.trim();
    throw new Error(`git checkout failed${stderr ? `: ${stderr}` : ''}`);
  }
  return { action: 'switched', branchName };
}

// ===== ISSUE HANDLERS =====

/**
 * List issues in a project
 */
export async function executeIssueList(client, params) {
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

/**
 * View issue details
 */
export async function executeIssueView(client, params) {
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

/**
 * Create a new issue
 */
export async function executeIssueCreate(client, params, options = {}) {
  const { resolveDefaultTeam } = options;

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
  if (!teamRef && resolveDefaultTeam) {
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
  } else if (params.assigneeId) {
    createInput.assigneeId = params.assigneeId;
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

/**
 * Update an issue
 */
export async function executeIssueUpdate(client, params) {
  const issue = ensureNonEmpty(params.issue, 'issue');

  debug('executeIssueUpdate: incoming params', {
    issue,
    hasTitle: params.title !== undefined,
    hasDescription: params.description !== undefined,
    priority: params.priority,
    state: params.state,
    assignee: params.assignee,
    assigneeId: params.assigneeId,
    milestone: params.milestone,
    projectMilestoneId: params.projectMilestoneId,
    subIssueOf: params.subIssueOf,
    parentOfCount: Array.isArray(params.parentOf) ? params.parentOf.length : 0,
    blockedByCount: Array.isArray(params.blockedBy) ? params.blockedBy.length : 0,
    blockingCount: Array.isArray(params.blocking) ? params.blocking.length : 0,
    relatedToCount: Array.isArray(params.relatedTo) ? params.relatedTo.length : 0,
    duplicateOf: params.duplicateOf,
  });

  const updatePatch = {
    title: params.title,
    description: params.description,
    priority: params.priority,
    state: params.state,
    milestone: params.milestone,
    projectMilestoneId: params.projectMilestoneId,
    subIssueOf: params.subIssueOf,
    parentOf: params.parentOf,
    blockedBy: params.blockedBy,
    blocking: params.blocking,
    relatedTo: params.relatedTo,
    duplicateOf: params.duplicateOf,
  };

  if (params.assignee !== undefined && params.assigneeId !== undefined) {
    debug('executeIssueUpdate: both assignee and assigneeId provided; assignee takes precedence', {
      issue,
      assignee: params.assignee,
      assigneeId: params.assigneeId,
    });
  }

  // Handle assignee parameter
  if (params.assignee === 'me') {
    const viewer = await client.viewer;
    updatePatch.assigneeId = viewer.id;
  } else if (params.assignee) {
    updatePatch.assigneeId = params.assignee;
  } else if (params.assigneeId) {
    updatePatch.assigneeId = params.assigneeId;
  }

  debug('executeIssueUpdate: constructed updatePatch', {
    issue,
    patchKeys: Object.keys(updatePatch).filter((k) => updatePatch[k] !== undefined),
    assigneeId: updatePatch.assigneeId,
    milestone: updatePatch.milestone,
    projectMilestoneId: updatePatch.projectMilestoneId,
  });

  const result = await updateIssue(client, issue, updatePatch);

  const friendlyChanges = result.changed.map((field) => {
    if (field === 'stateId') return 'state';
    if (field === 'assigneeId') return 'assignee';
    if (field === 'projectMilestoneId') return 'milestone';
    if (field === 'parentId') return 'subIssueOf';
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

  if (friendlyChanges.includes('milestone')) {
    const milestoneLabel = result.issue?.projectMilestone?.name || 'None';
    changeSummaryParts.push(`milestone: ${milestoneLabel}`);
  }

  if (friendlyChanges.includes('subIssueOf')) {
    changeSummaryParts.push('subIssueOf');
  }

  for (const field of friendlyChanges) {
    if (field !== 'state' && field !== 'assignee' && field !== 'milestone' && field !== 'subIssueOf') {
      changeSummaryParts.push(field);
    }
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
      projectMilestone: result.issue.projectMilestone,
    }
  );
}

/**
 * Add a comment to an issue
 */
export async function executeIssueComment(client, params) {
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

/**
 * Start an issue (set to In Progress and create branch)
 */
export async function executeIssueStart(client, params, options = {}) {
  const { gitExecutor } = options;

  const issue = ensureNonEmpty(params.issue, 'issue');
  const prepared = await prepareIssueStart(client, issue);

  const desiredBranch = params.branch || prepared.branchName;
  if (!desiredBranch) {
    throw new Error(
      `No branch name resolved for issue ${prepared.issue.identifier}. Provide the 'branch' parameter explicitly.`
    );
  }

  let gitResult;
  if (gitExecutor) {
    // Use provided git executor (e.g., pi.exec)
    gitResult = await gitExecutor(desiredBranch, params.fromRef || 'HEAD', params.onBranchExists || 'switch');
  } else {
    // Use built-in child_process git operations
    gitResult = await startGitBranch(desiredBranch, params.fromRef || 'HEAD', params.onBranchExists || 'switch');
  }

  const updatedIssue = await setIssueState(client, prepared.issue.id, prepared.startedState.id);

  const identifier = updatedIssue.identifier || prepared.issue.identifier;
  const compactTitle = String(updatedIssue.title || prepared.issue?.title || '').trim().toLowerCase();
  const summary = compactTitle
    ? `Started issue ${identifier} (${compactTitle})`
    : `Started issue ${identifier}`;

  return toTextResult(summary, {
    issueId: updatedIssue.id,
    identifier: updatedIssue.identifier,
    state: updatedIssue.state,
    startedState: prepared.startedState,
    git: gitResult,
  });
}

/**
 * Delete an issue
 */
export async function executeIssueDelete(client, params) {
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

// ===== PROJECT HANDLERS =====

/**
 * List projects
 */
export async function executeProjectList(client) {
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

// ===== TEAM HANDLERS =====

/**
 * List teams
 */
export async function executeTeamList(client) {
  const teams = await fetchTeams(client);

  if (teams.length === 0) {
    return toTextResult('No teams found', { teamCount: 0 });
  }

  const lines = [`## Teams (${teams.length})\n`];

  for (const team of teams) {
    lines.push(`- **${team.key}**: ${team.name} \`${team.id}\``);
  }

  return toTextResult(lines.join('\n'), {
    teamCount: teams.length,
    teams: teams.map((t) => ({ id: t.id, key: t.key, name: t.name })),
  });
}

// ===== MILESTONE HANDLERS =====

/**
 * List milestones in a project
 */
export async function executeMilestoneList(client, params) {
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

    lines.push(`- ${statusEmoji} **${milestone.name}** _[${milestone.status}]_ (${progressLabel})${dateLabel} \`${milestone.id}\``);
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

/**
 * View milestone details
 */
export async function executeMilestoneView(client, params) {
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

/**
 * Create a milestone
 */
export async function executeMilestoneCreate(client, params) {
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

/**
 * Update a milestone
 */
export async function executeMilestoneUpdate(client, params) {
  const milestoneId = ensureNonEmpty(params.milestone, 'milestone');

  // Note: status is not included as it's a computed/read-only field in Linear's API
  const result = await updateProjectMilestone(client, milestoneId, {
    name: params.name,
    description: params.description,
    targetDate: params.targetDate,
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

/**
 * Delete a milestone
 */
export async function executeMilestoneDelete(client, params) {
  const milestoneId = ensureNonEmpty(params.milestone, 'milestone');
  const result = await deleteProjectMilestone(client, milestoneId);

  const label = result.name
    ? `**${result.name}** (\`${milestoneId}\`)`
    : `\`${milestoneId}\``;

  return toTextResult(
    `Deleted milestone ${label}`,
    {
      milestoneId: result.milestoneId,
      name: result.name,
      success: result.success,
    }
  );
}
