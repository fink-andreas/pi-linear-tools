# Code Review: PR #1 - Add project updates, issue activity, and doc sync workflows

## PR Details

- **URL:** https://github.com/fink-andreas/pi-linear-tools/pull/1
- **Author:** austinm911 (Austin)
- **Branch:** `codex/project-crud`
- **State:** DRAFT
- **Commits:** 13 commits

## Context

This PR adds three major features to the pi-linear-tools extension:
1. Project updates support (new `linear_project_update` tool)
2. Issue activity history viewing
3. Bidirectional sync-doc feature for syncing local files with Linear

## Key Files Changed

| Category | Files | Stats |
|----------|-------|-------|
| Core implementation | `src/handlers.js`, `src/linear.js`, `src/sync-doc.js` | +1,826 lines |
| CLI | `src/cli.js` | +706 lines |
| Extension | `extensions/pi-linear-tools.js` | +185 lines |
| Tests | 6 new/modified test files | +1,252 lines |
| Docs | `README.md` | +134 lines |
| Entry point | `index.js` | -1,020 lines |

---

# Source Code Diff

## 1. src/handlers.js (key additions)

```javascript
// New imports for project operations
import {
  fetchProjectDetails,
  fetchIssueActivity,
  formatIssueActivityAsMarkdown,
  createProject,
  updateProject,
  deleteProject,
  archiveProject,
  unarchiveProject,
  fetchProjectUpdates,
  fetchProjectUpdateDetails,
  createProjectUpdate,
  updateProjectUpdate,
  archiveProjectUpdate,
  unarchiveProjectUpdate,
} from './linear.js';

// Issue activity handler
export async function executeIssueActivity(client, params) {
  const issue = ensureNonEmpty(params.issue, 'issue');
  const activityData = await fetchIssueActivity(client, issue, {
    limit: params.limit,
    includeArchived: params.includeArchived === true,
  });
  const markdown = formatIssueActivityAsMarkdown(activityData, {
    limit: params.limit,
  });

  return {
    content: [{ type: 'text', text: markdown }],
    details: {
      issueId: activityData.issue.id,
      identifier: activityData.issue.identifier,
      title: activityData.issue.title,
      activityCount: activityData.activity.length,
      url: activityData.issue.url,
    },
  };
}

// Project CRUD handlers
export async function executeProjectView(client, params) { /* ... */ }
export async function executeProjectCreate(client, params) { /* ... */ }
export async function executeProjectUpdate(client, params) { /* ... */ }
export async function executeProjectDelete(client, params) { /* ... */ }
export async function executeProjectArchive(client, params) { /* ... */ }
export async function executeProjectUnarchive(client, params) { /* ... */ }

// Project update handlers
export async function executeProjectUpdateList(client, params) { /* ... */ }
export async function executeProjectUpdateView(client, params) { /* ... */ }
export async function executeProjectUpdateCreate(client, params) { /* ... */ }
export async function executeProjectUpdateUpdate(client, params) { /* ... */ }
export async function executeProjectUpdateArchive(client, params) { /* ... */ }
export async function executeProjectUpdateUnarchive(client, params) { /* ... */ }
```

---

## 2. src/sync-doc.js (new file - key excerpts)

