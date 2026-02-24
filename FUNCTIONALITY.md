# pi-linear-tools Functionality

## Scope

`pi-linear-tools` provides Linear SDK functionality as a pi extension package.

Included:
- extension configuration command (`/linear-tools-config`)
- issue/project/milestone tools powered by `@linear/sdk`
- issue start flow with optional git branch creation/switch
- settings persistence for API key/default team/project team mapping

Excluded:
- daemon runtime
- polling loop
- systemd service installation/control
- tmux/process session management
- RPC process lifecycle management

## Core modules

- `src/linear-client.js`: Linear SDK client factory
- `src/linear.js`: issue/project/milestone operations and formatting helpers
- `src/settings.js`: settings defaults/validation/load/save
- `src/logger.js`: structured logging
- `extensions/pi-linear-tools.js`: command and tool registration
- `src/cli.js`: optional local CLI for settings operations

## Tool behavior notes

- `LINEAR_API_KEY` is resolved from env first, then settings
- project references may be project name or project ID
- issue references may be identifier (`ABC-123`) or Linear issue ID
- default team resolution order for issue creation:
  1. explicit `team` parameter
  2. project-level configured team
  3. global `defaultTeam`
- `linear_issue` `start` action:
  - uses Linear branch name if available
  - can create/switch git branch via `pi.exec("git", ...)`

## Settings schema

```json
{
  "schemaVersion": 1,
  "linearApiKey": null,
  "defaultTeam": null,
  "projects": {
    "<linear-project-id>": {
      "scope": {
        "team": "ENG"
      }
    }
  }
}
```
