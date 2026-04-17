# Problem: Milestone Operations Fail with Name Lookup

## Issue

Milestone operations that use a name/string identifier fail with:
```
Linear API error: Entity not found: ProjectMilestone - Could not find referenced ProjectMilestone
```

## Affected Operations

| Action | Example | Result |
|--------|---------|--------|
| `linear_milestone view` | `milestone="Smoke Test Milestone"` | ❌ Fails |
| `linear_milestone update` | `milestone="Smoke Test Milestone"` | ❌ Fails |
| `linear_milestone delete` | `milestone="Smoke Test Milestone"` | ❌ Fails |
| `linear_issue update` (milestone) | `milestone="First Steps"` | ❌ Fails |

## Working Workaround

Use the milestone's **UUID** instead of the name:

```bash
# Get milestone ID from list
linear_milestone(action="list", project="pi-linear-test-repo")

# Use ID for operations
linear_milestone(action="view", milestone="<MILESTONE_UUID>")
linear_milestone(action="update", milestone="<MILESTONE_UUID>", description="New desc")
linear_milestone(action="delete", milestone="<MILESTONE_UUID>")
```

## Root Cause

The Linear API doesn't support direct name-to-ID resolution for milestones. The MCP tool passes the string directly without querying for matching milestones by name first.

## Expected Fix

The MCP tool should:
1. Accept milestone name as input
2. Query Linear API to find matching milestone by name
3. Use the returned UUID for the actual API call
4. Or provide clear error message suggesting to use ID

## Severity

**Medium** - Impacts usability but has workaround.
