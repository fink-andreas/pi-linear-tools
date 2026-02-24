/**
 * Linear SDK API wrapper
 *
 * Provides high-level functions for interacting with Linear API via @linear/sdk.
 * All functions receive a LinearClient instance as the first parameter.
 */

import { warn, info, debug } from './logger.js';

// ===== HELPERS =====

/**
 * Check if a value looks like a Linear UUID
 */
function isLinearId(value) {
  return typeof value === 'string' && /^[0-9a-fA-F-]{16,}$/.test(value);
}

/**
 * Normalize issue lookup input
 */
function normalizeIssueLookupInput(issue) {
  const value = String(issue || '').trim();
  if (!value) throw new Error('Missing required issue identifier');
  return value;
}

/**
 * Transform SDK issue object to plain object for consumers
 * Handles both SDK Issue objects and already-resolved plain objects
 */
async function transformIssue(sdkIssue) {
  if (!sdkIssue) return null;

  // Handle SDK issue with lazy-loaded relations
  const [state, team, project, assignee] = await Promise.all([
    sdkIssue.state?.catch?.(() => null) ?? sdkIssue.state,
    sdkIssue.team?.catch?.(() => null) ?? sdkIssue.team,
    sdkIssue.project?.catch?.(() => null) ?? sdkIssue.project,
    sdkIssue.assignee?.catch?.(() => null) ?? sdkIssue.assignee,
  ]);

  return {
    id: sdkIssue.id,
    identifier: sdkIssue.identifier,
    title: sdkIssue.title,
    description: sdkIssue.description,
    url: sdkIssue.url,
    branchName: sdkIssue.branchName,
    priority: sdkIssue.priority,
    state: state ? { id: state.id, name: state.name, type: state.type } : null,
    team: team ? { id: team.id, key: team.key, name: team.name } : null,
    project: project ? { id: project.id, name: project.name } : null,
    assignee: assignee ? { id: assignee.id, name: assignee.name, displayName: assignee.displayName } : null,
  };
}

/**
 * Resolve state ID from state input (ID, name, or type)
 */
function resolveStateIdFromInput(states, stateInput) {
  if (!stateInput) return null;
  const target = String(stateInput).trim();
  if (!target) return null;

  const byId = states.find((s) => s.id === target);
  if (byId) return byId.id;

  const lower = target.toLowerCase();
  const byName = states.find((s) => String(s.name || '').toLowerCase() === lower);
  if (byName) return byName.id;

  const byType = states.find((s) => String(s.type || '').toLowerCase() === lower);
  if (byType) return byType.id;

  throw new Error(`State not found in team workflow: ${target}`);
}

// ===== QUERY FUNCTIONS =====

/**
 * Fetch the current authenticated viewer
 * @param {LinearClient} client - Linear SDK client
 * @returns {Promise<{id: string, name: string}>}
 */
export async function fetchViewer(client) {
  const viewer = await client.viewer;
  return {
    id: viewer.id,
    name: viewer.name,
    displayName: viewer.displayName,
  };
}

/**
 * Fetch issues in specific states, optionally filtered by assignee
 * @param {LinearClient} client - Linear SDK client
 * @param {string|null} assigneeId - Assignee ID to filter by (null = all assignees)
 * @param {Array<string>} openStates - List of state names to include
 * @param {number} limit - Maximum number of issues to fetch
 * @returns {Promise<{issues: Array, truncated: boolean}>}
 */
export async function fetchIssues(client, assigneeId, openStates, limit) {
  const filter = {
    state: { name: { in: openStates } },
  };

  if (assigneeId) {
    filter.assignee = { id: { eq: assigneeId } };
  }

  const result = await client.issues({
    first: limit,
    filter,
  });

  const nodes = result.nodes || [];
  const hasNextPage = result.pageInfo?.hasNextPage ?? false;

  // Transform SDK issues to plain objects
  const issues = await Promise.all(nodes.map(transformIssue));

  // DEBUG: Log issues delivered by Linear API
  debug('Issues delivered by Linear API', {
    issueCount: issues.length,
    issues: issues.map(issue => ({
      id: issue.id,
      title: issue.title,
      state: issue.state?.name,
      assigneeId: issue.assignee?.id,
      project: issue.project?.name,
      projectId: issue.project?.id,
    })),
  });

  const truncated = hasNextPage || nodes.length >= limit;
  if (truncated) {
    warn('Linear issues query may be truncated by LINEAR_PAGE_LIMIT', {
      limit,
      returned: nodes.length,
      hasNextPage,
    });
  }

  return {
    issues,
    truncated,
  };
}

