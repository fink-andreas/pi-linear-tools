#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getDefaultSettings,
  validateSettings,
  loadSettings,
  saveSettings,
} from '../src/settings.js';

async function withTempHome(fn) {
  const tempHome = await mkdtemp(join(tmpdir(), 'pi-linear-tools-settings-test-home-'));
  const prevHome = process.env.HOME;
  process.env.HOME = tempHome;
  try {
    await fn(tempHome);
  } finally {
    process.env.HOME = prevHome;
  }
}

async function testDefaults() {
  const defaults = getDefaultSettings();
  assert.equal(defaults.schemaVersion, 2);
  assert.equal(defaults.apiKey, null);
  assert.equal(defaults.defaultTeam, null);
  assert.equal(defaults.defaultWorkspace, null);
  assert.deepEqual(defaults.projects, {});
}

async function testSaveAndLoad() {
  await withTempHome(async () => {
    const settings = {
      schemaVersion: 2,
      apiKey: 'lin_test',
      defaultTeam: 'ENG',
      projects: {
        'project-1': {
          scope: {
            team: 'ENG',
          },
        },
      },
    };

    await saveSettings(settings);
    const loaded = await loadSettings();

    assert.equal(loaded.apiKey, 'lin_test');
    assert.equal(loaded.defaultTeam, 'ENG');
    assert.equal(loaded.debug_reload, undefined);
    assert.equal(loaded.projects['project-1'].scope.team, 'ENG');
  });
}

async function testValidation() {
  const valid = validateSettings(getDefaultSettings());
  assert.equal(valid.valid, true);

  const invalid = validateSettings({ schemaVersion: 2, projects: [] });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.length > 0);
}

async function main() {
  await testDefaults();
  await testSaveAndLoad();
  await testValidation();
  console.log('✓ tests/test-settings.js passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
