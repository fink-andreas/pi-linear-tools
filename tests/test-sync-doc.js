#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defaultMarkerFromFile, extractManagedSegments, listSyncDocTargets, loadSyncDocTargets, runAllSyncDocs, runSyncDoc, upsertManagedContent } from '../src/sync-doc.js';

function createProjectPayload(content) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Example Project',
    description: '',
    content,
    color: '#123456',
    icon: null,
    priority: 2,
    progress: 42,
    health: 'onTrack',
    startDate: '2026-04-01',
    targetDate: '2026-06-30',
    slugId: 'abc123def456',
    url: 'https://linear.app/example/project/example-project-abc123def456',
    archivedAt: null,
    completedAt: null,
    canceledAt: null,
    status: {
      id: 'ps1',
      name: 'In Progress',
      type: 'started',
      color: '#abcdef',
    },
    lead: null,
    teams: {
      nodes: [{ id: 't1', key: 'GEN', name: 'General' }],
    },
    projectMilestones: {
      nodes: [],
    },
  };
}

async function withTempHome(fn) {
  const tempHome = await mkdtemp(join(tmpdir(), 'pi-linear-tools-sync-home-'));
  const previousHome = process.env.HOME;
  process.env.HOME = tempHome;
  try {
    await fn(tempHome);
  } finally {
    process.env.HOME = previousHome;
  }
}

async function testDefaultMarkerFromFile() {
  assert.equal(defaultMarkerFromFile('/tmp/README.md'), 'README');
  assert.equal(defaultMarkerFromFile('/tmp/vendor hidden.md'), 'vendor-hidden');
  console.log('✓ defaultMarkerFromFile');
}

