# Follow-up: `sync-doc check` vs `sync-doc run` mismatch on first document creation

## Summary
There is still a correctness gap in the `sync-doc` workflow when a batch contains:
- a `projectField` target that maintains a document index, and
- one or more `document` targets that do not exist yet in Linear.

In that case, `sync-doc check` and `sync-doc run` can compute different final project-field content for the same source files.

## Why this happens
`runAllSyncDocs()` executes document targets before field targets, which is the right ordering.

However, on the first sync of a document target:
- `check` mode does **not** create the document
- therefore there is no new Linear document URL yet
- the in-memory state for that target still has `documentUrl: null`
- later, when the project overview target builds its managed document index, it renders a plain-text entry instead of a link

During a real `run`:
- the document gets created first
- the new `documentId`, `documentTitle`, and `documentUrl` become available
- the later overview/index target includes a markdown link

That means the overview target's computed `afterHash` differs between `check` and `run` on the initial sync.

## Reproduction shape
Minimal config:

```json
{
  "syncDocs": {
    "targets": [
      {
        "name": "overview",
        "file": "README.md",
        "project": "Example Project",
        "field": "content",
        "marker": "overview",
        "documentIndexMarker": "doc-links"
      },
      {
        "name": "provider-doc",
        "targetType": "document",
        "file": "docs/provider.md",
        "project": "Example Project",
        "title": "Provider Doc",
        "marker": "provider-doc"
      }
    ]
  }
}
```

Observed behavior:
1. `sync-doc check` computes an overview body whose linked-doc section contains plain text for the not-yet-created document.
2. `sync-doc run` creates the document and computes an overview body whose linked-doc section contains a real markdown link.
3. The overview target therefore produces different hashes in `check` vs `run`.

## Impact
This makes `sync-doc check` an unreliable preview for CI or drift detection on the first sync of newly added document targets.

Specifically, users may see:
- `check` reporting one pending change shape
- `run` applying a different result
- hash comparisons or dry-run expectations that do not line up with the actual write path

## Likely fix directions
A future fix should make batch `check` capable of predicting the same document index that `run` would produce.

Possible approaches:
- carry forward synthetic/in-memory document creation results during `check`
- precompute a deterministic placeholder result for new documents that matches what `run` will later use
- split planning from execution so index-building can reference a full batch execution model instead of only persisted state

## Notes
This is separate from the already-fixed drift detection and resolved-identity matching issues.
It only affects the initial creation path for document targets that are referenced by a project-field document index.
