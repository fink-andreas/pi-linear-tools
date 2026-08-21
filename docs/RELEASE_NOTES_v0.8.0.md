# Release v0.8.0

**Feature release for Linear labels, link attachments, and issue text search.**

## Highlights

- Manage issue labels and append issue link attachments directly through `linear_issue` and the CLI.
- List and create issue labels, and list project labels.
- Search issue titles and descriptions with `linear_issue(action="list", query="...")`.
- More reliable defaults, error reporting, and Ctrl+O expansion for tool output.

## New features

### Labels and links

`linear_issue` now supports:

- `action="labels"` to list labels or create one with `subAction="create"`.
- `labels` on issue create/update, accepting label names or IDs.
- `links` on issue create/update to append attachments from URLs.

`linear_project(action="labels")` lists project labels. The CLI provides equivalent `issue labels`, `project labels`, `--labels`, and repeatable `--link` workflows.

### Issue text search

Pass `query` to `linear_issue(action="list")` to find issues whose titles or descriptions match free text.

## Fixes and usability

- Default project resolution derives the project from the Git `origin` remote, avoiding worktree-directory names.
- Linear tool output now honors Pi's Ctrl+O collapsed/expanded rendering contract.
- Rejected Linear API calls are surfaced as errors rather than successful empty results, with a consistent operation-specific prefix.
- Label resolution supports workspace labels for team issues; comma-separated labels and link-only updates work as expected.

## Tests

Regression coverage was added for labels and links, issue text search, default-project resolution, collapsed rendering, and tool error propagation.

## Contributor credits

Thank you to [@elecnix](https://github.com/elecnix) (Nicolas Marchildon) for the PRs included in this release:

- [#24](https://github.com/fink-andreas/pi-linear-tools/pull/24) — issue text search
- [#29](https://github.com/fink-andreas/pi-linear-tools/pull/29) — Ctrl+O collapse/expand rendering
- [#32](https://github.com/fink-andreas/pi-linear-tools/pull/32) — error signaling for rejected API calls
- [#33](https://github.com/fink-andreas/pi-linear-tools/pull/33) — Git-origin project defaults
- [#35](https://github.com/fink-andreas/pi-linear-tools/pull/35) — issue/project labels and issue links

---

**npm package:** `@fink-andreas/pi-linear-tools`
**git tag:** `v0.8.0`