async function testUpsertManagedContent() {
  const marker = 'README';
  const incoming = '# New content';

  const appended = upsertManagedContent('Intro', marker, incoming);
  assert.match(appended, /Intro/);
  assert.match(appended, /linear-tools:sync-start README/);
  assert.match(appended, /# New content/);

  const replaced = upsertManagedContent(
    'Intro\n\n<!-- linear-tools:sync-start README -->\nOld\n<!-- linear-tools:sync-end README -->\n\nTail',
    marker,
    incoming
  );
  assert.match(replaced, /Intro/);
  assert.match(replaced, /# New content/);
  assert.doesNotMatch(replaced, /\nOld\n/);
  assert.match(replaced, /Tail/);
  console.log('✓ upsertManagedContent');
}

async function testExtractManagedSegments() {
  const segments = extractManagedSegments(
    'Intro\n\n<!-- linear-tools:sync-start README -->\nManaged\n<!-- linear-tools:sync-end README -->\n\nTail',
    'README'
  );
  assert.equal(segments.hasManagedBlock, true);
  assert.equal(segments.before, 'Intro');
  assert.equal(segments.managed, 'Managed');
  assert.equal(segments.after, 'Tail');
  console.log('✓ extractManagedSegments');
}

async function testLoadSyncDocTargets() {
  await withTempHome(async (tempHome) => {
    const repoDir = await mkdtemp(join(tmpdir(), 'pi-linear-tools-sync-repo-'));
    await mkdir(join(repoDir, 'docs'), { recursive: true });
    await writeFile(join(repoDir, 'docs', 'README.md'), '# Repo doc\n', 'utf8');
    await writeFile(join(tempHome, '.linear-tools.json'), JSON.stringify({
      syncDocs: {
        targets: [
          {
            name: 'global-target',
            file: '/tmp/global.md',
            project: 'Global Project',
            field: 'description',
          },
        ],
      },
    }, null, 2));
    await writeFile(join(repoDir, '.linear-tools.json'), JSON.stringify({
      syncDocs: {
        targets: [
          {
            name: 'repo-target',
            file: 'docs/README.md',
            project: 'Repo Project',
          },
        ],
      },
    }, null, 2));

    const loaded = await loadSyncDocTargets({ cwd: repoDir });
    assert.equal(loaded.targets.length, 2);
    assert.equal(loaded.configPath, join(repoDir, '.linear-tools.json'));
    assert.equal(loaded.statePath, join(repoDir, '.linear-tools', 'sync-state.json'));
  });

  console.log('✓ loadSyncDocTargets');
}

async function testListSyncDocTargets() {
  await withTempHome(async () => {
    const repoDir = await mkdtemp(join(tmpdir(), 'pi-linear-tools-sync-list-'));
    await mkdir(join(repoDir, 'docs'), { recursive: true });
    await writeFile(join(repoDir, 'docs', 'README.md'), '# Repo doc\n', 'utf8');
    await writeFile(join(repoDir, '.linear-tools.json'), JSON.stringify({
      syncDocs: {
        targets: [
          {
            name: 'package-readme',
            file: 'docs/README.md',
            project: 'Example Project',
            field: 'content',
          },
        ],
      },
    }, null, 2));

    const listed = await listSyncDocTargets({ cwd: repoDir });
    assert.equal(listed.targets.length, 1);
    assert.equal(listed.targets[0].name, 'package-readme');
    assert.equal(listed.targets[0].entityType, 'project');
    assert.equal(listed.targets[0].field, 'content');
    assert.equal(listed.targets[0].marker, 'README');
    assert.equal(listed.targets[0].sourceConfigPath, join(repoDir, '.linear-tools.json'));
  });

  console.log('✓ listSyncDocTargets');
}

async function testRunSyncDocProjectTarget() {
  const repoDir = await mkdtemp(join(tmpdir(), 'pi-linear-tools-sync-project-'));
  const readmePath = join(repoDir, 'README.md');
  await writeFile(readmePath, '# Example Package\n\nActive runtime surface.\n', 'utf8');

  let remoteContent = 'Manual intro above.\n\n<!-- linear-tools:sync-start README -->\nOld content\n<!-- linear-tools:sync-end README -->\n\nManual tail below.';

  const mockClient = {
    projects: async () => ({
      nodes: [{
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Example Project',
        slugId: 'example-project-abc123def456',
      }],
    }),
    rawRequest: async (query, variables) => {
      if (query.includes('ProjectsLookup')) {
        return {
          data: {
            projects: {
              nodes: [{
                id: '11111111-1111-4111-8111-111111111111',
                name: 'Example Project',
                slugId: 'abc123def456',
                archivedAt: null,
              }],
            },
          },
          headers: new Headers(),
        };
      }

      if (query.includes('ProjectDetails')) {
        return {
          data: {
            project: createProjectPayload(remoteContent),
          },
          headers: new Headers(),
        };
      }

      if (query.includes('ProjectUpdate')) {
        remoteContent = variables.input.content
          .replace('<!-- linear-tools:sync-start README -->\n# Example Package', '<!-- linear-tools:sync-start README -->\n\n# Example Package')
          .replace('\nActive runtime surface.\n', '\n\nActive runtime surface.\n');
        return {
          data: {
            projectUpdate: {
              success: true,
              project: {
                id: '11111111-1111-4111-8111-111111111111',
              },
            },
          },
          headers: new Headers(),
        };
      }

      throw new Error(`Unexpected query: ${query}`);
    },
  };

  const result = await runSyncDoc(mockClient, {
    mode: 'run',
    cwd: repoDir,
    file: readmePath,
    project: 'https://linear.app/example/project/example-project-abc123def456',
    field: 'content',
  });

  assert.equal(result.changed, true);
  assert.match(remoteContent, /Manual intro above\./);
  assert.match(remoteContent, /linear-tools:sync-start README/);
  assert.match(remoteContent, /# Example Package/);
  assert.match(remoteContent, /Manual tail below\./);
  assert.ok(existsSync(join(repoDir, '.linear-tools', 'sync-state.json')));

  const state = JSON.parse(await readFile(join(repoDir, '.linear-tools', 'sync-state.json'), 'utf8'));
  assert.ok(state.targets.README);
  assert.ok(state.targets.README.sourceHash);
  assert.ok(state.targets.README.beforeHash);
  assert.ok(state.targets.README.afterHash);

  const followUp = await runSyncDoc(mockClient, {
    mode: 'check',
    cwd: repoDir,
    file: readmePath,
    project: 'https://linear.app/example/project/example-project-abc123def456',
    field: 'content',
  });

  assert.equal(followUp.changed, false);
  console.log('✓ runSyncDoc project target');
}

async function testRunAllSyncDocs() {
  const repoDir = await mkdtemp(join(tmpdir(), 'pi-linear-tools-sync-all-'));
  await mkdir(join(repoDir, 'docs'), { recursive: true });
  const alphaPath = join(repoDir, 'docs', 'alpha.md');
  const betaPath = join(repoDir, 'docs', 'beta.md');
  await writeFile(alphaPath, '# Alpha\n', 'utf8');
  await writeFile(betaPath, '# Beta\n', 'utf8');
  await writeFile(join(repoDir, '.linear-tools.json'), JSON.stringify({
    syncDocs: {
      targets: [
        {
          name: 'alpha-doc',
          file: 'docs/alpha.md',
          project: 'Project Alpha',
          field: 'content',
        },
        {
          name: 'beta-doc',
          file: 'docs/beta.md',
          project: 'Project Beta',
          field: 'content',
        },
      ],
    },
  }, null, 2));

  const remoteContentById = new Map([
    ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Alpha intro'],
    ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Beta intro'],
  ]);
  const projectByRef = new Map([
    ['Project Alpha', { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Project Alpha', slugId: 'project-alpha' }],
    ['Project Beta', { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Project Beta', slugId: 'project-beta' }],
  ]);

  const mockClient = {
    projects: async () => ({
      nodes: Array.from(projectByRef.values()),
    }),
    rawRequest: async (query, variables) => {
      if (query.includes('ProjectDetails')) {
        const projectId = variables.id;
        const project = Array.from(projectByRef.values()).find((entry) => entry.id === projectId);
        return {
          data: {
            project: {
              ...createProjectPayload(remoteContentById.get(projectId)),
              id: project.id,
              name: project.name,
              slugId: project.slugId,
              url: `https://linear.app/example/project/${project.slugId}`,
            },
          },
          headers: new Headers(),
        };
      }

      if (query.includes('ProjectUpdate')) {
        remoteContentById.set(variables.id, variables.input.content);
        return {
          data: {
            projectUpdate: {
              success: true,
              project: {
                id: variables.id,
              },
            },
          },
          headers: new Headers(),
        };
      }

      throw new Error(`Unexpected query: ${query}`);
    },
  };

  const checkResult = await runAllSyncDocs(mockClient, {
    mode: 'check',
    cwd: repoDir,
  });
  assert.equal(checkResult.total, 2);
  assert.equal(checkResult.changedCount, 2);
  assert.equal(checkResult.unchangedCount, 0);

  const runResult = await runAllSyncDocs(mockClient, {
    mode: 'run',
    cwd: repoDir,
  });
  assert.equal(runResult.total, 2);
  assert.equal(runResult.changedCount, 2);
  assert.match(remoteContentById.get('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), /# Alpha/);
  assert.match(remoteContentById.get('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), /# Beta/);

  const followUp = await runAllSyncDocs(mockClient, {
    mode: 'check',
    cwd: repoDir,
  });
  assert.equal(followUp.changedCount, 0);
  assert.equal(followUp.unchangedCount, 2);
  console.log('✓ runAllSyncDocs');
}

async function main() {
  await testDefaultMarkerFromFile();
  await testUpsertManagedContent();
  await testExtractManagedSegments();
  await testLoadSyncDocTargets();
  await testListSyncDocTargets();
  await testRunSyncDocProjectTarget();
  await testRunAllSyncDocs();
  console.log('✓ tests/test-sync-doc.js passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
