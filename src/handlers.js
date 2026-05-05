/**
 * Shared handlers for Linear tools
 *
 * These handlers are used by both the pi extension and CLI.
 * All handlers are pure functions that accept a LinearClient and parameters.
 */

import path from 'path';
import { mkdir, open, unlink } from 'node:fs/promises';
import {
  prepareIssueStart,
  setIssueState,
  addIssueComment,
  updateIssue,
  createIssue,
  fetchProjects,
  fetchProjectDetails,
  fetchTeams,
  resolveProjectRef,
  resolveTeamRef,
  resolveMilestoneRef,
  getTeamWorkflowStates,
  fetchIssueDetails,
  fetchIssueImages,
  fetchIssueActivity,
  formatIssueAsMarkdown,
  formatIssueActivityAsMarkdown,
  fetchIssues,
  fetchIssuesByProject,
  fetchProjectMilestones,
  fetchMilestoneDetails,
  createProjectMilestone,
  updateProjectMilestone,
  deleteProjectMilestone,
  createProject,
  updateProject,
  deleteProject,
  archiveProject,
  unarchiveProject,
  fetchProjectUpdates,
  fetchProjectUpdateDetails,
  createProjectUpdate,
  updateProjectUpdate,
  archiveProjectUpdate,
  unarchiveProjectUpdate,
  deleteIssue,
  withHandlerErrorHandling,
  getViewer,
} from './linear.js';
import { debug } from './logger.js';

function toTextResult(text, details = {}) {
  return {
    content: [{ type: 'text', text }],
    details,
  };
}

const COMMENT_PREVIEW_LIMIT = 500;

function formatCommentPreview(body, limit = COMMENT_PREVIEW_LIMIT) {
  const text = String(body || '').trim();
  if (text.length <= limit) {
    return { text, truncated: false };
  }

  return {
    text: `${text.slice(0, limit).trimEnd()}...`,
    truncated: true,
  };
}

function ensureNonEmpty(value, fieldName) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`Missing required field: ${fieldName}`);
  return text;
}

function parseRefList(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const DEFAULT_MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function resolveSafeRelativeDirectory(directory, cwd = process.cwd()) {
  const requested = ensureNonEmpty(directory, 'directory');
  if (path.isAbsolute(requested)) {
    throw new Error('Download directory must be a relative path');
  }

  const resolvedCwd = path.resolve(cwd);
  const resolvedDirectory = path.resolve(resolvedCwd, requested);
  const relative = path.relative(resolvedCwd, resolvedDirectory);

  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Download directory must stay within the current working directory');
  }

  return resolvedDirectory;
}

