I found two related `sync-doc` correctness issues.

## 1. Related targets are matched by raw config string instead of resolved project identity

In `src/sync-doc.js`, both `getDocumentIndexEntries()` and `getAutomaticCleanupMarkers()` associate targets using:

```js
normalizeRefKey(target.project) === normalizeRefKey(projectTarget.project)
```

Relevant code:
- `src/sync-doc.js:611-632`
- `src/sync-doc.js:683-704`

This means valid references to the *same* project stop matching if one target uses a project name and another uses a UUID or URL.

Example:
- overview target: `project: "Census Data"`
- document target: `project: "11111111-1111-4111-8111-111111111111"`

Both are valid everywhere else, but here they are treated as different projects, so:
- the overview index omits the document
- automatic cleanup misses old sibling markers

I reproduced this and got:

```md
## Linked docs

_No linked documents yet._
```

even though the document had been created successfully.

Suggested fix: compare resolved project/issue IDs, not the raw config strings.

## 2. `sync-doc check` can disagree with the actual `run`

`runAllSyncDocs()` correctly processes document targets before field targets. But in check mode, `runDocumentTarget()` returns before updating state:
- `src/sync-doc.js:924-932`

Later, `runFieldTarget()` builds the document index only from persisted state:

```js
const entries = getDocumentIndexEntries(state, loaded.targets, target);
```

Relevant code:
- `src/sync-doc.js:740-760`
- `src/sync-doc.js:799-806`
- `src/sync-doc.js:924-932`

So a batch `sync-doc check` can evaluate documents first, but the subsequent project field check still does not see their newly discovered `documentUrl` / `documentTitle`.

I reproduced this by running:
1. `runAllSyncDocs(..., { mode: 'check' })`
2. `runAllSyncDocs(..., { mode: 'run' })`

The project overview target produced a different `afterHash` between check and run, because the real run included the document link in the index while check did not.

That makes `sync-doc check` unreliable for CI / drift reporting.

Suggested fix: carry forward in-memory document results during a batch check/run instead of relying only on the previously saved state file.