```javascript
// Constants
const CONFIG_DIRNAME = '.linear-tools';
const CONFIG_FILENAME = 'config.json';
const STATE_FILENAME = 'sync-state.json';

// Managed block markers
export function buildSyncMarkers(marker) {
  return {
    start: `<!-- linear-tools:sync-start ${marker} -->`,
    end: `<!-- linear-tools:sync-end ${marker} -->`,
  };
}

// Core function: upsert managed content into existing field
export function upsertManagedContent(currentValue, marker, incomingContent) {
  const currentText = normalizeNewlines(currentValue);
  const nextBody = normalizeNewlines(incomingContent).trimEnd();
  const { start, end } = buildSyncMarkers(marker);
  const managedBlock = nextBody
    ? `${start}\n\n${nextBody}\n\n${end}`
    : `${start}\n\n${end}`;

  // Find existing markers
  const startIndex = currentText.indexOf(start);
  const endIndex = currentText.indexOf(end);

  if (startIndex === -1 && endIndex === -1) {
    // No existing block - append
    const trimmedCurrent = currentText.trimEnd();
    if (!trimmedCurrent) {
      return managedBlock;
    }
    return `${trimmedCurrent}\n\n${managedBlock}`;
  }

  // Validate balanced markers
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(`Unbalanced sync markers for marker "${marker}"`);
  }

  // Check for multiple blocks (error)
  const secondStartIndex = currentText.indexOf(start, startIndex + start.length);
  const secondEndIndex = currentText.indexOf(end, endIndex + end.length);
  if (secondStartIndex !== -1 || secondEndIndex !== -1) {
    throw new Error(`Multiple sync marker blocks found for marker "${marker}"`);
  }

  // Replace managed block, preserving before/after content
  const before = currentText.slice(0, startIndex).trimEnd();
  const after = currentText.slice(endIndex + end.length).trimStart();

  if (before && after) {
    return `${before}\n\n${managedBlock}\n\n${after}`;
  }
  // ... other cases
}

// Extract managed segments
export function extractManagedSegments(currentValue, marker) {
  const currentText = normalizeNewlines(currentValue);
  const { start, end } = buildSyncMarkers(marker);
  // Returns { hasManagedBlock, before, managed, after }
}

// Hash-based change detection
function buildHashes(currentSegments, sourceContent, auxiliaryContent, metadataPayload) {
  return {
    sourceHash: sha256(sourceContent),
    beforeHash: sha256(currentSegments.before),
    afterHash: sha256(currentSegments.after),
    auxiliaryHash: sha256(auxiliaryContent || ''),
    metadataHash: sha256(serializeHashPayload(metadataPayload)),
  };
}

function shouldSkipManagedUpdate(previousState, currentSegments, hashes) {
  return currentSegments.hasManagedBlock
    && previousState.sourceHash === hashes.sourceHash
    && previousState.beforeHash === hashes.beforeHash
    && previousState.afterHash === hashes.afterHash
    && (previousState.auxiliaryHash || sha256('')) === hashes.auxiliaryHash
    && (previousState.metadataHash || sha256('{}')) === hashes.metadataHash;
}

// Run field target (sync to project/issue field)
async function runFieldTarget(client, target, loaded, { cwd, mode, inlineTarget }) {
  const remoteEntity = await getRemoteFieldEntity(client, target);
  const sourceContent = normalizeNewlines(await readFile(target.file, 'utf8')).trimEnd();
  const statePath = inlineTarget ? getFallbackStatePath(cwd) : loaded.statePath;
  const state = await loadSyncState(statePath);
  const previousState = state.targets[target.name] || {};
  
  // ... cleanup markers, document index, change detection
  // ... returns result with changed flag and entity info
}

// Run document target (sync to Linear document)
async function runDocumentTarget(client, target, loaded, context) {
  const sourceContent = normalizeNewlines(await readFile(target.file, 'utf8')).trimEnd();
  // ... fetch/create/update Linear document
  // ... returns result with documentUrl, documentTitle
}

// Public API
export async function listSyncDocTargets(options = {}) { /* ... */ }
export async function runAllSyncDocs(client, options = {}) { /* ... */ }
export async function runSyncDoc(client, options = {}) { /* ... */ }
export async function initSyncDocConfig(options = {}) { /* ... */ }
export function explainSyncDocSetup() { /* returns guidance string */ }
```

---

## 3. extensions/pi-linear-tools.js (tool registrations)

```javascript
// linear_issue tool - added 'activity' action
pi.registerTool({
  name: 'linear_issue',
  parameters: {
    properties: {
      action: {
        enum: ['list', 'view', 'activity', 'create', 'update', 'comment', 'start', 'delete'],
      },
      includeArchived: {
        type: 'boolean',
        description: 'Include archived resources when listing activity or project updates',
      },
      // ... other params
    },
  },
  async execute(_toolCallId, params) {
    switch (params.action) {
      case 'activity':
        return await executeIssueActivity(client, params);
      // ... other cases
    }
  },
});

// linear_project tool - extended with CRUD + archive
pi.registerTool({
  name: 'linear_project',
  description: 'Interact with Linear projects. Actions: list, view, create, update, delete, archive, unarchive',
  parameters: {
    properties: {
      action: {
        enum: ['list', 'view', 'create', 'update', 'delete', 'archive', 'unarchive'],
      },
      project: { description: 'Project name or ID (for view, update, delete)' },
      name: { description: 'Project name (required for create, optional for update)' },
      teams: { description: 'Comma-separated team keys or IDs' },
      lead: { description: 'Project lead user ID, "me", or "none"' },
      // ... other params
    },
  },
  async execute(_toolCallId, params) {
    switch (params.action) {
      case 'view': return await executeProjectView(client, params);
      case 'create': return await executeProjectCreate(client, params);
      case 'update': return await executeProjectUpdate(client, params);
      case 'delete': return await executeProjectDelete(client, params);
      case 'archive': return await executeProjectArchive(client, params);
      case 'unarchive': return await executeProjectProjectUnarchive(client, params);
    }
  },
});

// NEW: linear_project_update tool
pi.registerTool({
  name: 'linear_project_update',
  description: 'Interact with Linear project updates. Actions: list, view, create, update, archive, unarchive',
  parameters: {
    properties: {
      action: { enum: ['list', 'view', 'create', 'update', 'archive', 'unarchive'] },
      project: { description: 'Project name or ID (for list, create)' },
      projectUpdate: { description: 'Project update ID (for view, update, archive, unarchive)' },
      body: { description: 'Project update body in markdown' },
      health: { 
        type: 'string',
        enum: ['onTrack', 'atRisk', 'offTrack'],
        description: 'Project update health status',
      },
      limit: { type: 'integer', minimum: 1 },
      includeArchived: { type: 'boolean' },
    },
  },
  async execute(_toolCallId, params) {
    switch (params.action) {
      case 'list': return await executeProjectUpdateList(client, params);
      case 'view': return await executeProjectUpdateView(client, params);
      case 'create': return await executeProjectUpdateCreate(client, params);
      case 'update': return await executeProjectUpdateUpdate(client, params);
      case 'archive': return await executeProjectUpdateArchive(client, params);
      case 'unarchive': return await executeProjectUpdateUnarchive(client, params);
    }
  },
});
```