function sanitizeDownloadFilename(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  const basename = path.basename(text) || text;
  const sanitized = basename
    .replace(/[\\/\u0000-\u001f\u007f<>:"|?*]+/g, '_')
    .replace(/^\.+$/, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 180);

  return sanitized || '';
}

function filenameFromAttachment(attachment, explicitFilename) {
  const explicit = sanitizeDownloadFilename(explicitFilename);
  if (explicit) return explicit;

  const fromTitle = sanitizeDownloadFilename(attachment?.title);
  if (fromTitle) return fromTitle;

  try {
    const url = new URL(attachment?.url || '');
    const fromUrl = sanitizeDownloadFilename(url.pathname);
    if (fromUrl) return fromUrl;
  } catch {
    // fall through to attachment id
  }

  const fromId = sanitizeDownloadFilename(attachment?.id);
  if (fromId) return fromId;

  throw new Error('Unable to derive a safe filename for attachment; provide filename explicitly');
}

function resolveSafeDestinationPath(directory, filename, cwd = process.cwd()) {
  const resolvedDirectory = resolveSafeRelativeDirectory(directory, cwd);
  const safeFilename = filenameFromAttachment({}, filename);
  const destination = path.resolve(resolvedDirectory, safeFilename);
  const relative = path.relative(resolvedDirectory, destination);

  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Download filename must not escape the destination directory');
  }

  return { directory: resolvedDirectory, filename: safeFilename, filePath: destination };
}

function selectIssueAttachment(attachments, params) {
  const list = Array.isArray(attachments) ? attachments : [];
  if (list.length === 0) {
    throw new Error('Issue has no Linear attachments to download');
  }

  const selectors = [
    ['attachmentId', params.attachmentId],
    ['attachmentTitle', params.attachmentTitle],
    ['attachmentUrl', params.attachmentUrl],
    ['attachmentIndex', params.attachmentIndex],
  ].filter(([, value]) => hasValue(value));

  if (selectors.length > 1) {
    throw new Error('Provide only one attachment selector: attachmentId, attachmentTitle, attachmentUrl, or attachmentIndex');
  }

  if (selectors.length === 0) {
    if (list.length === 1) return list[0];
    throw new Error('Multiple attachments found; provide attachmentId, attachmentTitle, attachmentUrl, or attachmentIndex');
  }

  const [selector, rawValue] = selectors[0];
  const value = String(rawValue).trim();
  let matches = [];

  if (selector === 'attachmentId') {
    matches = list.filter((attachment) => attachment.id === value);
  } else if (selector === 'attachmentTitle') {
    const normalized = value.toLowerCase();
    matches = list.filter((attachment) => String(attachment.title || '').toLowerCase() === normalized);
  } else if (selector === 'attachmentUrl') {
    matches = list.filter((attachment) => attachment.url === value);
  } else if (selector === 'attachmentIndex') {
    const index = Number.parseInt(value, 10);
    if (!Number.isInteger(index) || index < 1 || index > list.length) {
      throw new Error(`attachmentIndex must be between 1 and ${list.length}`);
    }
    return list[index - 1];
  }

  if (matches.length === 0) {
    throw new Error(`No attachment matched ${selector}: ${value}`);
  }
  if (matches.length > 1) {
    throw new Error(`Multiple attachments matched ${selector}: ${value}; use attachmentId instead`);
  }
  return matches[0];
}

function normalizeMaxBytes(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_MAX_DOWNLOAD_BYTES;
  const maxBytes = Number(value);
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('maxBytes must be a positive integer');
  }
  if (maxBytes > DEFAULT_MAX_DOWNLOAD_BYTES) {
    throw new Error(`maxBytes cannot exceed ${DEFAULT_MAX_DOWNLOAD_BYTES} bytes`);
  }
  return maxBytes;
}

function normalizeImageMaxBytes(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_MAX_IMAGE_BYTES;
  const maxBytes = Number(value);
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('maxBytes must be a positive integer');
  }
  if (maxBytes > DEFAULT_MAX_IMAGE_BYTES) {
    throw new Error(`maxBytes cannot exceed ${DEFAULT_MAX_IMAGE_BYTES} bytes for images`);
  }
  return maxBytes;
}

async function writeResponseBodyToFile(response, filePath, options) {
  const { overwrite, maxBytes } = options;
  const flags = overwrite ? 'w' : 'wx';
  let fileHandle;
  let bytesWritten = 0;

  try {
    fileHandle = await open(filePath, flags);
  } catch (err) {
    if (err?.code === 'EEXIST') {
      throw new Error(`Destination file already exists: ${filePath}`);
    }
    throw err;
  }

  try {
    if (!response.body) {
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > maxBytes) {
        throw new Error(`Download exceeds maxBytes (${maxBytes} bytes)`);
      }
      await fileHandle.writeFile(buffer);
      bytesWritten = buffer.length;
      return bytesWritten;
    }

    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const buffer = Buffer.from(value);
      bytesWritten += buffer.length;
      if (bytesWritten > maxBytes) {
        throw new Error(`Download exceeds maxBytes (${maxBytes} bytes)`);
      }
      await fileHandle.write(buffer);
    }
    return bytesWritten;
  } catch (err) {
    await fileHandle.close().catch(() => {});
    await unlink(filePath).catch(() => {});
    throw err;
  } finally {
    await fileHandle?.close?.().catch(() => {});
  }
}

