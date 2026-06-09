# Release v0.7.1

**Patch release for issue creation milestone assignment and configuration help text.**

## Highlights
- Fix `linear_issue(action="create")` milestone assignment.
- Fix a typo in the extension configuration command text.
- Normalize npm package metadata to `0.7.1`.

## Bug Fixes

### `linear_issue(action="create")` milestone assignment
Creating an issue with `milestone` or `projectMilestoneId` now assigns the selected project milestone during issue creation.

```json
{
  "action": "create",
  "title": "Review release notes",
  "project": "Inbox",
  "milestone": "Reviews"
}
```

- Supports explicit `projectMilestoneId` on create.
- Resolves milestone names/IDs in the selected project context.
- Keeps clear/no-op milestone values unassigned on create.
- Adds regression coverage for handler and low-level create paths.

### Configuration command text
- Fixed a typo in the config command/help text.

## Release Maintenance
- Updated `package.json` and `package-lock.json` to version `0.7.1`.
- Backfilled changelog entries for `v0.7.0` and `v0.7.1`.

---

**npm package:** `@fink-andreas/pi-linear-tools`  
**git tag:** `v0.7.1`
