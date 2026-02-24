/**
 * Settings loader for pi-linear-tools
 * Reads configuration from ~/.pi/agent/extensions/pi-linear-tools/settings.json
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { debug, warn, error as logError } from './logger.js';

export function getDefaultSettings() {
  return {
    schemaVersion: 1,
    linearApiKey: null,
    defaultTeam: null,
    defaultWorkspace: null,
    projects: {},
  };
}

function migrateSettings(settings) {
  const migrated = { ...(settings || {}) };

  if (migrated.schemaVersion === undefined) {
    migrated.schemaVersion = 1;
  }

  if (migrated.linearApiKey === undefined) {
    migrated.linearApiKey = null;
  }

  if (migrated.defaultTeam === undefined) {
    migrated.defaultTeam = null;
  }

  if (migrated.defaultWorkspace === undefined) {
    migrated.defaultWorkspace = null;
  }

  if (!migrated.projects || typeof migrated.projects !== 'object' || Array.isArray(migrated.projects)) {
    migrated.projects = {};
  }

  for (const [projectId, cfg] of Object.entries(migrated.projects)) {
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
      migrated.projects[projectId] = { scope: { team: null } };
      continue;
    }

    if (!cfg.scope || typeof cfg.scope !== 'object' || Array.isArray(cfg.scope)) {
      cfg.scope = { team: null };
      continue;
    }

    if (cfg.scope.team === undefined) {
      cfg.scope.team = null;
    }
  }

  return migrated;
}

export function validateSettings(settings) {
  const errors = [];

  if (!settings || typeof settings !== 'object') {
    return { valid: false, errors: ['Settings must be an object'] };
  }

  if (typeof settings.schemaVersion !== 'number' || settings.schemaVersion < 1) {
    errors.push('settings.schemaVersion must be a positive number');
  }

  if (settings.linearApiKey !== null && settings.linearApiKey !== undefined && typeof settings.linearApiKey !== 'string') {
    errors.push('settings.linearApiKey must be a string or null');
  }

  if (settings.defaultTeam !== null && settings.defaultTeam !== undefined && typeof settings.defaultTeam !== 'string') {
    errors.push('settings.defaultTeam must be a string or null');
  }

  if (settings.defaultWorkspace !== null && settings.defaultWorkspace !== undefined) {
    if (typeof settings.defaultWorkspace !== 'object' || Array.isArray(settings.defaultWorkspace)) {
      errors.push('settings.defaultWorkspace must be an object or null');
    } else {
      if (typeof settings.defaultWorkspace.id !== 'string' || !settings.defaultWorkspace.id.trim()) {
        errors.push('settings.defaultWorkspace.id must be a non-empty string');
      }
      if (typeof settings.defaultWorkspace.name !== 'string' || !settings.defaultWorkspace.name.trim()) {
        errors.push('settings.defaultWorkspace.name must be a non-empty string');
      }
    }
  }

  if (settings.projects !== undefined) {
    if (typeof settings.projects !== 'object' || settings.projects === null || Array.isArray(settings.projects)) {
      errors.push('settings.projects must be an object map keyed by Linear project id');
    } else {
      for (const [projectId, cfg] of Object.entries(settings.projects)) {
        if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
          errors.push(`settings.projects.${projectId} must be an object`);
          continue;
        }

        if (!cfg.scope || typeof cfg.scope !== 'object' || Array.isArray(cfg.scope)) {
          errors.push(`settings.projects.${projectId}.scope must be an object`);
          continue;
        }

        if (cfg.scope.team !== undefined && cfg.scope.team !== null && typeof cfg.scope.team !== 'string') {
          errors.push(`settings.projects.${projectId}.scope.team must be a string or null`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function getSettingsPath() {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
  return join(homeDir, '.pi', 'agent', 'extensions', 'pi-linear-tools', 'settings.json');
}

export async function loadSettings() {
  const settingsPath = getSettingsPath();
  debug('Settings path', { path: settingsPath });

  if (!existsSync(settingsPath)) {
    debug('Settings file not found, using defaults', { path: settingsPath });
    return getDefaultSettings();
  }

  try {
    const content = await readFile(settingsPath, 'utf-8');
    const parsed = JSON.parse(content);
    const settings = migrateSettings(parsed);
    const validation = validateSettings(settings);

    if (!validation.valid) {
      warn('Settings validation failed, using defaults', {
        path: settingsPath,
        errors: validation.errors,
      });
      return getDefaultSettings();
    }

    return settings;
  } catch (err) {
    if (err instanceof SyntaxError) {
      logError('Settings file contains invalid JSON', { path: settingsPath, error: err.message });
    } else {
      logError('Failed to load settings file', { path: settingsPath, error: err.message });
    }

    return getDefaultSettings();
  }
}

export async function saveSettings(settings) {
  const settingsPath = getSettingsPath();
  const parentDir = dirname(settingsPath);

  const migrated = migrateSettings(settings);
  const validation = validateSettings(migrated);
  if (!validation.valid) {
    throw new Error(`Cannot save invalid settings: ${validation.errors.join('; ')}`);
  }

  await mkdir(parentDir, { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(migrated, null, 2)}\n`, 'utf-8');
  return settingsPath;
}