export const issueDownloadInternals = {
  DEFAULT_MAX_DOWNLOAD_BYTES,
  resolveSafeRelativeDirectory,
  sanitizeDownloadFilename,
  filenameFromAttachment,
  resolveSafeDestinationPath,
  selectIssueAttachment,
  normalizeMaxBytes,
};

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
  try {
    const result = await runGitCommand(['rev-parse', '--verify', branchName]);
    return result.code === 0;
  } catch {
    return false;
  }
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
 * @param {LinearClient} client - Linear SDK client
 * @param {Object} params - Parameters
 * @param {string} [params.project] - Project name or ID
 * @param {string[]} [params.states] - State names to filter by
 * @param {string} [params.assignee] - "me" or "all" for assignee filtering
 * @param {string} [params.team] - Team key or ID to filter by
 * @param {number} [params.limit] - Maximum results (default: 20)
 * @returns {Promise<{content: Array, details: Object}>}
 */
export async function executeIssueList(client, params) {
  return withHandlerErrorHandling(async () => {
    let projectRef = params.project;
    let projectMode = false;

    if (projectRef) {
      // Explicit project specified - use project-scoped listing
      projectMode = true;
    } else {
      // No explicit project - try cwd fallback
      const cwdProject = path.basename(process.cwd());
      try {
        const resolved = await resolveProjectRef(client, cwdProject);
        projectRef = resolved.name; // use resolved name for display
        projectMode = true;
      } catch {
        // cwd doesn't match any project - fall back to workspace-level listing
        projectMode = false;
      }
    }

    let assigneeId = null;
    if (params.assignee === 'me') {
      const viewer = await getViewer(client);
      assigneeId = viewer.id;
    }

    // Resolve team if provided
    let teamId = null;
    if (params.team) {
      const team = await resolveTeamRef(client, params.team);
      teamId = team.id;
    }

    const limit = params.limit || 20;

    let issues;
    let truncated;
    let projectId = null;
    let projectName = null;

    if (projectMode) {
      // Project-scoped listing
      const resolved = await resolveProjectRef(client, projectRef);
      projectId = resolved.id;
      projectName = resolved.name;

      const result = await fetchIssuesByProject(client, resolved.id, params.states || null, {
        assigneeId,
        teamId,
        limit,
      });
      issues = result.issues;
      truncated = result.truncated;
    } else {
      // Workspace-level listing (no project filter)
      // Default to open states if none specified
      const workspaceStates = params.states || ['Backlog', 'Triage', 'In Progress', 'In Review'];
      const result = await fetchIssues(client, assigneeId, workspaceStates, limit);
      issues = result.issues;
      truncated = result.truncated;
    }

    if (issues.length === 0) {
      return toTextResult(
        projectMode
          ? `No issues found in project "${projectName}"`
          : 'No issues found in workspace',
        {
          projectId,
          projectName,
          issueCount: 0,
        }
      );
    }

    const scopeLabel = projectMode ? `project "${projectName}"` : 'workspace';
    const lines = [`## Issues in ${scopeLabel} (${issues.length}${truncated ? '+' : ''})\n`];

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
      projectId,
      projectName,
      issueCount: issues.length,
      truncated,
    });
  }, 'executeIssueList');
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

