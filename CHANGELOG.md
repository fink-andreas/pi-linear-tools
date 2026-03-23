# Changelog

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
