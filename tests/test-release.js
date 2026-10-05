import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSchema, parse, validate } from 'graphql';
const schema = buildSchema(readFileSync(new URL('../docs/linear-schema.graphql', import.meta.url), 'utf8'));
import { runReleaseOperation } from '../src/linear.js';
import { executeRelease } from '../src/handlers.js';
import { runCli } from '../src/cli.js';
import extension from '../extensions/pi-linear-tools.js';
import { setTestClientFactory, resetTestClientFactory } from '../src/linear-client.js';

const release = { id: 'r1', name: 'v1', version: '1', pipeline: { id: 'p1', name: 'App' }, stage: { id: 's1', name: 'Started', type: 'started' } };
const stages = [
  { id: 's1', name: 'Started', type: 'started', position: 0, archivedAt: null, pipeline: { id: 'p1', name: 'App' } },
  { id: 's2', name: 'Started', type: 'started', position: 0, archivedAt: null, pipeline: { id: 'p2', name: 'Backend' } },
];
const pipelines = stages.map(stage => ({ ...stage.pipeline, archivedAt: null }));
const calls = [];
let failure = false;
const client = { rawRequest: async (query, variables) => {
  calls.push({ query, variables });
  assert.deepEqual(validate(schema, parse(query)), [], 'operation must match official schema');
  assert.doesNotMatch(query, /projectMilestone|projectId/);
  let data;
  if (query.includes('query ReleaseIssues')) {
    assert.deepEqual(variables.filter, { releases: { some: { id: { eq: 'r1' } } } });
    data = { issues: { nodes: [{ id: 'i1', identifier: 'ENG-123', title: 'Ship feature', state: { id: 'state1', name: 'Done', type: 'completed' } }], pageInfo: { hasNextPage: true, endCursor: 'issues-next' } } };
  } else if (query.includes('mutation ReleaseAddIssue')) {
    data = { issueToReleaseCreate: { success: !failure, issueToRelease: { id: 'join1', issue: { id: 'i1', identifier: 'ENG-123', title: 'Ship feature' }, release: { id: 'r1', name: 'v1' } } } };
  } else if (query.includes('mutation ReleaseRemoveIssue')) {
    assert.doesNotMatch(query, /\bissueDelete\s*\(/);
    data = { issueToReleaseDeleteByIssueAndRelease: { success: !failure } };
  } else if (query.includes('query ReleaseList')) {
    const field = query.includes('releasePipelines(') ? 'releasePipelines' : query.includes('releaseStages(') ? 'releaseStages' : 'releases';
    data = { [field]: { nodes: field === 'releaseStages' ? stages : field === 'releasePipelines' ? pipelines : [release], pageInfo: { hasNextPage: true, endCursor: 'next' } } };
  } else if (query.includes('query ReleaseView')) data = { release };
  else {
    const field = query.match(/(release\w+)\(/)[1];
    data = { [field]: { success: !failure, ...(field === 'releaseDelete' ? {} : field === 'releaseCreate' || field === 'releaseUpdate' ? { release } : { entity: release }) } };
  }
  return { data, headers: new Headers() };
} };
for (const action of ['list', 'pipelines', 'stages']) {
  const result = await executeRelease(client, { action, limit: 2, after: 'cursor', includeArchived: true });
  assert.equal(result.details.pageInfo.endCursor, 'next');
  assert.match(result.content[0].text, /More results/);
  assert.deepEqual(calls.at(-1).variables, { first: 2, after: 'cursor', includeArchived: true });
}
const issuePage = await executeRelease(client, { action: 'issues', release: 'r1', limit: 2, after: 'issues-cursor', includeArchived: true });
assert.match(issuePage.content[0].text, /ENG-123.*Ship feature/);
assert.equal(issuePage.details.pageInfo.endCursor, 'issues-next');
assert.equal(calls.at(-1).variables.after, 'issues-cursor');
assert.equal(calls.at(-1).variables.includeArchived, true);
for (const action of ['add-issue', 'remove-issue']) {
  for (const issue of ['ENG-123', '11111111-1111-4111-8111-111111111111']) {
    const result = await executeRelease(client, { action, release: 'r1', issue });
    assert.equal(result.details.issue, issue);
    assert.deepEqual(calls.at(-1).variables, action === 'add-issue' ? { input: { issueId: issue, releaseId: 'r1' } } : { issueId: issue, releaseId: 'r1' });
  }
  failure = true;
  await assert.rejects(runReleaseOperation(client, { action, release: 'r1', issue: 'ENG-123' }), /Failed to/);
  failure = false;
  const count = calls.length;
  await assert.rejects(runReleaseOperation(client, { action, release: 'r1' }), /issue/);
  await assert.rejects(runReleaseOperation(client, { action, issue: 'ENG-123' }), /release/);
  assert.equal(calls.length, count);
}
assert.equal((await runReleaseOperation(client, { action: 'view', release: 'r1' })).id, 'r1');
await runReleaseOperation(client, { action: 'create', name: 'v1', pipelineId: 'p1', stageId: 's1', version: '1' });
assert.deepEqual(calls.at(-1).variables, { input: { name: 'v1', version: '1', pipelineId: 'p1', stageId: 's1' } });
await runReleaseOperation(client, { action: 'update', release: 'r1', description: null, targetDate: null });
assert.deepEqual(calls.at(-1).variables, { id: 'r1', input: { description: null, targetDate: null } });
for (const action of ['archive', 'unarchive', 'delete']) {
  assert.equal((await runReleaseOperation(client, { action, release: 'r1' })).releaseId, 'r1');
  failure = true;
  await assert.rejects(runReleaseOperation(client, { action, release: 'r1' }), /Failed/);
  failure = false;
}
failure = true;
for (const action of ['create', 'update']) await assert.rejects(runReleaseOperation(client, { action, release: 'r1', name: 'v1', pipelineId: 'p1' }), /Failed/);
failure = false;
const before = calls.length;
for (const params of [{ action: 'create', name: 'x' }, { action: 'create', pipelineId: 'p1' }, { action: 'view' }, { action: 'update', release: 'r1' }, { action: 'list', limit: 0 }, { action: 'list', limit: 1.5 }]) await assert.rejects(runReleaseOperation(client, params));
assert.equal(calls.length, before, 'invalid input must not make API calls');
await assert.rejects(runReleaseOperation({ rawRequest: async () => { throw new Error('Access denied'); } }, { action: 'list' }), /Access denied/);
await assert.rejects(runReleaseOperation({ rawRequest: async () => ({ data: { release: null } }) }, { action: 'view', release: 'missing' }), /not found/);

const tools = new Map();
const prev = process.env.LINEAR_API_KEY;
process.env.LINEAR_API_KEY = 'lin_test';
setTestClientFactory(() => client);
try {
  await extension({ registerTool: tool => tools.set(tool.name, tool), registerCommand() {}, sendMessage() {}, sendUserMessage() {} });
  const output = [];
  const originalLog = console.log;
  try {
    console.log = text => output.push(text);
    await runCli(['release', 'list', '--limit', '2', '--after', 'cli-cursor', '--include-archived']);
    assert.deepEqual(calls.at(-1).variables, { first: 2, after: 'cli-cursor', includeArchived: true });
    await runCli(['release', 'issues', 'r1', '--after', 'issues-cursor']);
    assert.match(output.at(-1), /ENG-123.*Ship feature/);
    await runCli(['release', 'add-issue', 'r1', '--issue', 'ENG-123']);
    assert.deepEqual(calls.at(-1).variables, { input: { issueId: 'ENG-123', releaseId: 'r1' } });
    await runCli(['release', 'remove-issue', 'r1', '--issue', 'ENG-123']);
    assert.deepEqual(calls.at(-1).variables, { issueId: 'ENG-123', releaseId: 'r1' });
    await runCli(['release', 'stages']);
    const stageLines = output.at(-1).split('\n');
    assert.equal(stageLines[0], '- **Started** `s1` — Pipeline: **App** (`p1`)');
    assert.equal(stageLines[1], '- **Started** `s2` — Pipeline: **Backend** (`p2`)');
    await runCli(['release', 'create', '--name', 'CLI release', '--pipeline-id', 'p1', '--version', '2']);
    assert.deepEqual(calls.at(-1).variables.input, { name: 'CLI release', pipelineId: 'p1', version: '2' });
    await runCli(['release', 'update', 'r1', '--stage-id', 's2']);
    assert.deepEqual(calls.at(-1).variables, { id: 'r1', input: { stageId: 's2' } });
  } finally { console.log = originalLog; }
  assert.ok(output.length >= 3);
  const tool = tools.get('linear_release');
  assert.ok(tool, 'release tool registered');
  assert.equal(tool.parameters.additionalProperties, false);
  const result = await tool.execute('call', { action: 'view', release: 'r1' });
  assert.equal(result.details.id, 'r1');
  for (const action of ['issues', 'add-issue', 'remove-issue']) {
    assert.ok(tool.parameters.properties.action.enum.includes(action));
    const membershipResult = await tool.execute('membership-call', { action, release: 'r1', issue: 'ENG-123' });
    assert.equal(membershipResult.details.releaseId, 'r1');
  }
} finally {
  resetTestClientFactory();
  if (prev === undefined) delete process.env.LINEAR_API_KEY; else process.env.LINEAR_API_KEY = prev;
}
console.log('Release queries, mutations, validation, pagination, failure handling, and extension tests passed');
