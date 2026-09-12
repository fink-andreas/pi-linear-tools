#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import extension from '../extensions/pi-linear-tools.js';
import {
  executeDocumentCreate,
  executeDocumentList,
  executeDocumentUpdate,
  executeDocumentView,
} from '../src/handlers.js';
import { fetchDocuments } from '../src/linear.js';
import { resetTestClientFactory, setTestClientFactory } from '../src/linear-client.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const ISSUE_ID = '22222222-2222-4222-8222-222222222222';

function documentPayload(overrides = {}) {
  return {
    id: 'doc-1',
    title: 'Inbox product spec',
    content: '# Inbox\n\nCanonical specification.',
    icon: null,
    color: null,
    slugId: 'inbox-product-spec-abc123',
    url: 'https://linear.app/example/document/inbox-product-spec-abc123',
    archivedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    project: { id: PROJECT_ID, name: 'Inbox' },
    issue: null,
    ...overrides,
  };
}

function createMockPi() {
  const tools = new Map();
  return {
    tools,
    registerTool(definition) { tools.set(definition.name, definition); },
    registerCommand() {},
    sendMessage() {},
  };
}

async function withTempHome(fn) {
  const previousHome = process.env.HOME;
  process.env.HOME = await mkdtemp(join(tmpdir(), 'pi-linear-document-home-'));
  try {
    await fn();
  } finally {
    process.env.HOME = previousHome;
  }
}

async function testFetchDocumentsPaginatesAndFilters() {
  const requests = [];
  const client = {
    rawRequest: async (query, variables) => {
      requests.push({ query, variables });
      if (variables.after === null) {
        return {
          data: {
            documents: {
              nodes: [
                documentPayload(),
                documentPayload({ id: 'doc-2', title: 'Inbox decisions' }),
              ],
              pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
            },
          },
          headers: new Headers(),
        };
      }
      return {
        data: {
          documents: {
            nodes: [documentPayload({ id: 'doc-3', title: 'Inbox follow-up' })],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
        headers: new Headers(),
      };
    },
  };

  const firstPage = await fetchDocuments(client, {
    projectId: PROJECT_ID,
    query: 'inbox',
    limit: 2,
  });

  assert.equal(firstPage.documents.length, 2);
  assert.equal(firstPage.pageCount, 1);
  assert.equal(firstPage.limit, 2);
  assert.equal(firstPage.truncated, true);
  assert.equal(firstPage.nextCursor, 'cursor-1');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].variables.first, 2);
  assert.equal(requests[0].variables.after, null);
  assert.deepEqual(requests[0].variables.filter, {
    and: [
      { project: { id: { eq: PROJECT_ID } } },
      { title: { containsIgnoreCase: 'inbox' } },
    ],
  });

  const secondPage = await fetchDocuments(client, {
    projectId: PROJECT_ID,
    query: 'inbox',
    limit: 2,
    cursor: firstPage.nextCursor,
  });

  assert.deepEqual(secondPage.documents.map((document) => document.id), ['doc-3']);
  assert.equal(secondPage.pageCount, 1);
  assert.equal(secondPage.truncated, false);
  assert.equal(secondPage.nextCursor, null);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].variables.first, 2);
  assert.equal(requests[1].variables.after, 'cursor-1');
  assert.deepEqual(requests[1].variables.filter, requests[0].variables.filter);
}

