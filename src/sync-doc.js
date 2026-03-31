import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';

import { fetchProjectDetails, resolveIssue, updateIssue, updateProject } from './linear.js';

const CONFIG_FILENAME = '.linear-tools.json';
const STATE_DIRNAME = '.linear-tools';
const STATE_FILENAME = 'sync-state.json';

function getHomeDir() {
  return process.env.HOME || process.env.USERPROFILE || '.';
}

function normalizeNewlines(value) {
  return String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function sha256(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

export function defaultMarkerFromFile(filePath) {
  const baseName = basename(filePath, extname(filePath)).trim();
  const sanitized = baseName.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized || 'sync';
}

export function buildSyncMarkers(marker) {
  return {
    start: `<!-- linear-tools:sync-start ${marker} -->`,
    end: `<!-- linear-tools:sync-end ${marker} -->`,
  };
}

export function upsertManagedContent(currentValue, marker, incomingContent) {
  const currentText = normalizeNewlines(currentValue);
  const nextBody = normalizeNewlines(incomingContent).trimEnd();
  const { start, end } = buildSyncMarkers(marker);
  const managedBlock = `${start}\n${nextBody}\n${end}`;

  const startIndex = currentText.indexOf(start);
  const endIndex = currentText.indexOf(end);

  if (startIndex === -1 && endIndex === -1) {
    const trimmedCurrent = currentText.trimEnd();
    if (!trimmedCurrent) {
      return managedBlock;
    }
    return `${trimmedCurrent}\n\n${managedBlock}`;
  }

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(`Unbalanced sync markers for marker "${marker}"`);
  }

  const secondStartIndex = currentText.indexOf(start, startIndex + start.length);
  const secondEndIndex = currentText.indexOf(end, endIndex + end.length);
  if (secondStartIndex !== -1 || secondEndIndex !== -1) {
    throw new Error(`Multiple sync marker blocks found for marker "${marker}"`);
  }

  const before = currentText.slice(0, startIndex).trimEnd();
  const after = currentText.slice(endIndex + end.length).trimStart();

  if (before && after) {
    return `${before}\n\n${managedBlock}\n\n${after}`;
  }

  if (before) {
    return `${before}\n\n${managedBlock}`;
  }

  if (after) {
    return `${managedBlock}\n\n${after}`;
  }

  return managedBlock;
}

export function extractManagedSegments(currentValue, marker) {
  const currentText = normalizeNewlines(currentValue);
  const { start, end } = buildSyncMarkers(marker);
  const startIndex = currentText.indexOf(start);
  const endIndex = currentText.indexOf(end);

  if (startIndex === -1 && endIndex === -1) {
    return {
      hasManagedBlock: false,
      before: currentText.trimEnd(),
      managed: '',
      after: '',
    };
  }

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(`Unbalanced sync markers for marker "${marker}"`);
  }

  const secondStartIndex = currentText.indexOf(start, startIndex + start.length);
  const secondEndIndex = currentText.indexOf(end, endIndex + end.length);
  if (secondStartIndex !== -1 || secondEndIndex !== -1) {
    throw new Error(`Multiple sync marker blocks found for marker "${marker}"`);
  }

  return {
    hasManagedBlock: true,
    before: currentText.slice(0, startIndex).trimEnd(),
    managed: currentText.slice(startIndex + start.length, endIndex).replace(/^\n+/, '').replace(/\n+$/, ''),
    after: currentText.slice(endIndex + end.length).trimStart(),
  };
}

