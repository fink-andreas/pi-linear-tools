`sync-doc` can miss drift when someone edits inside the managed block.

In `src/sync-doc.js`, `buildHashes()` and `shouldSkipManagedUpdate()` only compare:
- source file hash
- content before the managed block
- content after the managed block
- auxiliary/meta hashes

But they never hash the actual managed content (`currentSegments.managed`). Because of that, if someone manually edits text inside:

```md
<!-- linear-tools:sync-start X -->
...
<!-- linear-tools:sync-end X -->
```

a later sync can incorrectly conclude that nothing changed.

Relevant code:
- `src/sync-doc.js:657-723`
- used from `src/sync-doc.js:769-775`
- used from `src/sync-doc.js:880-885`

I reproduced this with a quick script:
1. Run `runSyncDoc()` once so state is written.
2. Manually modify the remote content inside the managed block.
3. Run `runSyncDoc()` again.
4. It returns `changed: false`, and the manual edit remains in Linear.

That means the core hash-based change detection is not robust enough for one of the main edge cases this feature needs to handle.

Suggested fix: include a hash of `currentSegments.managed` in the stored state / comparison logic, or directly compare the current managed block to the expected managed block before deciding to skip.
