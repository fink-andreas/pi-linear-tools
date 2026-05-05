# Release v0.7.0

**Issue image fetching + file download release.**

## Highlights
- Fetch embedded images from issue descriptions and comments
- Download Linear issue attachments to local filesystem
- List issues across the entire workspace without requiring a project
- Bug fixes for project archive, comment rendering, and rate-limit display

## New Features

### `linear_issue(action="images")`
Fetch markdown/HTML embedded images from Linear issues.

```json
{
  "action": "images",
  "issue": "ENG-123",
  "limit": 10,
  "includeComments": true
}
```

- Extracts `![]()` and `<img>` tags from issue description and comments
- Returns images as tool `image` content (base64-encoded)
- Special auth handling for Linear upload URLs (`uploads.linear.app`)
- 10 MiB per-image limit, default 10 images
- Reports fetch failures separately (doesn't block successful images)

### `linear_issue(action="download")`
Download Linear issue attachments to local filesystem.

```json
{
  "action": "download",
  "issue": "INN-299",
  "attachmentId": "att_xxx",
  "directory": "downloads",
  "filename": "spec.pdf",
  "overwrite": false
}
```

- Attachment selection by ID, title, URL, or index
- Relative path validation (rejects absolute paths and path traversal)
- Auto-creates missing directories
- Filename sanitization for safe filenames
- `allow_overwrite_files` config flag (default: `false`)
- 50 MiB max download size

### Config command
```bash
/linear-tools-config --allow-overwrite-files true
pi-linear-tools config --allow-overwrite-files true
```

## Bug Fixes

- **Fixed project archive mutation (INN-301)**: `archiveProject` now properly archives projects instead of deleting them.
- **Fixed comment rendering (INN-305)**: `linear_issue comment` now renders submitted comment text in the tool result.
- **Fixed rate-limit display (INN-304)**: Removed hardcoded total=5000; now reflects actual complexity-based rate limits.
- **Fixed project rate-limit pre-check (INN-303)**: `linear_project` and `linear_project_update` now have rate-limit pre-checks.
- **Fixed workspace-wide issue listing (#4)**: `linear_issue list` now works without a project context. When no project is specified and cwd doesn't match a Linear project, it falls back to workspace-level listing. Example: `linear_issue list assignee=me` now works.

## Documentation

- Updated smoke tests with coverage for `images` and `download` actions

---

**npm package:** `@fink-andreas/pi-linear-tools`  
**git tag:** `v0.7.0`
