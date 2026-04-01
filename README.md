# pi-linear-tools

`pi-linear-tools` is a Pi extension for the [Pi coding agent](https://github.com/badlogic/pi-mono) that lets you manage [Linear](https://linear.app/about) issues, projects, and milestones via LLM tools and CLI commands.

Useful mental model:
- `issue update` changes issue fields; `issue comment` adds discussion; `issue activity` reads the Activity timeline
- `project update` changes project fields; `project-update` manages Updates tab entries
- `project-update` maps to Linear project updates in the Updates tab
- `sync-doc run` and `sync-doc check` default to all configured targets in `.linear-tools/config.json`
- `sync-doc --target X` narrows the operation to one configured target

Reference conventions:
- issues use issue key or issue ID
- projects use project name or project ID
- project updates use project update ID
- milestones use milestone ID

## Install

### As a pi package (recommended)
```bash
pi install npm:@fink-andreas/pi-linear-tools
```

### As an npm package
```bash
npm install -g @fink-andreas/pi-linear-tools
```
Use pi-linear-tools as a CLI tool.

## Initial configuration

After installation, run `/linear-tools-config` in pi.

When used **without parameters**, it starts the interactive setup flow and guides you through:
- authentication (API key)
- workspace selection
- default team selection

```text
/linear-tools-config
```

Optional non-interactive commands:
```text
/linear-tools-config --api-key lin_xxx
/linear-tools-config --default-team ENG
/linear-tools-config --team ENG --project "My Project"
```

## Extension commands

- `/linear-tools-config`
- `/linear-tools-help`

## LLM-callable tools

### `linear_issue`
Actions: `list`, `view`, `activity`, `create`, `update`, `comment`, `start`, `delete`

### `linear_project`
Actions: `list`, `view`, `create`, `update`, `delete`, `archive`, `unarchive`

### `linear_project_update`
Actions: `list`, `view`, `create`, `update`, `archive`, `unarchive`

### `linear_milestone`
Actions: `list`, `view`, `create`, `update`, `delete`

## CLI usage

If installed globally via ```npm install -g @fink-andreas/pi-linear-tools```, CLI command ```pi-linear-tools``` is available:

```bash
pi-linear-tools --help
pi-linear-tools issue --help
pi-linear-tools project --help
pi-linear-tools project-update --help
pi-linear-tools sync-doc --help
pi-linear-tools config
pi-linear-tools config --api-key lin_xxx
pi-linear-tools config --default-team ENG
pi-linear-tools config --team ENG --project "My Project"
```

### Issue commands

Use `update` to change the issue itself. Use `comment` to add discussion. Use `activity` to read the Activity timeline shown in Linear.

```bash
# List issues
pi-linear-tools issue list --project "My Project"
pi-linear-tools issue list --project "My Project" --states "In Progress,Backlog"
pi-linear-tools issue list --project "My Project" --assignee me

# View issue details
pi-linear-tools issue view ENG-123
pi-linear-tools issue view ENG-123 --no-comments

# Read Activity timeline
pi-linear-tools issue activity ENG-123 --limit 20
pi-linear-tools issue activity https://linear.app/workspace/issue/ENG-123/example --limit 20

# Create issue
pi-linear-tools issue create --title "Fix login bug" --team ENG
pi-linear-tools issue create --title "New feature" --team ENG --project "My Project" --priority 2 --assignee me

# Update issue
pi-linear-tools issue update ENG-123 --state "In Progress"
pi-linear-tools issue update ENG-123 --title "Updated title" --assignee me
pi-linear-tools issue update ENG-123 --milestone "Sprint 1"
pi-linear-tools issue update ENG-123 --sub-issue-of ENG-100

# Comment on issue
pi-linear-tools issue comment ENG-123 --body "This is fixed in PR #456"
pi-linear-tools issue comment ENG-123 --body "Blocked on API review"

# Start working on issue (creates branch, sets state to In Progress)
pi-linear-tools issue start ENG-123
pi-linear-tools issue start ENG-123 --from-ref main --on-branch-exists suffix

# Delete issue
pi-linear-tools issue delete ENG-123
```

### Project commands

Use `project update` to change the project record itself: name, teams, dates, lead, description, priority, color, or icon.

```bash
pi-linear-tools project list
pi-linear-tools project view "My Project"
pi-linear-tools project create --name "Roadmap Refresh" --teams ENG,OPS --lead me
pi-linear-tools project update "Roadmap Refresh" --description "Updated scope" --target-date 2026-06-30
pi-linear-tools project update "Roadmap Refresh" --lead me --teams ENG,OPS
pi-linear-tools project delete "Roadmap Refresh"
pi-linear-tools project archive "Roadmap Refresh"
pi-linear-tools project unarchive 11111111-1111-4111-8111-111111111111
```

### Project update commands

This maps to the Updates tab inside a Linear project. Create an update by project name or ID, then use the returned project update ID for later view, update, archive, or unarchive actions.

```bash
pi-linear-tools project-update list --project "My Project"
pi-linear-tools project-update view 22222222-2222-4222-8222-222222222222
pi-linear-tools project-update create --project "My Project" --body "Weekly progress update" --health onTrack
pi-linear-tools project-update update 22222222-2222-4222-8222-222222222222 --body "Revised update" --health atRisk
pi-linear-tools project-update archive 22222222-2222-4222-8222-222222222222
pi-linear-tools project-update unarchive 22222222-2222-4222-8222-222222222222
```

### Sync doc commands

```bash
pi-linear-tools sync-doc list
pi-linear-tools sync-doc run
pi-linear-tools sync-doc check
pi-linear-tools sync-doc run --target package-readme
pi-linear-tools sync-doc check --target package-readme
pi-linear-tools sync-doc run --file README.md --project "Roadmap Refresh" --field content
pi-linear-tools sync-doc run --file providers/foo/README.md --project "Roadmap Refresh" --target-type document --document-title "Provider Foo"
```

Use one project overview target for the project body, then sync deeper docs as separate Linear documents.

The simplest setup is to keep `.linear-tools/config.json` at your monorepo or repo root so the targets live with the code they sync.

`~/.linear-tools/config.json` is also supported for personal defaults, but it should be treated as an override layer, not the main source of truth for repo-owned sync targets.

Recommended pattern for multiple docs:
- one `projectField` target syncs the project overview into `project.content` or `project.description`
- deeper docs use `targetType: "document"` so each file gets its own Linear document
- the project overview target can set `documentIndexMarker` to maintain a managed list of links to those documents

For repos with multiple sync targets, the normal workflow is:
- define them in the repo-root `.linear-tools/config.json`
- run `pi-linear-tools sync-doc run` to push everything
- run `pi-linear-tools sync-doc check` in CI or before updates if you want drift visibility

Example:

```json
{
  "syncDocs": {
    "targets": [
      {
        "name": "project-overview",
        "file": "README.md",
        "project": "Roadmap Refresh",
        "field": "content",
        "marker": "project-overview",
        "documentIndexMarker": "project-doc-links"
      },
      {
        "name": "provider-foo",
        "targetType": "document",
        "file": "providers/foo/README.md",
        "project": "Roadmap Refresh",
        "title": "Provider Foo",
        "marker": "provider-foo",
        "documentId": "optional-existing-document-id"
      }
    ]
  }
}
```

Store that config at `.linear-tools/config.json`. Sync state is written to `.linear-tools/sync-state.json`.
If `documentId` is omitted on a document target, the first sync creates a new Linear document and stores the created ID in sync state.

Managed content is wrapped in marker comments inside the target Linear field so manual content above or below the managed block is preserved:

```md
<!-- linear-tools:sync-start README -->
...synced markdown...
<!-- linear-tools:sync-end README -->
```

When `documentIndexMarker` is configured on the overview target, the project field also gets a second managed block containing links to the synced Linear documents.

### Team commands

```bash
pi-linear-tools team list
```

### Milestone commands

```bash
# List milestones
pi-linear-tools milestone list --project "My Project"

# View milestone details
pi-linear-tools milestone view <milestone-id>

# Create milestone
pi-linear-tools milestone create --project "My Project" --name "v1.0 Release"
pi-linear-tools milestone create --project "My Project" --name "Sprint 1" --target-date 2024-12-31 --status planned

# Update milestone
pi-linear-tools milestone update <milestone-id> --status inProgress

# Delete milestone
pi-linear-tools milestone delete <milestone-id>
```

## Configuration storage

Settings path:

`~/.pi/agent/extensions/pi-linear-tools/settings.json`

Environment fallback:
- `LINEAR_API_KEY` (takes precedence over settings)

Debug/diagnostics environment flags:
- `PI_LINEAR_TOOLS_USAGE_SUMMARY=true` — append per-command Linear API usage summary to tool output markdown and include `details.apiUsage`
- `LOG_LEVEL=debug` — enable detailed file logging
- `PI_LINEAR_TOOLS_LOG_TO_CONSOLE=true` — mirror logs to console (normally file-first logging)
- `PI_LINEAR_TOOLS_LOG_FILE=/custom/path.log` — override log file path

## Development

```bash
npm install
npm test
npm run release:check
node index.js --help
```

### Local extension debug flow (unpublished code)

Use project-local extension loading with a generated wrapper file:

```bash
npm run dev:sync-local-extension
```

Then in pi:

```text
/reload
```

If install/remove sources changed, restart pi before validating.

Release checklist: see `RELEASE.md`.
Post-release verification checklist: see `POST_RELEASE_CHECKLIST.md`.