/**
 * Fetch issues by project and optional state filter
 * @param {LinearClient} client - Linear SDK client
 * @param {string} projectId - Project ID to filter by
 * @param {Array<string>|null} states - List of state names to include (null = all states)
 * @param {Object} options
 * @param {string|null} options.assigneeId - Assignee ID to filter by (null = all assignees)
 * @param {number} options.limit - Maximum number of issues to fetch
 * @returns {Promise<{issues: Array, truncated: boolean}>}
 */
export async function fetchIssuesByProject(client, projectId, states, options = {}) {
  const { assigneeId = null, limit = 50 } = options;

  const filter = {
    project: { id: { eq: projectId } },
  };

  if (states && states.length > 0) {
    filter.state = { name: { in: states } };
  }

  if (assigneeId) {
    filter.assignee = { id: { eq: assigneeId } };
  }

  const result = await client.issues({
    first: limit,
    filter,
  });

  const nodes = result.nodes || [];
  const hasNextPage = result.pageInfo?.hasNextPage ?? false;

  // Transform SDK issues to plain objects
  const issues = await Promise.all(nodes.map(transformIssue));

  debug('Fetched issues by project', {
    projectId,
    stateCount: states?.length ?? 0,
    issueCount: issues.length,
    truncated: hasNextPage,
  });

  const truncated = hasNextPage || nodes.length >= limit;
  if (truncated) {
    warn('Issues query may be truncated', {
      limit,
      returned: nodes.length,
      hasNextPage,
    });
  }

  return {
    issues,
    truncated,
  };
}

/**
 * Fetch all accessible projects from Linear API
 * @param {LinearClient} client - Linear SDK client
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function fetchProjects(client) {
  const result = await client.projects();
  const nodes = result.nodes ?? [];

  debug('Fetched Linear projects', {
    projectCount: nodes.length,
    projects: nodes.map((p) => ({ id: p.id, name: p.name })),
  });

  return nodes.map(p => ({ id: p.id, name: p.name }));
}

/**
 * Fetch all accessible teams from Linear API
 * @param {LinearClient} client - Linear SDK client
 * @returns {Promise<Array<{id: string, key: string, name: string}>>}
 */
export async function fetchTeams(client) {
  const result = await client.teams();
  const nodes = result.nodes ?? [];

  debug('Fetched Linear teams', {
    teamCount: nodes.length,
    teams: nodes.map((t) => ({ id: t.id, key: t.key, name: t.name })),
  });

  return nodes.map(t => ({ id: t.id, key: t.key, name: t.name }));
}

/**
 * Resolve a team reference (key, name, or ID) to a team object
 * @param {LinearClient} client - Linear SDK client
 * @param {string} teamRef - Team key, name, or ID
 * @returns {Promise<{id: string, key: string, name: string}>}
 */
export async function resolveTeamRef(client, teamRef) {
  const ref = String(teamRef || '').trim();
  if (!ref) {
    throw new Error('Missing team reference');
  }

  const teams = await fetchTeams(client);

  // If it looks like a Linear ID (UUID), try direct lookup first
  if (isLinearId(ref)) {
    const byId = teams.find((t) => t.id === ref);
    if (byId) {
      return byId;
    }
    throw new Error(`Team not found with ID: ${ref}`);
  }

  // Try exact key match (e.g., "ENG")
  const byKey = teams.find((t) => t.key === ref);
  if (byKey) {
    return byKey;
  }

  // Try exact name match
  const exactName = teams.find((t) => t.name === ref);
  if (exactName) {
    return exactName;
  }

  // Try case-insensitive key or name match
  const lowerRef = ref.toLowerCase();
  const insensitiveMatch = teams.find(
    (t) => t.key?.toLowerCase() === lowerRef || t.name?.toLowerCase() === lowerRef
  );
  if (insensitiveMatch) {
    return insensitiveMatch;
  }

  throw new Error(`Team not found: ${ref}. Available teams: ${teams.map((t) => `${t.key} (${t.name})`).join(', ')}`);
}

/**
 * Resolve an issue by ID or identifier
 * @param {LinearClient} client - Linear SDK client
 * @param {string} issueRef - Issue identifier (ABC-123) or Linear issue ID
 * @returns {Promise<Object>} Resolved issue object
 */
export async function resolveIssue(client, issueRef) {
  const lookup = normalizeIssueLookupInput(issueRef);

  // The SDK's client.issue() method accepts both UUIDs and identifiers (ABC-123)
  try {
    const issue = await client.issue(lookup);
    if (issue) {
      return transformIssue(issue);
    }
  } catch (err) {
    // Fall through to error
  }

  throw new Error(`Issue not found: ${lookup}`);
}

/**
 * Get workflow states for a team
 * @param {LinearClient} client - Linear SDK client
 * @param {string} teamRef - Team ID or key
 * @returns {Promise<Array<{id: string, name: string, type: string}>>}
 */
