#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { resolveDefaultProject } from '../src/shared.js';

function isGitAvailable() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function testDefaultProjectUsesOriginAcrossPlatforms() {
  if (!isGitAvailable()) {
    console.log('⊘ Skipped default-project test: git is unavailable');
    return;
  }

  const repoDir = await mkdtemp(path.join(tmpdir(), 'linear-default-project-test-'));
  execFileSync('git', ['init', '--quiet', repoDir], { stdio: 'ignore' });
  execFileSync('git', ['-C', repoDir, 'remote', 'add', 'origin',
    'https://github.com/acme/project-from-origin.git'], { stdio: 'ignore' });

  assert.strictEqual(resolveDefaultProject(repoDir), 'project-from-origin');

  execFileSync('git', ['-C', repoDir, 'remote', 'set-url', 'origin',
    'git@github.com:acme/ssh-project.git'], { stdio: 'ignore' });
  assert.strictEqual(resolveDefaultProject(repoDir), 'ssh-project');
}

async function testDefaultProjectFallsBackToDirectoryName() {
  const directory = await mkdtemp(path.join(tmpdir(), 'linear-default-project-fallback-'));
  assert.strictEqual(resolveDefaultProject(directory), path.basename(directory));
}

async function main() {
  await testDefaultProjectUsesOriginAcrossPlatforms();
  await testDefaultProjectFallsBackToDirectoryName();
  console.log('✓ tests/test-default-project.js passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