export async function executeIssueImages(client, params) {
  const issue = ensureNonEmpty(params.issue, 'issue');
  const includeComments = params.includeComments !== false;
  const maxBytes = normalizeImageMaxBytes(params.maxBytes);
  const imageData = await fetchIssueImages(client, issue, {
    includeComments,
    limit: params.limit || 10,
    maxBytes,
  });

  const lines = [
    `# Images for ${imageData.issue.identifier}: ${imageData.issue.title}`,
    '',
  ];

  if (imageData.images.length === 0) {
    lines.push('No fetchable markdown images found.');
  } else {
    lines.push(`Fetched ${imageData.images.length} image${imageData.images.length === 1 ? '' : 's'}.`);
    lines.push('');
    imageData.images.forEach((image, index) => {
      lines.push(`- **Image ${index + 1}**${image.alt ? ` (${image.alt})` : ''}: ${image.url}`);
      lines.push(`  _${image.mimeType}, ${image.sizeBytes} bytes, source: ${image.source}_`);
    });
  }

  if (imageData.failures.length > 0) {
    lines.push('');
    lines.push('## Failed image fetches');
    lines.push('');
    for (const failure of imageData.failures) {
      lines.push(`- ${failure.url} — ${failure.error}`);
    }
  }

  return {
    content: [
      { type: 'text', text: lines.join('\n') },
      ...imageData.images.map((image) => ({
        type: 'image',
        data: image.data,
        mimeType: image.mimeType,
      })),
    ],
    details: {
      issue: imageData.issue,
      imageCount: imageData.images.length,
      failureCount: imageData.failures.length,
      totalCandidates: imageData.totalCandidates,
      images: imageData.images.map(({ data, ...image }) => image),
      failures: imageData.failures,
    },
  };
}

export async function executeIssueDownload(client, params, options = {}) {
  const issue = ensureNonEmpty(params.issue, 'issue');
  const directory = ensureNonEmpty(params.directory, 'directory');
  const overwrite = params.overwrite === true;
  const settings = options.settings || {};

  if (overwrite && settings.allow_overwrite_files !== true) {
    throw new Error('overwrite=true requires allow_overwrite_files=true. Enable it with /linear-tools-config --allow-overwrite-files true.');
  }

  const maxBytes = normalizeMaxBytes(params.maxBytes);
  const issueData = await fetchIssueDetails(client, issue, { includeComments: false });
  const attachment = selectIssueAttachment(issueData.attachments, params);
  const filename = filenameFromAttachment(attachment, params.filename);
  const destination = resolveSafeDestinationPath(directory, filename, options.cwd || process.cwd());
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch API is not available in this Node.js runtime');
  }

  await mkdir(destination.directory, { recursive: true });

  const response = await fetchImpl(attachment.url, { redirect: 'follow' });
  if (!response?.ok) {
    const status = response?.status ? `HTTP ${response.status}` : 'request failed';
    throw new Error(`Failed to download attachment "${attachment.title}": ${status}`);
  }

  const contentLengthHeader = response.headers?.get?.('content-length');
  if (contentLengthHeader) {
    const contentLength = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error(`Download exceeds maxBytes (${maxBytes} bytes)`);
    }
  }

  const bytesWritten = await writeResponseBodyToFile(response, destination.filePath, { overwrite, maxBytes });
  const relativePath = path.relative(options.cwd || process.cwd(), destination.filePath) || destination.filename;

  return {
    content: [{
      type: 'text',
      text: [
        `Downloaded **${attachment.title}** to \`${relativePath}\``,
        '',
        `- bytes: ${bytesWritten}`,
        `- source: ${attachment.url}`,
      ].join('\n'),
    }],
    details: {
      issueId: issueData.id,
      identifier: issueData.identifier,
      attachmentId: attachment.id,
      attachmentTitle: attachment.title,
      sourceUrl: attachment.url,
      filePath: destination.filePath,
      relativePath,
      bytesWritten,
      overwritten: overwrite,
      maxBytes,
    },
  };
}

