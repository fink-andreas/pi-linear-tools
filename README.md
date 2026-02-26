# pi-linear-tools

`pi-linear-tools` is a **Pi extension package** for the [Pi coding agent](https://github.com/badlogic/pi-mono), with Linear SDK-powered tools for issues, projects, and milestones.

## Install

### As a pi package (recommended)
```bash
pi install npm:@fink-andreas/pi-linear-tools
pi config
```
Enable the `pi-linear-tools` extension resource.

### As an npm package
```bash
npm install -g @fink-andreas/pi-linear-tools
```

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
Actions: `list`

### `linear_milestone`
Actions: `list`, `view`, `create`, `update`, `delete`

## CLI usage

If installed globally via npm, you can run:

```bash
npm install -g @fink-andreas/pi-linear-tools
pi-linear-tools --help
pi-linear-tools config
pi-linear-tools config --api-key lin_xxx
pi-linear-tools config --default-team ENG
pi-linear-tools config --team ENG --project "My Project"
```

If `pi-linear-tools` is not found, run it from the repo:

```bash
node bin/pi-linear-tools.js --help
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