export async function getTeamWorkflowStates(client, teamRef) {
  const team = await client.team(teamRef);
  if (!team) {
    throw new Error(`Team not found: ${teamRef}`);
  }

  const states = await team.states();
  return (states.nodes || []).map(s => ({
    id: s.id,
    name: s.name,
    type: s.type,
  }));
}

/**
 * Resolve a project reference (name or ID) to a project object
 * @param {LinearClient} client - Linear SDK client
 * @param {string} projectRef - Project name or ID
 * @returns {Promise<{id: string, name: string}>}
 */
export async function resolveProjectRef(client, projectRef) {
  const ref = String(projectRef || '').trim();
  if (!ref) {
    throw new Error('Missing project reference');
  }

  const projects = await fetchProjects(client);

  // If it looks like a Linear ID (UUID), try direct lookup first
  if (isLinearId(ref)) {
    const byId = projects.find((p) => p.id === ref);
    if (byId) {
      return byId;
    }
    throw new Error(`Project not found with ID: ${ref}`);
  }

  // Try exact name match
  const exactName = projects.find((p) => p.name === ref);
  if (exactName) {
    return exactName;
  }

  // Try case-insensitive name match
  const lowerRef = ref.toLowerCase();
  const insensitiveName = projects.find((p) => p.name?.toLowerCase() === lowerRef);
  if (insensitiveName) {
    return insensitiveName;
  }

  throw new Error(`Project not found: ${ref}. Available projects: ${projects.map((p) => p.name).join(', ')}`);
}

/**
 * Fetch detailed issue information including comments, parent, children, and attachments
 * @param {LinearClient} client - Linear SDK client
 * @param {string} issueRef - Issue identifier (ABC-123) or Linear issue ID
 * @param {Object} options
 * @param {boolean} [options.includeComments=true] - Include comments in response
 * @returns {Promise<Object>} Issue details
 */
export async function fetchIssueDetails(client, issueRef, options = {}) {
  const { includeComments = true } = options;

  // Resolve issue - client.issue() accepts both UUIDs and identifiers
  const lookup = normalizeIssueLookupInput(issueRef);
  const sdkIssue = await client.issue(lookup);

  if (!sdkIssue) {
    throw new Error(`Issue not found: ${lookup}`);
  }

  // Fetch all nested relations in parallel
  const [
    state,
    team,
    project,
    assignee,
    creator,
    labelsResult,
    parent,
    childrenResult,
    commentsResult,
    attachmentsResult,
  ] = await Promise.all([
    sdkIssue.state?.catch?.(() => null) ?? sdkIssue.state,
    sdkIssue.team?.catch?.(() => null) ?? sdkIssue.team,
    sdkIssue.project?.catch?.(() => null) ?? sdkIssue.project,
    sdkIssue.assignee?.catch?.(() => null) ?? sdkIssue.assignee,
    sdkIssue.creator?.catch?.(() => null) ?? sdkIssue.creator,
    sdkIssue.labels?.()?.catch?.(() => ({ nodes: [] })) ?? sdkIssue.labels?.() ?? { nodes: [] },
    sdkIssue.parent?.catch?.(() => null) ?? sdkIssue.parent,
    sdkIssue.children?.()?.catch?.(() => ({ nodes: [] })) ?? sdkIssue.children?.() ?? { nodes: [] },
    includeComments ? (sdkIssue.comments?.()?.catch?.(() => ({ nodes: [] })) ?? sdkIssue.comments?.() ?? { nodes: [] }) : Promise.resolve({ nodes: [] }),
    sdkIssue.attachments?.()?.catch?.(() => ({ nodes: [] })) ?? sdkIssue.attachments?.() ?? { nodes: [] },
  ]);

  // Transform parent if exists
  let transformedParent = null;
  if (parent) {
    const parentState = await parent.state?.catch?.(() => null) ?? parent.state;
    transformedParent = {
      identifier: parent.identifier,
      title: parent.title,
      state: parentState ? { name: parentState.name, color: parentState.color } : null,
    };
  }

  // Transform children
  const children = (childrenResult.nodes || []).map(c => ({
    identifier: c.identifier,
    title: c.title,
    state: c.state ? { name: c.state.name, color: c.state.color } : null,
  }));

  // Transform comments
  const comments = (commentsResult.nodes || []).map(c => ({
    id: c.id,
    body: c.body,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    user: c.user ? { name: c.user.name, displayName: c.user.displayName } : null,
    externalUser: c.externalUser ? { name: c.externalUser.name, displayName: c.externalUser.displayName } : null,
    parent: c.parent ? { id: c.parent.id } : null,
  }));

  // Transform attachments
  const attachments = (attachmentsResult.nodes || []).map(a => ({
    id: a.id,
    title: a.title,
    url: a.url,
    subtitle: a.subtitle,
    sourceType: a.sourceType,
    createdAt: a.createdAt,
  }));

  // Transform labels
  const labels = (labelsResult.nodes || []).map(l => ({
    id: l.id,
    name: l.name,
    color: l.color,
  }));

  return {
    identifier: sdkIssue.identifier,
    title: sdkIssue.title,
    description: sdkIssue.description,
    url: sdkIssue.url,
    branchName: sdkIssue.branchName,
    priority: sdkIssue.priority,
    estimate: sdkIssue.estimate,
    createdAt: sdkIssue.createdAt,
    updatedAt: sdkIssue.updatedAt,
    state: state ? { name: state.name, color: state.color, type: state.type } : null,
    team: team ? { id: team.id, key: team.key, name: team.name } : null,
    project: project ? { id: project.id, name: project.name } : null,
    assignee: assignee ? { id: assignee.id, name: assignee.name, displayName: assignee.displayName } : null,
    creator: creator ? { id: creator.id, name: creator.name, displayName: creator.displayName } : null,
    labels,
    parent: transformedParent,
    children,
    comments,
    attachments,
  };
}

