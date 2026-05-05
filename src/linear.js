/**
 * Linear SDK API wrapper
 *
 * Provides high-level functions for interacting with Linear API via @linear/sdk.
 * All functions receive a LinearClient instance as the first parameter.
 */

import { warn, info, debug } from './logger.js';

const CACHE_TTL_MS = {
  viewer: 30_000,
  projects: 60_000,
  teams: 60_000,
  teamStates: 60_000,
};

const viewerCache = new Map();
const projectsCache = new Map();
const teamsCache = new Map();
const teamStatesCache = new Map();

function getClientCacheKey(client) {
  return client?.apiKey || 'default';
}

function getCache(map, key) {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    map.delete(key);
    return null;
  }
  return entry.value;
}

function setCache(map, key, value, ttlMs) {
  map.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

// ===== OPTIMIZED GRAPHQL QUERIES =====
// These queries fetch relations upfront to avoid N+1 API calls

/**
 * Optimized GraphQL query to fetch issues with all relations in a single request
 * This reduces API calls from ~251 (N+1) to 1 per query
 */
const ISSUES_WITH_RELATIONS_QUERY = `
  query IssuesWithRelations($first: Int, $filter: IssueFilter) {
    issues(first: $first, filter: $filter) {
      nodes {
        id
        identifier
        title
        description
        url
        branchName
        priority
        state {
          id
          name
          type
        }
        team {
          id
          key
          name
        }
        project {
          id
          name
        }
        projectMilestone {
          id
          name
        }
        assignee {
          id
          name
          displayName
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const PROJECT_DETAILS_QUERY = `
  query ProjectDetails($id: String!, $milestoneLimit: Int!) {
    project(id: $id) {
      id
      name
      description
      content
      color
      icon
      priority
      progress
      health
      startDate
      targetDate
      slugId
      url
      archivedAt
      completedAt
      canceledAt
      status {
        id
        name
        type
        color
      }
      lead {
        id
        name
        displayName
      }
      teams {
        nodes {
          id
          key
          name
        }
      }
      projectMilestones(first: $milestoneLimit) {
        nodes {
          id
          name
          status
          progress
          targetDate
        }
      }
    }
  }
`;

const PROJECTS_LOOKUP_QUERY = `
  query ProjectsLookup($includeArchived: Boolean!) {
    projects(first: 250, includeArchived: $includeArchived) {
      nodes {
        id
        name
        slugId
        archivedAt
      }
    }
  }
`;

const PROJECT_MINIMAL_QUERY = `
  query ProjectMinimal($id: String!) {
    project(id: $id) {
      id
      name
      slugId
      archivedAt
    }
  }
`;

const PROJECT_MILESTONES_QUERY = `
  query ProjectMilestones($id: String!, $first: Int!) {
    project(id: $id) {
      id
      name
      projectMilestones(first: $first) {
        nodes {
          id
          name
          description
          progress
          sortOrder
          targetDate
          status
        }
      }
    }
  }
`;

const TEAM_MINIMAL_QUERY = `
  query TeamMinimal($id: String!) {
    team(id: $id) {
      id
      key
      name
    }
  }
`;

const TEAM_STATES_QUERY = `
  query TeamStates($id: String!, $first: Int!) {
    team(id: $id) {
      id
      key
      name
      states(first: $first) {
        nodes {
          id
          name
          type
        }
      }
    }
  }
`;

const PROJECT_CREATE_MUTATION = `
  mutation ProjectCreate($input: ProjectCreateInput!) {
    projectCreate(input: $input) {
      success
      project {
        id
        name
      }
    }
  }
`;

const PROJECT_UPDATE_MUTATION = `
  mutation ProjectUpdate($id: String!, $input: ProjectUpdateInput!) {
    projectUpdate(id: $id, input: $input) {
      success
      project {
        id
        name
      }
    }
  }
`;


const MILESTONE_DETAILS_QUERY = `
  query MilestoneDetails($id: String!, $issueLimit: Int!) {
    projectMilestone(id: $id) {
      id
      name
      description
      progress
      sortOrder
      targetDate
      status
      project {
        id
        name
      }
      issues(first: $issueLimit) {
        nodes {
          id
          identifier
          title
          priority
          estimate
          state {
            id
            name
            color
            type
          }
          assignee {
            id
            name
            displayName
          }
        }
      }
    }
  }
`;

const PROJECT_DELETE_MUTATION = `
  mutation ProjectDelete($id: String!) {
    projectDelete(id: $id) {
      success
      entity {
        id
        name
      }
    }
  }
`;

const PROJECT_ARCHIVE_MUTATION = `
  mutation ProjectArchive($id: String!) {
    projectArchiveResult: projectArchive(id: $id) {
      success
      entity {
        id
        name
      }
    }
  }
`;

const PROJECT_UNARCHIVE_MUTATION = `
  mutation ProjectUnarchive($id: String!) {
    projectUnarchive(id: $id) {
      success
      entity {
        id
        name
      }
    }
  }
`;

const PROJECT_UPDATES_BY_PROJECT_QUERY = `
  query ProjectUpdatesByProject($id: String!, $first: Int!, $includeArchived: Boolean!) {
    project(id: $id) {
      id
      name
      projectUpdates(first: $first, includeArchived: $includeArchived) {
        nodes {
          id
          body
          health
          createdAt
          updatedAt
          archivedAt
          url
          slugId
          isDiffHidden
          isStale
          user {
            id
            name
            displayName
          }
        }
      }
    }
  }
`;

const PROJECT_UPDATE_DETAILS_QUERY = `
  query ProjectUpdateDetails($id: String!) {
    projectUpdate(id: $id) {
      id
      body
      health
      createdAt
      updatedAt
      archivedAt
      editedAt
      url
      slugId
      isDiffHidden
      isStale
      project {
        id
        name
      }
      user {
        id
        name
        displayName
      }
    }
  }
`;

const PROJECT_UPDATE_CREATE_MUTATION = `
  mutation ProjectUpdateCreate($input: ProjectUpdateCreateInput!) {
    projectUpdateCreate(input: $input) {
      success
      projectUpdate {
        id
      }
    }
  }
`;

const PROJECT_UPDATE_UPDATE_MUTATION = `
  mutation ProjectUpdateUpdate($id: String!, $input: ProjectUpdateUpdateInput!) {
    projectUpdateUpdate(id: $id, input: $input) {
      success
      projectUpdate {
        id
      }
    }
  }
`;

const PROJECT_UPDATE_ARCHIVE_MUTATION = `
  mutation ProjectUpdateArchive($id: String!) {
    projectUpdateArchive(id: $id) {
      success
      entity {
        id
      }
    }
  }
`;

const PROJECT_UPDATE_UNARCHIVE_MUTATION = `
  mutation ProjectUpdateUnarchive($id: String!) {
    projectUpdateUnarchive(id: $id) {
      success
      entity {
        id
      }
    }
  }
`;

const DOCUMENT_DETAILS_QUERY = `
  query DocumentDetails($id: String!) {
    document(id: $id) {
      id
      title
      content
      icon
      color
      slugId
      url
      archivedAt
      createdAt
      updatedAt
      project {
        id
        name
      }
      issue {
        id
        identifier
        title
      }
    }
  }
`;

const DOCUMENT_CREATE_MUTATION = `
  mutation DocumentCreate($input: DocumentCreateInput!) {
    documentCreate(input: $input) {
      success
      document {
        id
      }
    }
  }
`;

const DOCUMENT_UPDATE_MUTATION = `
  mutation DocumentUpdate($id: String!, $input: DocumentUpdateInput!) {
    documentUpdate(id: $id, input: $input) {
      success
      document {
        id
      }
    }
  }
`;

const ISSUE_MINIMAL_QUERY = `
  query IssueMinimal($id: String!) {
    issue(id: $id) {
      id
      identifier
      title
      description
      url
      branchName
      priority
      estimate
      createdAt
      updatedAt
      state {
        id
        name
        type
      }
      team {
        id
        key
        name
      }
      project {
        id
        name
      }
      projectMilestone {
        id
        name
      }
      assignee {
        id
        name
        displayName
      }
    }
  }
`;

const ISSUE_MINIMAL_BY_TEAM_AND_NUMBER_QUERY = `
  query IssueMinimalByTeamAndNumber($teamKey: String!, $number: Float!) {
    issues(first: 1, filter: { team: { key: { eq: $teamKey } }, number: { eq: $number } }) {
      nodes {
        id
        identifier
        title
        description
        url
        branchName
        priority
        estimate
        createdAt
        updatedAt
        state {
          id
          name
          type
        }
        team {
          id
          key
          name
        }
        project {
          id
          name
        }
        projectMilestone {
          id
          name
        }
        assignee {
          id
          name
          displayName
        }
      }
    }
  }
`;

const ISSUE_DETAILS_QUERY = `
  query IssueDetails($id: String!) {
    issue(id: $id) {
      id
      identifier
      title
      description
      url
      branchName
      priority
      estimate
      createdAt
      updatedAt
      state {
        id
        name
        color
        type
      }
      team {
        id
        key
        name
      }
      project {
        id
        name
      }
      projectMilestone {
        id
        name
      }
      assignee {
        id
        name
        displayName
      }
      creator {
        id
        name
        displayName
      }
      labels(first: 50) {
        nodes {
          id
          name
          color
        }
      }
      parent {
        id
        identifier
        title
        state {
          id
          name
          color
        }
      }
      children(first: 50) {
        nodes {
          id
          identifier
          title
          state {
            id
            name
            color
          }
        }
      }
      attachments(first: 50) {
        nodes {
          id
          title
          url
          subtitle
          sourceType
          createdAt
        }
      }
    }
  }
`;

const ISSUE_DETAILS_WITH_COMMENTS_QUERY = `
  query IssueDetailsWithComments($id: String!) {
    issue(id: $id) {
      id
      identifier
      title
      description
      url
      branchName
      priority
      estimate
      createdAt
      updatedAt
      state {
        id
        name
        color
        type
      }
      team {
        id
        key
        name
      }
      project {
        id
        name
      }
      projectMilestone {
        id
        name
      }
      assignee {
        id
        name
        displayName
      }
      creator {
        id
        name
        displayName
      }
      labels(first: 50) {
        nodes {
          id
          name
          color
        }
      }
      parent {
        id
        identifier
        title
        state {
          id
          name
          color
        }
      }
      children(first: 50) {
        nodes {
          id
          identifier
          title
          state {
            id
            name
            color
          }
        }
      }
      comments(first: 100) {
        nodes {
          id
          body
          createdAt
          updatedAt
          user {
            id
            name
            displayName
          }
          externalUser {
            id
            name
            displayName
          }
          parent {
            id
          }
        }
      }
      attachments(first: 50) {
        nodes {
          id
          title
          url
          subtitle
          sourceType
          createdAt
        }
      }
    }
  }
`;

const ISSUE_CREATE_MUTATION = `
  mutation IssueCreate($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue {
        id
        identifier
        title
        description
        url
        branchName
        priority
        estimate
        createdAt
        updatedAt
        state {
          id
          name
          type
        }
        team {
          id
          key
          name
        }
        project {
          id
          name
        }
        projectMilestone {
          id
          name
        }
        assignee {
          id
          name
          displayName
        }
      }
    }
  }
`;

const ISSUE_UPDATE_MUTATION = `
  mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) {
      success
      issue {
        id
        identifier
        title
        description
        url
        branchName
        priority
        estimate
        createdAt
        updatedAt
        state {
          id
          name
          type
        }
        team {
          id
          key
          name
        }
        project {
          id
          name
        }
        projectMilestone {
          id
          name
        }
        assignee {
          id
          name
          displayName
        }
      }
    }
  }
`;

const ISSUE_DELETE_MUTATION = `
  mutation IssueDelete($id: String!) {
    issueDelete(id: $id) {
      success
      entity {
        id
        identifier
      }
    }
  }
`;

const ISSUE_ACTIVITY_QUERY = `
  query IssueActivity($id: String!, $first: Int!, $includeArchived: Boolean!) {
    issue(id: $id) {
      id
      identifier
      title
      url
      history(first: $first, includeArchived: $includeArchived) {
        nodes {
          id
          createdAt
          updatedAt
          archived
          archivedAt
          autoArchived
          autoClosed
          trashed
          updatedDescription
          fromTitle
          toTitle
          fromPriority
          toPriority
          fromState {
            id
            name
          }
          toState {
            id
            name
          }
          fromAssignee {
            id
            name
            displayName
          }
          toAssignee {
            id
            name
            displayName
          }
          fromProject {
            id
            name
          }
          toProject {
            id
            name
          }
          fromProjectMilestone {
            id
            name
          }
          toProjectMilestone {
            id
            name
          }
          addedLabels {
            id
            name
          }
          removedLabels {
            id
            name
          }
          relationChanges {
            identifier
            type
          }
          attachment {
            id
            title
            url
          }
          actor {
            id
            name
            displayName
          }
        }
      }
    }
  }