async function testDocumentListUsesBoundedDefault() {
  let requestVariables = null;
  const client = {
    rawRequest: async (_query, variables) => {
      requestVariables = variables;
      return {
        data: {
          documents: {
            nodes: [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
        headers: new Headers(),
      };
    },
  };

  const result = await fetchDocuments(client);

  assert.equal(result.limit, 50);
  assert.equal(result.truncated, false);
  assert.equal(result.nextCursor, null);
  assert.equal(requestVariables.first, 50);
  assert.equal(requestVariables.after, null);
}

async function testDocumentListPaginationValidation() {
  const client = {
    rawRequest: async () => {
      throw new Error('rawRequest should not run for invalid pagination input');
    },
  };

  await assert.rejects(
    () => fetchDocuments(client, { limit: 0 }),
    /limit must be a positive integer/
  );
  await assert.rejects(
    () => fetchDocuments(client, { limit: 251 }),
    /limit cannot exceed 250/
  );
  await assert.rejects(
    () => fetchDocuments(client, { cursor: '' }),
    /cursor must be a non-empty string/
  );
  await assert.rejects(
    () => fetchDocuments(client, { cursor: 123 }),
    /cursor must be a non-empty string/
  );
}

async function testDocumentHandlers() {
  let updateVariables = null;
  let detailsRequests = 0;
  const projectConnection = {
    nodes: [{ id: 'project-first-page', name: 'Other project' }],
    pageInfo: { hasNextPage: true, endCursor: 'project-cursor-1' },
    async fetchNext() {
      this.nodes.push({ id: PROJECT_ID, name: 'Inbox' });
      this.pageInfo = { hasNextPage: false, endCursor: null };
      return this;
    },
  };
  const client = {
    projects: async () => projectConnection,
    rawRequest: async (query, variables) => {
      if (query.includes('query Documents')) {
        return {
          data: {
            documents: {
              nodes: [documentPayload()],
              pageInfo: { hasNextPage: true, endCursor: 'handler-cursor-1' },
            },
          },
          headers: new Headers(),
        };
      }
      if (query.includes('DocumentDetails')) {
        detailsRequests += 1;
        return { data: { document: documentPayload({ content: updateVariables?.input?.content ?? documentPayload().content }) }, headers: new Headers() };
      }
      if (query.includes('IssueMinimalByTeamAndNumber')) {
        return {
          data: { issues: { nodes: [{ id: ISSUE_ID, identifier: 'INB-11', title: 'Document tool' }] } },
          headers: new Headers(),
        };
      }
      if (query.includes('DocumentCreate')) {
        assert.deepEqual(variables.input, {
          title: 'Issue notes',
          issueId: ISSUE_ID,
          content: 'Initial notes',
        });
        return {
          data: {
            documentCreate: {
              success: true,
              document: documentPayload({
                title: variables.input.title,
                content: variables.input.content,
                project: null,
                issue: { id: ISSUE_ID, identifier: 'INB-11', title: 'Document tool' },
              }),
            },
          },
          headers: new Headers(),
        };
      }
      if (query.includes('DocumentUpdate')) {
        updateVariables = variables;
        return {
          data: {
            documentUpdate: {
              success: true,
              document: documentPayload({
                ...(variables.input.content !== undefined ? { content: variables.input.content } : {}),
              }),
            },
          },
          headers: new Headers(),
        };
      }
      throw new Error(`Unexpected query: ${query}`);
    },
  };

  const listed = await executeDocumentList(client, {
    projectId: 'Inbox',
    query: 'spec',
    limit: 1,
  });
  assert.match(listed.content[0].text, /Inbox product spec/);
  assert.match(listed.content[0].text, /More documents are available/);
  assert.equal(listed.details.projectId, PROJECT_ID);
  assert.equal(listed.details.pageCount, 1);
  assert.equal(listed.details.limit, 1);
  assert.equal(listed.details.truncated, true);
  assert.equal(listed.details.nextCursor, 'handler-cursor-1');

  const viewed = await executeDocumentView(client, { document: 'inbox-product-spec-abc123' });
  assert.match(viewed.content[0].text, /Canonical specification/);
  assert.equal(viewed.details.documentId, 'doc-1');
  assert.equal(viewed.details.url, documentPayload().url);
  assert.equal(viewed.details.updatedAt, documentPayload().updatedAt);

  const created = await executeDocumentCreate(client, {
    title: 'Issue notes',
    content: 'Initial notes',
    issue: 'INB-11',
  });
  assert.equal(created.details.documentId, 'doc-1');

  const updated = await executeDocumentUpdate(client, { document: 'doc-1', content: '' });
  assert.deepEqual(updateVariables.input, { content: '' });
  assert.deepEqual(updated.details.changed, ['content']);

  await executeDocumentUpdate(client, { document: 'doc-1', project: 'Inbox' });
  assert.deepEqual(updateVariables.input, { projectId: PROJECT_ID, issueId: null });

  await executeDocumentUpdate(client, { document: 'doc-1', issue: 'INB-11' });
  assert.deepEqual(updateVariables.input, { issueId: ISSUE_ID, projectId: null });
  assert.equal(detailsRequests, 1, 'create/update should return mutation payloads without follow-up reads');

  await assert.rejects(
    () => executeDocumentCreate(client, { title: 'Invalid', project: 'Inbox', issue: 'INB-11' }),
    /exactly one document parent/
  );
  await assert.rejects(
    () => executeDocumentUpdate(client, { document: 'doc-1', project: 'Inbox', issue: 'INB-11' }),
    /exactly one document parent/
  );
}

async function testProjectResolutionCacheIsScopedByCredential() {
  const filters = [];
  function clientFor(trackerKey, projectId) {
    return {
      __piLinearTrackerKey: trackerKey,
      projects: async () => ({ nodes: [{ id: projectId, name: 'Inbox' }] }),
      rawRequest: async (_query, variables) => {
        filters.push(variables.filter);
        return {
          data: { documents: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } },
          headers: new Headers(),
        };
      },
    };
  }

  const firstProjectId = '33333333-3333-4333-8333-333333333333';
  const secondProjectId = '44444444-4444-4444-8444-444444444444';
  await executeDocumentList(clientFor('fake-auth-a', firstProjectId), { projectId: 'Inbox' });
  await executeDocumentList(clientFor('fake-auth-b', secondProjectId), { projectId: 'Inbox' });

  assert.deepEqual(filters, [
    { project: { id: { eq: firstProjectId } } },
    { project: { id: { eq: secondProjectId } } },
  ]);
}

async function testRegistrationAuthAndRouterCompatibility() {
  const previousKey = process.env.LINEAR_API_KEY;
  const authValues = [];

  try {
    await withTempHome(async () => {
      setTestClientFactory((auth) => {
        authValues.push(auth);
        return {
          rawRequest: async () => ({
            data: { documents: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } },
            headers: new Headers(),
          }),
        };
      });

      const pi = createMockPi();
      await extension(pi);
      const tool = pi.tools.get('linear_document');
      assert.ok(tool, 'linear_document must be registered');
      assert.deepEqual(tool.parameters.properties.action.enum, ['list', 'view', 'create', 'update']);
      assert.match(tool.parameters.properties.content.description, /empty string to clear/);
      assert.equal(tool.parameters.properties.limit.type, 'integer');
      assert.equal(tool.parameters.properties.limit.minimum, 1);
      assert.equal(tool.parameters.properties.limit.maximum, 250);
      assert.equal(tool.parameters.properties.cursor.type, 'string');

      process.env.LINEAR_API_KEY = 'lin_fake_scoped_a';
      await tool.execute('document-auth-a', { action: 'list' });
      process.env.LINEAR_API_KEY = 'lin_fake_scoped_b';
      await tool.execute('document-auth-b', { action: 'list' });
      assert.deepEqual(authValues, [
        { apiKey: 'lin_fake_scoped_a' },
        { apiKey: 'lin_fake_scoped_b' },
      ]);

      const blockedRouterHook = (event) => event.toolName.startsWith('linear_')
        ? { block: true, reason: 'fake scoped workspace verification failed' }
        : undefined;
      assert.deepEqual(blockedRouterHook({ toolName: tool.name, input: { action: 'list' } }), {
        block: true,
        reason: 'fake scoped workspace verification failed',
      });
      const input = { action: 'create', title: 'Doc', project: 'Inbox' };
      const activeRouterHook = () => undefined;
      assert.equal(activeRouterHook({ toolName: tool.name, input }), undefined);
      assert.deepEqual(input, { action: 'create', title: 'Doc', project: 'Inbox' });
    });
  } finally {
    resetTestClientFactory();
    process.env.LINEAR_API_KEY = previousKey;
  }
}

await testFetchDocumentsPaginatesAndFilters();
await testDocumentListUsesBoundedDefault();
await testDocumentListPaginationValidation();
await testDocumentHandlers();
await testProjectResolutionCacheIsScopedByCredential();
await testRegistrationAuthAndRouterCompatibility();
console.log('✓ tests/test-document-tool.js passed');
