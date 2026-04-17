# PLAN: reduce expensive Linear API reads

## Goal
Reduce Linear API rate-limit and complexity pressure by replacing broad SDK entity fetches in `src/linear.js` with narrow GraphQL queries via the existing `executeGraphQL()` path.

## Project exploration

### Relevant files
- `src/linear.js` — current SDK reads, GraphQL helpers, resolvers, and issue/project/team logic
- `docs/linear-schema.graphql` — GraphQL schema reference for query shapes and filters
- `tests/test-api-usage-caching.js` — current caching / resolver fast-path regression tests
- `tests/test-rate-limit-fallback-update.js` — existing update regression coverage

### Current expensive read paths
- `resolveProjectRef()` uses `client.project(ref)` for UUID fast path
- `fetchProjectMilestones()` uses `client.project(projectId)` then `project.projectMilestones()`
- `resolveIssue()` uses `client.issue(lookup)`
- `fetchIssueDetails()` uses `client.issue()` plus many nested relation reads
- `updateIssue()` refetches via `client.issue(targetIssue.id)` after mutation
- `resolveTeamRef()` / `getTeamWorkflowStates()` use `client.team(...)`

### Constraints / notes
- Keep existing return shapes stable for callers
- Prefer incremental, low-risk changes first
- Reuse `executeGraphQL()` and existing transform helpers where possible
- Add tests proving SDK read paths were removed for the changed areas

## Implementation order
1. Add minimal project GraphQL helpers and replace project SDK reads
2. Add regression tests for project lookup / milestone fetch GraphQL paths
3. Run tests and verify no regressions
4. If green, continue with issue minimal-query refactors next