`;

/**
 * Execute an optimized GraphQL query using rawRequest
 * Falls back to SDK method if rawRequest is not available (e.g., in tests)
 * @param {LinearClient} client - Linear SDK client
 * @param {string} query - GraphQL query string
 * @param {Object} variables - Query variables
 * @returns {Promise<{data: Object, headers: Headers}>}
 */
async function executeOptimizedQuery(client, query, variables) {
  // Try rawRequest first (preferred - more efficient)
  if (typeof client.rawRequest === 'function') {
    const response = await client.rawRequest(query, variables);
    return {
      data: response.data,
      headers: response.headers,
    };
  }

  // Fallback to SDK method for testing/compatibility
  if (typeof client.client?.rawRequest === 'function') {
    const response = await client.client.rawRequest(query, variables);
    return {
      data: response.data,
      headers: response.headers,
    };
  }

  // Fallback: use SDK's issues() method (less efficient but always available)
  warn('executeOptimizedQuery: rawRequest not available, falling back to SDK method');
  const filter = variables.filter || {};
  const result = await client.issues({
    first: variables.first,
    filter,
  });

  return {
    data: {
      issues: {
        nodes: result.nodes || [],
        pageInfo: result.pageInfo || { hasNextPage: false },
      },
    },
    headers: new Headers(),
  };
}

function getRawRequest(client) {
  return (
    (typeof client.client?.rawRequest === 'function' ? client.client.rawRequest.bind(client.client) : null) ||
    (typeof client.rawRequest === 'function' ? client.rawRequest.bind(client) : null)
  );
}

async function executeGraphQL(client, query, variables = {}) {
  const rawRequest = getRawRequest(client);

  if (!rawRequest) {
    throw new Error('GraphQL rawRequest is unavailable on this Linear client');
  }

  const response = await rawRequest(query, variables);
  updateRateLimitState(response);
  checkRateLimitWarning();
  return response.data;
}

/**
 * Transform raw GraphQL issue data to plain object format
 * Used by optimized queries to avoid SDK lazy loading
 */
function transformRawIssue(rawIssue) {
  if (!rawIssue) return null;

  return {
    id: rawIssue.id,
    identifier: rawIssue.identifier,
    title: rawIssue.title,
    description: rawIssue.description,
    url: rawIssue.url,
    branchName: rawIssue.branchName,
    priority: rawIssue.priority,
    estimate: rawIssue.estimate ?? null,
    createdAt: rawIssue.createdAt ?? null,
    updatedAt: rawIssue.updatedAt ?? null,
    state: rawIssue.state ? { id: rawIssue.state.id, name: rawIssue.state.name, type: rawIssue.state.type } : null,
    team: rawIssue.team ? { id: rawIssue.team.id, key: rawIssue.team.key, name: rawIssue.team.name } : null,
    project: rawIssue.project ? { id: rawIssue.project.id, name: rawIssue.project.name } : null,
    projectMilestone: rawIssue.projectMilestone ? { id: rawIssue.projectMilestone.id, name: rawIssue.projectMilestone.name } : null,
    assignee: rawIssue.assignee ? { id: rawIssue.assignee.id, name: rawIssue.assignee.name, displayName: rawIssue.assignee.displayName } : null,
  };
}

function parseIssueIdentifierLookup(lookup) {
  const match = String(lookup || '').trim().match(/^([A-Za-z0-9]+)-(\d+)$/);
  if (!match) {
    return null;
  }

  return {
    teamKey: match[1].toUpperCase(),
    number: Number.parseInt(match[2], 10),
  };
}

async function fetchIssueMinimalById(client, issueId) {
  if (getRawRequest(client)) {
    try {
      const data = await executeGraphQL(client, ISSUE_MINIMAL_QUERY, { id: issueId });
      const transformed = transformRawIssue(data?.issue ?? null);
      if (transformed) {
        return transformed;
      }
    } catch {
      // Fall back to SDK read below.
    }
  }

  const sdkIssue = await client.issue?.(issueId);
  return sdkIssue ? transformIssue(sdkIssue) : null;
}

async function fetchIssueMinimalByIdentifier(client, identifier) {
  if (getRawRequest(client)) {
    const parsed = parseIssueIdentifierLookup(identifier);
    if (parsed) {
      try {
        const data = await executeGraphQL(client, ISSUE_MINIMAL_BY_TEAM_AND_NUMBER_QUERY, parsed);
        const transformed = transformRawIssue(data?.issues?.nodes?.[0] ?? null);
        if (transformed) {
          return transformed;
        }
      } catch {
        // Fall back to SDK read below.
      }
    }
  }

  const sdkIssue = await client.issue?.(identifier);
  return sdkIssue ? transformIssue(sdkIssue) : null;
}

async function fetchIssueMinimal(client, lookup) {
  return isLinearId(lookup)
    ? fetchIssueMinimalById(client, lookup)
    : fetchIssueMinimalByIdentifier(client, lookup);
}

async function performIssueUpdate(client, issueId, updateInput) {
  if (getRawRequest(client)) {
    const payload = await executeGraphQL(client, ISSUE_UPDATE_MUTATION, {
      id: issueId,
      input: updateInput,
    });

    if (!payload?.issueUpdate?.success) {
      throw new Error('Failed to update issue');
    }

    return transformRawIssue(payload.issueUpdate.issue ?? null);
  }

  const sdkIssue = await client.issue(issueId);
  if (!sdkIssue) {
    throw new Error(`Issue not found: ${issueId}`);
  }

  const result = await sdkIssue.update(updateInput);
  if (!result.success) {
    throw new Error('Failed to update issue');
  }

  return transformIssue(result.issue);
}

function transformRawIssueDetails(rawIssue, options = {}) {
  const { includeComments = true } = options;
  if (!rawIssue) return null;

  return {
    identifier: rawIssue.identifier,
    title: rawIssue.title,
    description: rawIssue.description ?? null,
    url: rawIssue.url ?? null,
    branchName: rawIssue.branchName ?? null,
    priority: rawIssue.priority ?? null,
    estimate: rawIssue.estimate ?? null,
    createdAt: rawIssue.createdAt ?? null,
    updatedAt: rawIssue.updatedAt ?? null,
    state: rawIssue.state ? {
      name: rawIssue.state.name,
      color: rawIssue.state.color ?? null,
      type: rawIssue.state.type ?? null,
    } : null,
    team: rawIssue.team ? { id: rawIssue.team.id, key: rawIssue.team.key, name: rawIssue.team.name } : null,
    project: rawIssue.project ? { id: rawIssue.project.id, name: rawIssue.project.name } : null,
    projectMilestone: rawIssue.projectMilestone ? { id: rawIssue.projectMilestone.id, name: rawIssue.projectMilestone.name } : null,
    assignee: rawIssue.assignee ? { id: rawIssue.assignee.id, name: rawIssue.assignee.name, displayName: rawIssue.assignee.displayName } : null,
    creator: rawIssue.creator ? { id: rawIssue.creator.id, name: rawIssue.creator.name, displayName: rawIssue.creator.displayName } : null,
    labels: (rawIssue.labels?.nodes || []).map((label) => ({
      id: label.id,
      name: label.name,
      color: label.color ?? null,
    })),
    parent: rawIssue.parent ? {
      identifier: rawIssue.parent.identifier,
      title: rawIssue.parent.title,
      state: rawIssue.parent.state ? {
        name: rawIssue.parent.state.name,
        color: rawIssue.parent.state.color ?? null,
      } : null,
    } : null,
    children: (rawIssue.children?.nodes || []).map((child) => ({
      identifier: child.identifier,
      title: child.title,
      state: child.state ? {
        name: child.state.name,
        color: child.state.color ?? null,
      } : null,
    })),
    comments: includeComments
      ? (rawIssue.comments?.nodes || []).map((comment) => ({
        id: comment.id,
        body: comment.body,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
        user: comment.user ? {
          name: comment.user.name,
          displayName: comment.user.displayName,
        } : null,
        externalUser: comment.externalUser ? {
          name: comment.externalUser.name,
          displayName: comment.externalUser.displayName,
        } : null,
        parent: comment.parent ? { id: comment.parent.id } : null,
      }))
      : [],
    attachments: (rawIssue.attachments?.nodes || []).map((attachment) => ({
      id: attachment.id,
      title: attachment.title,
      url: attachment.url,
      subtitle: attachment.subtitle,
      sourceType: attachment.sourceType,
      createdAt: attachment.createdAt,
    })),
  };
}

function transformRawProjectMinimal(rawProject) {
  if (!rawProject) return null;

  return {
    id: rawProject.id,
    name: rawProject.name,
    slugId: rawProject.slugId ?? null,
    archivedAt: rawProject.archivedAt ?? null,
  };
}

function transformRawMilestone(rawMilestone, project = null) {
  if (!rawMilestone) return null;

  return {
    id: rawMilestone.id,
    name: rawMilestone.name,
    description: rawMilestone.description ?? null,
    progress: rawMilestone.progress ?? null,
    order: rawMilestone.sortOrder ?? null,
    targetDate: rawMilestone.targetDate ?? null,
    status: rawMilestone.status ?? null,
    project: project ? { id: project.id, name: project.name } : null,
  };
}

async function fetchProjectMinimal(client, projectId) {
  // If input looks like a UUID but can't be resolved directly,
  // it might be a project name that accidentally matches the UUID pattern.
  // Return null to signal that resolveProjectRef should fall back to name search.
  if (isLinearId(projectId)) {
    if (!getRawRequest(client)) {
      const sdkProject = await client.project?.(projectId);
      if (sdkProject) {
        return transformRawProjectMinimal(sdkProject);
      }
      // SDK can't resolve it - return null so resolveProjectRef falls back to name lookup
      return null;
    }

    const data = await executeGraphQL(client, PROJECT_MINIMAL_QUERY, { id: projectId });
    if (data?.project) {
      return transformRawProjectMinimal(data.project);
    }
    // GraphQL can't resolve it - return null so resolveProjectRef falls back to name lookup
    return null;
  }

  // For non-UUID inputs (names), return null to let resolveProjectRef handle it directly
  return null;
}

async function fetchTeamMinimal(client, teamId) {
  if (getRawRequest(client)) {
    try {
      const data = await executeGraphQL(client, TEAM_MINIMAL_QUERY, { id: teamId });
      const team = data?.team;
      if (team) {
        return { id: team.id, key: team.key, name: team.name };
      }
    } catch {
      // Fall back to SDK read below.
    }
  }

  const sdkTeam = await client.team?.(teamId);
  return sdkTeam ? { id: sdkTeam.id, key: sdkTeam.key, name: sdkTeam.name } : null;
}

async function fetchTeamStatesByQuery(client, teamId, options = {}) {
  const { first = 50 } = options;

  if (getRawRequest(client)) {
    try {
      const data = await executeGraphQL(client, TEAM_STATES_QUERY, { id: teamId, first });
      if (data?.team) {
        return (data.team.states?.nodes || []).map((state) => ({
          id: state.id,
          name: state.name,
          type: state.type,
        }));
      }
    } catch {
      // Fall back to SDK read below.
    }
  }

  const team = await client.team?.(teamId);
  if (!team) {
    return null;
  }

  const result = await team.states();
  return (result.nodes || []).map((state) => ({
    id: state.id,
    name: state.name,
    type: state.type,
  }));
}

async function fetchProjectMilestonesByQuery(client, projectId, options = {}) {
  const { first = 250 } = options;

  if (!getRawRequest(client)) {
    const project = await client.project?.(projectId);
    if (!project) {
      return null;
    }

    const result = await project.projectMilestones();
    const nodes = result.nodes || [];
    return Promise.all(nodes.map(transformMilestone));
  }

  const data = await executeGraphQL(client, PROJECT_MILESTONES_QUERY, {
    id: projectId,
    first,
  });

  if (!data?.project) {
    return null;
  }

  const project = { id: data.project.id, name: data.project.name };
  return (data.project.projectMilestones?.nodes || []).map((milestone) => transformRawMilestone(milestone, project));
}

// ===== RATE LIMIT TRACKING =====

/**
 * Track rate limit status from API responses
 * Linear API returns headers: X-RateLimit-Requests-Remaining, X-RateLimit-Requests-Reset
 */
const DEFAULT_REQUEST_LIMIT = 5000;
const LOW_RATE_LIMIT_THRESHOLD = 0.10;

const rateLimitState = {
  limit: DEFAULT_REQUEST_LIMIT,
  remaining: null,
  resetAt: null,
  lastWarnAt: 0,
};

/**
 * Update rate limit state from response headers (internal)
 * @param {Response} response - Fetch response object
 */
function updateRateLimitState(response) {
  if (!response) return;

  const headers = response.headers;
  if (headers) {
    const limit = headers.get('X-RateLimit-Requests-Limit');
    const remaining = headers.get('X-RateLimit-Requests-Remaining');
    const resetAt = headers.get('X-RateLimit-Requests-Reset');

    if (limit !== null) {
      const parsedLimit = parseInt(limit, 10);
      if (Number.isFinite(parsedLimit)) rateLimitState.limit = parsedLimit;
    }
    if (remaining !== null) {
      const parsedRemaining = parseInt(remaining, 10);
      if (Number.isFinite(parsedRemaining)) rateLimitState.remaining = parsedRemaining;
    }
    if (resetAt !== null) {
      const parsedResetAt = parseInt(resetAt, 10);
      if (Number.isFinite(parsedResetAt)) rateLimitState.resetAt = parsedResetAt;
    }
  }
}

/**
 * Get current rate limit status
 * @returns {{remaining: number|null, resetAt: number|null, resetTime: string|null, usagePercent: number|null, shouldWarn: boolean}}
 */
export function getRateLimitStatus() {
  const result = {
    limit: rateLimitState.limit,
    remaining: rateLimitState.remaining,
    resetAt: rateLimitState.resetAt,
    resetTime: null,
    usagePercent: null,
    shouldWarn: false,
  };

  if (rateLimitState.resetAt) {
    result.resetTime = new Date(rateLimitState.resetAt).toLocaleTimeString();
    const remaining = rateLimitState.remaining;
    const limit = rateLimitState.limit || DEFAULT_REQUEST_LIMIT;
    if (remaining !== null) {
      result.usagePercent = Math.round((Math.max(0, limit - remaining) / limit) * 100);
      result.shouldWarn = remaining <= Math.max(1, Math.floor(limit * LOW_RATE_LIMIT_THRESHOLD));
    }
  }

  return result;
}

/**
 * Check and warn about low rate limit
 */
function checkRateLimitWarning() {
  const now = Date.now();
  // Only warn once per 30 seconds to avoid spam
  if (now - rateLimitState.lastWarnAt < 30000) return;

  const status = getRateLimitStatus();
  if (status.shouldWarn && status.remaining !== null) {
    rateLimitState.lastWarnAt = now;
    warn(`Linear API rate limit running low: ${status.remaining} requests remaining (~${status.usagePercent}% used). Resets at ${status.resetTime}`, {
      limit: status.limit,
      remaining: status.remaining,
      resetAt: status.resetTime,
      usagePercent: status.usagePercent,
    });
  }
}

// ===== ERROR HANDLING =====

/**
 * Check if an error is a Linear SDK error type
 * @param {Error} error - The error to check
 * @returns {boolean}
 */
export function isLinearError(error) {
  return error?.constructor?.name?.includes('LinearError') ||
    error?.name?.includes('LinearError') ||
    error?.type?.startsWith?.('Ratelimited') ||
    error?.type?.startsWith?.('Forbidden') ||
    error?.type?.startsWith?.('Authentication') ||
    error?.type === 'invalid_request' ||
    error?.type === 'NetworkError' ||
    error?.type === 'InternalError';
}


/**
 * Check if an error is a rate-limit error
 * @param {Error} error - The error to check
 * @returns {boolean}
 */
export function isRateLimitError(error) {
  return (
    isLinearError(error) &&
    (error?.type === 'Ratelimited' || String(error?.message || '').toLowerCase().includes('rate limit'))
  );
}

/**
 * Format a Linear API error into a user-friendly message
 * @param {Error} error - The original error
 * @returns {Error|unknown} Formatted error with user-friendly message, or original if unhandled
 */
function formatLinearError(error) {
  const message = String(error?.message || error || 'Unknown error');
  const errorType = error?.type || 'Unknown';

  // Rate limit: provide reset time and reduce-frequency hint
  if (errorType === 'Ratelimited' || message.toLowerCase().includes('rate limit')) {
    const resetAt = error?.requestsResetAt
      ? new Date(error.requestsResetAt).toLocaleTimeString()
      : '1 hour';

    return new Error(
      `Linear API rate limit exceeded. Please wait before making more requests.\n` +
      `Rate limit resets at: ${resetAt}\n` +
      `Hint: Reduce request frequency or wait before retrying.`
    );
  }

  // Auth/permission failures: prompt to check credentials
  if (errorType === 'Forbidden' || errorType === 'AuthenticationError' ||
    message.toLowerCase().includes('forbidden') || message.toLowerCase().includes('unauthorized')) {
    return new Error(
      `${message}\nHint: Check your Linear API key or OAuth token permissions.`
    );
  }

  // Network errors
  if (errorType === 'NetworkError' || message.toLowerCase().includes('network')) {
    return new Error(
      `Network error while communicating with Linear API.\nHint: Check your internet connection and try again.`
    );
  }

  // Internal server errors
  if (errorType === 'InternalError' || (error?.status >= 500 && error?.status < 600)) {
    return new Error(
      `Linear API server error (${error?.status || 'unknown'}).\nHint: Linear may be experiencing issues. Try again later.`
    );
  }

  // Generic Linear API error
  if (isLinearError(error)) {
    return new Error(
      `Linear API error: ${message}`
    );
  }

  // Unknown error - wrap if not already an Error
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Wrap an async function with Linear-specific error handling
 * @param {Function} fn - Async function to wrap
 * @param {string} operation - Description of the operation for error messages
 * @returns {Promise<*>} Result of the wrapped function
 */
async function withLinearErrorHandling(fn, operation = 'Linear API operation') {
  try {
    return await fn();
  } catch (error) {
    if (isLinearError(error)) {
      const formatted = formatLinearError(error);
      debug(`${operation} failed with Linear error`, {
        originalError: error?.message,
        errorType: error?.type,
        formattedMessage: formatted.message,
      });
      throw formatted;
    }
    throw error;
  }
}

/**
 * Wrap a handler function with comprehensive error handling for Linear API errors.
 * This provides user-friendly error messages for rate limits, auth issues, etc.
 * Use this in the execute() functions of tool handlers.
 *
 * @param {Function} fn - Async handler function to wrap
 * @param {string} operation - Description of the operation for error messages
 * @returns {Promise<*>} Result of the wrapped function
 * @example
 * ```js
 * export async function executeIssueList(client, params) {
 *   return withHandlerErrorHandling(async () => {
 *     // ... implementation
 *   }, 'executeIssueList');
 * }
 * ```
 */
export async function withHandlerErrorHandling(fn, operation = 'Handler') {
  return withLinearErrorHandling(async () => {
    try {
      return await fn();
    } catch (error) {
      // Log additional context for unexpected errors
      debug(`${operation} failed unexpectedly`, {
        error: error?.message,
        stack: error?.stack,
      });
      throw error;
    }
  }, operation);
}

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

  const issueUrlMatch = value.match(/\/issue\/([A-Za-z0-9]+-\d+)(?:[/?#]|$)/i);
  if (issueUrlMatch?.[1]) {
    return issueUrlMatch[1].toUpperCase();
  }

  return value;
}

function extractProjectLookupValue(projectRef) {
  const ref = String(projectRef || '').trim();
  if (!ref) {
    return '';
  }

  const projectUrlMatch = ref.match(/\/project\/([^/?#]+)/i);
  if (projectUrlMatch?.[1]) {
    return projectUrlMatch[1];
  }

  return ref;
}

function getProjectLookupCandidates(projectRef) {
  const lookupValue = extractProjectLookupValue(projectRef);
  const candidates = new Set([lookupValue]);

  if (lookupValue.includes('-')) {
    const slugSuffix = lookupValue.split('-').pop();
    if (slugSuffix) {
      candidates.add(slugSuffix);
    }
  }

  return Array.from(candidates).filter(Boolean);
}

const PROJECT_UPDATE_HEALTH_VALUES = ['onTrack', 'atRisk', 'offTrack'];

function normalizePositiveInteger(value, fieldName, defaultValue) {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${fieldName} must be a positive integer`);
  }

  return parsed;
}

