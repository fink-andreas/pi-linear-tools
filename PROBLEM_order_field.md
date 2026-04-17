# Bug Report: `linear_milestone` list action fails with "order" field error

## Summary

The `linear_milestone` tool's `list` action fails when attempting to retrieve milestones, regardless of whether a project is specified.

## Error Message

```
Linear API error: Cannot query field "order" on type "ProjectMilestone".
```

## Raw Tool Calls

### Attempt 1: List milestones without project

```json
{
  "tool": "linear_milestone",
  "args": {
    "action": "list"
  }
}
```

**Response:**
```json
{
  "Linear API error: Cannot query field \"order\" on type \"ProjectMilestone\"."
}
```

### Attempt 2: List milestones with project filter

```json
{
  "tool": "linear_milestone",
  "args": {
    "action": "list",
    "project": "pi-linear-test-repo"
  }
}
```

**Response:**
```json
{
  "Linear API error: Cannot query field \"order\" on type \"ProjectMilestone\"."
}
```

## Root Cause

The Linear MCP tool constructs a GraphQL query that includes an `order` field on the `ProjectMilestone` type for sorting purposes. However, this field does not exist in Linear's current API schema.

## Impact

- Users cannot list milestones directly via the `linear_milestone` tool
- Workaround: Use `linear_project` action `view` with `project` parameter to retrieve milestones as a nested object

## Expected Behavior

The `linear_milestone` tool should successfully return a list of milestones from Linear.

## Possible Fixes

1. **Remove the `order` field**: Update the GraphQL query to not request the `order` field on `ProjectMilestone`
2. **Use correct ordering field**: If Linear uses a different field for ordering (e.g., `createdAt`, `name`, or no explicit ordering), update the query accordingly
3. **Handle at application level**: Sort milestones in the tool's code after receiving the response instead of relying on GraphQL ordering

## Environment

- Project: `pi-linear-test-repo`
- Linear API version: current (as of 2026-04-17)
- Tool: `@mariozechner/pi-coding-agent` Linear integration