---

## 4. src/cli.js (new commands)

```javascript
// New CLI commands
Commands:
  issue <action> [options]      Manage issues, comments, and issue activity/history
  project <action> [options]    Manage projects and project metadata
  project-update <action> [options]  Manage project updates (Linear Updates tab entries)
  sync-doc [action] [options]   Sync local markdown into Linear fields

// New sync-doc command handler
async function handleSyncDoc(args) {
  const [action] = args;
  
  switch (action) {
    case 'init':
      const result = await initSyncDocConfig({ cwd, project, file, force });
      // print result
    case 'explain':
      console.log(explainSyncDocSetup());
    case 'list':
      const targets = await listSyncDocTargets({ cwd, configPath });
      printSyncDocTargets(targets);
    case 'run':
      const runResult = await runAllSyncDocs(client, { mode: 'run', cwd, configPath });
      // print results
    case 'check':
      const checkResult = await runAllSyncDocs(client, { mode: 'check', cwd, configPath });
      // print results
  }
}
```

---

## 5. README.md (documentation additions)

```markdown
Useful mental model:
- `issue update` changes issue fields; `issue comment` adds discussion; `issue activity` reads the Activity timeline
- `project update` changes project fields; `project-update` manages Updates tab entries
- `sync-doc init` scaffolds `.linear-tools/config.json` in the folder you point at
- `sync-doc run` and `sync-doc check` default to all configured targets

### Sync doc commands

```bash
pi-linear-tools sync-doc init --cwd /path/to/subproject --project "Project name or ID"
pi-linear-tools sync-doc explain
pi-linear-tools sync-doc list
pi-linear-tools sync-doc run
pi-linear-tools sync-doc check
```

Placement rule:
- put `.linear-tools/config.json` in the smallest folder that owns the docs you are syncing

Example config:
{
  "syncDocs": {
    "targets": [
      {
        "name": "project-overview",
        "file": "README.md",
        "project": "Project name or ID",
        "field": "content",
        "marker": "project-overview",
        "documentIndexMarker": "project-doc-links"
      },
      {
        "name": "provider-foo",
        "targetType": "document",
        "file": "docs/provider.md",
        "project": "Project name or ID",
        "title": "Provider Doc",
        "marker": "provider-foo"
      }
    ]
  }
}
```

---

# Review Focus Areas

## 1. Architecture & Design
- Does the sync-doc architecture make sense?
- Are the managed block markers (`linear-tools:sync-start/end`) well-designed?
- Is the separation between `targetType: "field"` vs `targetType: "document"` appropriate?
- Is the document index feature properly designed?

## 2. Security & Input Validation
- Validate all user inputs, especially:
  - Health status values (onTrack, atRisk, offTrack)
  - Project/issue identifiers
  - File paths for sync targets
- Check for injection risks in GraphQL queries
- File path traversal concerns in sync-doc

## 3. Error Handling
- Are all async operations properly awaited?
- Do error messages provide useful context?
- Are there fallback paths for partial failures?

## 4. API Design
- Is the `linear_project_update` tool API well-designed?
- Are the parameters intuitive for users?
- Does the activity viewing format make sense?

## 5. Performance
- Any N+1 query issues?
- File system operations that could be batched?
- State file writes that could be optimized?

## 6. Test Coverage
- Are edge cases covered?
- Are error paths tested?
- Is the mock client pattern appropriate?

## 7. Breaking Changes
- The `index.js` simplification (from full code to re-export) - any concerns?
- Any changes to existing tool behavior?

## 8. Documentation
- Is the README guidance clear for the new features?
- Are error messages helpful for troubleshooting?

---

# Specific Questions to Address

1. **Hash-based change detection:** Is `shouldSkipManagedUpdate` robust enough for edge cases?
2. **Race conditions:** When multiple sync targets update the same document, are there issues?
3. **Document index ordering:** Does the sorted order work predictably?
4. **Activity formatting:** Is the history markdown readable?
5. **GraphQL fragments:** Any missing fields that could cause runtime errors?
6. **Config precedence:** Is the global/local config merge logic correct?
7. **Cleanup markers:** Is the automatic cleanup for document markers safe?
8. **Validation:** Are all enum values and constraints properly enforced?

---

# Commands to Run

```bash
# Run tests
npm test

# View full diff
git diff main..pr/1

# Review specific file
git show pr/1:src/sync-doc.js | head -300

# Review tests
git show pr/1 -- tests/test-sync-doc.js | head -200
```

---

# Notes

- This is a Draft PR, but code quality review is still valuable
- The author is a bot (austinm911) - actual author appears to be using "codex" based on branch name
- Full diff available via: `git diff main..pr/1`