function normalizeProjectUpdateHealth(value) {
  if (value === undefined) {
    return undefined;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    throw new Error(`health must be one of: ${PROJECT_UPDATE_HEALTH_VALUES.join(', ')}`);
  }

  if (!PROJECT_UPDATE_HEALTH_VALUES.includes(normalized)) {
    throw new Error(`health must be one of: ${PROJECT_UPDATE_HEALTH_VALUES.join(', ')}`);
  }

  return normalized;
}

const ISSUE_PRIORITY_NAMES = ['No priority', 'Urgent', 'High', 'Medium', 'Low'];
const ISSUE_PRIORITY_ALIASES = Object.freeze({
  none: 0,
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
});
const ISSUE_PRIORITY_MAPPING_DESCRIPTION = '0=None, 1=Urgent, 2=High, 3=Medium, 4=Low';
const ISSUE_PRIORITY_ALIAS_DESCRIPTION = Object.keys(ISSUE_PRIORITY_ALIASES).join(', ');

function parseIssuePriority(value) {
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= 0 && value <= 4) {
      return value;
    }
  } else if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(ISSUE_PRIORITY_ALIASES, normalized)) {
      return ISSUE_PRIORITY_ALIASES[normalized];
    }
    if (/^[0-4]$/.test(normalized)) {
      return Number(normalized);
    }
  }

  throw new Error(
    `Invalid priority: ${value}. Use Linear priority ${ISSUE_PRIORITY_MAPPING_DESCRIPTION}, or one of: ${ISSUE_PRIORITY_ALIAS_DESCRIPTION}.`
  );
}

function formatPriorityLabel(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return String(value);
  }

  return ISSUE_PRIORITY_NAMES[numeric] || `Priority ${numeric}`;
}

function getUserDisplayName(user) {
  return user?.displayName || user?.name || 'Unknown';
}

function summarizeIssueHistoryEntry(entry) {
  if (entry.fromState?.name || entry.toState?.name) {
    if (entry.fromState?.name && entry.toState?.name) {
      return `moved state from ${entry.fromState.name} to ${entry.toState.name}`;
    }
    if (entry.toState?.name) {
      return `set state to ${entry.toState.name}`;
    }
    return `cleared state ${entry.fromState.name}`;
  }

  if (entry.fromAssignee || entry.toAssignee) {
    const fromAssignee = entry.fromAssignee ? getUserDisplayName(entry.fromAssignee) : null;
    const toAssignee = entry.toAssignee ? getUserDisplayName(entry.toAssignee) : null;
    if (fromAssignee && toAssignee) {
      return `reassigned from ${fromAssignee} to ${toAssignee}`;
    }
    if (toAssignee) {
      return `assigned to ${toAssignee}`;
    }
    return `unassigned from ${fromAssignee}`;
  }

  if (entry.fromTitle || entry.toTitle) {
    if (entry.fromTitle && entry.toTitle) {
      return `renamed issue from "${entry.fromTitle}" to "${entry.toTitle}"`;
    }
    if (entry.toTitle) {
      return `set title to "${entry.toTitle}"`;
    }
  }

  if (entry.fromPriority !== undefined || entry.toPriority !== undefined) {
    const fromPriority = formatPriorityLabel(entry.fromPriority);
    const toPriority = formatPriorityLabel(entry.toPriority);
    if (fromPriority && toPriority) {
      return `changed priority from ${fromPriority} to ${toPriority}`;
    }
    if (toPriority) {
      return `set priority to ${toPriority}`;
    }
  }

  if (entry.fromProject?.name || entry.toProject?.name) {
    if (entry.fromProject?.name && entry.toProject?.name) {
      return `moved project from ${entry.fromProject.name} to ${entry.toProject.name}`;
    }
    if (entry.toProject?.name) {
      return `added to project ${entry.toProject.name}`;
    }
    return `removed from project ${entry.fromProject.name}`;
  }

  if (entry.fromProjectMilestone?.name || entry.toProjectMilestone?.name) {
    if (entry.fromProjectMilestone?.name && entry.toProjectMilestone?.name) {
      return `moved milestone from ${entry.fromProjectMilestone.name} to ${entry.toProjectMilestone.name}`;
    }
    if (entry.toProjectMilestone?.name) {
      return `set milestone to ${entry.toProjectMilestone.name}`;
    }
    return `cleared milestone ${entry.fromProjectMilestone.name}`;
  }

  if ((entry.addedLabels?.length || 0) > 0 || (entry.removedLabels?.length || 0) > 0) {
    const labelChanges = [];
    if ((entry.addedLabels?.length || 0) > 0) {
      labelChanges.push(`added labels ${entry.addedLabels.map((label) => label.name).join(', ')}`);
    }
    if ((entry.removedLabels?.length || 0) > 0) {
      labelChanges.push(`removed labels ${entry.removedLabels.map((label) => label.name).join(', ')}`);
    }
    return labelChanges.join('; ');
  }

  if ((entry.relationChanges?.length || 0) > 0) {
    const relationSummary = entry.relationChanges
      .map((relation) => `${relation.type} ${relation.identifier}`)
      .join(', ');
    return `updated relations: ${relationSummary}`;
  }

  if (entry.updatedDescription) {
    return 'updated description';
  }

  if (entry.attachment?.title || entry.attachment?.url) {
    return `linked attachment ${entry.attachment.title ? `"${entry.attachment.title}"` : entry.attachment.url}`;
  }

  if (entry.archivedAt || entry.archived === true) {
    return entry.autoArchived ? 'auto-archived issue' : 'archived issue';
  }

  if (entry.autoClosed) {
    return 'auto-closed issue';
  }

  if (entry.trashed === true) {
    return 'trashed issue';
  }

  if (entry.trashed === false) {
    return 'restored issue from trash';
  }

  return 'updated issue';
}

