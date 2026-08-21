#!/usr/bin/env node

/**
 * Tests for issue/project label listing + creation and for the `labels` /
 * `links` parameters on issue create/update.
 */

import assert from 'node:assert/strict';

import {
  executeIssueLabelList,
  executeIssueLabelCreate,
  executeProjectLabelList,
  executeIssueCreate,
  executeIssueUpdate,
} from '../src/handlers.js';

function createLabel(raw = {}) {
  return {
    id: raw.id ?? '11111111-1111-4111-8111-111111111111',
    name: raw.name ?? 'frontend',
    color: raw.color ?? '#C5283E',
    description: raw.description ?? null,
    isGroup: raw.isGroup ?? false,
    team: raw.team ?? null,
    parent: raw.parent ?? null,
    ...raw,
  };
}

function runGraphQL(mutations, queryMatches) {
  return async (query, variables) => {
    for (const key of Object.keys(mutations)) {
      if (query.includes(key)) {
        const fn = mutations[key];
        const result = typeof fn === 'function' ? fn(variables) : fn;
        return { data: result, headers: new Headers() };
      }
    }
    // Default empty label list for label queries
    if (queryMatches?.length) {
      for (const { match, data } of queryMatches) {
        if (query.includes(match)) {
          return { data, headers: new Headers() };
        }
      }
    }
    throw new Error(`Unexpected query: ${query.slice(0, 80)}`);
  };
}

const EMPTY_LABELS = {
  issueLabels: { nodes: [] },
};

async function testIssueLabelListEmpty() {
  const client = {
    rawRequest: runGraphQL({}, [{ match: 'IssueLabels', data: EMPTY_LABELS }]),
  };

  const result = await executeIssueLabelList(client, {});
  assert.match(result.content[0].text, /No issue labels found/);
  assert.equal(result.details.labelCount, 0);
}

async function testIssueLabelListWithNameAndTeam() {
  let receivedFilter = null;
  const client = {
    teams: async () => ({ nodes: [{ id: 'team-1', key: 'ENG', name: 'Engineering' }] }),
    rawRequest: async (query, variables) => {
      receivedFilter = variables.filter;
      return {
        data: {
          issueLabels: {
            nodes: [createLabel({ id: 'label-1', name: 'frontend', color: '#C5283E' })],
          },
        },
        headers: new Headers(),
      };
    },
  };

  const result = await executeIssueLabelList(client, { name: 'front', team: 'ENG' });
  assert.deepEqual(receivedFilter, {
    name: { containsIgnoreCase: 'front' },
    team: { id: { eq: 'team-1' } },
  });
  assert.match(result.content[0].text, /frontend/);
  assert.equal(result.details.labelCount, 1);
}

async function testIssueLabelCreateForwardsInput() {
  let receivedInput = null;
  const client = {
    teams: async () => ({ nodes: [{ id: 'team-1', key: 'ENG', name: 'Engineering' }] }),
    rawRequest: async (query, variables) => {
      receivedInput = variables.input;
      return {
        data: {
          issueLabelCreate: {
            success: true,
            issueLabel: createLabel({ id: 'label-new', name: 'backend', team: { id: 'team-1', key: 'ENG', name: 'Engineering' } }),
          },
        },
        headers: new Headers(),
      };
    },
  };

  const result = await executeIssueLabelCreate(client, {
    name: 'backend',
    description: 'Backend work',
    color: '#123456',
    team: 'ENG',
  });
  assert.deepEqual(receivedInput, {
    name: 'backend',
    description: 'Backend work',
    color: '#123456',
    teamId: 'team-1',
  });
  assert.match(result.content[0].text, /backend/);
  assert.equal(result.details.labelId, 'label-new');
}

async function testProjectLabelList() {
  let receivedFilter = null;
  const client = {
    rawRequest: async (query, variables) => {
      receivedFilter = variables.filter;
      return {
        data: {
          projectLabels: {
            nodes: [{ id: 'pl-1', name: 'infra', color: '#ABC123', description: null }],
          },
        },
        headers: new Headers(),
      };
    },
  };

  const result = await executeProjectLabelList(client, { name: 'infra' });
  assert.deepEqual(receivedFilter, { name: { containsIgnoreCase: 'infra' } });
  assert.match(result.content[0].text, /infra/);
  assert.equal(result.details.labelCount, 1);
}

