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
    schemaVersion: 2,
    authMethod: 'api-key', // 'api-key' or 'oauth'
    apiKey: null, // Legacy API key (migrated from linearApiKey)
    oauth: {
      clientId: 'a3e177176c6697611367f1a2405d4a34',
      redirectUri: 'http://localhost:34711/callback',
    },
    defaultTeam: null,
    defaultWorkspace: null,
    projects: {},
  };
}

function migrateSettings(settings) {
  const migrated = { ...(settings || {}) };

  // Set default schema version if not set
  if (migrated.schemaVersion === undefined) {
    migrated.schemaVersion = 1;
  }

  // Migration from schema version 1 to 2
  if (migrated.schemaVersion === 1) {
    debug('Migrating settings from schema version 1 to 2');

    // Migrate linearApiKey to apiKey
    if (migrated.linearApiKey !== undefined) {
      migrated.apiKey = migrated.linearApiKey;
      delete migrated.linearApiKey;
    } else {
      migrated.apiKey = null;
    }

    // Set default auth method
    migrated.authMethod = 'api-key';

    // Add OAuth config
    if (!migrated.oauth || typeof migrated.oauth !== 'object') {
      migrated.oauth = {
        clientId: 'a3e177176c6697611367f1a2405d4a34',
        redirectUri: 'http://localhost:34711/callback',
      };
    }

    // Update schema version
    migrated.schemaVersion = 2;

    debug('Settings migration to version 2 complete');
  }

  // Ensure authMethod is set
  if (migrated.authMethod === undefined) {
    migrated.authMethod = 'api-key';
  }

  // Ensure apiKey is set (for backward compatibility)
  if (migrated.apiKey === undefined) {
    migrated.apiKey = null;
  }

  // Ensure oauth config exists
  if (!migrated.oauth || typeof migrated.oauth !== 'object') {
    migrated.oauth = {
      clientId: 'a3e177176c6697611367f1a2405d4a34',
      redirectUri: 'http://localhost:34711/callback',
    };
  }

  // Ensure oauth has clientId and redirectUri
  if (migrated.oauth.clientId === undefined) {
    migrated.oauth.clientId = 'a3e177176c6697611367f1a2405d4a34';
  }

  if (migrated.oauth.redirectUri === undefined) {
    migrated.oauth.redirectUri = 'http://localhost:34711/callback';
  }

  // Legacy: ensure linearApiKey is null (for validation)
  if (migrated.linearApiKey !== undefined) {
    delete migrated.linearApiKey;
  }

  if (migrated.defaultTeam === undefined) {
    migrated.defaultTeam = null;
  }

  if (migrated.defaultWorkspace === undefined) {
    migrated.defaultWorkspace = null;
  }

  // Remove deprecated debug_reload field
  if (Object.prototype.hasOwnProperty.call(migrated, 'debug_reload')) {
    delete migrated.debug_reload;
  }

  // Ensure projects is an object
  if (!migrated.projects || typeof migrated.projects !== 'object' || Array.isArray(migrated.projects)) {
    migrated.projects = {};
  }

  // Migrate project scopes
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

  // Validate authMethod
  if (settings.authMethod !== undefined && settings.authMethod !== null) {
    if (typeof settings.authMethod !== 'string') {
      errors.push('settings.authMethod must be a string');
    } else if (
!['api-key', 'oauth'].includes(settings.authMethod)
) {
      errors.push('settings.authMethod must be "api-key" or "oauth"');
    }
  }

  // Validate apiKey (for backward compatibility)
  if (settings.apiKey !== null && settings.apiKey !== undefined && typeof settings.apiKey !== 'string') {
    errors.push('settings.apiKey must be a string or null');
  }

  // Reject legacy linearApiKey field
  if (settings.linearApiKey !== undefined) {
    errors.push('settings.linearApiKey is deprecated. Use settings.apiKey instead.');
  }

  // Validate oauth config
  if (settings.oauth !== undefined && settings.oauth !== null) {
    if (typeof settings.oauth !== 'object' || Array.isArray(settings.oauth)) {
      errors.push('settings.oauth must be an object');
    } else {
      if (settings.oauth.clientId !== undefined && typeof settings.oauth.clientId !== 'string') {
        errors.push('settings.oauth.clientId must be a string');
      }
      if (settings.oauth.redirectUri !== undefined && typeof settings.oauth.redirectUri !== 'string') {
        errors.push('settings.oauth.redirectUri must be a string');
      }
    }
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
