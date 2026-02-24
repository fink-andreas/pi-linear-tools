# pi-linear-tools

`pi-linear-tools` is a **pi extension package** with Linear SDK-powered tools for issues, projects, and milestones.

It is extracted from `pi-linear-service`, but intentionally excludes:
- systemd service management
- background poll loops
- tmux/RPC daemon orchestration

## Install

### As a pi package (recommended)
```bash
pi install git:github.com/fink-andreas/pi-linear-tools
pi config
```
Enable the `pi-linear-tools` extension resource.

### As an npm package
```bash
npm install -g @fink-andreas/pi-linear-tools
```

## Initial configuration

Set API key in extension settings:
```text
/linear-tools-config --api-key lin_xxx
```

Optional default team:
```text
/linear-tools-config --default-team ENG
```

Optional project-specific team mapping:
```text
/linear-tools-config --team ENG --project "My Project"
```

Show current configuration:
```text
/linear-tools-config
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

```bash
pi-linear-tools --help
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

Release checklist: see `RELEASE.md`.
Post-release verification checklist: see `POST_RELEASE_CHECKLIST.md`.