async function testIssueCreateWithLabelsResolvesAndAddsLinks() {
  const created = [];
  const attachments = [];
  const client = {
    viewer: Promise.resolve({ id: 'viewer-1', displayName: 'Viewer' }),
    projects: async () => ({ nodes: [{ id: 'project-1', name: 'demo-project' }] }),
    teams: async () => ({ nodes: [{ id: 'team-1', key: 'ENG', name: 'Engineering' }] }),
    rawRequest: async (query, variables) => {
      if (query.includes('IssueLabels')) {
        return {
          data: {
            issueLabels: {
              nodes: [
                createLabel({ id: 'label-frontend', name: 'frontend' }),
                createLabel({ id: 'label-backend', name: 'backend' }),
              ],
            },
          },
          headers: new Headers(),
        };
      }
      if (query.includes('IssueCreate')) {
        created.push(variables.input);
        return {
          data: {
            issueCreate: {
              success: true,
              issue: createLabel({
                id: 'issue-1',
                identifier: 'ENG-123',
                title: variables.input.title,
                state: { id: 'state-1', name: 'Todo', type: 'unstarted' },
                team: { id: 'team-1', key: 'ENG', name: 'Engineering' },
              }),
            },
          },
          headers: new Headers(),
        };
      }
      if (query.includes('AttachmentCreate')) {
        attachments.push(variables.input);
        return {
          data: { attachmentCreate: { success: true, attachment: { id: 'att-1', title: variables.input.title, url: variables.input.url } } },
          headers: new Headers(),
        };
      }
      throw new Error(`Unexpected query: ${query.slice(0, 80)}`);
    },
  };

  const result = await executeIssueCreate(client, {
    title: 'Add labels',
    team: 'ENG',
    labels: ['frontend, backend'],
    links: [{ url: 'https://example.com/pr', title: 'PR #1' }],
  });

  // labelIds resolved from names
  assert.deepEqual(created[0].labelIds, ['label-frontend', 'label-backend']);
  // attachment created against created issue
  assert.equal(attachments[0].issueId, 'issue-1');
  assert.equal(attachments[0].url, 'https://example.com/pr');
  assert.match(result.content[0].text, /Links: 1/);
  assert.equal(result.details.links.length, 1);
}

async function testIssueUpdateWithLabelsAndLinks() {
  const patches = [];
  const attachments = [];
  const client = {
    rawRequest: async (query, variables) => {
      if (query.includes('IssueLabels')) {
        return {
          data: {
            issueLabels: {
              nodes: [
                createLabel({ id: 'label-ux', name: 'ux' }),
                createLabel({ id: 'label-frontend', name: 'frontend' }),
              ],
            },
          },
          headers: new Headers(),
        };
      }
      if (query.includes('IssueMinimalById')) {
        return {
          data: {
            issue: {
              id: 'issue-5',
              identifier: 'ENG-5',
              title: 'Update labels',
              team: { id: 'team-1', key: 'ENG', name: 'Engineering' },
            },
          },
          headers: new Headers(),
        };
      }
      if (query.includes('IssueMinimalByTeamAndNumber')) {
        return {
          data: {
            issues: {
              nodes: [{
                id: 'issue-5',
                identifier: 'ENG-5',
                title: 'Update labels',
                team: { id: 'team-1', key: 'ENG', name: 'Engineering' },
              }],
            },
          },
          headers: new Headers(),
        };
      }
      if (query.includes('IssueUpdate')) {
        patches.push(variables.input);
        return {
          data: {
            issueUpdate: {
              success: true,
              issue: {
                id: 'issue-5',
                identifier: 'ENG-5',
                title: 'Update labels',
                state: { id: 'state-1', name: 'Todo', type: 'unstarted' },
                team: { id: 'team-1', key: 'ENG', name: 'Engineering' },
              },
            },
          },
          headers: new Headers(),
        };
      }
      if (query.includes('IssueDetailsWithComments')) {
        return {
          data: {
            issue: {
              id: 'issue-5',
              identifier: 'ENG-5',
              title: 'Update labels',
              team: { id: 'team-1', key: 'ENG', name: 'Engineering' },
            },
          },
          headers: new Headers(),
        };
      }
      if (query.includes('AttachmentCreate')) {
        attachments.push(variables.input);
        return {
          data: { attachmentCreate: { success: true, attachment: { id: 'att-9', title: variables.input.title, url: variables.input.url } } },
          headers: new Headers(),
        };
      }
      throw new Error(`Unexpected query: ${query.slice(0, 80)}`);
    },
  };

  const result = await executeIssueUpdate(client, {
    issue: 'ENG-5',
    labels: ['ux, frontend'],
    links: [{ url: 'https://example.com/docs', title: 'DOC' }],
  });

  assert.deepEqual(patches[0].labelIds, ['label-ux', 'label-frontend']);
  assert.equal(attachments[0].issueId, 'issue-5');
  assert.match(result.content[0].text, /links: 1/);
}

async function testIssueUpdateWithLinksOnly() {
  const attachments = [];
  const client = {
    rawRequest: async (query, variables) => {
      if (query.includes('IssueMinimalByTeamAndNumber')) {
        return {
          data: {
            issues: {
              nodes: [{
                id: 'issue-6',
                identifier: 'ENG-6',
                title: 'Link only',
                team: { id: 'team-1', key: 'ENG', name: 'Engineering' },
              }],
            },
          },
          headers: new Headers(),
        };
      }
      if (query.includes('AttachmentCreate')) {
        attachments.push(variables.input);
        return {
          data: { attachmentCreate: { success: true, attachment: { id: 'att-10', title: variables.input.title, url: variables.input.url } } },
          headers: new Headers(),
        };
      }
      throw new Error(`Unexpected query: ${query.slice(0, 80)}`);
    },
  };

  const result = await executeIssueUpdate(client, {
    issue: 'ENG-6',
    links: [{ url: 'https://example.com/only-link', title: 'Only link' }],
  });

  assert.equal(attachments[0].issueId, 'issue-6');
  assert.match(result.content[0].text, /links: 1/);
}

async function run() {
  await testIssueLabelListEmpty();
  await testIssueLabelListWithNameAndTeam();
  await testIssueLabelCreateForwardsInput();
  await testProjectLabelList();
  await testIssueCreateWithLabelsResolvesAndAddsLinks();
  await testIssueUpdateWithLabelsAndLinks();
  await testIssueUpdateWithLinksOnly();
  console.log('✓ test-labels-links.js passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
