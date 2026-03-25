# Release v0.4.2

**Rate-limit resilience + API usage diagnostics improvements.**

## Highlights
- Improved `linear_issue update` behavior when Linear rate limits occur after successful mutation
- Added in-memory caching for common resolver calls to reduce request volume
- Added optional per-command API usage summary in tool output

## Bug Fixes
- Fallback response for post-update refresh rate-limit failures (avoids false operation failure)
- Correct per-command usage delta accounting in diagnostics

## Performance / API Usage
- Viewer cache: 30s
- Projects cache: 60s
- Teams cache: 60s
- Team workflow states cache: 60s (per team)
- Direct ID lookup fast-paths for project/team resolution

## Diagnostics
- `PI_LINEAR_TOOLS_USAGE_SUMMARY=true` adds:
  - markdown summary line in tool output
  - `details.apiUsage` payload for integrations
- Debug logs include request delta per tool action

## Notes
- Issue list payloads remain uncached (fresh data from Linear on each list call)

---

**npm package:** `@fink-andreas/pi-linear-tools`  
**git tag:** `v0.4.2`