/**
 * Safely resolve a lazy-loaded relation without triggering unnecessary API calls
 * Only fetches if the relation is already cached or if we have minimal data
 */
async function safeResolveRelation(sdkIssue, relationKey) {
  try {
    const relation = sdkIssue[relationKey];
    if (!relation) return null;

    // If it's a function (lazy loader), check if we can call it safely
    if (typeof relation === 'function') {
      const result = await relation().catch(() => null);
      return result || null;
    }

    // If it's already resolved, return it
    return relation;
  } catch {
    return null;
  }
}

/**
 * Transform SDK issue object to plain object for consumers
 * Optimized to minimize API calls by avoiding unnecessary lazy loads
 */
async function transformIssue(sdkIssue) {
  if (!sdkIssue) return null;

  // If the SDK issue has _data, relations might already be available
  // Check if we can extract data without making extra calls
  const hasRelations = sdkIssue.state?.id || sdkIssue.assignee?.id || sdkIssue.project?.id;

  // Only resolve relations if not already available
  let state = null;
  let team = null;
  let project = null;
  let assignee = null;
  let projectMilestone = null;

  if (sdkIssue.state?.id) {
    state = sdkIssue.state;
  } else if (sdkIssue._data?.state) {
    state = { id: sdkIssue._data.state?.id, name: sdkIssue._data.state?.name, type: sdkIssue._data.state?.type };
  }

  if (sdkIssue.team?.id) {
    team = sdkIssue.team;
  } else if (sdkIssue._data?.team) {
    team = { id: sdkIssue._data.team?.id, key: sdkIssue._data.team?.key, name: sdkIssue._data.team?.name };
  }

  if (sdkIssue.project?.id) {
    project = sdkIssue.project;
  } else if (sdkIssue._data?.project) {
    project = { id: sdkIssue._data.project?.id, name: sdkIssue._data.project?.name };
  }

  if (sdkIssue.assignee?.id) {
    assignee = sdkIssue.assignee;
  } else if (sdkIssue._data?.assignee) {
    assignee = { id: sdkIssue._data.assignee?.id, name: sdkIssue._data.assignee?.name, displayName: sdkIssue._data.assignee?.displayName };
  }

  if (sdkIssue.projectMilestone?.id) {
    projectMilestone = sdkIssue.projectMilestone;
  } else if (sdkIssue._data?.projectMilestone) {
    projectMilestone = { id: sdkIssue._data.projectMilestone?.id, name: sdkIssue._data.projectMilestone?.name };
  }

  // Only trigger lazy loads if we don't have data from cache
  const needsLazyLoad = !state && !team && !project && !assignee && !projectMilestone;

  if (needsLazyLoad) {
    // Use Promise.all with small timeout to avoid blocking
    const [resolvedState, resolvedTeam, resolvedProject, resolvedAssignee, resolvedMilestone] = await Promise.all([
      safeResolveRelation(sdkIssue, 'state'),
      safeResolveRelation(sdkIssue, 'team'),
      safeResolveRelation(sdkIssue, 'project'),
      safeResolveRelation(sdkIssue, 'assignee'),
      safeResolveRelation(sdkIssue, 'projectMilestone'),
    ]);

    state = state || resolvedState;
    team = team || resolvedTeam;
    project = project || resolvedProject;
    assignee = assignee || resolvedAssignee;
    projectMilestone = projectMilestone || resolvedMilestone;
  }

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
    projectMilestone: projectMilestone ? { id: projectMilestone.id, name: projectMilestone.name } : null,
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

function resolveProjectMilestoneIdFromInput(milestones, milestoneInput) {
  const target = String(milestoneInput || '').trim();
  if (!target) return null;

  const byId = milestones.find((m) => m.id === target);
  if (byId) return byId.id;

  const lower = target.toLowerCase();
  const byName = milestones.find((m) => String(m.name || '').toLowerCase() === lower);
  if (byName) return byName.id;

  throw new Error(`Milestone not found in project: ${target}`);
}

/**
 * Resolve a milestone reference (name or ID) to a milestone object with id and name.
 * Requires project context to search for milestones by name.
 * @param {LinearClient} client - Linear SDK client
 * @param {string} milestoneRef - Milestone name or ID
 * @param {string} projectId - Project ID to search within
 * @returns {Promise<{id: string, name: string}>}
 */
export async function resolveMilestoneRef(client, milestoneRef, projectId) {
  const ref = String(milestoneRef || '').trim();
  if (!ref) {
    throw new Error('Missing milestone reference');
  }

  // If it's already a Linear ID (UUID format with 16+ hex chars), try to fetch it directly
  if (/^[0-9a-fA-F-]{16,}$/.test(ref)) {
    try {
      const milestone = await client.projectMilestone(ref);
      if (milestone) {
        return { id: milestone.id, name: milestone.name };
      }
    } catch {
      // fall through to name lookup
    }
    throw new Error(`Milestone not found: ${ref}`);
  }

  // Search by name in the project's milestones
  const milestones = await fetchProjectMilestones(client, projectId);

  // Try exact name match first
  const exactMatch = milestones.find((m) => m.name === ref);
  if (exactMatch) {
    return { id: exactMatch.id, name: exactMatch.name };
  }

  // Try case-insensitive match
  const lowerRef = ref.toLowerCase();
  const caseInsensitiveMatch = milestones.find((m) => m.name?.toLowerCase() === lowerRef);
  if (caseInsensitiveMatch) {
    return { id: caseInsensitiveMatch.id, name: caseInsensitiveMatch.name };
  }

  throw new Error(`Milestone not found: ${ref}. Available milestones: ${milestones.map((m) => m.name).join(', ')}`);
}

function normalizeIssueRefList(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v || '').trim()).filter(Boolean);
  }
  return String(value)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

// ===== QUERY FUNCTIONS =====

/**
 * Fetch the current authenticated viewer
 * @param {LinearClient} client - Linear SDK client
 * @returns {Promise<{id: string, name: string}>}
 */
export async function fetchViewer(client) {
  return withLinearErrorHandling(async () => {
    const cacheKey = getClientCacheKey(client);
    const cached = getCache(viewerCache, cacheKey);
    if (cached) return cached;

    const viewer = await client.viewer;
    const result = {
      id: viewer.id,
      name: viewer.name,
      displayName: viewer.displayName,
    };

    setCache(viewerCache, cacheKey, result, CACHE_TTL_MS.viewer);
    return result;
  }, 'fetchViewer');
}

export const getViewer = fetchViewer;

/**
 * Fetch issues in specific states, optionally filtered by assignee
 * OPTIMIZED: Uses rawRequest with custom GraphQL to fetch all relations in ONE request
 * @param {LinearClient} client - Linear SDK client
 * @param {string|null} assigneeId - Assignee ID to filter by (null = all assignees)
 * @param {Array<string>} openStates - List of state names to include
 * @param {number} limit - Maximum number of issues to fetch
 * @returns {Promise<{issues: Array, truncated: boolean}>}
 */