// ===== MUTATION FUNCTIONS =====

/**
 * Set issue state
 * @param {LinearClient} client - Linear SDK client
 * @param {string} issueId - Issue ID (UUID)
 * @param {string} stateId - Target state ID
 * @returns {Promise<Object>} Updated issue
 */
export async function setIssueState(client, issueId, stateId) {
  const issue = await client.issue(issueId);
  if (!issue) {
    throw new Error(`Issue not found: ${issueId}`);
  }

  const result = await issue.update({ stateId });
  if (!result.success) {
    throw new Error('Failed to update issue state');
  }

  return transformIssue(result.issue);
}

/**
 * Create a new issue
 * @param {LinearClient} client - Linear SDK client
 * @param {Object} input - Issue creation input
 * @param {string} input.teamId - Team ID (required)
 * @param {string} input.title - Issue title (required)
 * @param {string} [input.description] - Issue description
 * @param {string} [input.projectId] - Project ID
 * @param {string} [input.priority] - Priority 0-4
 * @param {string} [input.assigneeId] - Assignee ID
 * @param {string} [input.parentId] - Parent issue ID for sub-issues
 * @returns {Promise<Object>} Created issue
 */
export async function createIssue(client, input) {
  const title = String(input.title || '').trim();
  if (!title) {
    throw new Error('Missing required field: title');
  }

  const teamId = String(input.teamId || '').trim();
  if (!teamId) {
    throw new Error('Missing required field: teamId');
  }

  const createInput = {
    teamId,
    title,
  };

  if (input.description !== undefined) {
    createInput.description = String(input.description);
  }

  if (input.projectId !== undefined) {
    createInput.projectId = input.projectId;
  }

  if (input.priority !== undefined) {
    const parsed = Number.parseInt(String(input.priority), 10);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 4) {
      throw new Error(`Invalid priority: ${input.priority}. Valid range: 0..4`);
    }
    createInput.priority = parsed;
  }

  if (input.assigneeId !== undefined) {
    createInput.assigneeId = input.assigneeId;
  }

  if (input.parentId !== undefined) {
    createInput.parentId = input.parentId;
  }

  if (input.stateId !== undefined) {
    createInput.stateId = input.stateId;
  }

  const result = await client.createIssue(createInput);

  if (!result.success) {
    throw new Error('Failed to create issue');
  }

  // The create response has _issue (private property), not issue
  const created = result._issue;

  // Try to fetch the full issue to get computed fields like identifier
  try {
    if (!created?.id) {
      throw new Error('created.id is missing');
    }
    const fullIssue = await client.issue(created.id);
    if (fullIssue) {
      const transformed = await transformIssue(fullIssue);
      return transformed;
    }
  } catch {
    // Continue with fallback
  }

  // Fallback: Build response from create result + input values
  const issueResponse = {
    id: created.id,
    identifier: created.identifier || null,
    title: created.title || title,
    description: created.description ?? input.description ?? null,
    url: created.url || null,
    priority: created.priority ?? input.priority ?? null,
    state: null,
    team: null,
    project: null,
    assignee: null,
  };

  // Try to resolve relations (they may be promises)
  try {
    if (created.team) {
      const teamData = await created.team;
      if (teamData) issueResponse.team = { id: teamData.id, key: teamData.key, name: teamData.name };
    }
  } catch { /* ignore */ }

  try {
    if (created.project) {
      const projectData = await created.project;
      if (projectData) issueResponse.project = { id: projectData.id, name: projectData.name };
    }
  } catch { /* ignore */ }

  try {
    if (created.state) {
      const stateData = await created.state;
      if (stateData) issueResponse.state = { id: stateData.id, name: stateData.name, type: stateData.type };
    }
  } catch { /* ignore */ }

  try {
    if (created.assignee) {
      const assigneeData = await created.assignee;
      if (assigneeData) issueResponse.assignee = { id: assigneeData.id, name: assigneeData.name, displayName: assigneeData.displayName };
    }
  } catch { /* ignore */ }

  return issueResponse;
}