function findNearestConfigPath(startDir) {
  let currentDir = resolve(startDir || process.cwd());

  while (true) {
    const candidate = join(currentDir, CONFIG_FILENAME);
    if (existsSync(candidate)) {
      return candidate;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

function getGlobalConfigPath() {
  return join(getHomeDir(), CONFIG_FILENAME);
}

function getConfigStatePath(configPath) {
  return join(dirname(configPath), STATE_DIRNAME, STATE_FILENAME);
}

function getFallbackStatePath(cwd) {
  return join(resolve(cwd || process.cwd()), STATE_DIRNAME, STATE_FILENAME);
}

async function loadConfigFile(configPath) {
  if (!configPath || !existsSync(configPath)) {
    return { path: configPath, targets: [] };
  }

  const parsed = JSON.parse(await readFile(configPath, 'utf8'));
  const rawTargets = parsed?.syncDocs?.targets;
  if (!Array.isArray(rawTargets)) {
    throw new Error(`Expected syncDocs.targets array in ${configPath}`);
  }

  const baseDir = dirname(configPath);
  const targets = rawTargets.map((target, index) => normalizeTargetConfig(target, baseDir, `${configPath}#${index + 1}`));
  return { path: configPath, targets };
}

function normalizeTargetConfig(target, baseDir, sourceLabel) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    throw new Error(`Invalid sync target at ${sourceLabel}`);
  }

  if (!target.file) {
    throw new Error(`Missing required field "file" at ${sourceLabel}`);
  }

  const entityType = target.project ? 'project' : target.issue ? 'issue' : null;
  if (!entityType) {
    throw new Error(`Sync target at ${sourceLabel} must include either "project" or "issue"`);
  }

  const filePath = isAbsolute(target.file) ? resolve(target.file) : resolve(baseDir, target.file);
  const marker = target.marker ? String(target.marker).trim() : defaultMarkerFromFile(filePath);
  const field = target.field ? String(target.field).trim() : (entityType === 'project' ? 'content' : 'description');

  if (entityType === 'project' && !['content', 'description'].includes(field)) {
    throw new Error(`Project sync target at ${sourceLabel} must use field "content" or "description"`);
  }

  if (entityType === 'issue' && field !== 'description') {
    throw new Error(`Issue sync target at ${sourceLabel} must use field "description"`);
  }

  return {
    name: target.name ? String(target.name).trim() : marker,
    file: filePath,
    project: target.project ? String(target.project).trim() : undefined,
    issue: target.issue ? String(target.issue).trim() : undefined,
    entityType,
    field,
    marker,
  };
}

function mergeTargets(globalTargets, localTargets) {
  const merged = new Map();

  for (const target of globalTargets) {
    merged.set(target.name, target);
  }

  for (const target of localTargets) {
    merged.set(target.name, target);
  }

  return Array.from(merged.values());
}

export async function loadSyncDocTargets({ cwd = process.cwd(), configPath } = {}) {
  if (configPath) {
    const explicitPath = isAbsolute(configPath) ? resolve(configPath) : resolve(cwd, configPath);
    const explicitConfig = await loadConfigFile(explicitPath);
    return {
      targets: explicitConfig.targets,
      configPath: explicitPath,
      statePath: getConfigStatePath(explicitPath),
    };
  }

  const globalConfigPath = getGlobalConfigPath();
  const localConfigPath = findNearestConfigPath(cwd);

  const globalConfig = await loadConfigFile(globalConfigPath);
  const localConfig = localConfigPath ? await loadConfigFile(localConfigPath) : { path: null, targets: [] };

  const targets = mergeTargets(globalConfig.targets, localConfig.targets);
  const activeConfigPath = localConfig.path || globalConfig.path || null;

  return {
    targets,
    configPath: activeConfigPath,
    statePath: activeConfigPath ? getConfigStatePath(activeConfigPath) : getFallbackStatePath(cwd),
  };
}

function buildInlineTargetFromFlags(flags, cwd) {
  if (!flags.file || (!flags.project && !flags.issue)) {
    return null;
  }

  return normalizeTargetConfig(
    {
      name: flags.target,
      file: flags.file,
      project: flags.project,
      issue: flags.issue,
      field: flags.field,
      marker: flags.marker,
    },
    cwd,
    'cli-flags'
  );
}

async function loadSyncState(statePath) {
  if (!existsSync(statePath)) {
    return { targets: {} };
  }

  try {
    const parsed = JSON.parse(await readFile(statePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { targets: {} };
    }
    if (!parsed.targets || typeof parsed.targets !== 'object' || Array.isArray(parsed.targets)) {
      return { targets: {} };
    }
    return parsed;
  } catch {
    return { targets: {} };
  }
}

async function saveSyncState(statePath, state) {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function selectTarget(targets, targetName) {
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error(`No sync targets configured. Add ${CONFIG_FILENAME} or pass --file with --project/--issue`);
  }

  if (targetName) {
    const match = targets.find((target) => target.name === targetName);
    if (!match) {
      throw new Error(`Sync target not found: ${targetName}`);
    }
    return match;
  }

  if (targets.length === 1) {
    return targets[0];
  }

  throw new Error(`Multiple sync targets are configured. Pass --target. Available: ${targets.map((target) => target.name).join(', ')}`);
}

async function getRemoteEntity(client, target) {
  if (target.entityType === 'project') {
    const project = await fetchProjectDetails(client, target.project);
    return {
      entityType: 'project',
      entityName: project.name,
      entityId: project.id,
      fieldValue: project[target.field] ?? '',
      update: async (nextValue) => updateProject(client, target.project, { [target.field]: nextValue }),
    };
  }

  const issue = await resolveIssue(client, target.issue);
  return {
    entityType: 'issue',
    entityName: issue.identifier || issue.title || issue.id,
    entityId: issue.id,
    fieldValue: issue.description ?? '',
    update: async (nextValue) => updateIssue(client, target.issue, { description: nextValue }),
  };
}

export async function runSyncDoc(client, options = {}) {
  const cwd = resolve(options.cwd || process.cwd());
  const mode = options.mode === 'check' ? 'check' : 'run';

  const inlineTarget = buildInlineTargetFromFlags(options, cwd);
  const loaded = await loadSyncDocTargets({ cwd, configPath: options.configPath });
  const target = inlineTarget || selectTarget(loaded.targets, options.targetName || options.target);
  const remoteEntity = await getRemoteEntity(client, target);

  const fileContent = await readFile(target.file, 'utf8');
  const sourceContent = normalizeNewlines(fileContent).trimEnd();
  const nextValue = upsertManagedContent(remoteEntity.fieldValue, target.marker, sourceContent);
  const currentValue = normalizeNewlines(remoteEntity.fieldValue);

  const statePath = inlineTarget ? getFallbackStatePath(cwd) : loaded.statePath;
  const state = await loadSyncState(statePath);
  const stateKey = target.name;
  const previousState = state.targets[stateKey] || {};

  const currentSegments = extractManagedSegments(currentValue, target.marker);
  const nextSegments = extractManagedSegments(nextValue, target.marker);
  const sourceHash = sha256(sourceContent);
  const beforeHash = sha256(currentSegments.before);
  const afterHash = sha256(currentSegments.after);
  const changed = currentSegments.hasManagedBlock
    ? previousState.sourceHash !== sourceHash || previousState.beforeHash !== beforeHash || previousState.afterHash !== afterHash
    : currentValue !== nextValue;

  const baseResult = {
    mode,
    changed,
    targetName: target.name,
    entityType: remoteEntity.entityType,
    entityName: remoteEntity.entityName,
    entityId: remoteEntity.entityId,
    field: target.field,
    marker: target.marker,
    file: target.file,
    configPath: loaded.configPath,
    statePath,
  };

  if (!changed) {
    state.targets[stateKey] = {
      ...previousState,
      lastCheckedAt: new Date().toISOString(),
      file: target.file,
      field: target.field,
      marker: target.marker,
      sourceHash,
      beforeHash,
      afterHash,
      changed: false,
    };
    await saveSyncState(statePath, state);
    return baseResult;
  }

  if (mode === 'check') {
    return {
      ...baseResult,
      beforeHash: sha256(currentValue),
      afterHash: sha256(nextValue),
      sourceHash,
    };
  }

  const updated = await remoteEntity.update(nextValue);
  state.targets[stateKey] = {
    lastSyncedAt: new Date().toISOString(),
    file: target.file,
    field: target.field,
    marker: target.marker,
    sourceHash,
    beforeHash: sha256(nextSegments.before),
    afterHash: sha256(nextSegments.after),
    changed: true,
  };
  await saveSyncState(statePath, state);

  return {
    ...baseResult,
    updatedEntityName: updated?.project?.name || updated?.issue?.identifier || remoteEntity.entityName,
    beforeHash: sha256(currentValue),
    afterHash: sha256(nextValue),
  };
}