export async function fetchIssues(client, assigneeId, openStates, limit) {
  return withLinearErrorHandling(async () => {
    const filter = {
      state: { name: { in: openStates } },
    };

    if (assigneeId) {
      filter.assignee = { id: { eq: assigneeId } };
    }

    // Use optimized rawRequest to fetch issues with ALL relations in ONE request
    const { data } = await executeOptimizedQuery(client, ISSUES_WITH_RELATIONS_QUERY, {
      first: limit,
      filter,
    });

    const nodes = data?.issues?.nodes || [];
    const pageInfo = data?.issues?.pageInfo;
    const hasNextPage = pageInfo?.hasNextPage ?? false;

    // Transform raw GraphQL response directly - no lazy loading needed
    const issues = nodes.map(transformRawIssue);

    debug('Fetched issues (optimized)', {
      issueCount: issues.length,
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
  }, 'fetchIssues');
}

/**
 * Fetch issues by project and optional state filter
 * OPTIMIZED: Uses rawRequest with custom GraphQL to fetch all relations in ONE request
 * instead of N+1 requests (1 for list + 5 per issue for lazy-loaded relations)
 * @param {LinearClient} client - Linear SDK client
 * @param {string} projectId - Project ID to filter by
 * @param {Array<string>|null} states - List of state names to include (null = all states)
 * @param {Object} options
 * @param {string|null} options.assigneeId - Assignee ID to filter by (null = all assignees)
 * @param {string|null} options.teamId - Team ID to filter by (null = all teams)
 * @param {number} options.limit - Maximum number of issues to fetch
 * @returns {Promise<{issues: Array, truncated: boolean}>}
 */
export async function fetchIssuesByProject(client, projectId, states, options = {}) {
  return withLinearErrorHandling(async () => {
    const { assigneeId = null, teamId = null, limit = 20 } = options;

    const filter = {
      project: { id: { eq: projectId } },
    };

    if (states && states.length > 0) {
      filter.state = { name: { in: states } };
    }

    if (assigneeId) {
      filter.assignee = { id: { eq: assigneeId } };
    }

    if (teamId) {
      filter.team = { id: { eq: teamId } };
    }

    // Use optimized rawRequest to fetch issues with ALL relations in ONE request
    // This eliminates the N+1 problem where each issue triggered 5 additional API calls
    const { data } = await executeOptimizedQuery(client, ISSUES_WITH_RELATIONS_QUERY, {
      first: limit,
      filter,
    });

    const nodes = data?.issues?.nodes || [];
    const pageInfo = data?.issues?.pageInfo;
    const hasNextPage = pageInfo?.hasNextPage ?? false;

    // Transform raw GraphQL response directly - no lazy loading needed
    const issues = nodes.map(transformRawIssue);

    debug('Fetched issues by project (optimized)', {
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
  }, 'fetchIssuesByProject');
}

/**
 * Fetch all accessible projects from Linear API
 * @param {LinearClient} client - Linear SDK client
 * @param {{ includeArchived?: boolean }} options - Fetch options
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function fetchProjects(client, options = {}) {
  return withLinearErrorHandling(async () => {
    const { includeArchived = false, forceGraphql = false } = options;
    const cacheKey = getClientCacheKey(client);
    const scopedCacheKey = `${cacheKey}::projects::${includeArchived ? 'all' : 'active'}::${forceGraphql ? 'graphql' : 'sdk'}`;
    const cached = getCache(projectsCache, scopedCacheKey);
    if (cached) return cached;

    let nodes = [];
    if (includeArchived || forceGraphql) {
      const data = await executeGraphQL(client, PROJECTS_LOOKUP_QUERY, {
        includeArchived,
      });
      nodes = data?.projects?.nodes ?? [];
    } else {
      const result = await client.projects();
      nodes = result.nodes ?? [];
    }

    debug('Fetched Linear projects', {
      projectCount: nodes.length,
      includeArchived,
      projects: nodes.map((p) => ({ id: p.id, name: p.name })),
    });

    const projects = nodes.map((p) => ({
      id: p.id,
      name: p.name,
      slugId: p.slugId ?? null,
      archivedAt: p.archivedAt ?? null,
    }));
    setCache(projectsCache, scopedCacheKey, projects, CACHE_TTL_MS.projects);
    return projects;
  }, 'fetchProjects');
}

export async function fetchProjectDetails(client, projectRef, options = {}) {
  return withLinearErrorHandling(async () => {
    const { milestoneLimit = 10 } = options;
    const ref = String(projectRef || '').trim();
    const projectId = isLinearId(ref)
      ? ref
      : (await resolveProjectRef(client, ref)).id;
    const data = await executeGraphQL(client, PROJECT_DETAILS_QUERY, {
      id: projectId,
      milestoneLimit,
    });

    if (!data?.project) {
      throw new Error(`Project not found: ${projectRef}`);
    }

    return transformProject(data.project);
  }, 'fetchProjectDetails');
}

/**
 * Fetch available workspaces (organization context) from Linear API
 * @param {LinearClient} client - Linear SDK client
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function fetchWorkspaces(client) {
  return withLinearErrorHandling(async () => {
    const viewer = await client.viewer;
    const organization = await (viewer?.organization?.catch?.(() => null) ?? viewer?.organization ?? null);

    if (!organization) {
      debug('No organization available from viewer context');
      return [];
    }

    const workspace = { id: organization.id, name: organization.name || organization.urlKey || 'Workspace' };

    debug('Fetched Linear workspace from viewer organization', {
      workspace,
    });

    return [workspace];
  }, 'fetchWorkspaces');
}

/**
 * Fetch all accessible teams from Linear API
 * @param {LinearClient} client - Linear SDK client
 * @returns {Promise<Array<{id: string, key: string, name: string}>>}
 */
export async function fetchTeams(client) {
  return withLinearErrorHandling(async () => {
    const cacheKey = getClientCacheKey(client);
    const cached = getCache(teamsCache, cacheKey);
    if (cached) return cached;

    const result = await client.teams();
    const nodes = result.nodes ?? [];

    debug('Fetched Linear teams', {
      teamCount: nodes.length,
      teams: nodes.map((t) => ({ id: t.id, key: t.key, name: t.name })),
    });

    const teams = nodes.map(t => ({ id: t.id, key: t.key, name: t.name }));
    setCache(teamsCache, cacheKey, teams, CACHE_TTL_MS.teams);
    return teams;
  }, 'fetchTeams');
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

  // If it looks like a Linear ID (UUID), try a minimal GraphQL lookup first.
  if (isLinearId(ref)) {
    try {
      const direct = await fetchTeamMinimal(client, ref);
      if (direct) {
        return direct;
      }
    } catch {
      // fall back to cached/full-team lookup below
    }

    const teams = await fetchTeams(client);
    const byId = teams.find((t) => t.id === ref);
    if (byId) {
      return byId;
    }
    throw new Error(`Team not found with ID: ${ref}`);
  }

  const teams = await fetchTeams(client);

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
  return withLinearErrorHandling(async () => {
    const lookup = normalizeIssueLookupInput(issueRef);

    try {
      const issue = await fetchIssueMinimal(client, lookup);
      if (issue) {
        return issue;
      }
    } catch {
      // Fall through to not-found error below
    }

    throw new Error(`Issue not found: ${lookup}`);
  }, 'resolveIssue');
}

/**
 * Get workflow states for a team
 * @param {LinearClient} client - Linear SDK client
 * @param {string} teamRef - Team ID or key
 * @returns {Promise<Array<{id: string, name: string, type: string}>>}
 */
export async function getTeamWorkflowStates(client, teamRef) {
  return withLinearErrorHandling(async () => {
    const cacheKey = `${getClientCacheKey(client)}::${teamRef}`;
    const cached = getCache(teamStatesCache, cacheKey);
    if (cached) return cached;

    const mapped = await fetchTeamStatesByQuery(client, teamRef);
    if (!mapped) {
      throw new Error(`Team not found: ${teamRef}`);
    }

    setCache(teamStatesCache, cacheKey, mapped, CACHE_TTL_MS.teamStates);
    return mapped;
  }, 'getTeamWorkflowStates');
}

/**
 * Resolve a project reference (name or ID) to a project object
 * @param {LinearClient} client - Linear SDK client
 * @param {string} projectRef - Project name or ID
 * @param {{ includeArchived?: boolean }} options - Lookup options
 * @returns {Promise<{id: string, name: string}>}
 */
export async function resolveProjectRef(client, projectRef, options = {}) {
  const ref = String(projectRef || '').trim();
  const { includeArchived = false } = options;
  if (!ref) {
    throw new Error('Missing project reference');
  }

  // If it looks like a Linear ID (UUID), try a minimal GraphQL lookup first.
  if (isLinearId(ref)) {
    try {
      const direct = await fetchProjectMinimal(client, ref);
      if (direct) {
        return direct;
      }
    } catch {
      // fall back to cached/full-project lookup below
    }

    const projectsById = await fetchProjects(client, { includeArchived });
    const byId = projectsById.find((p) => p.id === ref);
    if (byId) {
      return byId;
    }
    throw new Error(`Project not found with ID: ${ref}`);
  }

  const lookupCandidates = getProjectLookupCandidates(ref);
  const lookupValue = lookupCandidates[0] || ref;
  const shouldUseGraphqlLookup = lookupValue !== ref;
  const projects = await fetchProjects(client, {
    includeArchived,
    forceGraphql: shouldUseGraphqlLookup,
  });

  // Try exact name match
  const exactName = projects.find((p) => p.name === ref);
  if (exactName) {
    return exactName;
  }

  // Try exact slug match
  const exactSlug = projects.find((p) => lookupCandidates.includes(p.slugId));
  if (exactSlug) {
    return exactSlug;
  }

  // Try case-insensitive name match
  const lowerRef = ref.toLowerCase();
  const insensitiveName = projects.find((p) => p.name?.toLowerCase() === lowerRef);
  if (insensitiveName) {
    return insensitiveName;
  }

  // Try case-insensitive slug match
  const lowerLookupValues = lookupCandidates.map((candidate) => candidate.toLowerCase());
  const insensitiveSlug = projects.find((p) => p.slugId && lowerLookupValues.includes(p.slugId.toLowerCase()));
  if (insensitiveSlug) {
    return insensitiveSlug;
  }

  throw new Error(`Project not found: ${ref}. Available projects: ${projects.map((p) => p.name).join(', ')}`);
}

export async function createProject(client, input) {
  return withLinearErrorHandling(async () => {
    const name = String(input.name || '').trim();
    if (!name) {
      throw new Error('Missing required field: name');
    }

    const teamIds = Array.isArray(input.teamIds)
      ? input.teamIds.map((value) => String(value || '').trim()).filter(Boolean)
      : [];

    if (teamIds.length === 0) {
      throw new Error('Missing required field: teamIds');
    }

    const createInput = {
      name,
      teamIds,
    };

    for (const field of ['description', 'color', 'icon', 'leadId', 'startDate', 'targetDate']) {
      if (input[field] !== undefined) {
        createInput[field] = input[field];
      }
    }

    if (input.priority !== undefined) {
      createInput.priority = input.priority;
    }

    const payload = await executeGraphQL(client, PROJECT_CREATE_MUTATION, {
      input: createInput,
    });

    if (!payload?.projectCreate?.success || !payload?.projectCreate?.project?.id) {
      throw new Error('Failed to create project');
    }

    invalidateProjectsCache(client);
    return fetchProjectDetails(client, payload.projectCreate.project.id);
  }, 'createProject');
}

export async function updateProject(client, projectRef, patch = {}) {
  return withLinearErrorHandling(async () => {
    const resolved = await resolveProjectRef(client, projectRef);
    const updateInput = {};

    for (const field of ['name', 'description', 'content', 'color', 'icon', 'startDate', 'targetDate']) {
      if (patch[field] !== undefined) {
        updateInput[field] = patch[field];
      }
    }

    if (patch.priority !== undefined) {
      updateInput.priority = patch.priority;
    }

    if (patch.leadId !== undefined) {
      updateInput.leadId = patch.leadId;
    }

    if (patch.teamIds !== undefined) {
      updateInput.teamIds = patch.teamIds;
    }

    if (Object.keys(updateInput).length === 0) {
      throw new Error('No update fields provided');
    }

    const payload = await executeGraphQL(client, PROJECT_UPDATE_MUTATION, {
      id: resolved.id,
      input: updateInput,
    });

    if (!payload?.projectUpdate?.success || !payload?.projectUpdate?.project?.id) {
      throw new Error('Failed to update project');
    }

    invalidateProjectsCache(client);
    const project = await fetchProjectDetails(client, payload.projectUpdate.project.id);

    return {
      project,
      changed: Object.keys(updateInput),
    };
  }, 'updateProject');
}

export async function deleteProject(client, projectRef) {
  return withLinearErrorHandling(async () => {
    const resolved = await resolveProjectRef(client, projectRef);
    const payload = await executeGraphQL(client, PROJECT_DELETE_MUTATION, {
      id: resolved.id,
    });

    if (!payload?.projectDelete?.success) {
      throw new Error('Failed to delete project');
    }

    invalidateProjectsCache(client);

    return {
      success: true,
      projectId: resolved.id,
      name: resolved.name,
      entity: transformProject(payload.projectDelete.entity),
    };
  }, 'deleteProject');
}

export async function archiveProject(client, projectRef) {
  return withLinearErrorHandling(async () => {
    const resolved = await resolveProjectRef(client, projectRef);
    const payload = await executeGraphQL(client, PROJECT_ARCHIVE_MUTATION, {
      id: resolved.id,
    });

    if (!payload?.projectArchiveResult?.success) {
      throw new Error('Failed to archive project');
    }

    invalidateProjectsCache(client);

    return {
      success: true,
      projectId: resolved.id,
      name: resolved.name,
      entity: transformProject(payload.projectArchiveResult.entity),
    };
  }, 'archiveProject');
}

export async function unarchiveProject(client, projectRef) {
  return withLinearErrorHandling(async () => {
    const ref = String(projectRef || '').trim();
    const resolved = isLinearId(ref)
      ? { id: ref, name: null }
      : await resolveProjectRef(client, ref, { includeArchived: true });

    const payload = await executeGraphQL(client, PROJECT_UNARCHIVE_MUTATION, {
      id: resolved.id,
    });

    if (!payload?.projectUnarchive?.success) {
      throw new Error('Failed to unarchive project');
    }

    invalidateProjectsCache(client);
    const project = await fetchProjectDetails(client, resolved.id);

    return {
      success: true,
      project,
    };
  }, 'unarchiveProject');
}

export async function fetchProjectUpdates(client, projectRef, options = {}) {
  return withLinearErrorHandling(async () => {
    const includeArchived = options.includeArchived === true;
    const limit = normalizePositiveInteger(options.limit, 'limit', 10);
    const resolved = await resolveProjectRef(client, projectRef, { includeArchived });
    const data = await executeGraphQL(client, PROJECT_UPDATES_BY_PROJECT_QUERY, {
      id: resolved.id,
      first: limit,
      includeArchived,
    });

    const nodes = data?.project?.projectUpdates?.nodes || [];
    return {
      project: {
        id: data?.project?.id || resolved.id,
        name: data?.project?.name || resolved.name,
      },
      updates: nodes.map(transformProjectUpdate),
    };
  }, 'fetchProjectUpdates');
}

export async function fetchProjectUpdateDetails(client, projectUpdateId) {
  return withLinearErrorHandling(async () => {
    const id = String(projectUpdateId || '').trim();
    if (!id) {
      throw new Error('Missing required field: projectUpdate');
    }

    const data = await executeGraphQL(client, PROJECT_UPDATE_DETAILS_QUERY, { id });

    if (!data?.projectUpdate) {
      throw new Error(`Project update not found: ${id}`);
    }

    return transformProjectUpdate(data.projectUpdate);
  }, 'fetchProjectUpdateDetails');
}

export async function createProjectUpdate(client, input) {
  return withLinearErrorHandling(async () => {
    const projectId = String(input.projectId || '').trim();
    if (!projectId) {
      throw new Error('Missing required field: projectId');
    }

    const createInput = { projectId };
    if (input.body !== undefined) createInput.body = String(input.body);
    if (input.health !== undefined) createInput.health = normalizeProjectUpdateHealth(input.health);
    if (input.isDiffHidden !== undefined) createInput.isDiffHidden = input.isDiffHidden;

    if (createInput.body === undefined && createInput.health === undefined) {
      throw new Error('At least one of body or health is required');
    }

    const payload = await executeGraphQL(client, PROJECT_UPDATE_CREATE_MUTATION, {
      input: createInput,
    });

    if (!payload?.projectUpdateCreate?.success || !payload?.projectUpdateCreate?.projectUpdate?.id) {
      throw new Error('Failed to create project update');
    }

    return fetchProjectUpdateDetails(client, payload.projectUpdateCreate.projectUpdate.id);
  }, 'createProjectUpdate');
}

export async function updateProjectUpdate(client, projectUpdateId, patch = {}) {
  return withLinearErrorHandling(async () => {
    const id = String(projectUpdateId || '').trim();
    if (!id) {
      throw new Error('Missing required field: projectUpdate');
    }

    const updateInput = {};
    if (patch.body !== undefined) updateInput.body = String(patch.body);
    if (patch.health !== undefined) updateInput.health = normalizeProjectUpdateHealth(patch.health);
    if (patch.isDiffHidden !== undefined) updateInput.isDiffHidden = patch.isDiffHidden;

    if (Object.keys(updateInput).length === 0) {
      throw new Error('No update fields provided');
    }

    const payload = await executeGraphQL(client, PROJECT_UPDATE_UPDATE_MUTATION, {
      id,
      input: updateInput,
    });

    if (!payload?.projectUpdateUpdate?.success || !payload?.projectUpdateUpdate?.projectUpdate?.id) {
      throw new Error('Failed to update project update');
    }

    const projectUpdate = await fetchProjectUpdateDetails(client, payload.projectUpdateUpdate.projectUpdate.id);
    return {
      projectUpdate,
      changed: Object.keys(updateInput),
    };
  }, 'updateProjectUpdate');
}

export async function archiveProjectUpdate(client, projectUpdateId) {
  return withLinearErrorHandling(async () => {
    const id = String(projectUpdateId || '').trim();
    if (!id) {
      throw new Error('Missing required field: projectUpdate');
    }

    const payload = await executeGraphQL(client, PROJECT_UPDATE_ARCHIVE_MUTATION, { id });
    if (!payload?.projectUpdateArchive?.success) {
      throw new Error('Failed to archive project update');
    }

    return {
      success: true,
      projectUpdateId: id,
    };
  }, 'archiveProjectUpdate');
}

export async function unarchiveProjectUpdate(client, projectUpdateId) {
  return withLinearErrorHandling(async () => {
    const id = String(projectUpdateId || '').trim();
    if (!id) {
      throw new Error('Missing required field: projectUpdate');
    }

    const payload = await executeGraphQL(client, PROJECT_UPDATE_UNARCHIVE_MUTATION, { id });
    if (!payload?.projectUpdateUnarchive?.success) {
      throw new Error('Failed to unarchive project update');
    }

    const projectUpdate = await fetchProjectUpdateDetails(client, id);
    return {
      success: true,
      projectUpdate,
    };
  }, 'unarchiveProjectUpdate');
}

export async function fetchDocumentDetails(client, documentRef) {
  return withLinearErrorHandling(async () => {
    const id = String(documentRef || '').trim();
    if (!id) {
      throw new Error('Missing required field: document');
    }

    const data = await executeGraphQL(client, DOCUMENT_DETAILS_QUERY, { id });

    if (!data?.document) {
      throw new Error(`Document not found: ${id}`);
    }

    return transformDocument(data.document);
  }, 'fetchDocumentDetails');
}

export async function createDocument(client, input = {}) {
  return withLinearErrorHandling(async () => {
    const title = String(input.title || '').trim();
    if (!title) {
      throw new Error('Missing required field: title');
    }

    const createInput = { title };
    if (input.projectId !== undefined) createInput.projectId = input.projectId;
    if (input.issueId !== undefined) createInput.issueId = input.issueId;

    if (!createInput.projectId && !createInput.issueId) {
      throw new Error('Document create requires either projectId or issueId');
    }

    for (const field of ['content', 'icon', 'color']) {
      if (input[field] !== undefined) {
        createInput[field] = input[field];
      }
    }

    const payload = await executeGraphQL(client, DOCUMENT_CREATE_MUTATION, {
      input: createInput,
    });

    if (!payload?.documentCreate?.success || !payload?.documentCreate?.document?.id) {
      throw new Error('Failed to create document');
    }

    return fetchDocumentDetails(client, payload.documentCreate.document.id);
  }, 'createDocument');
}

export async function updateDocument(client, documentRef, patch = {}) {
  return withLinearErrorHandling(async () => {
    const id = String(documentRef || '').trim();
    if (!id) {
      throw new Error('Missing required field: document');
    }

    const updateInput = {};
    for (const field of ['title', 'content', 'icon', 'color', 'projectId', 'issueId']) {
      if (patch[field] !== undefined) {
        updateInput[field] = patch[field];
      }
    }

    if (Object.keys(updateInput).length === 0) {
      throw new Error('No update fields provided');
    }

    const payload = await executeGraphQL(client, DOCUMENT_UPDATE_MUTATION, {
      id,
      input: updateInput,
    });

    if (!payload?.documentUpdate?.success || !payload?.documentUpdate?.document?.id) {
      throw new Error('Failed to update document');
    }

    const document = await fetchDocumentDetails(client, payload.documentUpdate.document.id);
    return {
      document,
      changed: Object.keys(updateInput),
    };
  }, 'updateDocument');
}

/**
 * Fetch detailed issue information including comments, parent, children, and attachments
 * @param {LinearClient} client - Linear SDK client
 * @param {string} issueRef - Issue identifier (ABC-123) or Linear issue ID
 * @param {Object} options
 * @param {boolean} [options.includeComments=true] - Include comments in response
 * @returns {Promise<Object>} Issue details
 */
async function fetchIssueDetailsViaSdk(client, issueRef, options = {}) {
  const { includeComments = true } = options;

  const lookup = normalizeIssueLookupInput(issueRef);
  const sdkIssue = await client.issue(lookup);

  if (!sdkIssue) {
    throw new Error(`Issue not found: ${lookup}`);
  }

  const [
    state,
    team,
    project,
    projectMilestone,
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
    sdkIssue.projectMilestone?.catch?.(() => null) ?? sdkIssue.projectMilestone,
    sdkIssue.assignee?.catch?.(() => null) ?? sdkIssue.assignee,
    sdkIssue.creator?.catch?.(() => null) ?? sdkIssue.creator,
    sdkIssue.labels?.()?.catch?.(() => ({ nodes: [] })) ?? sdkIssue.labels?.() ?? { nodes: [] },
    sdkIssue.parent?.catch?.(() => null) ?? sdkIssue.parent,
    sdkIssue.children?.()?.catch?.(() => ({ nodes: [] })) ?? sdkIssue.children?.() ?? { nodes: [] },
    includeComments ? (sdkIssue.comments?.()?.catch?.(() => ({ nodes: [] })) ?? sdkIssue.comments?.() ?? { nodes: [] }) : Promise.resolve({ nodes: [] }),
    sdkIssue.attachments?.()?.catch?.(() => ({ nodes: [] })) ?? sdkIssue.attachments?.() ?? { nodes: [] },
  ]);

  let transformedParent = null;
  if (parent) {
    const parentState = await parent.state?.catch?.(() => null) ?? parent.state;
    transformedParent = {
      identifier: parent.identifier,
      title: parent.title,
      state: parentState ? { name: parentState.name, color: parentState.color } : null,
    };
  }

  const children = (childrenResult.nodes || []).map(c => ({
    identifier: c.identifier,
    title: c.title,
    state: c.state ? { name: c.state.name, color: c.state.color } : null,
  }));

  const comments = (commentsResult.nodes || []).map(c => ({
    id: c.id,
    body: c.body,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    user: c.user ? { name: c.user.name, displayName: c.user.displayName } : null,
    externalUser: c.externalUser ? { name: c.externalUser.name, displayName: c.externalUser.displayName } : null,
    parent: c.parent ? { id: c.parent.id } : null,
  }));

  const attachments = (attachmentsResult.nodes || []).map(a => ({
    id: a.id,
    title: a.title,
    url: a.url,
    subtitle: a.subtitle,
    sourceType: a.sourceType,
    createdAt: a.createdAt,
  }));

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
    projectMilestone: projectMilestone ? { id: projectMilestone.id, name: projectMilestone.name } : null,
    assignee: assignee ? { id: assignee.id, name: assignee.name, displayName: assignee.displayName } : null,
    creator: creator ? { id: creator.id, name: creator.name, displayName: creator.displayName } : null,
    labels,
    parent: transformedParent,
    children,
    comments,
    attachments,
  };
}

export async function fetchIssueDetails(client, issueRef, options = {}) {
  return withLinearErrorHandling(async () => {
    const { includeComments = true } = options;

    if (!getRawRequest(client)) {
      return fetchIssueDetailsViaSdk(client, issueRef, options);
    }

    const lookup = normalizeIssueLookupInput(issueRef);
    const issueId = isLinearId(lookup)
      ? lookup
      : (await resolveIssue(client, lookup)).id;
    const query = includeComments ? ISSUE_DETAILS_WITH_COMMENTS_QUERY : ISSUE_DETAILS_QUERY;
    const data = await executeGraphQL(client, query, { id: issueId });

    if (!data?.issue) {
      throw new Error(`Issue not found: ${lookup}`);
    }

    return transformRawIssueDetails(data.issue, { includeComments });
  }, 'fetchIssueDetails');
}

function extractMarkdownImages(markdown, source) {
  if (!markdown || typeof markdown !== 'string') return [];

  const images = [];
  const markdownImagePattern = /!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g;
  const htmlImagePattern = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;

  let match;
  while ((match = markdownImagePattern.exec(markdown)) !== null) {
    images.push({ alt: match[1] || null, url: match[2], source });
  }
  while ((match = htmlImagePattern.exec(markdown)) !== null) {
    images.push({ alt: null, url: match[1], source });
  }

  return images;
}

function isImageUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isLinearUploadUrl(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'uploads.linear.app' || hostname.endsWith('.uploads.linear.app');
  } catch {
    return false;
  }
}

function getLinearAuthHeaderValue(client, mode = 'raw') {
  const token = client?.__piLinearTrackerKey || client?.apiKey || null;
  if (!token || token === 'default') return null;
  return mode === 'bearer' ? `Bearer ${token}` : token;
}

async function fetchImageUrl(client, url, options = {}) {
  const { maxBytes = 10 * 1024 * 1024 } = options;
  const attempts = [{ headers: {} }];

  if (isLinearUploadUrl(url)) {
    const rawAuth = getLinearAuthHeaderValue(client, 'raw');
    const bearerAuth = getLinearAuthHeaderValue(client, 'bearer');
    if (rawAuth) attempts.push({ headers: { authorization: rawAuth } });
    if (bearerAuth) attempts.push({ headers: { authorization: bearerAuth } });
  }

  let lastError = null;
  for (const attempt of attempts) {
    try {
      const response = await fetch(url, { headers: attempt.headers, redirect: 'follow' });
      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status} ${response.statusText}`);
        continue;
      }

      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      if (!contentType.toLowerCase().startsWith('image/')) {
        lastError = new Error(`URL did not return an image (content-type: ${contentType})`);
        continue;
      }

      const contentLength = Number(response.headers.get('content-length') || 0);
      if (contentLength > maxBytes) {
        throw new Error(`Image is too large (${contentLength} bytes, max ${maxBytes})`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > maxBytes) {
        throw new Error(`Image is too large (${buffer.length} bytes, max ${maxBytes})`);
      }

      return {
        data: buffer.toString('base64'),
        mimeType: contentType.split(';')[0].trim() || 'application/octet-stream',
        sizeBytes: buffer.length,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Failed to fetch image');
}

export async function fetchIssueImages(client, issueRef, options = {}) {
  return withLinearErrorHandling(async () => {
    const { includeComments = true, limit = 10, maxBytes = 10 * 1024 * 1024 } = options;
    const issueData = await fetchIssueDetails(client, issueRef, { includeComments });
    const candidates = [];

    candidates.push(...extractMarkdownImages(issueData.description, 'description'));
    if (includeComments) {
      for (const comment of issueData.comments || []) {
        candidates.push(...extractMarkdownImages(comment.body, `comment:${comment.id}`));
      }
    }

    const seen = new Set();
    const uniqueCandidates = candidates
      .filter((candidate) => candidate.url && isImageUrl(candidate.url))
      .filter((candidate) => {
        if (seen.has(candidate.url)) return false;
        seen.add(candidate.url);
        return true;
      })
      .slice(0, limit);

    const images = [];
    const failures = [];
    for (const candidate of uniqueCandidates) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const image = await fetchImageUrl(client, candidate.url, { maxBytes });
        images.push({ ...candidate, ...image });
      } catch (error) {
        failures.push({ ...candidate, error: error?.message || String(error) });
      }
    }

    return {
      issue: {
        identifier: issueData.identifier,
        title: issueData.title,
        url: issueData.url,
      },
      images,
      failures,
      totalCandidates: candidates.length,
    };
  }, 'fetchIssueImages');
}

export async function fetchIssueActivity(client, issueRef, options = {}) {
  return withLinearErrorHandling(async () => {
    const limit = normalizePositiveInteger(options.limit, 'limit', 20);
    const includeArchived = options.includeArchived === true;
    const resolved = await resolveIssue(client, issueRef);
    const data = await executeGraphQL(client, ISSUE_ACTIVITY_QUERY, {
      id: resolved.id,
      first: limit,
      includeArchived,
    });

    if (!data?.issue) {
      throw new Error(`Issue not found: ${issueRef}`);
    }

    return {
      issue: {
        id: data.issue.id,
        identifier: data.issue.identifier,
        title: data.issue.title,
        url: data.issue.url ?? null,
      },
      activity: (data.issue.history?.nodes || []).map((entry) => ({
        id: entry.id,
        createdAt: entry.createdAt ?? null,
        updatedAt: entry.updatedAt ?? null,
        actor: entry.actor ? {
          id: entry.actor.id,
          name: entry.actor.name,
          displayName: entry.actor.displayName,
        } : null,
        fromState: entry.fromState ? { id: entry.fromState.id, name: entry.fromState.name } : null,
        toState: entry.toState ? { id: entry.toState.id, name: entry.toState.name } : null,
        fromAssignee: entry.fromAssignee ? {
          id: entry.fromAssignee.id,
          name: entry.fromAssignee.name,
          displayName: entry.fromAssignee.displayName,
        } : null,
        toAssignee: entry.toAssignee ? {
          id: entry.toAssignee.id,
          name: entry.toAssignee.name,
          displayName: entry.toAssignee.displayName,
        } : null,
        fromTitle: entry.fromTitle ?? null,
        toTitle: entry.toTitle ?? null,
        fromPriority: entry.fromPriority ?? null,
        toPriority: entry.toPriority ?? null,
        fromProject: entry.fromProject ? { id: entry.fromProject.id, name: entry.fromProject.name } : null,
        toProject: entry.toProject ? { id: entry.toProject.id, name: entry.toProject.name } : null,
        fromProjectMilestone: entry.fromProjectMilestone ? { id: entry.fromProjectMilestone.id, name: entry.fromProjectMilestone.name } : null,
        toProjectMilestone: entry.toProjectMilestone ? { id: entry.toProjectMilestone.id, name: entry.toProjectMilestone.name } : null,
        addedLabels: (entry.addedLabels || []).map((label) => ({ id: label.id, name: label.name })),
        removedLabels: (entry.removedLabels || []).map((label) => ({ id: label.id, name: label.name })),
        relationChanges: (entry.relationChanges || []).map((relation) => ({
          identifier: relation.identifier,
          type: relation.type,
        })),
        attachment: entry.attachment ? {
          id: entry.attachment.id,
          title: entry.attachment.title,
          url: entry.attachment.url,
        } : null,
        archived: entry.archived ?? null,
        archivedAt: entry.archivedAt ?? null,
        autoArchived: entry.autoArchived ?? false,
        autoClosed: entry.autoClosed ?? false,
        trashed: entry.trashed ?? null,
        updatedDescription: entry.updatedDescription ?? false,
      })),
    };
  }, 'fetchIssueActivity');
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
  return withLinearErrorHandling(async () => {
    const updated = await performIssueUpdate(client, issueId, { stateId });
    if (updated) {
      return updated;
    }

    const refreshed = await fetchIssueMinimalById(client, issueId);
    if (!refreshed) {
      throw new Error(`Issue not found: ${issueId}`);
    }

    return refreshed;
  }, 'setIssueState');
}

/**
 * Create a new issue
 * @param {LinearClient} client - Linear SDK client
 * @param {Object} input - Issue creation input
 * @param {string} input.teamId - Team ID (required)
 * @param {string} input.title - Issue title (required)
 * @param {string} [input.description] - Issue description
 * @param {string} [input.projectId] - Project ID
 * @param {number|string} [input.priority] - Issue priority: 0=None, 1=Urgent, 2=High, 3=Medium, 4=Low; or none/urgent/high/medium/low
 * @param {string} [input.assigneeId] - Assignee ID
 * @param {string} [input.parentId] - Parent issue ID for sub-issues
 * @returns {Promise<Object>} Created issue
 */
export async function createIssue(client, input) {
  return withLinearErrorHandling(async () => {
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
      createInput.priority = parseIssuePriority(input.priority);
    }

    if (input.estimate !== undefined) {
      const parsed = Number.parseInt(String(input.estimate), 10);
      if (Number.isNaN(parsed) || parsed < 0) {
        throw new Error(`Invalid estimate: ${input.estimate}. Must be a non-negative integer.`);
      }
      createInput.estimate = parsed;
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

    if (getRawRequest(client)) {
      const payload = await executeGraphQL(client, ISSUE_CREATE_MUTATION, { input: createInput });
      if (!payload?.issueCreate?.success) {
        throw new Error('Failed to create issue');
      }

      const createdIssue = transformRawIssue(payload.issueCreate.issue ?? null);
      if (createdIssue) {
        return createdIssue;
      }
    } else {
      const result = await client.createIssue(createInput);

      if (!result.success) {
        throw new Error('Failed to create issue');
      }

      const createdIssueId =
        result.issue?.id
        || result._issue?.id
        || null;

      if (createdIssueId) {
        try {
          const fullIssue = await fetchIssueMinimalById(client, createdIssueId);
          if (fullIssue) {
            return fullIssue;
          }
        } catch {
          // continue to fallback
        }
      }

      return {
        id: createdIssueId,
        identifier: null,
        title,
        description: input.description ?? null,
        url: null,
        priority: createInput.priority ?? null,
        state: null,
        team: null,
        project: null,
        assignee: null,
      };
    }

    return {
      id: null,
      identifier: null,
      title,
      description: input.description ?? null,
      url: null,
      priority: createInput.priority ?? null,
      state: null,
      team: null,
      project: null,
      assignee: null,
    };
  }, 'createIssue');
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
  return withLinearErrorHandling(async () => {
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
  }, 'addIssueComment');
}

/**
 * Update an issue
 * @param {LinearClient} client - Linear SDK client
 * @param {string} issueRef - Issue identifier or ID
 * @param {Object} patch - Fields to update
 * @returns {Promise<{issue: Object, changed: Array<string>}>}
 */
function buildFallbackUpdatedIssue(targetIssue, updateInput) {
  const fallback = { ...(targetIssue || {}) };

  if (Object.prototype.hasOwnProperty.call(updateInput, 'title')) {
    fallback.title = updateInput.title;
  }
  if (Object.prototype.hasOwnProperty.call(updateInput, 'description')) {
    fallback.description = updateInput.description;
  }
  if (Object.prototype.hasOwnProperty.call(updateInput, 'priority')) {
    fallback.priority = updateInput.priority;
  }
  if (Object.prototype.hasOwnProperty.call(updateInput, 'estimate')) {
    fallback.estimate = updateInput.estimate;
  }

  if (Object.prototype.hasOwnProperty.call(updateInput, 'assigneeId')) {
    const assigneeId = updateInput.assigneeId;
    if (assigneeId === null) {
      fallback.assignee = null;
    } else if (typeof assigneeId === 'string' && assigneeId.trim()) {
      fallback.assignee = {
        id: assigneeId,
        name: fallback.assignee?.name || 'Unknown',
        displayName: fallback.assignee?.displayName || 'Unknown',
      };
    }
  }

  if (Object.prototype.hasOwnProperty.call(updateInput, 'projectMilestoneId')) {
    const milestoneId = updateInput.projectMilestoneId;
    if (milestoneId === null) {
      fallback.projectMilestone = null;
    } else if (typeof milestoneId === 'string' && milestoneId.trim()) {
      fallback.projectMilestone = {
        id: milestoneId,
        name: fallback.projectMilestone?.name || 'Unknown',
      };
    }
  }

  return fallback;
}

export async function updateIssue(client, issueRef, patch = {}) {
  return withLinearErrorHandling(async () => {
    const targetIssue = await resolveIssue(client, issueRef);
    const updateInput = {};

    debug('updateIssue: received patch', {
      issueRef,
      resolvedIssueId: targetIssue?.id,
      resolvedIdentifier: targetIssue?.identifier,
      patchKeys: Object.keys(patch || {}),
      hasTitle: patch.title !== undefined,
      hasDescription: patch.description !== undefined,
      priority: patch.priority,
      state: patch.state,
      assigneeId: patch.assigneeId,
      milestone: patch.milestone,
      projectMilestoneId: patch.projectMilestoneId,
      subIssueOf: patch.subIssueOf,
      parentOf: patch.parentOf,
      blockedBy: patch.blockedBy,
      blocking: patch.blocking,
      relatedTo: patch.relatedTo,
      duplicateOf: patch.duplicateOf,
    });

    if (patch.title !== undefined) {
      updateInput.title = String(patch.title);
    }

    if (patch.description !== undefined) {
      updateInput.description = String(patch.description);
    }

    if (patch.priority !== undefined) {
      updateInput.priority = parseIssuePriority(patch.priority);
    }


    if (patch.estimate !== undefined) {
      const parsed = Number.parseInt(String(patch.estimate), 10);
      if (Number.isNaN(parsed) || parsed < 0) {
        throw new Error(`Invalid estimate: ${patch.estimate}. Must be a non-negative integer.`);
      }
      updateInput.estimate = parsed;
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

    if (patch.assigneeId !== undefined) {
      updateInput.assigneeId = patch.assigneeId;
    }

    if (patch.projectMilestoneId !== undefined) {
      updateInput.projectMilestoneId = patch.projectMilestoneId;
    } else if (patch.milestone !== undefined) {
      const milestoneRef = String(patch.milestone || '').trim();
      const clearMilestoneValues = new Set(['', 'none', 'null', 'unassigned', 'clear']);

      if (clearMilestoneValues.has(milestoneRef.toLowerCase())) {
        updateInput.projectMilestoneId = null;
      } else {
        const projectId = targetIssue.project?.id;
        if (!projectId) {
          throw new Error(`Issue ${targetIssue.identifier} has no project; cannot resolve milestone by name`);
        }

        const milestones = await fetchProjectMilestones(client, projectId);
        updateInput.projectMilestoneId = resolveProjectMilestoneIdFromInput(milestones, milestoneRef);
      }
    }

    if (patch.subIssueOf !== undefined) {
      const parentRef = String(patch.subIssueOf || '').trim();
      const clearParentValues = new Set(['', 'none', 'null', 'unassigned', 'clear']);
      if (clearParentValues.has(parentRef.toLowerCase())) {
        updateInput.parentId = null;
      } else {
        const parentIssue = await resolveIssue(client, parentRef);
        updateInput.parentId = parentIssue.id;
      }
    }

    const relationCreates = [];
    const parentOfRefs = normalizeIssueRefList(patch.parentOf);
    const blockedByRefs = normalizeIssueRefList(patch.blockedBy);
    const blockingRefs = normalizeIssueRefList(patch.blocking);
    const relatedToRefs = normalizeIssueRefList(patch.relatedTo);
    const duplicateOfRef = patch.duplicateOf !== undefined ? String(patch.duplicateOf || '').trim() : null;

    for (const childRef of parentOfRefs) {
      const childIssue = await resolveIssue(client, childRef);
      await performIssueUpdate(client, childIssue.id, { parentId: targetIssue.id });
    }

    for (const blockerRef of blockedByRefs) {
      const blocker = await resolveIssue(client, blockerRef);
      relationCreates.push({ issueId: blocker.id, relatedIssueId: targetIssue.id, type: 'blocks' });
    }

    for (const blockedRef of blockingRefs) {
      const blocked = await resolveIssue(client, blockedRef);
      relationCreates.push({ issueId: targetIssue.id, relatedIssueId: blocked.id, type: 'blocks' });
    }

    for (const relatedRef of relatedToRefs) {
      const related = await resolveIssue(client, relatedRef);
      relationCreates.push({ issueId: targetIssue.id, relatedIssueId: related.id, type: 'related' });
    }

    if (duplicateOfRef) {
      const duplicateTarget = await resolveIssue(client, duplicateOfRef);
      relationCreates.push({ issueId: targetIssue.id, relatedIssueId: duplicateTarget.id, type: 'duplicate' });
    }

    debug('updateIssue: computed update input', {
      issueRef,
      resolvedIdentifier: targetIssue?.identifier,
      updateKeys: Object.keys(updateInput),
      updateInput,
      relationCreateCount: relationCreates.length,
      parentOfCount: parentOfRefs.length,
    });

    if (Object.keys(updateInput).length === 0
      && relationCreates.length === 0
      && parentOfRefs.length === 0) {
      throw new Error('No update fields provided');
    }

    if (Object.keys(updateInput).length > 0) {
      await performIssueUpdate(client, targetIssue.id, updateInput);
    }

    for (const relationInput of relationCreates) {
      const relationResult = await client.createIssueRelation(relationInput);
      if (!relationResult.success) {
        throw new Error(`Failed to create issue relation (${relationInput.type})`);
      }
    }

    // Prefer official data path: refetch the issue after successful mutation.
    // If this extra fetch is rate-limited, keep operation successful and return fallback data.
    let updatedIssue = null;
    let usedRateLimitFallback = false;
    try {
      updatedIssue = await fetchIssueMinimalById(client, targetIssue.id);
    } catch (refreshError) {
      const refreshMessage = String(refreshError?.message || refreshError || 'unknown');
      const isRefreshRateLimited = refreshError?.type === 'Ratelimited' || refreshMessage.toLowerCase().includes('rate limit');

      if (!isRefreshRateLimited) {
        throw refreshError;
      }

      debug('updateIssue: post-update refresh was rate-limited; returning fallback issue payload', {
        issueRef,
        issueId: targetIssue?.id,
      });

      usedRateLimitFallback = true;
      updatedIssue = buildFallbackUpdatedIssue(targetIssue, updateInput);
    }

    const changed = [...Object.keys(updateInput)];
    if (parentOfRefs.length > 0) changed.push('parentOf');
    if (blockedByRefs.length > 0) changed.push('blockedBy');
    if (blockingRefs.length > 0) changed.push('blocking');
    if (relatedToRefs.length > 0) changed.push('relatedTo');
    if (duplicateOfRef) changed.push('duplicateOf');

    return {
      issue: updatedIssue || targetIssue,
      changed,
      usedRateLimitFallback,
    };
  }, 'updateIssue');
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
    order: sdkMilestone.sortOrder,
    targetDate: sdkMilestone.targetDate,
    status: sdkMilestone.status,
    project: project ? { id: project.id, name: project.name } : null,
  };
}

function transformProject(rawProject) {
  if (!rawProject) return null;

  const milestoneNodes = rawProject.projectMilestones?.nodes || [];
  const teamNodes = rawProject.teams?.nodes || [];

  return {
    id: rawProject.id,
    name: rawProject.name,
    description: rawProject.description ?? '',
    content: rawProject.content ?? null,
    color: rawProject.color ?? null,
    icon: rawProject.icon ?? null,
    priority: rawProject.priority ?? null,
    progress: rawProject.progress ?? null,
    health: rawProject.health ?? null,
    startDate: rawProject.startDate ?? null,
    targetDate: rawProject.targetDate ?? null,
    slugId: rawProject.slugId ?? null,
    url: rawProject.url ?? null,
    archivedAt: rawProject.archivedAt ?? null,
    completedAt: rawProject.completedAt ?? null,
    canceledAt: rawProject.canceledAt ?? null,
    status: rawProject.status ? {
      id: rawProject.status.id,
      name: rawProject.status.name,
      type: rawProject.status.type,
      color: rawProject.status.color,
    } : null,
    lead: rawProject.lead ? {
      id: rawProject.lead.id,
      name: rawProject.lead.name,
      displayName: rawProject.lead.displayName,
    } : null,
    teams: teamNodes.map((team) => ({
      id: team.id,
      key: team.key,
      name: team.name,
    })),
    projectMilestones: milestoneNodes.map((milestone) => ({
      id: milestone.id,
      name: milestone.name,
      status: milestone.status,
      progress: milestone.progress ?? null,
      targetDate: milestone.targetDate ?? null,
    })),
  };
}

function transformProjectUpdate(rawUpdate) {
  if (!rawUpdate) return null;

  return {
    id: rawUpdate.id,
    body: rawUpdate.body ?? '',
    health: rawUpdate.health ?? null,
    createdAt: rawUpdate.createdAt ?? null,
    updatedAt: rawUpdate.updatedAt ?? null,
    archivedAt: rawUpdate.archivedAt ?? null,
    editedAt: rawUpdate.editedAt ?? null,
    url: rawUpdate.url ?? null,
    slugId: rawUpdate.slugId ?? null,
    isDiffHidden: rawUpdate.isDiffHidden ?? false,
    isStale: rawUpdate.isStale ?? false,
    project: rawUpdate.project ? {
      id: rawUpdate.project.id,
      name: rawUpdate.project.name,
    } : null,
    user: rawUpdate.user ? {
      id: rawUpdate.user.id,
      name: rawUpdate.user.name,
      displayName: rawUpdate.user.displayName,
    } : null,
  };
}

function transformDocument(rawDocument) {
  if (!rawDocument) return null;

  return {
    id: rawDocument.id,
    title: rawDocument.title ?? '',
    content: rawDocument.content ?? '',
    icon: rawDocument.icon ?? null,
    color: rawDocument.color ?? null,
    slugId: rawDocument.slugId ?? null,
    url: rawDocument.url ?? null,
    archivedAt: rawDocument.archivedAt ?? null,
    createdAt: rawDocument.createdAt ?? null,
    updatedAt: rawDocument.updatedAt ?? null,
    project: rawDocument.project ? {
      id: rawDocument.project.id,
      name: rawDocument.project.name,
    } : null,
    issue: rawDocument.issue ? {
      id: rawDocument.issue.id,
      identifier: rawDocument.issue.identifier,
      title: rawDocument.issue.title,
    } : null,
  };
}

function invalidateProjectsCache(client) {
  const cacheKey = getClientCacheKey(client);
  projectsCache.delete(cacheKey);
}

/**
 * Fetch milestones for a project
 * @param {LinearClient} client - Linear SDK client
 * @param {string} projectId - Project ID
 * @returns {Promise<Array<Object>>} Array of milestones
 */
export async function fetchProjectMilestones(client, projectId) {
  return withLinearErrorHandling(async () => {
    const milestones = await fetchProjectMilestonesByQuery(client, projectId);
    if (!milestones) {
      throw new Error(`Project not found: ${projectId}`);
    }

    debug('Fetched project milestones', {
      projectId,
      milestoneCount: milestones.length,
      milestones: milestones.map((m) => ({ id: m.id, name: m.name, status: m.status })),
    });

    return milestones;
  }, 'fetchProjectMilestones');
}

/**
 * Fetch milestone details including associated issues
 * @param {LinearClient} client - Linear SDK client
 * @param {string} milestoneId - Milestone ID
 * @returns {Promise<Object>} Milestone details with issues
 */
export async function fetchMilestoneDetails(client, milestoneId) {
  return withLinearErrorHandling(async () => {
    // Prefer raw GraphQL: one request instead of N+1 SDK lazy loads.
    // This dramatically reduces rate-limit exposure for milestone view.
    if (getRawRequest(client)) {
      try {
        const data = await executeGraphQL(client, MILESTONE_DETAILS_QUERY, {
          id: milestoneId,
          issueLimit: 250,
        });

        const raw = data?.projectMilestone;
        if (!raw) {
          throw new Error(`Milestone not found: ${milestoneId}`);
        }

        const project = raw.project ? { id: raw.project.id, name: raw.project.name } : null;
        const issues = (raw.issues?.nodes || []).map((issue) => ({
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          state: issue.state ? { name: issue.state.name, color: issue.state.color, type: issue.state.type } : null,
          assignee: issue.assignee ? { id: issue.assignee.id, name: issue.assignee.name, displayName: issue.assignee.displayName } : null,
          priority: issue.priority ?? null,
          estimate: issue.estimate ?? null,
        }));

        return {
          id: raw.id,
          name: raw.name,
          description: raw.description ?? null,
          progress: raw.progress ?? null,
          order: raw.sortOrder ?? null,
          targetDate: raw.targetDate ?? null,
          status: raw.status ?? null,
          project,
          issues,
        };
      } catch (err) {
        // If raw GraphQL fails (e.g., network error), fall through to SDK path.
        // Rate-limit errors are re-thrown by executeGraphQL -> withLinearErrorHandling.
        if (!isLinearError(err)) {
          debug('fetchMilestoneDetails: raw GraphQL unavailable, falling back to SDK', { error: err?.message });
        } else {
          throw err; // re-throw Linear errors including rate limits
        }
      }
    }

    // SDK fallback: the rate-limit propagation logic for lazy loads is preserved.
    const milestone = await client.projectMilestone(milestoneId);
    if (!milestone) {
      throw new Error(`Milestone not found: ${milestoneId}`);
    }

    // Fetch project and issues in parallel
    const [projectResult, issuesResult] = await Promise.all([
      milestone.project?.catch?.(() => null) ?? milestone.project,
      milestone.issues?.()?.catch?.((err) => {
        if (isRateLimitError(err)) {
          // Propagate rate-limit errors so the caller can surface a safe user message
          // instead of silently swallowing the issue list.
          throw err;
        }
        return { nodes: [] };
      }) ?? { nodes: [] },
    ]);

    const project = projectResult;

    const issues = await Promise.all(
      (issuesResult.nodes || []).map(async (issue) => {
        // Propagate rate-limit errors from per-issue lazy loads so the caller can surface
        // a safe user message. Silently degrading to partial data masks the problem.
        const [state, assignee] = await Promise.all([
          issue.state?.catch?.((err) => {
            if (isRateLimitError(err)) throw err;
            return null;
          }) ?? issue.state,
          issue.assignee?.catch?.((err) => {
            if (isRateLimitError(err)) throw err;
            return null;
          }) ?? issue.assignee,
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
      order: milestone.sortOrder,
      targetDate: milestone.targetDate,
      status: milestone.status,
      project: project ? { id: project.id, name: project.name } : null,
      issues,
    };
  }, 'fetchMilestoneDetails');
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
  return withLinearErrorHandling(async () => {
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
      order: created?.sortOrder ?? null,
      targetDate: created?.targetDate ?? input.targetDate ?? null,
      status: created?.status ?? input.status ?? 'backlogged',
      project: null,
    };
  }, 'createProjectMilestone');
}

/**
 * Update a project milestone
 * @param {LinearClient} client - Linear SDK client
 * @param {string} milestoneId - Milestone ID
 * @param {Object} patch - Fields to update
 * @returns {Promise<{milestone: Object, changed: Array<string>}>}
 */
export async function updateProjectMilestone(client, milestoneId, patch = {}) {
  return withLinearErrorHandling(async () => {
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

    // Note: status is a computed/read-only field in Linear's API (ProjectMilestoneStatus enum)
    // It cannot be set via ProjectMilestoneUpdateInput. The status values (done, next, overdue, unstarted)
    // are automatically determined by Linear based on milestone progress and dates.

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
  }, 'updateProjectMilestone');
}

/**
 * Delete a project milestone
 * @param {LinearClient} client - Linear SDK client
 * @param {string} milestoneId - Milestone ID
 * @returns {Promise<{success: boolean, milestoneId: string, name: string|null}>}
 */
export async function deleteProjectMilestone(client, milestoneId) {
  return withLinearErrorHandling(async () => {
    let milestoneName = null;

    try {
      const existing = await client.projectMilestone(milestoneId);
      if (existing?.name) {
        milestoneName = existing.name;
      }
    } catch {
      milestoneName = null;
    }

    const result = await client.deleteProjectMilestone(milestoneId);

    return {
      success: result.success,
      milestoneId,
      name: milestoneName,
    };
  }, 'deleteProjectMilestone');
}

/**
 * Delete (archive) an issue
 * @param {LinearClient} client - Linear SDK client
 * @param {string} issueRef - Issue identifier or ID
 * @returns {Promise<{success: boolean, issueId: string, identifier: string}>}
 */
export async function deleteIssue(client, issueRef) {
  return withLinearErrorHandling(async () => {
    const targetIssue = await resolveIssue(client, issueRef);

    let success = false;
    if (getRawRequest(client)) {
      const payload = await executeGraphQL(client, ISSUE_DELETE_MUTATION, { id: targetIssue.id });
      success = payload?.issueDelete?.success === true;
    } else {
      const sdkIssue = await client.issue(targetIssue.id);
      if (!sdkIssue) {
        throw new Error(`Issue not found: ${targetIssue.id}`);
      }
      const result = await sdkIssue.delete();
      success = result.success;
    }

    return {
      success,
      issueId: targetIssue.id,
      identifier: targetIssue.identifier,
    };
  }, 'deleteIssue');
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
  if (issueData.projectMilestone?.name) {
    metaParts.push(`**Milestone:** ${issueData.projectMilestone.name}`);
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

export function formatIssueActivityAsMarkdown(issueData, options = {}) {
  const { limit } = options;
  const lines = [`# Activity for ${issueData.issue.identifier}: ${issueData.issue.title}`];

  if (issueData.issue.url) {
    lines.push('');
    lines.push(`**URL:** ${issueData.issue.url}`);
  }

  if (!issueData.activity || issueData.activity.length === 0) {
    lines.push('');
    lines.push('No activity entries found.');
    return lines.join('\n');
  }

  lines.push('');
  lines.push(`Showing ${issueData.activity.length}${limit ? ` of up to ${limit}` : ''} activity entries.`);
  lines.push('');

  for (const entry of issueData.activity) {
    const actor = entry.actor ? getUserDisplayName(entry.actor) : 'System';
    const timestamp = entry.createdAt ? formatRelativeTime(entry.createdAt) : 'unknown time';
    lines.push(`- **${actor}** ${summarizeIssueHistoryEntry(entry)} _(${timestamp})_`);
  }

  return lines.join('\n');
}
