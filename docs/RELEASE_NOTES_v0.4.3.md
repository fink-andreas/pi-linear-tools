# Release notes: v0.4.3

## Highlights
- Sync-doc first-run `check` vs `run` parity fix in batched project index planning
- Managed content marker positioning stability improvements
- Better project-update handling for archived projects
- Consistent `promptSnippet` metadata across all Linear tools

## Changes
### Bug fixes
- Fixed first-run sync-doc planning mismatch between `check` and `run`
- Preserved existing marker location when `position` is `top`
- Improved archived-project resolution during project updates
- Added safer default limit behavior in issue activity execution

### Tooling / UX
- Added `promptSnippet` across all Linear tool definitions for improved context/discoverability

### Test coverage
- Expanded sync-doc regression tests for first-run parity and managed-block stability

## Upgrade
```bash
npm install @fink-andreas/pi-linear-tools@0.4.3
```
