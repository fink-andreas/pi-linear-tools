#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { executeIssueDownload, issueDownloadInternals } from '../src/handlers.js';

function createMockClient(attachments) {
  return {
    async issue(identifier) {
      return {
        id: 'issue-1',
        identifier,
        title: 'Download test issue',
        description: 'Issue with attachments',
        url: `https://linear.app/test/issue/${identifier}/download-test`,
        branchName: 'test/download',
        priority: 0,
        estimate: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        state: Promise.resolve({ name: 'Todo', color: '#ccc', type: 'unstarted' }),
        team: Promise.resolve({ id: 'team-1', key: 'TST', name: 'Test' }),
        project: Promise.resolve(null),
        projectMilestone: Promise.resolve(null),
        assignee: Promise.resolve(null),
        creator: Promise.resolve(null),
        labels: async () => ({ nodes: [] }),
        parent: Promise.resolve(null),
        children: async () => ({ nodes: [] }),
        attachments: async () => ({ nodes: attachments }),
      };
    },
  };
}

function createFetch(body, headers = {}) {
  return async () => new Response(body, {
    status: 200,
    headers,
  });
}

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'pi-linear-tools-download-test-'));
  await fn(dir);
}

async function testSuccessfulDownload() {
  await withTempDir(async (cwd) => {
    const client = createMockClient([
      {
        id: 'att-1',
        title: 'Spec File.txt',
        url: 'https://example.com/spec.txt',
        subtitle: 'docs',
        sourceType: 'upload',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    const result = await executeIssueDownload(client, {
      issue: 'TST-1',
      directory: 'downloads',
    }, {
      cwd,
      settings: { allow_overwrite_files: false },
      fetchImpl: createFetch('hello world', { 'content-length': '11' }),
    });

    assert.match(result.content[0].text, /Downloaded \*\*Spec File\.txt\*\*/);
    assert.equal(result.details.bytesWritten, 11);
    assert.equal(result.details.relativePath, path.join('downloads', 'Spec File.txt'));
    assert.equal(await readFile(path.join(cwd, 'downloads', 'Spec File.txt'), 'utf-8'), 'hello world');
  });
}

async function testOverwriteGuardAndExistingFileBehavior() {
  await withTempDir(async (cwd) => {
    const client = createMockClient([
      { id: 'att-1', title: 'same.txt', url: 'https://example.com/same.txt' },
    ]);
    const downloads = path.join(cwd, 'downloads');
    await writeFile(path.join(cwd, 'placeholder'), 'x');
    await import('node:fs/promises').then(fs => fs.mkdir(downloads, { recursive: true }));
    await writeFile(path.join(downloads, 'same.txt'), 'old');

    await assert.rejects(
      executeIssueDownload(client, {
        issue: 'TST-1',
        directory: 'downloads',
        overwrite: true,
      }, {
        cwd,
        settings: { allow_overwrite_files: false },
        fetchImpl: createFetch('new'),
      }),
      /allow_overwrite_files=true/
    );

    await assert.rejects(
      executeIssueDownload(client, {
        issue: 'TST-1',
        directory: 'downloads',
      }, {
        cwd,
        settings: { allow_overwrite_files: false },
        fetchImpl: createFetch('new'),
      }),
      /already exists/
    );

    await executeIssueDownload(client, {
      issue: 'TST-1',
      directory: 'downloads',
      overwrite: true,
    }, {
      cwd,
      settings: { allow_overwrite_files: true },
      fetchImpl: createFetch('new'),
    });

    assert.equal(await readFile(path.join(downloads, 'same.txt'), 'utf-8'), 'new');
  });
}

async function testPathSafetyAndFilenameSanitization() {
  const { resolveSafeRelativeDirectory, sanitizeDownloadFilename, selectIssueAttachment } = issueDownloadInternals;
  assert.throws(() => resolveSafeRelativeDirectory('/tmp'), /relative/);
  assert.throws(() => resolveSafeRelativeDirectory('../outside', '/tmp/base'), /current working directory/);
  assert.equal(sanitizeDownloadFilename('../bad:name?.txt'), 'bad_name_.txt');

  assert.equal(
    selectIssueAttachment([
      { id: 'att-1', title: 'A' },
      { id: 'att-2', title: 'B' },
    ], { attachmentIndex: 2 }).id,
    'att-2'
  );
  assert.throws(
    () => selectIssueAttachment([{ id: 'a', title: 'Same' }, { id: 'b', title: 'Same' }], { attachmentTitle: 'same' }),
    /Multiple attachments/
  );
}

async function testMaxBytesGuards() {
  await withTempDir(async (cwd) => {
    const client = createMockClient([
      { id: 'att-1', title: 'large.bin', url: 'https://example.com/large.bin' },
    ]);

    await assert.rejects(
      executeIssueDownload(client, {
        issue: 'TST-1',
        directory: 'downloads',
        maxBytes: 2,
      }, {
        cwd,
        settings: {},
        fetchImpl: createFetch('abc', { 'content-length': '3' }),
      }),
      /exceeds maxBytes/
    );

    await assert.rejects(
      executeIssueDownload(client, {
        issue: 'TST-1',
        directory: 'downloads',
        maxBytes: 2,
        filename: 'stream.bin',
      }, {
        cwd,
        settings: {},
        fetchImpl: createFetch('abc'),
      }),
      /exceeds maxBytes/
    );
  });
}

async function main() {
  await testSuccessfulDownload();
  await testOverwriteGuardAndExistingFileBehavior();
  await testPathSafetyAndFilenameSanitization();
  await testMaxBytesGuards();
  console.log('✓ tests/test-issue-download.js passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
