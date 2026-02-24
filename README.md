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
npm install -g pi-linear-tools
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

## Configuration storage

Settings path:

`~/.pi/agent/extensions/pi-linear-tools/settings.json`

Environment fallback:
- `LINEAR_API_KEY` (takes precedence over settings)

## Development

```bash
npm install
npm test
node index.js --help
```
