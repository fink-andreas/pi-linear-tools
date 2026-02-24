import { loadSettings, saveSettings } from './settings.js';
import { createLinearClient } from './linear-client.js';
import { resolveProjectRef } from './linear.js';

function readFlag(args, flag) {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
}

function printHelp() {
  console.log(`pi-linear-tools

Usage:
  pi-linear-tools help
  pi-linear-tools config
  pi-linear-tools config --api-key <key>
  pi-linear-tools config --default-team <team-key>
  pi-linear-tools config --team <team-key> --project <project-name-or-id>

This package is primarily used as a pi extension.
After enabling extension resources in pi config, use:
  /linear-tools-help
  /linear-tools-config --api-key <key>`);
}

async function tryResolveProjectId(projectRef, explicitApiKey = null) {
  const envKey = process.env.LINEAR_API_KEY;
  const apiKey = explicitApiKey || (envKey && envKey.trim() ? envKey.trim() : null);

  if (!apiKey) {
    return projectRef;
  }

  try {
    const client = createLinearClient(apiKey);
    const resolved = await resolveProjectRef(client, projectRef);
    return resolved.id;
  } catch {
    return projectRef;
  }
}

async function handleConfig(args) {
  const apiKey = readFlag(args, '--api-key');
  const defaultTeam = readFlag(args, '--default-team');
  const projectTeam = readFlag(args, '--team');
  const projectName = readFlag(args, '--project');

  if (apiKey) {
    const settings = await loadSettings();
    settings.linearApiKey = apiKey;
    await saveSettings(settings);
    console.log('LINEAR_API_KEY saved to settings');
    return;
  }

  if (defaultTeam) {
    const settings = await loadSettings();
    settings.defaultTeam = defaultTeam;
    await saveSettings(settings);
    console.log(`Default team set to: ${defaultTeam}`);
    return;
  }

  if (projectTeam) {
    if (!projectName) {
      throw new Error('Missing required flag: --project when using --team');
    }

    const settings = await loadSettings();
    const projectId = await tryResolveProjectId(projectName, settings.linearApiKey);

    if (!settings.projects[projectId]) {
      settings.projects[projectId] = { scope: { team: null } };
    }

    if (!settings.projects[projectId].scope) {
      settings.projects[projectId].scope = { team: null };
    }

    settings.projects[projectId].scope.team = projectTeam;
    await saveSettings(settings);
    console.log(`Team for project "${projectName}" set to: ${projectTeam}`);
    return;
  }

  const settings = await loadSettings();
  const hasKey = !!(settings.linearApiKey || process.env.LINEAR_API_KEY);
  const keySource = process.env.LINEAR_API_KEY ? 'environment' : (settings.linearApiKey ? 'settings' : 'not set');

  console.log(`Configuration:
  LINEAR_API_KEY: ${hasKey ? 'configured' : 'not set'} (source: ${keySource})
  Default team: ${settings.defaultTeam || 'not set'}
  Project team mappings: ${Object.keys(settings.projects || {}).length}

Commands:
  pi-linear-tools config --api-key lin_xxx
  pi-linear-tools config --default-team ENG
  pi-linear-tools config --team ENG --project MyProject`);
}

export async function runCli(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    return;
  }

  if (command === 'config') {
    await handleConfig(rest);
    return;
  }

  printHelp();
  process.exitCode = 1;
}
