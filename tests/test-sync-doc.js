#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  defaultMarkerFromFile,
  explainSyncDocSetup,
  extractManagedSegments,
  initSyncDocConfig,
  listSyncDocTargets,
  loadSyncDocTargets,
  runAllSyncDocs,
  runSyncDoc,
  upsertManagedContent,
} from '../src/sync-doc.js';

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

async function testLoadSyncDocTargetsUsesFolderConfig() {
  await withTempHome(async (tempHome) => {
    const repoDir = await mkdtemp(join(tmpdir(), 'pi-linear-tools-sync-repo-'));
    await mkdir(join(repoDir, '.linear-tools'), { recursive: true });
    await mkdir(join(repoDir, 'docs'), { recursive: true });
    await writeFile(join(repoDir, 'docs', 'README.md'), '# Repo doc\n', 'utf8');

    await mkdir(join(tempHome, '.linear-tools'), { recursive: true });
    await writeFile(join(tempHome, '.linear-tools', 'config.json'), JSON.stringify({
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

    await writeFile(join(repoDir, '.linear-tools', 'config.json'), JSON.stringify({
      syncDocs: {
        targets: [
          {
            name: 'repo-target',
            file: 'docs/README.md',
            project: 'Repo Project',
            field: 'content',
            documentIndexMarker: 'repo-doc-links',
          },
          {
            name: 'repo-doc',
            targetType: 'document',
            file: 'docs/README.md',
            project: 'Repo Project',
            title: 'Repo Doc',
          },
        ],
      },
    }, null, 2));

    const loaded = await loadSyncDocTargets({ cwd: repoDir });
    assert.equal(loaded.targets.length, 3);
    assert.equal(loaded.configPath, join(repoDir, '.linear-tools', 'config.json'));
    assert.equal(loaded.statePath, join(repoDir, '.linear-tools', 'sync-state.json'));
    assert.equal(loaded.targets.find((target) => target.name === 'repo-doc')?.targetType, 'document');
  });

  console.log('✓ loadSyncDocTargets uses .linear-tools/config.json');
}

async function testListSyncDocTargetsIncludesDocumentTargets() {
  await withTempHome(async () => {
    const repoDir = await mkdtemp(join(tmpdir(), 'pi-linear-tools-sync-list-'));
    await mkdir(join(repoDir, '.linear-tools'), { recursive: true });
    await mkdir(join(repoDir, 'providers'), { recursive: true });
    await writeFile(join(repoDir, 'README.md'), '# Overview\n', 'utf8');
    await writeFile(join(repoDir, 'providers', 'README.md'), '# Provider\n', 'utf8');
    await writeFile(join(repoDir, '.linear-tools', 'config.json'), JSON.stringify({
      syncDocs: {
        targets: [
          {
            name: 'project-overview',
            file: 'README.md',
            project: 'Example Project',
            field: 'content',
            marker: 'project-overview',
            documentIndexMarker: 'project-doc-links',
          },
          {
            name: 'provider-doc',
            targetType: 'document',
            file: 'providers/README.md',
            project: 'Example Project',
            title: 'Provider Doc',
            marker: 'provider-doc',
          },
        ],
      },
    }, null, 2));

    const listed = await listSyncDocTargets({ cwd: repoDir });
    assert.equal(listed.targets.length, 2);
    assert.equal(listed.targets[0].sourceConfigPath, join(repoDir, '.linear-tools', 'config.json'));
    assert.equal(listed.targets[1].targetType, 'document');
    assert.equal(listed.targets[1].title, 'Provider Doc');
  });

  console.log('✓ listSyncDocTargets includes document targets');
}

async function testInitSyncDocConfigCreatesStarterConfig() {
  const repoDir = await mkdtemp(join(tmpdir(), 'pi-linear-tools-sync-init-'));
  const nestedDir = join(repoDir, 'packages', 'feature');
  await mkdir(nestedDir, { recursive: true });

  const result = await initSyncDocConfig({
    cwd: nestedDir,
    project: 'Project name or ID',
    file: 'README.md',
  });

  assert.equal(result.created, true);
  assert.equal(result.configPath, join(nestedDir, '.linear-tools', 'config.json'));
  assert.equal(result.statePath, join(nestedDir, '.linear-tools', 'sync-state.json'));

  const config = JSON.parse(await readFile(result.configPath, 'utf8'));
  assert.equal(config.syncDocs.targets.length, 1);
  assert.deepEqual(config.syncDocs.targets[0], {
    name: 'project-overview',
    file: 'README.md',
    project: 'Project name or ID',
    field: 'content',
    marker: 'project-overview',
    documentIndexMarker: 'project-documents',
  });

  console.log('✓ initSyncDocConfig creates starter config');
}

async function testExplainSyncDocSetupMentionsNearestConfig() {
  const explanation = explainSyncDocSetup();
  assert.match(explanation, /nearest `?\.linear-tools\/config\.json`?/i);
  assert.match(explanation, /smallest folder/i);
  assert.match(explanation, /projectField/i);
  assert.match(explanation, /targetType: "document"/i);
  console.log('✓ explainSyncDocSetup');
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

  console.log('✓ runSyncDoc project target');
}

async function testRunAllSyncDocsCreatesDocumentAndIndex() {
  const repoDir = await mkdtemp(join(tmpdir(), 'pi-linear-tools-sync-all-'));
  await mkdir(join(repoDir, '.linear-tools'), { recursive: true });
  await mkdir(join(repoDir, 'providers', 'hud'), { recursive: true });
  await writeFile(join(repoDir, 'README.md'), '# Census Data\n\nOverview content.\n', 'utf8');
  await writeFile(join(repoDir, 'providers', 'hud', 'README.md'), '# HUD Provider\n\nProvider details.\n', 'utf8');
  await writeFile(join(repoDir, '.linear-tools', 'config.json'), JSON.stringify({
    syncDocs: {
      targets: [
        {
          name: 'census-readme',
          file: 'README.md',
          project: 'Census Data',
          field: 'content',
          marker: 'census-readme',
          documentIndexMarker: 'census-documents',
          documentIndexHeading: 'Linked docs',
        },
        {
          name: 'census-provider-hud-readme',
          targetType: 'document',
          file: 'providers/hud/README.md',
          project: 'Census Data',
          title: 'HUD Provider',
          marker: 'census-provider-hud-readme',
        },
      ],
    },
  }, null, 2));

  let remoteProjectContent = [
    '<!-- linear-tools:sync-start README -->',
    'Old overview',
    '<!-- linear-tools:sync-end README -->',
    '',
    '<!-- linear-tools:sync-start census-provider-hud-readme -->',
    'Old HUD provider content',
    '<!-- linear-tools:sync-end census-provider-hud-readme -->',
  ].join('\n');
  const documents = new Map();
  let nextDocumentId = 1;

  const mockClient = {
    projects: async () => ({
      nodes: [{
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Census Data',
        slugId: 'census-data-abc123',
      }],
    }),
    issue: async () => null,
    rawRequest: async (query, variables) => {
      if (query.includes('ProjectsLookup')) {
        return {
          data: {
            projects: {
              nodes: [{
                id: '11111111-1111-4111-8111-111111111111',
                name: 'Census Data',
                slugId: 'census-data-abc123',
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
            project: createProjectPayload(remoteProjectContent),
          },
          headers: new Headers(),
        };
      }

      if (query.includes('ProjectUpdate')) {
        remoteProjectContent = variables.input.content;
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

      if (query.includes('DocumentCreate')) {
        const id = `doc-${nextDocumentId}`;
        nextDocumentId += 1;
        documents.set(id, {
          id,
          title: variables.input.title,
          content: variables.input.content,
          icon: variables.input.icon ?? null,
          color: variables.input.color ?? null,
          slugId: `${id}-slug`,
          url: `https://linear.app/example/document/${id}-slug`,
          archivedAt: null,
          createdAt: '2026-03-31T00:00:00.000Z',
          updatedAt: '2026-03-31T00:00:00.000Z',
          project: {
            id: variables.input.projectId,
            name: 'Census Data',
          },
          issue: null,
        });

        return {
          data: {
            documentCreate: {
              success: true,
              document: { id },
            },
          },
          headers: new Headers(),
        };
      }

      if (query.includes('DocumentDetails')) {
        return {
          data: {
            document: documents.get(variables.id) || null,
          },
          headers: new Headers(),
        };
      }

      if (query.includes('DocumentUpdate')) {
        const existing = documents.get(variables.id);
        documents.set(variables.id, {
          ...existing,
          ...variables.input,
          updatedAt: '2026-03-31T01:00:00.000Z',
        });
        return {
          data: {
            documentUpdate: {
              success: true,
              document: { id: variables.id },
            },
          },
          headers: new Headers(),
        };
      }

      throw new Error(`Unexpected query: ${query}`);
    },
  };

  const result = await runAllSyncDocs(mockClient, {
    mode: 'run',
    cwd: repoDir,
  });

  assert.equal(result.total, 2);
  assert.equal(result.changedCount, 2);
  assert.equal(documents.size, 1);
  assert.match(remoteProjectContent, /linear-tools:sync-start census-readme/);
  assert.match(remoteProjectContent, /linear-tools:sync-start census-documents/);
  assert.match(remoteProjectContent, /## Linked docs/);
  assert.match(remoteProjectContent, /\[HUD Provider\]\(https:\/\/linear\.app\/example\/document\/doc-1-slug\)/);
  assert.doesNotMatch(remoteProjectContent, /linear-tools:sync-start README/);
  assert.doesNotMatch(remoteProjectContent, /linear-tools:sync-start census-provider-hud-readme/);

  const state = JSON.parse(await readFile(join(repoDir, '.linear-tools', 'sync-state.json'), 'utf8'));
  assert.equal(state.targets['census-provider-hud-readme'].documentId, 'doc-1');
  assert.equal(state.targets['census-provider-hud-readme'].documentTitle, 'HUD Provider');
  assert.equal(state.targets['census-readme'].marker, 'census-readme');
  console.log('✓ runAllSyncDocs creates linked documents and project index');
}

async function main() {
  await testDefaultMarkerFromFile();
  await testUpsertManagedContent();
  await testExtractManagedSegments();
  await testLoadSyncDocTargetsUsesFolderConfig();
  await testListSyncDocTargetsIncludesDocumentTargets();
  await testInitSyncDocConfigCreatesStarterConfig();
  await testExplainSyncDocSetupMentionsNearestConfig();
  await testRunSyncDocProjectTarget();
  await testRunAllSyncDocsCreatesDocumentAndIndex();
  console.log('✓ tests/test-sync-doc.js passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
