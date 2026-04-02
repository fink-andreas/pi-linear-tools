import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';

import {
  createDocument,
  fetchDocumentDetails,
  fetchProjectDetails,
  resolveIssue,
  resolveProjectRef,
  updateDocument,
  updateIssue,
  updateProject,
} from './linear.js';

const CONFIG_DIRNAME = '.linear-tools';
const CONFIG_FILENAME = 'config.json';
const STATE_FILENAME = 'sync-state.json';

function getHomeDir() {
  return process.env.HOME || process.env.USERPROFILE || '.';
}

function getConfigDisplayPath() {
  return `${CONFIG_DIRNAME}/${CONFIG_FILENAME}`;
}

function toPortablePath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function normalizeNewlines(value) {
  return String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function sha256(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function isPathWithinBaseDir(baseDir, targetPath) {
  const relativePath = relative(resolve(baseDir), resolve(targetPath));
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function defaultDocumentTitleFromFile(filePath) {
  const baseName = basename(filePath, extname(filePath)).trim();
  return baseName || 'Document';
}

function normalizeRefKey(value) {
  return String(value || '').trim().toLowerCase();
}

function serializeHashPayload(value) {
  return JSON.stringify(value || {});
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
  const managedBlock = nextBody
    ? `${start}\n\n${nextBody}\n\n${end}`
    : `${start}\n\n${end}`;

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

export function upsertManagedContentWithPosition(currentValue, marker, incomingContent, position = 'bottom') {
  if (position !== 'top') {
    return upsertManagedContent(currentValue, marker, incomingContent);
  }

  const currentText = normalizeNewlines(currentValue);
  const nextBody = normalizeNewlines(incomingContent).trimEnd();
  const { start, end } = buildSyncMarkers(marker);
  const managedBlock = nextBody
    ? `${start}\n\n${nextBody}\n\n${end}`
    : `${start}\n\n${end}`;

  const startIndex = currentText.indexOf(start);
  const endIndex = currentText.indexOf(end);

  if (startIndex === -1 && endIndex === -1) {
    const trimmedCurrent = currentText.trim();
    if (!trimmedCurrent) {
      return managedBlock;
    }
    return `${managedBlock}\n\n${trimmedCurrent}`;
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
  const remainder = [before, after].filter(Boolean).join('\n\n');

  if (!remainder) {
    return managedBlock;
  }

  return `${managedBlock}\n\n${remainder}`;
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

export function removeManagedContent(currentValue, marker) {
  const currentText = normalizeNewlines(currentValue);
  const { start, end } = buildSyncMarkers(marker);
  const startIndex = currentText.indexOf(start);
  const endIndex = currentText.indexOf(end);

  if (startIndex === -1 && endIndex === -1) {
    return currentText;
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
    return `${before}\n\n${after}`;
  }

  if (before) {
    return before;
  }

  if (after) {
    return after;
  }

  return '';
}

function resolveConfigInputPath(configPath, cwd) {
  const resolvedPath = isAbsolute(configPath) ? resolve(configPath) : resolve(cwd, configPath);

  if (existsSync(resolvedPath) && statSync(resolvedPath).isDirectory()) {
    return join(resolvedPath, CONFIG_FILENAME);
  }

  if (basename(resolvedPath) === CONFIG_DIRNAME) {
    return join(resolvedPath, CONFIG_FILENAME);
  }

  return resolvedPath;
}

function findNearestConfigPath(startDir) {
  let currentDir = resolve(startDir || process.cwd());

  while (true) {
    const candidate = join(currentDir, CONFIG_DIRNAME, CONFIG_FILENAME);
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
  return join(getHomeDir(), CONFIG_DIRNAME, CONFIG_FILENAME);
}

function getConfigStatePath(configPath) {
  return join(dirname(configPath), STATE_FILENAME);
}

function getFallbackStatePath(cwd) {
  return join(resolve(cwd || process.cwd()), CONFIG_DIRNAME, STATE_FILENAME);
}

function getConfigDirPath(cwd) {
  return join(resolve(cwd || process.cwd()), CONFIG_DIRNAME);
}

function toConfigFileReference(targetDir, filePath) {
  if (!filePath) {
    return 'README.md';
  }

  const resolvedFile = isAbsolute(filePath) ? resolve(filePath) : resolve(targetDir, filePath);
  const relativePath = relative(targetDir, resolvedFile);

  if (relativePath && !relativePath.startsWith('..') && !isAbsolute(relativePath)) {
    return toPortablePath(relativePath);
  }

  return toPortablePath(resolvedFile);
}

function buildInitTarget(options = {}) {
  const targetDir = resolve(options.cwd || process.cwd());
  const fileRef = toConfigFileReference(targetDir, options.file);
  const marker = options.marker ? String(options.marker).trim() : 'project-overview';

  return {
    name: options.name ? String(options.name).trim() : 'project-overview',
    file: fileRef,
    project: options.project ? String(options.project).trim() : 'Project name or ID',
    field: options.field ? String(options.field).trim() : 'content',
    marker,
    documentIndexMarker: options.documentIndexMarker
      ? String(options.documentIndexMarker).trim()
      : 'project-documents',
  };
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

  const baseDir = dirname(dirname(configPath));
  const targets = rawTargets.map((target, index) => normalizeTargetConfig(
    target,
    baseDir,
    `${configPath}#${index + 1}`,
    configPath
  ));

  return { path: configPath, targets };
}

function normalizeTargetConfig(target, baseDir, sourceLabel, sourceConfigPath) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    throw new Error(`Invalid sync target at ${sourceLabel}`);
  }

  if (!target.file) {
    throw new Error(`Missing required field "file" at ${sourceLabel}`);
  }

  const filePath = isAbsolute(target.file) ? resolve(target.file) : resolve(baseDir, target.file);
  if (!isPathWithinBaseDir(baseDir, filePath)) {
    throw new Error(`Sync target file must stay within ${baseDir}: ${target.file}`);
  }

  const marker = target.marker ? String(target.marker).trim() : defaultMarkerFromFile(filePath);
  const explicitType = target.targetType ? String(target.targetType).trim() : null;
  const allowedTypes = ['projectField', 'issueField', 'document'];

  if (explicitType && !allowedTypes.includes(explicitType)) {
    throw new Error(`Invalid targetType "${explicitType}" at ${sourceLabel}`);
  }

  const targetType = explicitType
    || (target.issue ? 'issueField' : target.project ? 'projectField' : null);

  if (!targetType) {
    throw new Error(`Sync target at ${sourceLabel} must declare targetType or include project/issue`);
  }

  if (targetType === 'document') {
    const hasProject = Boolean(target.project);
    const hasIssue = Boolean(target.issue);
    if (hasProject === hasIssue) {
      throw new Error(`Document sync target at ${sourceLabel} must include exactly one of "project" or "issue"`);
    }

    return {
      name: target.name ? String(target.name).trim() : marker,
      targetType,
      file: filePath,
      project: target.project ? String(target.project).trim() : undefined,
      issue: target.issue ? String(target.issue).trim() : undefined,
      title: target.title ? String(target.title).trim() : defaultDocumentTitleFromFile(filePath),
      documentId: target.documentId ? String(target.documentId).trim() : undefined,
      icon: target.icon !== undefined ? String(target.icon) : undefined,
      color: target.color !== undefined ? String(target.color) : undefined,
      marker,
      includeInProjectIndex: target.includeInProjectIndex !== false,
      sourceConfigPath: sourceConfigPath || null,
    };
  }

  if (targetType === 'issueField') {
    const field = target.field ? String(target.field).trim() : 'description';
    if (field !== 'description') {
      throw new Error(`Issue sync target at ${sourceLabel} must use field "description"`);
    }

    return {
      name: target.name ? String(target.name).trim() : marker,
      targetType,
      file: filePath,
      issue: String(target.issue || '').trim(),
      field,
      marker,
      sourceConfigPath: sourceConfigPath || null,
    };
  }

  const field = target.field ? String(target.field).trim() : 'content';
  if (!['content', 'description'].includes(field)) {
    throw new Error(`Project sync target at ${sourceLabel} must use field "content" or "description"`);
  }

  return {
    name: target.name ? String(target.name).trim() : marker,
    targetType,
    file: filePath,
    project: String(target.project || '').trim(),
    field,
    marker,
    cleanupMarkers: Array.isArray(target.cleanupMarkers)
      ? target.cleanupMarkers.map((value) => String(value || '').trim()).filter(Boolean)
      : [],
    documentIndexMarker: target.documentIndexMarker ? String(target.documentIndexMarker).trim() : undefined,
    documentIndexHeading: target.documentIndexHeading ? String(target.documentIndexHeading).trim() : 'Related docs',
    documentIndexPosition: target.documentIndexPosition ? String(target.documentIndexPosition).trim() : 'top',
    sourceConfigPath: sourceConfigPath || null,
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
    const explicitPath = resolveConfigInputPath(configPath, cwd);
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
  const activeConfigPath = localConfig.path || globalConfig.path || null;

  return {
    targets: mergeTargets(globalConfig.targets, localConfig.targets),
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
      targetType: flags.targetType,
      file: flags.file,
      project: flags.project,
      issue: flags.issue,
      field: flags.field,
      marker: flags.marker,
      title: flags.title || flags.documentTitle,
      documentId: flags.documentId,
      documentIndexMarker: flags.documentIndexMarker,
      documentIndexHeading: flags.documentIndexHeading,
    },
    cwd,
    'cli-flags',
    null
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

async function getExecutionState(statePath, context = {}) {
  if (context.sharedState) {
    return context.sharedState;
  }

  return loadSyncState(statePath);
}

async function saveExecutionState(statePath, state, context = {}) {
  if (context.sharedState) {
    context.sharedState = state;
    if (context.persistState === true) {
      await saveSyncState(statePath, state);
    }
    return;
  }

  if (context.persistState === false) {
    return;
  }

  await saveSyncState(statePath, state);
}

async function prepareTargetsForExecution(client, targets = []) {
  const projectCache = new Map();
  const issueCache = new Map();

  return Promise.all(targets.map(async (target) => {
    const prepared = { ...target };

    if (target.project) {
      const cacheKey = normalizeRefKey(target.project);
      if (!projectCache.has(cacheKey)) {
        projectCache.set(cacheKey, await resolveProjectRef(client, target.project));
      }
      prepared.resolvedProjectId = projectCache.get(cacheKey)?.id || null;
    }

    if (target.issue) {
      const cacheKey = normalizeRefKey(target.issue);
      if (!issueCache.has(cacheKey)) {
        issueCache.set(cacheKey, await resolveIssue(client, target.issue));
      }
      prepared.resolvedIssueId = issueCache.get(cacheKey)?.id || null;
    }

    return prepared;
  }));
}

export async function initSyncDocConfig(options = {}) {
  const targetDir = resolve(options.cwd || process.cwd());
  const configDir = getConfigDirPath(targetDir);
  const configPath = join(configDir, CONFIG_FILENAME);
  const statePath = join(configDir, STATE_FILENAME);
  const force = options.force === true;
  const existed = existsSync(configPath);

  if (existed && !force) {
    return {
      created: false,
      overwritten: false,
      configPath,
      statePath,
      cwd: targetDir,
      target: null,
    };
  }

  const target = buildInitTarget({
    cwd: targetDir,
    file: options.file,
    project: options.project,
    field: options.field,
    marker: options.marker,
    name: options.name,
    documentIndexMarker: options.documentIndexMarker,
  });

  const payload = {
    syncDocs: {
      targets: [target],
    },
  };

  await mkdir(configDir, { recursive: true });
  await writeFile(configPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  return {
    created: true,
    overwritten: existed && force,
    configPath,
    statePath,
    cwd: targetDir,
    target,
  };
}

export function explainSyncDocSetup() {
  return [
    'Sync-doc setup model:',
    '- Put `.linear-tools/config.json` in the smallest folder that owns the docs you are syncing.',
    '- The CLI resolves the nearest `.linear-tools/config.json` from the current directory upward.',
    '- Use repo root only for targets intentionally shared across multiple subprojects.',
    '- Use one `projectField` target for the project overview in `content` or `description`.',
    '- Use `targetType: "document"` for deeper docs that should become separate Linear documents.',
    '- Let the overview target set `documentIndexMarker` so it maintains a managed links block to those documents.',
    '- `sync-doc run` and `sync-doc check` default to all configured targets.',
    '- Keep `.linear-tools/sync-state.json` local; it is runtime state, not source config.',
    '',
    'Recommended bootstrap:',
    '- `pi-linear-tools sync-doc init --cwd /path/to/subproject --project "Project name or ID"`',
    '- `pi-linear-tools sync-doc list --cwd /path/to/subproject`',
    '- `pi-linear-tools sync-doc run --cwd /path/to/subproject`',
  ].join('\n');
}

function selectTarget(targets, targetName) {
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error(`No sync targets configured. Add ${getConfigDisplayPath()} or pass --file with --project/--issue`);
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

function buildDocumentIndexContent(entries, heading) {
  const lines = [`## ${heading || 'Related docs'}`, ''];

  if (entries.length === 0) {
    lines.push('_No linked documents yet._');
    return lines.join('\n');
  }

  for (const entry of entries) {
    if (entry.url) {
      lines.push(`* [${entry.title}](${entry.url})`);
    } else {
      lines.push(`* ${entry.title}`);
    }
  }

  return lines.join('\n');
}

function getProjectIdentityKey(target) {
  if (!target?.project) {
    return null;
  }

  if (target.resolvedProjectId) {
    return `project:${target.resolvedProjectId}`;
  }

  return `project-ref:${normalizeRefKey(target.project)}`;
}

function getIssueIdentityKey(target) {
  if (!target?.issue) {
    return null;
  }

  if (target.resolvedIssueId) {
    return `issue:${target.resolvedIssueId}`;
  }

  return `issue-ref:${normalizeRefKey(target.issue)}`;
}

function getDocumentIndexEntries(state, targets, projectTarget) {
  const projectKey = getProjectIdentityKey(projectTarget);
  if (!projectKey) {
    return [];
  }

  return targets
    .filter((target) => (
      target.targetType === 'document'
      && target.includeInProjectIndex !== false
      && getProjectIdentityKey(target) === projectKey
    ))
    .map((target) => {
      const stateEntry = state.targets[target.name] || {};
      return {
        name: target.name,
        title: stateEntry.documentTitle || target.title,
        url: stateEntry.documentUrl || null,
      };
    })
    .sort((left, right) => left.title.localeCompare(right.title));
}

async function getRemoteFieldEntity(client, target) {
  if (target.targetType === 'projectField') {
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

function buildHashes(currentSegments, sourceContent, auxiliaryContent, metadataPayload) {
  return {
    sourceHash: sha256(sourceContent),
    beforeHash: sha256(currentSegments.before),
    managedHash: sha256(currentSegments.managed),
    afterHash: sha256(currentSegments.after),
    auxiliaryHash: sha256(auxiliaryContent || ''),
    metadataHash: sha256(serializeHashPayload(metadataPayload)),
  };
}

function applyCleanupMarkers(currentValue, cleanupMarkers = []) {
  let nextValue = currentValue;
  for (const marker of cleanupMarkers) {
    nextValue = removeManagedContent(nextValue, marker);
  }
  return nextValue;
}

function getAutomaticCleanupMarkers(target, allTargets = []) {
  const markers = new Set();
  const legacyMarker = defaultMarkerFromFile(target.file);

  if (legacyMarker && legacyMarker !== target.marker) {
    markers.add(legacyMarker);
  }

  if (target.targetType === 'projectField' && target.project) {
    const projectKey = getProjectIdentityKey(target);
    for (const sibling of allTargets) {
      if (!sibling || sibling.name === target.name) {
        continue;
      }

      if (sibling.targetType === 'document' && getProjectIdentityKey(sibling) === projectKey) {
        markers.add(sibling.marker);
      }
    }
  }

  if (target.targetType === 'issueField' && target.issue) {
    const issueKey = getIssueIdentityKey(target);
    for (const sibling of allTargets) {
      if (!sibling || sibling.name === target.name) {
        continue;
      }

      if (sibling.targetType === 'document' && getIssueIdentityKey(sibling) === issueKey) {
        markers.add(sibling.marker);
      }
    }
  }

  if (target.documentIndexMarker) {
    markers.delete(target.documentIndexMarker);
  }
  markers.delete(target.marker);

  return Array.from(markers);
}

function shouldSkipManagedUpdate(previousState, currentSegments, hashes) {
  return currentSegments.hasManagedBlock
    && previousState.sourceHash === hashes.sourceHash
    && previousState.beforeHash === hashes.beforeHash
    && previousState.managedHash === hashes.managedHash
    && previousState.afterHash === hashes.afterHash
    && (previousState.auxiliaryHash || sha256('')) === hashes.auxiliaryHash
    && (previousState.metadataHash || sha256('{}')) === hashes.metadataHash;
}

function buildBaseResult(target, loaded, statePath, mode) {
  return {
    mode,
    targetName: target.name,
    targetType: target.targetType,
    file: target.file,
    field: target.field ?? 'content',
    marker: target.marker,
    configPath: loaded.configPath,
    sourceConfigPath: target.sourceConfigPath || loaded.configPath || null,
    statePath,
  };
}

async function runFieldTarget(client, target, loaded, context) {
  const { cwd, mode, inlineTarget } = context;
  const remoteEntity = await getRemoteFieldEntity(client, target);
  const sourceContent = normalizeNewlines(await readFile(target.file, 'utf8')).trimEnd();
  const statePath = inlineTarget ? getFallbackStatePath(cwd) : loaded.statePath;
  const state = await getExecutionState(statePath, context);
  const previousState = state.targets[target.name] || {};
  const cleanupMarkers = Array.from(new Set([
    ...getAutomaticCleanupMarkers(target, loaded.targets),
    ...(target.cleanupMarkers || []),
  ]));

  const rawCurrentValue = normalizeNewlines(remoteEntity.fieldValue);
  const cleanedCurrentValue = applyCleanupMarkers(rawCurrentValue, cleanupMarkers);
  const cleanupChanged = rawCurrentValue !== cleanedCurrentValue;

  let nextValue = upsertManagedContent(cleanedCurrentValue, target.marker, sourceContent);
  let auxiliaryContent = '';

  if (target.targetType === 'projectField' && target.documentIndexMarker) {
    const entries = getDocumentIndexEntries(state, loaded.targets, target);
    auxiliaryContent = buildDocumentIndexContent(entries, target.documentIndexHeading);
    nextValue = upsertManagedContentWithPosition(
      nextValue,
      target.documentIndexMarker,
      auxiliaryContent,
      target.documentIndexPosition || 'top'
    );
  }

  const currentSegments = extractManagedSegments(cleanedCurrentValue, target.marker);
  const nextSegments = extractManagedSegments(nextValue, target.marker);
  const hashes = buildHashes(currentSegments, sourceContent, auxiliaryContent, { cleanupMarkers });
  const stateChanged = currentSegments.hasManagedBlock
    ? !shouldSkipManagedUpdate(previousState, currentSegments, hashes)
    : cleanedCurrentValue !== nextValue;
  const changed = cleanupChanged || stateChanged;

  const baseResult = {
    ...buildBaseResult(target, loaded, statePath, mode),
    changed,
    entityType: remoteEntity.entityType,
    entityName: remoteEntity.entityName,
    entityId: remoteEntity.entityId,
  };

  if (!changed) {
    state.targets[target.name] = {
      ...previousState,
      lastCheckedAt: new Date().toISOString(),
      file: target.file,
      field: target.field,
      marker: target.marker,
      ...hashes,
      changed: false,
    };
    await saveExecutionState(statePath, state, context);
    return baseResult;
  }

  if (mode === 'check') {
    state.targets[target.name] = {
      ...previousState,
      lastCheckedAt: new Date().toISOString(),
      file: target.file,
      field: target.field,
      marker: target.marker,
      sourceHash: hashes.sourceHash,
      beforeHash: sha256(nextSegments.before),
      managedHash: sha256(nextSegments.managed),
      afterHash: sha256(nextSegments.after),
      auxiliaryHash: hashes.auxiliaryHash,
      metadataHash: hashes.metadataHash,
      changed: true,
    };
    await saveExecutionState(statePath, state, context);
    return {
      ...baseResult,
      beforeHash: sha256(cleanedCurrentValue),
      afterHash: sha256(nextValue),
      sourceHash: hashes.sourceHash,
      auxiliaryHash: hashes.auxiliaryHash,
    };
  }

  const updated = await remoteEntity.update(nextValue);
  state.targets[target.name] = {
    ...previousState,
    lastSyncedAt: new Date().toISOString(),
    file: target.file,
    field: target.field,
    marker: target.marker,
    sourceHash: hashes.sourceHash,
    beforeHash: sha256(nextSegments.before),
    managedHash: sha256(nextSegments.managed),
    afterHash: sha256(nextSegments.after),
    auxiliaryHash: hashes.auxiliaryHash,
    metadataHash: hashes.metadataHash,
    changed: true,
  };
  await saveExecutionState(statePath, state, context);

  return {
    ...baseResult,
    updatedEntityName: updated?.project?.name || updated?.issue?.identifier || remoteEntity.entityName,
    beforeHash: sha256(cleanedCurrentValue),
    afterHash: sha256(nextValue),
  };
}

async function resolveDocumentOwnerIds(client, target) {
  if (target.project) {
    const project = await resolveProjectRef(client, target.project);
    return { projectId: project.id, issueId: undefined };
  }

  const issue = await resolveIssue(client, target.issue);
  return { projectId: undefined, issueId: issue.id };
}

async function loadExistingDocument(client, target, previousState) {
  const documentRef = target.documentId || previousState.documentId || null;
  if (!documentRef) {
    return null;
  }

  try {
    return await fetchDocumentDetails(client, documentRef);
  } catch (error) {
    if (target.documentId) {
      throw error;
    }
    return null;
  }
}

async function runDocumentTarget(client, target, loaded, context) {
  const { cwd, mode, inlineTarget } = context;
  const sourceContent = normalizeNewlines(await readFile(target.file, 'utf8')).trimEnd();
  const statePath = inlineTarget ? getFallbackStatePath(cwd) : loaded.statePath;
  const state = await getExecutionState(statePath, context);
  const previousState = state.targets[target.name] || {};
  const existingDocument = await loadExistingDocument(client, target, previousState);
  const ownerIds = await resolveDocumentOwnerIds(client, target);

  const currentValue = normalizeNewlines(existingDocument?.content ?? '');
  const nextValue = upsertManagedContent(currentValue, target.marker, sourceContent);
  const currentSegments = extractManagedSegments(currentValue, target.marker);
  const nextSegments = extractManagedSegments(nextValue, target.marker);
  const metadataPayload = {
    title: target.title,
    icon: target.icon ?? null,
    color: target.color ?? null,
    projectId: ownerIds.projectId ?? null,
    issueId: ownerIds.issueId ?? null,
  };
  const hashes = buildHashes(currentSegments, sourceContent, '', metadataPayload);

  let changed;
  if (!existingDocument) {
    changed = true;
  } else if (currentSegments.hasManagedBlock) {
    changed = !shouldSkipManagedUpdate(previousState, currentSegments, hashes);
  } else {
    const metadataChanged = sha256(serializeHashPayload({
      title: existingDocument.title,
      icon: existingDocument.icon ?? null,
      color: existingDocument.color ?? null,
      projectId: existingDocument.project?.id ?? null,
      issueId: existingDocument.issue?.id ?? null,
    })) !== hashes.metadataHash;
    changed = metadataChanged || currentValue !== nextValue;
  }

  const baseResult = {
    ...buildBaseResult(target, loaded, statePath, mode),
    changed,
    entityType: 'document',
    entityName: existingDocument?.title || target.title,
    entityId: existingDocument?.id || target.documentId || previousState.documentId || null,
  };

  if (!changed) {
    state.targets[target.name] = {
      ...previousState,
      lastCheckedAt: new Date().toISOString(),
      file: target.file,
      marker: target.marker,
      ...hashes,
      documentId: existingDocument.id,
      documentTitle: existingDocument.title,
      documentUrl: existingDocument.url,
      changed: false,
    };
    await saveExecutionState(statePath, state, context);
    return {
      ...baseResult,
      documentTitle: existingDocument.title,
      documentUrl: existingDocument.url,
    };
  }

  if (mode === 'check') {
    state.targets[target.name] = {
      ...previousState,
      lastCheckedAt: new Date().toISOString(),
      file: target.file,
      marker: target.marker,
      sourceHash: hashes.sourceHash,
      beforeHash: sha256(nextSegments.before),
      managedHash: sha256(nextSegments.managed),
      afterHash: sha256(nextSegments.after),
      auxiliaryHash: hashes.auxiliaryHash,
      metadataHash: hashes.metadataHash,
      documentId: existingDocument?.id || target.documentId || previousState.documentId || null,
      documentTitle: existingDocument?.title || target.title,
      documentUrl: existingDocument?.url || previousState.documentUrl || null,
      changed: true,
    };
    await saveExecutionState(statePath, state, context);
    return {
      ...baseResult,
      beforeHash: sha256(currentValue),
      afterHash: sha256(nextValue),
      sourceHash: hashes.sourceHash,
      documentTitle: existingDocument?.title || target.title,
      documentUrl: existingDocument?.url || previousState.documentUrl || null,
    };
  }

  let document;
  if (!existingDocument) {
    document = await createDocument(client, {
      title: target.title,
      content: nextValue,
      projectId: ownerIds.projectId,
      issueId: ownerIds.issueId,
      icon: target.icon,
      color: target.color,
    });
  } else {
    const patch = {};
    if (!currentSegments.hasManagedBlock || !shouldSkipManagedUpdate(previousState, currentSegments, hashes)) {
      patch.content = nextValue;
    }
    if (existingDocument.title !== target.title) patch.title = target.title;
    if (target.icon !== undefined && (existingDocument.icon ?? null) !== (target.icon ?? null)) patch.icon = target.icon;
    if (target.color !== undefined && (existingDocument.color ?? null) !== (target.color ?? null)) patch.color = target.color;
    if (ownerIds.projectId && existingDocument.project?.id !== ownerIds.projectId) patch.projectId = ownerIds.projectId;
    if (ownerIds.issueId && existingDocument.issue?.id !== ownerIds.issueId) patch.issueId = ownerIds.issueId;

    document = Object.keys(patch).length > 0
      ? (await updateDocument(client, existingDocument.id, patch)).document
      : existingDocument;
  }

  state.targets[target.name] = {
    ...previousState,
    lastSyncedAt: new Date().toISOString(),
    file: target.file,
    marker: target.marker,
    ...hashes,
    beforeHash: sha256(nextSegments.before),
    managedHash: sha256(nextSegments.managed),
    afterHash: sha256(nextSegments.after),
    documentId: document.id,
    documentTitle: document.title,
    documentUrl: document.url,
    changed: true,
  };
  await saveExecutionState(statePath, state, context);

  return {
    ...baseResult,
    entityName: document.title,
    entityId: document.id,
    documentTitle: document.title,
    documentUrl: document.url,
    beforeHash: sha256(currentValue),
    afterHash: sha256(nextValue),
  };
}

async function runSyncDocTarget(client, target, loaded, context) {
  if (target.targetType === 'document') {
    return runDocumentTarget(client, target, loaded, context);
  }

  return runFieldTarget(client, target, loaded, context);
}

export async function listSyncDocTargets(options = {}) {
  const cwd = resolve(options.cwd || process.cwd());
  const loaded = await loadSyncDocTargets({ cwd, configPath: options.configPath });

  return {
    configPath: loaded.configPath,
    statePath: loaded.statePath,
    targets: loaded.targets.map((target) => ({
      name: target.name,
      targetType: target.targetType,
      entityRef: target.project || target.issue || target.documentId || null,
      project: target.project || null,
      issue: target.issue || null,
      file: target.file,
      field: target.field || 'content',
      marker: target.marker,
      title: target.title || null,
      documentIndexMarker: target.documentIndexMarker || null,
      documentIndexPosition: target.documentIndexPosition || null,
      sourceConfigPath: target.sourceConfigPath || loaded.configPath || null,
    })),
  };
}

function orderTargetsForRun(targets) {
  return [...targets].sort((left, right) => {
    const leftPriority = left.targetType === 'document' ? 0 : 1;
    const rightPriority = right.targetType === 'document' ? 0 : 1;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    return left.name.localeCompare(right.name);
  });
}

export async function runAllSyncDocs(client, options = {}) {
  const cwd = resolve(options.cwd || process.cwd());
  const loaded = await loadSyncDocTargets({ cwd, configPath: options.configPath });

  if (!Array.isArray(loaded.targets) || loaded.targets.length === 0) {
    throw new Error(`No sync targets configured. Add ${getConfigDisplayPath()} or pass --file with --project/--issue`);
  }

  const preparedTargets = await prepareTargetsForExecution(client, loaded.targets);
  const preparedLoaded = {
    ...loaded,
    targets: preparedTargets,
  };
  const mode = options.mode === 'check' ? 'check' : 'run';
  const sharedState = await loadSyncState(preparedLoaded.statePath);
  const context = {
    cwd,
    mode,
    inlineTarget: false,
    sharedState,
    persistState: mode !== 'check',
  };

  const results = [];
  for (const target of orderTargetsForRun(preparedLoaded.targets)) {
    results.push(await runSyncDocTarget(client, target, preparedLoaded, context));
  }

  return {
    mode,
    all: true,
    configPath: preparedLoaded.configPath,
    statePath: preparedLoaded.statePath,
    total: results.length,
    changedCount: results.filter((result) => result.changed).length,
    unchangedCount: results.filter((result) => !result.changed).length,
    results,
  };
}

export async function runSyncDoc(client, options = {}) {
  const cwd = resolve(options.cwd || process.cwd());
  const mode = options.mode === 'check' ? 'check' : 'run';
  const inlineTarget = buildInlineTargetFromFlags(options, cwd);
  const loaded = await loadSyncDocTargets({ cwd, configPath: options.configPath });
  const preparedLoaded = {
    ...loaded,
    targets: await prepareTargetsForExecution(client, loaded.targets),
  };
  const preparedInlineTargets = inlineTarget ? await prepareTargetsForExecution(client, [inlineTarget]) : [];
  const target = preparedInlineTargets[0] || selectTarget(preparedLoaded.targets, options.targetName || options.target);

  return runSyncDocTarget(client, target, preparedLoaded, {
    cwd,
    mode,
    inlineTarget: Boolean(inlineTarget),
    persistState: mode !== 'check',
  });
}

export {
  CONFIG_DIRNAME,
  CONFIG_FILENAME,
  STATE_FILENAME,
};
