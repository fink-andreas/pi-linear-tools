# Changelog

## v0.7.0 (2026-05-05)

Issue image fetching and file download release.

### New Features
- **`linear_issue(action="images")`**: Fetch markdown/HTML embedded images from issue descriptions and comments. Returns images as tool `image` content (base64-encoded). Includes special auth handling for Linear upload URLs (`uploads.linear.app`).
- **`linear_issue(action="download")`**: Download Linear issue attachments to local filesystem. Supports attachment selection by ID, title, URL, or index. Includes relative path validation, filename sanitization, and `allow_overwrite_files` config guard (default: `false`).

### Performance / API Usage
- **N+1 issue resolution optimization**: Merged N+1-per-issue lazy loads in milestone details into a single GraphQL batch query (introduced in v0.6.0).

### Documentation
- **Updated smoke tests**: Added coverage for `images` and `download` actions.

### Bug Fixes
- **Fixed workspace-wide issue listing (#4)**: `linear_issue list` now falls back to workspace-level listing (using `fetchIssues`) when no project is specified and cwd doesn't match a Linear project. This allows `linear_issue list assignee=me` to work without requiring a project context.
- Fixed project archive mutation to actually archive instead of delete (INN-301).
- Fixed `linear_issue comment` to render submitted comment text in result (INN-305).
- Fixed rate limit display to not show hardcoded total=5000 (INN-304).
- Fixed `linear_project` and `linear_project_update` to have rate-limit pre-check (INN-303).

## v0.6.0 (2026-04-23)

Rate-limit resilience for milestone operations.

### Bug Fixes
- **Fixed linear_milestone view rate-limit crash**: `linear_milestone view` no longer crashes when hitting Linear API rate limits. Errors are now properly surfaced as safe tool results instead of propagating as crashes.
- **Fixed milestone issues rate-limit swallowing**: `fetchMilestoneDetails()` now correctly propagates rate-limit errors from lazy-loaded issue data instead of silently returning partial results.

### Performance / API Usage
- **Replaced N+1 lazy loading with single GraphQL query**: Milestone details now fetch all issue state/assignee in ONE request instead of N+1 per-issue lazy loads. This dramatically reduces API calls and rate-limit exposure for large milestones.
- **Added cached rate-limit pre-check**: `linear_milestone` now has the same cached pre-check that `linear_issue` uses to short-circuit before making API calls when the cache already knows about a rate limit.
- **Exported `isRateLimitError()` helper**: Made available for consistent error handling across tools.

### Documentation
- **Reorganized README**: Moved Key Concepts section for better onboarding
- **Added combined Linear+Pi logo**: Light/dark theme support for branding

## v0.5.1 (2026-04-17)

### Bug Fixes
- **Prevent pi crashes from Linear tool errors**: Added `executeToolSafely` wrapper that catches errors and returns them as safe tool results instead of throwing, preventing pi from crashing on Linear API errors

## v0.5.0 (2026-04-17)

Linear document sync, project lifecycle management, and estimate/story points support.

### New Features
- **Linear document sync**: Keep Linear documents in sync with local Markdown files via `linear_doc_sync` command
- **Project lifecycle**: Full project lifecycle support including archive/unarchive, updates, and milestones
- **Estimate (story points)**: Support for estimate/story points field on issue create/update
- **Issue activity history**: View complete issue activity with `linear_issue_activity` tool
- **Batch sync**: `sync-doc --all` for batch syncing all configured document targets

### Bug Fixes
- Fixed project name lookup for UUID-like project names
- Fixed milestone name lookup for view/update/delete operations
- Replaced 'order' with 'sortOrder' for ProjectMilestone queries
- Fixed sync-doc first-run check/run parity
- Fixed sync-doc drift detection and target matching
- Fixed project archive and update validation
- Fixed archived project resolution for project updates
- Fixed sync-doc marker position preservation when position is 'top'
- Fixed default limit for executeIssueActivity (now 25)

### Improvements
- Reduced expensive Linear API issue reads
- Better CLI help for issue and project workflows
- Improved sync-doc examples and guidance
- Added promptSnippet to all Linear tools for consistent LLM context
- Removed redundant action lists from tool descriptions

### Cleanup
- Removed planning artifacts and documentation files
- Stopped tracking plan files in git

## v0.4.2 (2026-03-26)

Rate-limit resilience and API usage diagnostics release.

### Bug Fixes
- Hardened issue update flow when post-mutation refresh is rate-limited
- Added explicit user-facing note when update succeeded but refresh is partial due to rate limits
- Fixed per-command API usage metric keying so usage deltas report correctly

### Performance / API Usage
- Added short-lived in-memory caches for viewer, project list, team list, and team workflow states
- Added direct-ID fast paths for project/team resolution to avoid full list fetches

### Diagnostics
- Added optional per-command usage summary output via `PI_LINEAR_TOOLS_USAGE_SUMMARY=true`
- Added debug-level per-command request delta logging across issue/project/team/milestone tools

### Documentation / Tests
- Documented new diagnostics flag and cache behavior
- Added regression tests for rate-limit fallback and API usage caching

## v0.4.0 (2026-03-23)

Comprehensive error handling and file-first logging release.

### New Features
- **File-first logging**: Structured JSON logs written to `~/.config/pi-linear-tools/` instead of stdout (TUI-safe)
- **Request metrics tracking**: Monitor total/success/failed/rate-limited requests per client
- **Periodic usage summaries**: Logged every 50 requests or 15 seconds

### Bug Fixes
- All tool `execute()` functions now wrapped with comprehensive try/catch
- Never let raw SDK errors propagate to users
- Extension initialization protected with safety wrapper

### Improvements
- Clear user-facing error messages for:
  - Rate limit errors (with reset times)
  - Authentication/authorization failures
  - Network errors
  - Server errors (5xx)
- Graceful handling when `pi.registerTool` is unavailable
- Better error context for debugging

## v0.3.0 (2026-03-22)

Rate limit optimization and crash prevention release.

### Bug Fixes
- Fixed rate limit crashes by eliminating N+1 API queries (root cause)
- Added global rate limit tracking to prevent repeated API calls
- Added comprehensive error handling to prevent extension crashes

### Performance
- Replaced SDK lazy-loading with optimized GraphQL queries
- API requests per issue listing: ~251 → 1
- Listings before hitting rate limit: ~50 → ~5000

### Improvements
- Reduced default pagination limit (50 → 20) to reduce API load
- Better user-friendly error messages for rate limit errors
- Rate limit pre-check before making API calls

## v0.2.0 (2026-02-28)

OAuth 2.0 authentication and Markdown rendering release.

### New Features
- OAuth 2.0 authentication with PKCE (INN-242)
- Markdown rendering for tool outputs (INN-241)

### Improvements
- Improved milestone list/delete usability
- Fixed pi-tui/pi-coding-agent imports when installed from npm or source
- Better error messages for OAuth scope issues
- Fallback token storage when keychain is unavailable

### Notes
- npm package: `@fink-andreas/pi-linear-tools`
- git tag: `v0.2.0`
- GitHub release notes source: `RELEASE_NOTES_v0.2.0.md`

## v0.1.0 (2026-02-25)

Initial public release of `@fink-andreas/pi-linear-tools`.

### Included
- Linear issue/project/team/milestone tools for pi
- Extension commands for configuration/help
- Local CLI for settings and tool operations
- Project/team/milestone and assignee handling improvements covered by test suite

### Notes
- npm package: `@fink-andreas/pi-linear-tools`
- Planned git tag: `v0.1.0`
- GitHub release notes source: `RELEASE_NOTES_v0.1.0.md`