/**
 * Add a comment to an issue
 * @param {LinearClient} client - Linear SDK client
 * @param {string} issueRef - Issue identifier or ID
 * @param {string} body - Comment body
 * @param {string} [parentCommentId] - Parent comment ID for replies
 * @returns {Promise<{issue: Object, comment: Object}>}
 */
export async function addIssueComment(client, issueRef, body, parentCommentId) {
  const commentBody = String(body || '').trim();
  if (!commentBody) {
    throw new Error('Missing required comment body');
  }

  const targetIssue = await resolveIssue(client, issueRef);

  const input = {
    issueId: targetIssue.id,
    body: commentBody,
  };

  if (parentCommentId) {
    input.parentId = parentCommentId;
  }

  const result = await client.createComment(input);

  if (!result.success) {
    throw new Error('Failed to create comment');
  }

  return {
    issue: targetIssue,
    comment: result.comment,
  };
}

/**
 * Update an issue
 * @param {LinearClient} client - Linear SDK client
 * @param {string} issueRef - Issue identifier or ID
 * @param {Object} patch - Fields to update
 * @returns {Promise<{issue: Object, changed: Array<string>}>}
 */
export async function updateIssue(client, issueRef, patch = {}) {
  const targetIssue = await resolveIssue(client, issueRef);
  const updateInput = {};

  if (patch.title !== undefined) {
    updateInput.title = String(patch.title);
  }

  if (patch.description !== undefined) {
    updateInput.description = String(patch.description);
  }

  if (patch.priority !== undefined) {
    const parsed = Number.parseInt(String(patch.priority), 10);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 4) {
      throw new Error(`Invalid priority: ${patch.priority}. Valid range: 0..4`);
    }
    updateInput.priority = parsed;
  }

  if (patch.state !== undefined) {
    // Need to resolve state ID from team's workflow states
    const team = targetIssue.team;
    if (!team?.id) {
      throw new Error(`Issue ${targetIssue.identifier} has no team assigned`);
    }

    const states = await getTeamWorkflowStates(client, team.id);
    updateInput.stateId = resolveStateIdFromInput(states, patch.state);
  }

  if (Object.keys(updateInput).length === 0) {
    throw new Error('No update fields provided');
  }

  // Get fresh issue instance for update
  const sdkIssue = await client.issue(targetIssue.id);
  if (!sdkIssue) {
    throw new Error(`Issue not found: ${targetIssue.id}`);
  }

  const result = await sdkIssue.update(updateInput);
  if (!result.success) {
    throw new Error('Failed to update issue');
  }

  const updatedIssue = await transformIssue(result.issue);

  return {
    issue: updatedIssue,
    changed: Object.keys(updateInput),
  };
}

/**
 * Prepare issue for starting (get started state)
 * @param {LinearClient} client - Linear SDK client
 * @param {string} issueRef - Issue identifier or ID
 * @returns {Promise<{issue: Object, startedState: Object, branchName: string|null}>}
 */
export async function prepareIssueStart(client, issueRef) {
  const targetIssue = await resolveIssue(client, issueRef);

  const teamRef = targetIssue.team?.key || targetIssue.team?.id;
  if (!teamRef) {
    throw new Error(`Issue ${targetIssue.identifier} has no team assigned`);
  }

  const states = await getTeamWorkflowStates(client, teamRef);

  // Find a "started" type state, or "In Progress" by name
  const started = states.find((s) => s.type === 'started')
    || states.find((s) => String(s.name || '').toLowerCase() === 'in progress');

  if (!started?.id) {
    throw new Error(`Could not resolve a started workflow state for team ${teamRef}`);
  }

  return {
    issue: targetIssue,
    startedState: started,
    branchName: targetIssue.branchName || null,
  };
}

/**
 * Start an issue (set to "In Progress" state)
 * @param {LinearClient} client - Linear SDK client
 * @param {string} issueRef - Issue identifier or ID
 * @returns {Promise<{issue: Object, startedState: Object, branchName: string|null}>}
 */
export async function startIssue(client, issueRef) {
  const prepared = await prepareIssueStart(client, issueRef);
  const updated = await setIssueState(client, prepared.issue.id, prepared.startedState.id);

  return {
    issue: updated,
    startedState: prepared.startedState,
    branchName: prepared.branchName,
  };
}

// ===== MILESTONE FUNCTIONS =====

/**
 * Transform SDK milestone object to plain object for consumers
 * @param {Object} sdkMilestone - SDK milestone object
 * @returns {Promise<Object>} Plain milestone object
 */
