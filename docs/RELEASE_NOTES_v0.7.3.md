# Release v0.7.3

**Patch release that fixes OAuth-authenticated issue-relation updates.**

## Highlights
- Default OAuth grants now include Linear's `write` scope, allowing issue relations to be created.
- Relation scope failures now explain exactly how to restore access for legacy credentials.

## Bug Fixes

### Issue relations now work with new OAuth grants
`linear_issue update` can set the following issue-relation fields after a new OAuth login:

- `blockedBy`
- `blocking`
- `relatedTo`
- `duplicateOf`

These fields use Linear's `issueRelationCreate` mutation, which requires the `write` scope.

### Clear remediation for older credentials
OAuth access tokens issued before v0.7.3 do not gain `write` automatically. If a relation update is rejected for a missing scope, re-authenticate:

```bash
pi-linear-tools auth login
```

API-key users must use a key with write access.

## Tests
- Added regression coverage that the default OAuth authorization URL includes `write`.
- Added coverage for the targeted relation-scope remediation hint.

---

**npm package:** `@fink-andreas/pi-linear-tools`
**git tag:** `v0.7.3`
