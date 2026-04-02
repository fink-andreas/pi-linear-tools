#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

async function main() {
  const packageJsonPath = resolve('package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'));

  assert.equal(packageJson.name, '@fink-andreas/pi-linear-tools');
  assert.ok(packageJson.pi, 'package.json must contain a pi manifest');
  assert.ok(Array.isArray(packageJson.pi.extensions), 'pi.extensions must be an array');
  assert.ok(packageJson.pi.extensions.includes('./index.js'), 'pi.extensions must include ./index.js');

  assert.ok(Array.isArray(packageJson.files), 'package.json files must be an array');
  assert.ok(packageJson.files.includes('index.js'), 'published files must include index.js');

  assert.ok(Array.isArray(packageJson.keywords), 'package.json keywords must be an array');
  assert.ok(packageJson.keywords.includes('pi-package'), 'package.json keywords must include pi-package');

  const entrypointPath = resolve('index.js');
  assert.ok(existsSync(entrypointPath), 'extension entrypoint file must exist');

  const entrypointSource = await readFile(entrypointPath, 'utf-8');
  assert.match(entrypointSource, /export \{ default \} from '\.\/extensions\/pi-linear-tools\.js';/, 'index.js must re-export the extension entrypoint');

  const extensionPath = resolve('extensions/pi-linear-tools.js');
  assert.ok(existsSync(extensionPath), 'extension implementation file must exist');

  const extensionSource = await readFile(extensionPath, 'utf-8');
  assert.match(extensionSource, /registerCommand\('linear-tools-config'/, 'extension must register config command');
  assert.match(extensionSource, /registerCommand\('linear-tools-help'/, 'extension must register help command');
  assert.match(extensionSource, /name: 'linear_issue'/, 'extension must register linear_issue tool');
  assert.match(extensionSource, /name: 'linear_project'/, 'extension must register linear_project tool');
  assert.match(extensionSource, /name: 'linear_project_update'/, 'extension must register linear_project_update tool');
  assert.match(extensionSource, /name: 'linear_team'/, 'extension must register linear_team tool');
  assert.match(extensionSource, /name: 'linear_milestone'/, 'extension must register linear_milestone tool');

  console.log('✓ tests/test-package-manifest.js passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