async function transformMilestone(sdkMilestone) {
  if (!sdkMilestone) return null;

  // Handle SDK milestone with lazy-loaded relations
  const [project] = await Promise.all([
    sdkMilestone.project?.catch?.(() => null) ?? sdkMilestone.project,
  ]);

  return {
    id: sdkMilestone.id,
    name: sdkMilestone.name,
    description: sdkMilestone.description,
    progress: sdkMilestone.progress,
    order: sdkMilestone.order,
    targetDate: sdkMilestone.targetDate,
    status: sdkMilestone.status,
    project: project ? { id: project.id, name: project.name } : null,
  };
}

/**
 * Fetch milestones for a project
 * @param {LinearClient} client - Linear SDK client
 * @param {string} projectId - Project ID
 * @returns {Promise<Array<Object>>} Array of milestones
 */
export async function fetchProjectMilestones(client, projectId) {
  const project = await client.project(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const result = await project.projectMilestones();
  const nodes = result.nodes || [];

  const milestones = await Promise.all(nodes.map(transformMilestone));

  debug('Fetched project milestones', {
    projectId,
    milestoneCount: milestones.length,
    milestones: milestones.map((m) => ({ id: m.id, name: m.name, status: m.status })),
  });

  return milestones;
}

/**
 * Fetch milestone details including associated issues
 * @param {LinearClient} client - Linear SDK client
 * @param {string} milestoneId - Milestone ID
 * @returns {Promise<Object>} Milestone details with issues
 */
export async function fetchMilestoneDetails(client, milestoneId) {
  const milestone = await client.projectMilestone(milestoneId);
  if (!milestone) {
    throw new Error(`Milestone not found: ${milestoneId}`);
  }

  // Fetch project and issues in parallel
  const [project, issuesResult] = await Promise.all([
    milestone.project?.catch?.(() => null) ?? milestone.project,
    milestone.issues?.()?.catch?.(() => ({ nodes: [] })) ?? milestone.issues?.() ?? { nodes: [] },
  ]);

  // Transform issues
  const issues = await Promise.all(
    (issuesResult.nodes || []).map(async (issue) => {
      const [state, assignee] = await Promise.all([
        issue.state?.catch?.(() => null) ?? issue.state,
        issue.assignee?.catch?.(() => null) ?? issue.assignee,
      ]);

      return {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        state: state ? { name: state.name, color: state.color, type: state.type } : null,
        assignee: assignee ? { id: assignee.id, name: assignee.name, displayName: assignee.displayName } : null,
        priority: issue.priority,
        estimate: issue.estimate,
      };
    })
  );

  return {
    id: milestone.id,
    name: milestone.name,
    description: milestone.description,
    progress: milestone.progress,
    order: milestone.order,
    targetDate: milestone.targetDate,
    status: milestone.status,
    project: project ? { id: project.id, name: project.name } : null,
    issues,
  };
}

/**
 * Create a new project milestone
 * @param {LinearClient} client - Linear SDK client
 * @param {Object} input - Milestone creation input
 * @param {string} input.projectId - Project ID (required)
 * @param {string} input.name - Milestone name (required)
 * @param {string} [input.description] - Milestone description
 * @param {string} [input.targetDate] - Target completion date (ISO string)
 * @param {string} [input.status] - Milestone status (backlogged, planned, inProgress, paused, completed, cancelled)
 * @returns {Promise<Object>} Created milestone
 */
export async function createProjectMilestone(client, input) {
  const name = String(input.name || '').trim();
  if (!name) {
    throw new Error('Missing required field: name');
  }

  const projectId = String(input.projectId || '').trim();
  if (!projectId) {
    throw new Error('Missing required field: projectId');
  }

  const createInput = {
    projectId,
    name,
  };

  if (input.description !== undefined) {
    createInput.description = String(input.description);
  }

  if (input.targetDate !== undefined) {
    createInput.targetDate = input.targetDate;
  }

  if (input.status !== undefined) {
    const validStatuses = ['backlogged', 'planned', 'inProgress', 'paused', 'completed', 'done', 'cancelled'];
    const status = String(input.status);
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid status: ${status}. Valid values: ${validStatuses.join(', ')}`);
    }
    createInput.status = status;
  }

  const result = await client.createProjectMilestone(createInput);

  if (!result.success) {
    throw new Error('Failed to create milestone');
  }

  // The payload has projectMilestone
  const created = result.projectMilestone || result._projectMilestone;

  // Try to fetch the full milestone
  try {
    if (created?.id) {
      const fullMilestone = await client.projectMilestone(created.id);
      if (fullMilestone) {
        return transformMilestone(fullMilestone);
      }
    }
  } catch {
    // Continue with fallback
  }

  // Fallback: Build response from create result
  return {
    id: created?.id || null,
    name: created?.name || name,
    description: created?.description ?? input.description ?? null,
    progress: created?.progress ?? 0,
    order: created?.order ?? null,
    targetDate: created?.targetDate ?? input.targetDate ?? null,
    status: created?.status ?? input.status ?? 'backlogged',
    project: null,
  };
}

/**
 * Update a project milestone
 * @param {LinearClient} client - Linear SDK client
 * @param {string} milestoneId - Milestone ID
 * @param {Object} patch - Fields to update
 * @returns {Promise<{milestone: Object, changed: Array<string>}>}
 */
export async function updateProjectMilestone(client, milestoneId, patch = {}) {
  const milestone = await client.projectMilestone(milestoneId);
  if (!milestone) {
    throw new Error(`Milestone not found: ${milestoneId}`);
  }

  const updateInput = {};

  if (patch.name !== undefined) {
    updateInput.name = String(patch.name);
  }

  if (patch.description !== undefined) {
    updateInput.description = String(patch.description);
  }

  if (patch.targetDate !== undefined) {
    updateInput.targetDate = patch.targetDate;
  }

  if (patch.status !== undefined) {
    const validStatuses = ['backlogged', 'planned', 'inProgress', 'paused', 'completed', 'done', 'cancelled'];
    const status = String(patch.status);
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid status: ${status}. Valid values: ${validStatuses.join(', ')}`);
    }
    updateInput.status = status;
  }

  if (Object.keys(updateInput).length === 0) {
    throw new Error('No update fields provided');
  }

  const result = await milestone.update(updateInput);
  if (!result.success) {
    throw new Error('Failed to update milestone');
  }

  const updatedMilestone = await transformMilestone(result.projectMilestone || result._projectMilestone || milestone);

  return {
    milestone: updatedMilestone,
    changed: Object.keys(updateInput),
  };
}

