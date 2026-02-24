# PLAN: Interactive `/linear-tools-config` flow

## Goal
When `/linear-tools-config` is invoked without flags, run an interactive setup wizard in TUI mode.

## Scope
- `extensions/pi-linear-tools.js`
- `src/linear.js` (workspace helper)
- `tests/test-extension-registration.js`

## Implementation Plan
1. Add a Linear helper to fetch available workspaces (organization-backed for current API context).
2. Add interactive config helpers in extension:
   - detect if API key exists globally/settings
   - ask auth method (OAuth/API key) when key is missing
   - abort with "not implemented" on OAuth
   - prompt for API key on API key path
   - list workspaces and let user select
   - list teams for selected workspace and let user select
   - persist selected values in settings
3. Wire the interactive flow into `/linear-tools-config` when called without parameters and with UI available.
4. Keep non-interactive behavior unchanged as fallback.
5. Add/adjust tests for interactive config and run full test suite.