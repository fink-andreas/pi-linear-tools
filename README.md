# pi-linear-tools

`pi-linear-tools` is a Pi extension for the [Pi coding agent](https://github.com/badlogic/pi-mono) that lets you manage [Linear](https://linear.app/about) issues, projects, and milestones via LLM tools and CLI commands.

Useful mental model:
- `project-update` maps to Linear project updates in the Updates tab
- `sync-doc run` and `sync-doc check` default to all configured targets in `.linear-tools.json`
- `sync-doc --target X` narrows the operation to one configured target

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
Actions: `list`, `view`, `create`, `update`, `comment`, `start`, `delete`

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
pi-linear-tools project --help
pi-linear-tools project-update --help
pi-linear-tools sync-doc --help
pi-linear-tools config
pi-linear-tools config --api-key lin_xxx
pi-linear-tools config --default-team ENG
pi-linear-tools config --team ENG --project "My Project"
```

### Issue commands

```bash
# List issues
pi-linear-tools issue list --project "My Project"
pi-linear-tools issue list --project "My Project" --states "In Progress,Backlog"
pi-linear-tools issue list --project "My Project" --assignee me

# View issue details
pi-linear-tools issue view ENG-123
pi-linear-tools issue view ENG-123 --no-comments

# Create issue
pi-linear-tools issue create --title "Fix login bug" --team ENG
pi-linear-tools issue create --title "New feature" --team ENG --project "My Project" --priority 2 --assignee me

# Update issue
pi-linear-tools issue update ENG-123 --state "In Progress"
pi-linear-tools issue update ENG-123 --title "Updated title" --assignee me
pi-linear-tools issue update ENG-123 --milestone "Sprint 1"

# Comment on issue
pi-linear-tools issue comment ENG-123 --body "This is fixed in PR #456"

# Start working on issue (creates branch, sets state to In Progress)
pi-linear-tools issue start ENG-123
pi-linear-tools issue start ENG-123 --branch custom-branch-name

# Delete issue
pi-linear-tools issue delete ENG-123
```

### Project commands

```bash
pi-linear-tools project list
pi-linear-tools project view "My Project"
pi-linear-tools project create --name "Roadmap Refresh" --teams ENG,OPS --lead me
pi-linear-tools project update "Roadmap Refresh" --description "Updated scope" --target-date 2026-06-30
pi-linear-tools project delete "Roadmap Refresh"
pi-linear-tools project archive "Roadmap Refresh"
pi-linear-tools project unarchive 11111111-1111-4111-8111-111111111111
```

### Project update commands

This maps to the Updates tab inside a Linear project.

```bash
pi-linear-tools project-update list --project "My Project"
pi-linear-tools project-update view 22222222-2222-4222-8222-222222222222
pi-linear-tools project-update create --project "My Project" --body "Weekly progress update" --health onTrack
pi-linear-tools project-update update 22222222-2222-4222-8222-222222222222 --health atRisk
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
```

The simplest setup is to keep `.linear-tools.json` at your monorepo or repo root so the targets live with the code they sync.

`~/.linear-tools.json` is also supported for personal defaults, but it should be treated as an override layer, not the main source of truth for repo-owned sync targets.

For repos with multiple sync targets, the normal workflow is:
- define them in the repo-root `.linear-tools.json`
- run `pi-linear-tools sync-doc run` to push everything
- run `pi-linear-tools sync-doc check` in CI or before updates if you want drift visibility

Example:

```json
{
  "syncDocs": {
    "targets": [
      {
        "name": "package-readme",
        "file": "packages/example-package/README.md",
        "project": "https://linear.app/example/project/example-project-abc123def456",
        "field": "content"
      }
    ]
  }
}
```

Managed content is wrapped in marker comments inside the target Linear field so manual content above or below the managed block is preserved:

```md
<!-- linear-tools:sync-start README -->
...synced markdown...
<!-- linear-tools:sync-end README -->
```

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