/**
 * Delete a project milestone
 * @param {LinearClient} client - Linear SDK client
 * @param {string} milestoneId - Milestone ID
 * @returns {Promise<{success: boolean, milestoneId: string}>}
 */
export async function deleteProjectMilestone(client, milestoneId) {
  const result = await client.deleteProjectMilestone(milestoneId);

  return {
    success: result.success,
    milestoneId,
  };
}

/**
 * Delete (archive) an issue
 * @param {LinearClient} client - Linear SDK client
 * @param {string} issueRef - Issue identifier or ID
 * @returns {Promise<{success: boolean, issueId: string, identifier: string}>}
 */
export async function deleteIssue(client, issueRef) {
  const targetIssue = await resolveIssue(client, issueRef);

  // Get SDK issue instance for delete
  const sdkIssue = await client.issue(targetIssue.id);
  if (!sdkIssue) {
    throw new Error(`Issue not found: ${targetIssue.id}`);
  }

  const result = await sdkIssue.delete();

  return {
    success: result.success,
    issueId: targetIssue.id,
    identifier: targetIssue.identifier,
  };
}

// ===== PURE HELPER FUNCTIONS (unchanged) =====

/**
 * Group issues by project
 * @param {Array<Object>} issues - Array of issues
 * @returns {Map<string, {projectName: string, issueCount: number, issues: Array}>}
 */
export function groupIssuesByProject(issues) {
  const map = new Map();
  let ignoredNoProject = 0;

  for (const issue of issues) {
    const project = issue?.project;
    const projectId = project?.id;

    if (!projectId) {
      ignoredNoProject += 1;
      debug('Ignoring issue with no project', {
        issueId: issue?.id,
        title: issue?.title,
        state: issue?.state?.name,
      });
      continue;
    }

    const existing = map.get(projectId);
    if (existing) {
      existing.issueCount += 1;
      existing.issues.push(issue);
    } else {
      map.set(projectId, {
        projectName: project?.name,
        issueCount: 1,
        issues: [issue],
      });
    }
  }

  info('Grouped issues by project', {
    issueCount: issues.length,
    projectCount: map.size,
    ignoredNoProject,
  });

  return map;
}

/**
 * Format relative time from ISO date string
 * @param {string} isoDate - ISO date string
 * @returns {string} Human-readable relative time
 */
function formatRelativeTime(isoDate) {
  if (!isoDate) return 'unknown';

  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffSeconds < 60) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  if (diffWeeks < 4) return `${diffWeeks} week${diffWeeks > 1 ? 's' : ''} ago`;
  if (diffMonths < 12) return `${diffMonths} month${diffMonths > 1 ? 's' : ''} ago`;
  return `${diffYears} year${diffYears > 1 ? 's' : ''} ago`;
}

/**
 * Format issue details as markdown
 * @param {Object} issueData - Issue data from fetchIssueDetails
 * @param {Object} options
 * @param {boolean} [options.includeComments=true] - Include comments in markdown
 * @returns {string} Markdown formatted issue
 */
