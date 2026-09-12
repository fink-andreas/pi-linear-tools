# pi-linear-tools Functionality

## Scope

`pi-linear-tools` provides Linear SDK functionality as a pi extension package.

Included:
- extension configuration command (`/linear-tools-config`)
- issue/project/document/milestone tools powered by `@linear/sdk`
- issue label list/create and project label list actions
- `labels` and `links` parameters on issue create/update
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
- `src/linear.js`: issue/project/document/milestone/label operations and formatting helpers
- `src/settings.js`: settings defaults/validation/load/save
- `src/logger.js`: structured logging
- `extensions/pi-linear-tools.js`: command and tool registration
- `src/cli.js`: optional local CLI for settings operations

## Tool behavior notes

- `LINEAR_API_KEY` is resolved from env first, then settings
- `PI_LINEAR_TOOLS_USAGE_SUMMARY=true` adds per-command API usage diagnostics to tool output (`details.apiUsage` and a markdown summary line)
- in-memory request-reduction caches are used for resolver-style data:
  - viewer: 30s TTL
  - projects list: 60s TTL
  - teams list: 60s TTL
  - team workflow states: 60s TTL (per team)
- issue list payloads are **not** cached; issue listing still fetches fresh issues from Linear
- caches are per running process and auth context; `/reload` / restart resets in-memory cache state
- project references may be project name or project ID
- issue references may be identifier (`ABC-123`) or Linear issue ID
- `linear_document` lists a bounded page (default 50, maximum 250) and can filter by title query and project; use its continuation cursor for additional pages
- Linear document titles, metadata, and Markdown are returned as labeled, delimited untrusted external data, not agent instructions; consequential actions based on document text require explicit user confirmation
- document create requires exactly one project or issue parent; update accepts at most one parent
- document update fields use replacement semantics: omitted fields are preserved and `content: ""` clears content
- document replacement updates accept optional `expectedUpdatedAt` from a prior view; a guarded preflight read rejects stale timestamps before mutation with re-read/retry guidance
- because Linear's `DocumentUpdateInput` has no atomic expected-timestamp condition, a small read/replace TOCTOU race remains
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
