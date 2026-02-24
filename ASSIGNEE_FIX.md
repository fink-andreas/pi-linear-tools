# Assignee Issue Update Fix

## Problem

When trying to assign an issue using `linear_issue` with `action="update"` and `assignee="me"`, the tool would return "No update fields provided" or "Updated issue undefined". This was because:

1. The `updateIssue` function in `src/linear.js` did not handle the `assigneeId` field
2. The `executeIssueUpdate` function in `extensions/pi-linear-tools.js` did not pass the `assignee` parameter to `updateIssue`

## Solution

### Changes to `src/linear.js`

Added handling for `assigneeId` in the `updateIssue` function:

```javascript
if (patch.assigneeId !== undefined) {
  updateInput.assigneeId = patch.assigneeId;
}
```

This allows the `updateIssue` function to accept and process the `assigneeId` field from the patch parameter.

### Changes to `extensions/pi-linear-tools.js`

Updated `executeIssueUpdate` to:

1. Handle the `assignee` parameter by converting it to `assigneeId`:
```javascript
if (params.assignee === 'me') {
  const viewer = await client.viewer;
  updatePatch.assigneeId = viewer.id;
} else if (params.assignee) {
  updatePatch.assigneeId = params.assignee;
}
```

2. Include assignee in the change summary:
```javascript
const friendlyChanges = result.changed.map((field) => {
  if (field === 'stateId') return 'state';
  if (field === 'assigneeId') return 'assignee';
  return field;
});
```

3. Display assignee changes in the response:
```javascript
if (friendlyChanges.includes('assignee')) {
  const assigneeLabel = result.issue?.assignee?.displayName || 'Unassigned';
  changeSummaryParts.push(`assignee: ${assigneeLabel}`);
}
```

## Usage

Now users can assign issues using:

```bash
linear_issue action=update issue=INN-226 assignee=me
```

Or with a specific assignee ID:

```bash
linear_issue action=update issue=INN-226 assignee=<assignee-id>
```

The response will show the updated assignee information.

## Tests

Added `tests/test-assignee-update.js` with comprehensive tests:
- Test 1: Update with assigneeId
- Test 2: Update without assigneeId (other fields)
- Test 3: Update with both assigneeId and other fields
- Test 4: Update with no fields (should throw error)

All tests pass successfully.