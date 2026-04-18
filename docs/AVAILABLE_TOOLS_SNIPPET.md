# Handoff: Check `Available tools` Prompt Snippets in `pi-linear-tools`

## Why this handoff exists
A similar issue was found in another pi extension project: the tool worked and was registered correctly, but it did **not** appear in pi's default system prompt under **Available tools**.

The root cause there was simple:

- pi includes custom extension tools in the textual **Available tools** summary only when the tool definition has a `promptSnippet`
- optional tool-specific guidance can also be added with `promptGuidelines`
- without `promptSnippet`, a custom tool is still callable, but it may be omitted from the short prompt summary

## What to check in this project
In `../pi-linear-tools/index.js`, these tools are registered:

- `linear_issue`
- `linear_project`
- `linear_team`
- `linear_milestone` (conditional)

Check whether each of these registrations includes:

- `promptSnippet`
- optionally `promptGuidelines`

At the moment, the registrations define `name`, `label`, `description`, `parameters`, `renderResult`, and `execute`, but they should be reviewed specifically for prompt metadata.

## Expected behavior
If `pi-linear-tools` wants its tools to show up consistently in pi's default **Available tools** prompt section, each tool should define a concise `promptSnippet`.

Example intent:

- `linear_issue` → one-line summary of issue operations
- `linear_project` → one-line summary of project listing
- `linear_team` → one-line summary of team listing
- `linear_milestone` → one-line summary of milestone operations

## Suggested implementation
For each `pi.registerTool({...})` call, add something like:

```js
promptSnippet: 'Interact with Linear issues (list, view, create, update, comment, start, delete)',
promptGuidelines: [
  'Use linear_issue for Linear issue listing, lookup, creation, updates, comments, and start actions.',
],
```

And equivalent snippets for:

- `linear_project`
- `linear_team`
- `linear_milestone`

Keep snippets short because they are meant for the prompt summary, not full documentation.

## Where to validate
### Code
- `index.js`

### Tests
- `tests/test-extension-registration.js`

Add assertions that registered tools expose the expected `promptSnippet` values.

## What to verify manually
1. Install/reload the extension in pi.
2. Confirm the relevant tools appear in the default prompt's **Available tools** section.
3. Confirm the milestone tool behavior still respects its existing conditional registration rules.
4. Confirm no behavior changes beyond prompt visibility/documentation.

## Important note about conditional tools
`linear_milestone` is only registered in some auth configurations.
If you add prompt metadata there, make sure tests still cover both cases:

- milestone tool hidden when OAuth is used without API key
- milestone tool present when API key auth is available

## Relevant pi behavior
pi extension docs state that:

- `promptSnippet` opts a custom tool into a one-line entry in **Available tools**
- if omitted, custom tools may be left out of that section
- `promptGuidelines` adds tool-specific bullets to the default **Guidelines** section while the tool is active

## Recommended outcome
Make tool listing consistent by explicitly defining `promptSnippet` for every user-facing tool in `pi-linear-tools`, then add regression coverage in `tests/test-extension-registration.js`.