export async function executeIssueActivity(client, params) {
  const issue = ensureNonEmpty(params.issue, 'issue');
  const activityData = await fetchIssueActivity(client, issue, {
    limit: params.limit || 25,
    includeArchived: params.includeArchived === true,
  });
  const markdown = formatIssueActivityAsMarkdown(activityData, {
    limit: params.limit,
  });

  return {
    content: [{ type: 'text', text: markdown }],
    details: {
      issueId: activityData.issue.id,
      identifier: activityData.issue.identifier,
      title: activityData.issue.title,
      activityCount: activityData.activity.length,
      url: activityData.issue.url,
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
    projectRef = path.basename(process.cwd());
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

  if (params.estimate !== undefined && params.estimate !== null) {
    createInput.estimate = params.estimate;
  }

  if (params.parentId) {
    createInput.parentId = params.parentId;
  }

  if (params.assignee === 'me') {
    const viewer = await getViewer(client);
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
    estimate: params.estimate,
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
    const viewer = await getViewer(client);
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

  const rateLimitNote = result.usedRateLimitFallback
    ? '\n\n_Note: update succeeded, but detailed issue refresh was rate-limited. Some returned fields may be partial until rate limit resets._'
    : '';

  return toTextResult(
    `Updated issue ${result.issue.identifier}${suffix}${rateLimitNote}`,
    {
      issueId: result.issue.id,
      identifier: result.issue.identifier,
      changed: friendlyChanges,
      state: result.issue.state,
      priority: result.issue.priority,
      projectMilestone: result.issue.projectMilestone,
      usedRateLimitFallback: !!result.usedRateLimitFallback,
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
  const commentBody = String(result.comment?.body || body).trim();
  const preview = formatCommentPreview(commentBody);

  return toTextResult(
    `Added comment to issue ${result.issue.identifier}\n\n${preview.text}`,
    {
      issueId: result.issue.id,
      identifier: result.issue.identifier,
      commentId: result.comment.id,
      commentBody,
      commentPreview: preview.text,
      commentPreviewTruncated: preview.truncated,
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

  // Always use Linear's suggested branchName - it cannot be changed via API
  // and using a custom branch would break Linear's branch-to-issue linking
  const branchName = prepared.branchName;
  if (!branchName) {
    throw new Error(
      `No branch name available for issue ${prepared.issue.identifier}. The issue may not have a team assigned.`
    );
  }

  let gitResult;
  if (gitExecutor) {
    // Use provided git executor (e.g., pi.exec)
    gitResult = await gitExecutor(branchName, params.fromRef || 'HEAD', params.onBranchExists || 'switch');
  } else {
    // Use built-in child_process git operations
    gitResult = await startGitBranch(branchName, params.fromRef || 'HEAD', params.onBranchExists || 'switch');
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

export async function executeProjectView(client, params) {
  return withHandlerErrorHandling(async () => {
    const projectRef = ensureNonEmpty(params.project, 'project');
    const project = await fetchProjectDetails(client, projectRef);

    const lines = [`# Project: ${project.name}`];
    const metaParts = [];

    if (project.status?.name) metaParts.push(`**Status:** ${project.status.name}`);
    if (project.health) metaParts.push(`**Health:** ${project.health}`);
    if (project.progress !== undefined && project.progress !== null) metaParts.push(`**Progress:** ${project.progress}%`);
    if (project.priority !== undefined && project.priority !== null) metaParts.push(`**Priority:** ${project.priority}`);
    if (project.startDate) metaParts.push(`**Start:** ${project.startDate}`);
    if (project.targetDate) metaParts.push(`**Target:** ${project.targetDate}`);

    if (metaParts.length > 0) {
      lines.push('');
      lines.push(metaParts.join(' | '));
    }

    const teamLabel = project.teams.length > 0
      ? project.teams.map((team) => `\`${team.key}\``).join(', ')
      : 'None';
    const leadLabel = project.lead?.displayName || project.lead?.name || 'Unassigned';

    lines.push('');
    lines.push(`**Teams:** ${teamLabel}`);
    lines.push(`**Lead:** ${leadLabel}`);

    if (project.url) {
      lines.push(`**URL:** ${project.url}`);
    }

    if (project.description) {
      lines.push('');
      lines.push(project.description);
    }

    if (project.content) {
      lines.push('');
      if (project.description) {
        lines.push('## Content');
        lines.push('');
      }
      lines.push(project.content);
    }

    if (project.projectMilestones.length > 0) {
      lines.push('');
      lines.push(`## Milestones (${project.projectMilestones.length})`);
      lines.push('');

      for (const milestone of project.projectMilestones) {
        const progressLabel = milestone.progress !== undefined && milestone.progress !== null
          ? `${milestone.progress}%`
          : 'N/A';
        const targetLabel = milestone.targetDate ? ` → ${milestone.targetDate}` : '';
        lines.push(`- **${milestone.name}** _[${milestone.status}]_ (${progressLabel})${targetLabel}`);
      }
    }

    return toTextResult(lines.join('\n'), {
      projectId: project.id,
      name: project.name,
      status: project.status,
      teamCount: project.teams.length,
      milestoneCount: project.projectMilestones.length,
      url: project.url,
    });
  }, 'executeProjectView');
}

export async function executeProjectCreate(client, params) {
  return withHandlerErrorHandling(async () => {
    const name = ensureNonEmpty(params.name, 'name');
    const teamRefs = parseRefList(params.teams ?? params.team);

    if (teamRefs.length === 0) {
      throw new Error('Missing required field: teams');
    }

    const teams = await Promise.all(teamRefs.map((teamRef) => resolveTeamRef(client, teamRef)));

    let leadId;
    if (params.lead === 'me') {
      const viewer = await getViewer(client);
      leadId = viewer.id;
    } else if (params.lead) {
      leadId = params.lead;
    }

    const project = await createProject(client, {
      name,
      teamIds: teams.map((team) => team.id),
      description: params.description,
      leadId,
      priority: params.priority,
      color: params.color,
      icon: params.icon,
      startDate: params.startDate,
      targetDate: params.targetDate,
    });

    return toTextResult(
      `Created project **${project.name}** for ${teams.map((team) => team.key).join(', ')}`,
      {
        projectId: project.id,
        name: project.name,
        teams: project.teams,
        status: project.status,
        url: project.url,
      }
    );
  }, 'executeProjectCreate');
}

export async function executeProjectUpdate(client, params) {
  return withHandlerErrorHandling(async () => {
    const projectRef = ensureNonEmpty(params.project, 'project');
    const patch = {
      name: params.name,
      description: params.description,
      priority: params.priority,
      color: params.color,
      icon: params.icon,
      startDate: params.startDate,
      targetDate: params.targetDate,
    };

    if (params.lead === 'me') {
      const viewer = await getViewer(client);
      patch.leadId = viewer.id;
    } else if (params.lead === 'none') {
      patch.leadId = null;
    } else if (params.lead !== undefined) {
      patch.leadId = params.lead;
    }

    if (params.teams !== undefined || params.team !== undefined) {
      const teamRefs = parseRefList(params.teams ?? params.team);
      if (teamRefs.length === 0) {
        throw new Error('At least one team is required when updating teams');
      }
      const teams = await Promise.all(teamRefs.map((teamRef) => resolveTeamRef(client, teamRef)));
      patch.teamIds = teams.map((team) => team.id);
    }

    const result = await updateProject(client, projectRef, patch);

    return toTextResult(
      `Updated project **${result.project.name}** (${result.changed.join(', ')})`,
      {
        projectId: result.project.id,
        name: result.project.name,
        changed: result.changed,
        status: result.project.status,
      }
    );
  }, 'executeProjectUpdate');
}

export async function executeProjectDelete(client, params) {
  return withHandlerErrorHandling(async () => {
    const projectRef = ensureNonEmpty(params.project, 'project');
    const result = await deleteProject(client, projectRef);

    return toTextResult(
      `Deleted project **${result.name}** \`${result.projectId}\``,
      {
        projectId: result.projectId,
        name: result.name,
        success: result.success,
      }
    );
  }, 'executeProjectDelete');
}

export async function executeProjectArchive(client, params) {
  return withHandlerErrorHandling(async () => {
    const projectRef = ensureNonEmpty(params.project, 'project');
    const result = await archiveProject(client, projectRef);

    return toTextResult(
      `Archived project **${result.name || result.entity?.name || result.projectId}**`,
      {
        projectId: result.projectId,
        name: result.name || result.entity?.name || null,
        success: result.success,
      }
    );
  }, 'executeProjectArchive');
}

export async function executeProjectUnarchive(client, params) {
  return withHandlerErrorHandling(async () => {
    const projectRef = ensureNonEmpty(params.project, 'project');
    const result = await unarchiveProject(client, projectRef);

    return toTextResult(
      `Unarchived project **${result.project.name}**`,
      {
        projectId: result.project.id,
        name: result.project.name,
        success: result.success,
      }
    );
  }, 'executeProjectUnarchive');
}

// ===== PROJECT UPDATE HANDLERS =====

export async function executeProjectUpdateList(client, params) {
  return withHandlerErrorHandling(async () => {
    const projectRef = ensureNonEmpty(params.project, 'project');
    const { project, updates } = await fetchProjectUpdates(client, projectRef, {
      limit: params.limit ?? 10,
      includeArchived: params.includeArchived === true,
    });

    if (updates.length === 0) {
      return toTextResult(`No project updates found for "${project.name}"`, {
        projectId: project.id,
        projectName: project.name,
        updateCount: 0,
      });
    }

    const lines = [`## Project updates for "${project.name}" (${updates.length})`, ''];
    for (const update of updates) {
      const author = update.user?.displayName || update.user?.name || 'Unknown';
      const createdAt = update.createdAt ? String(update.createdAt).slice(0, 10) : 'unknown date';
      const healthLabel = update.health ? ` [${update.health}]` : '';
      const archivedLabel = update.archivedAt ? ' [archived]' : '';
      const preview = update.body.replace(/\s+/g, ' ').trim().slice(0, 120);
      lines.push(`- **${update.id}**${healthLabel}${archivedLabel} by ${author} on ${createdAt}`);
      if (preview) {
        lines.push(`  ${preview}${update.body.length > 120 ? '...' : ''}`);
      }
    }

    return toTextResult(lines.join('\n'), {
      projectId: project.id,
      projectName: project.name,
      updateCount: updates.length,
    });
  }, 'executeProjectUpdateList');
}

export async function executeProjectUpdateView(client, params) {
  return withHandlerErrorHandling(async () => {
    const projectUpdateId = ensureNonEmpty(params.projectUpdate, 'projectUpdate');
    const projectUpdate = await fetchProjectUpdateDetails(client, projectUpdateId);

    const lines = [`# Project update ${projectUpdate.id}`];
    const meta = [];
    if (projectUpdate.project?.name) meta.push(`**Project:** ${projectUpdate.project.name}`);
    if (projectUpdate.health) meta.push(`**Health:** ${projectUpdate.health}`);
    if (projectUpdate.user?.displayName || projectUpdate.user?.name) meta.push(`**Author:** ${projectUpdate.user?.displayName || projectUpdate.user?.name}`);
    if (projectUpdate.createdAt) meta.push(`**Created:** ${String(projectUpdate.createdAt).slice(0, 10)}`);
    if (projectUpdate.archivedAt) meta.push(`**Archived:** ${String(projectUpdate.archivedAt).slice(0, 10)}`);
    if (meta.length > 0) {
      lines.push('');
      lines.push(meta.join(' | '));
    }
    if (projectUpdate.url) {
      lines.push('');
      lines.push(`**URL:** ${projectUpdate.url}`);
    }
    if (projectUpdate.body) {
      lines.push('');
      lines.push(projectUpdate.body);
    }

    return toTextResult(lines.join('\n'), {
      projectUpdateId: projectUpdate.id,
      projectId: projectUpdate.project?.id || null,
      projectName: projectUpdate.project?.name || null,
      health: projectUpdate.health,
      archivedAt: projectUpdate.archivedAt,
    });
  }, 'executeProjectUpdateView');
}

export async function executeProjectUpdateCreate(client, params) {
  return withHandlerErrorHandling(async () => {
    const projectRef = ensureNonEmpty(params.project, 'project');
    const resolved = await resolveProjectRef(client, projectRef);
    const projectUpdate = await createProjectUpdate(client, {
      projectId: resolved.id,
      body: params.body,
      health: params.health,
      isDiffHidden: params.isDiffHidden,
    });

    return toTextResult(
      `Created project update **${projectUpdate.id}** for "${resolved.name}"`,
      {
        projectUpdateId: projectUpdate.id,
        projectId: resolved.id,
        projectName: resolved.name,
        health: projectUpdate.health,
      }
    );
  }, 'executeProjectUpdateCreate');
}

export async function executeProjectUpdateUpdate(client, params) {
  return withHandlerErrorHandling(async () => {
    const projectUpdateId = ensureNonEmpty(params.projectUpdate, 'projectUpdate');
    const result = await updateProjectUpdate(client, projectUpdateId, {
      body: params.body,
      health: params.health,
      isDiffHidden: params.isDiffHidden,
    });

    return toTextResult(
      `Updated project update **${result.projectUpdate.id}** (${result.changed.join(', ')})`,
      {
        projectUpdateId: result.projectUpdate.id,
        changed: result.changed,
        health: result.projectUpdate.health,
      }
    );
  }, 'executeProjectUpdateUpdate');
}

export async function executeProjectUpdateArchive(client, params) {
  return withHandlerErrorHandling(async () => {
    const projectUpdateId = ensureNonEmpty(params.projectUpdate, 'projectUpdate');
    const result = await archiveProjectUpdate(client, projectUpdateId);

    return toTextResult(
      `Archived project update **${projectUpdateId}**`,
      {
        projectUpdateId,
        success: result.success,
      }
    );
  }, 'executeProjectUpdateArchive');
}

export async function executeProjectUpdateUnarchive(client, params) {
  return withHandlerErrorHandling(async () => {
    const projectUpdateId = ensureNonEmpty(params.projectUpdate, 'projectUpdate');
    const result = await unarchiveProjectUpdate(client, projectUpdateId);

    return toTextResult(
      `Unarchived project update **${result.projectUpdate.id}**`,
      {
        projectUpdateId: result.projectUpdate.id,
        success: result.success,
      }
    );
  }, 'executeProjectUpdateUnarchive');
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
    projectRef = path.basename(process.cwd());
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
  let projectId = null;
  let milestoneId = params.milestone;

  // If milestone is not a Linear ID, resolve it with project context
  const ref = String(milestoneId || '').trim();
  const isId = typeof ref === 'string' && /^[0-9a-fA-F-]{16,}$/.test(ref);

  if (!isId) {
    // Need project context to resolve milestone name
    let projectRef = params.project;
    if (!projectRef) {
      projectRef = path.basename(process.cwd());
    }
    const resolvedProject = await resolveProjectRef(client, projectRef);
    projectId = resolvedProject.id;
    const resolvedMilestone = await resolveMilestoneRef(client, ref, projectId);
    milestoneId = resolvedMilestone.id;
  }

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
    projectRef = path.basename(process.cwd());
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
  let projectId = null;
  let milestoneId = params.milestone;

  // If milestone is not a Linear ID, resolve it with project context
  const ref = String(milestoneId || '').trim();
  const isId = typeof ref === 'string' && /^[0-9a-fA-F-]{16,}$/.test(ref);


  if (!isId) {
    // Need project context to resolve milestone name
    let projectRef = params.project;
    if (!projectRef) {
      projectRef = path.basename(process.cwd());
    }
    const resolvedProject = await resolveProjectRef(client, projectRef);
    projectId = resolvedProject.id;
    const resolvedMilestone = await resolveMilestoneRef(client, ref, projectId);
    milestoneId = resolvedMilestone.id;
  }

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
  let projectId = null;
  let milestoneId = params.milestone;

  // If milestone is not a Linear ID, resolve it with project context
  const ref = String(milestoneId || '').trim();
  const isId = typeof ref === 'string' && /^[0-9a-fA-F-]{16,}$/.test(ref);


  if (!isId) {
    // Need project context to resolve milestone name
    let projectRef = params.project;
    if (!projectRef) {
      projectRef = path.basename(process.cwd());
    }
    const resolvedProject = await resolveProjectRef(client, projectRef);
    projectId = resolvedProject.id;
    const resolvedMilestone = await resolveMilestoneRef(client, ref, projectId);
    milestoneId = resolvedMilestone.id;
  }

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
