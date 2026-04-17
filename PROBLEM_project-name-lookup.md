# Problem: Project Update/Name Operations Fail with Name Lookup

## Issue

Project operations that use a name/string identifier for `update` fail with:
```
Linear project operation failed: Project not found: Smoke Test Project
```

## Affected Operations

| Action | Example | Result |
|--------|---------|--------|
| `linear_project update` | `project="Smoke Test Project"` | ❌ Fails |
| `linear_project archive` | `project="Smoke Test Project"` | ❌ Fails |
| `linear_project unarchive` | `project="Smoke Test Project"` | ❌ Fails |
| `linear_project delete` | `project="Smoke Test Project"` | ❌ Fails |

## Working Workaround

Use the project's **UUID** instead of the name:

```bash
# Get project ID from list
linear_project(action="list")

# Use ID for operations  
linear_project(action="update", project="<PROJECT_UUID>", description="New desc")
linear_project(action="archive", project="<PROJECT_UUID>")
linear_project(action="delete", project="<PROJECT_UUID>")
```

## Note

Other operations like `view` and `list` work correctly with project names - only `update`, `archive`, `unarchive`, and `delete` are affected.

## Root Cause

The Linear API update/mutation endpoints require a direct UUID reference, while the tool accepts names for read operations but fails to resolve names to IDs for write operations.

## Expected Fix

The MCP tool should:
1. Accept project name as input for all operations
2. Query Linear API to find matching project by name if UUID not provided
3. Use the returned UUID for the actual API call
4. Or provide clear error message suggesting to use ID

## Severity

**Medium** - Impacts usability but has workaround. Inconsistent behavior since `view` and `create` work with names.
