# Release v0.3.0

**Rate limit optimization and crash prevention release.**

## Bug Fixes
- Fixed rate limit crashes by eliminating N+1 API queries (root cause)
- Added global rate limit tracking to prevent repeated API calls
- Added comprehensive error handling to prevent extension crashes

## Performance
- Replaced SDK lazy-loading with optimized GraphQL queries
- API requests per issue listing: ~251 → 1
- Listings before hitting rate limit: ~50 → ~5000

## Improvements
- Reduced default pagination limit (50 → 20) to reduce API load
- Better user-friendly error messages for rate limit errors
- Rate limit pre-check before making API calls

---

**npm package:** `@fink-andreas/pi-linear-tools`  
**git tag:** `v0.3.0`