export function formatIssueAsMarkdown(issueData, options = {}) {
  const { includeComments = true } = options;
  const lines = [];

  // Title
  lines.push(`# ${issueData.identifier}: ${issueData.title}`);

  // Meta information
  const metaParts = [];
  if (issueData.state?.name) {
    metaParts.push(`**State:** ${issueData.state.name}`);
  }
  if (issueData.team?.name) {
    metaParts.push(`**Team:** ${issueData.team.name}`);
  }
  if (issueData.project?.name) {
    metaParts.push(`**Project:** ${issueData.project.name}`);
  }
  if (issueData.assignee?.displayName) {
    metaParts.push(`**Assignee:** ${issueData.assignee.displayName}`);
  }
  if (issueData.priority !== undefined && issueData.priority !== null) {
    const priorityNames = ['No priority', 'Urgent', 'High', 'Medium', 'Low'];
    metaParts.push(`**Priority:** ${priorityNames[issueData.priority] || issueData.priority}`);
  }
  if (issueData.estimate !== undefined && issueData.estimate !== null) {
    metaParts.push(`**Estimate:** ${issueData.estimate}`);
  }
  if (issueData.labels?.length > 0) {
    const labelNames = issueData.labels.map((l) => l.name).join(', ');
    metaParts.push(`**Labels:** ${labelNames}`);
  }

  if (metaParts.length > 0) {
    lines.push('');
    lines.push(metaParts.join(' | '));
  }

  // URLs
  if (issueData.url) {
    lines.push('');
    lines.push(`**URL:** ${issueData.url}`);
  }
  if (issueData.branchName) {
    lines.push(`**Branch:** ${issueData.branchName}`);
  }

  // Description
  if (issueData.description) {
    lines.push('');
    lines.push(issueData.description);
  }

  // Parent issue
  if (issueData.parent) {
    lines.push('');
    lines.push('## Parent');
    lines.push('');
    lines.push(`- **${issueData.parent.identifier}**: ${issueData.parent.title} _[${issueData.parent.state?.name || 'unknown'}]_`);
  }

  // Sub-issues
  if (issueData.children?.length > 0) {
    lines.push('');
    lines.push('## Sub-issues');
    lines.push('');
    for (const child of issueData.children) {
      lines.push(`- **${child.identifier}**: ${child.title} _[${child.state?.name || 'unknown'}]_`);
    }
  }

  // Attachments
  if (issueData.attachments?.length > 0) {
    lines.push('');
    lines.push('## Attachments');
    lines.push('');
    for (const attachment of issueData.attachments) {
      const sourceLabel = attachment.sourceType ? ` _[${attachment.sourceType}]_` : '';
      lines.push(`- **${attachment.title}**: ${attachment.url}${sourceLabel}`);
      if (attachment.subtitle) {
        lines.push(`  _${attachment.subtitle}_`);
      }
    }
  }

  // Comments
  if (includeComments && issueData.comments?.length > 0) {
    lines.push('');
    lines.push('## Comments');
    lines.push('');

    // Separate root comments from replies
    const rootComments = issueData.comments.filter((c) => !c.parent);
    const replies = issueData.comments.filter((c) => c.parent);

    // Create a map of parent ID to replies
    const repliesMap = new Map();
    replies.forEach((reply) => {
      const parentId = reply.parent.id;
      if (!repliesMap.has(parentId)) {
        repliesMap.set(parentId, []);
      }
      repliesMap.get(parentId).push(reply);
    });

    // Sort root comments by creation date (newest first)
    const sortedRootComments = rootComments.slice().reverse();

    for (const rootComment of sortedRootComments) {
      const threadReplies = repliesMap.get(rootComment.id) || [];

      // Sort replies by creation date (oldest first within thread)
      threadReplies.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

      const rootAuthor = rootComment.user?.displayName
        || rootComment.user?.name
        || rootComment.externalUser?.displayName
        || rootComment.externalUser?.name
        || 'Unknown';
      const rootDate = formatRelativeTime(rootComment.createdAt);

      lines.push(`- **@${rootAuthor}** - _${rootDate}_`);
      lines.push('');
      lines.push(`  ${rootComment.body.split('\n').join('\n  ')}`);
      lines.push('');

      // Format replies
      for (const reply of threadReplies) {
        const replyAuthor = reply.user?.displayName
          || reply.user?.name
          || reply.externalUser?.displayName
          || reply.externalUser?.name
          || 'Unknown';
        const replyDate = formatRelativeTime(reply.createdAt);

        lines.push(`  - **@${replyAuthor}** - _${replyDate}_`);
        lines.push('');
        lines.push(`    ${reply.body.split('\n').join('\n    ')}`);
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}
