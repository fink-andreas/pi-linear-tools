# Handoff: INN-241 - Add Markdown Rendering for Tool Outputs

## Status
**Partially implemented** - Not crashing, but Markdown not rendering (shows as plain text)

## What Was Implemented

### Changes to `extensions/pi-linear-tools.js`

1. **Added optional imports** for Markdown rendering (lines 8-22):
   ```javascript
   let Markdown = null;
   let getMarkdownTheme = null;
   let visibleWidth = null;
   let truncateToWidth = null;

   try {
     const piTui = await import('@mariozechner/pi-tui');
     Markdown = piTui.Markdown;
     visibleWidth = piTui.visibleWidth;
     truncateToWidth = piTui.truncateToWidth;
     const piCodingAgent = await import('@mariozechner/pi-coding-agent');
     getMarkdownTheme = piCodingAgent.getMarkdownTheme;
   } catch {
     // Packages not available in test environment
   }
   ```

2. **Created `renderMarkdownResult` helper function** (lines 385-420):
   ```javascript
   function renderMarkdownResult(result) {
     const text = result.content?.[0]?.text || '';

     if (!Markdown || !getMarkdownTheme || !visibleWidth || !truncateToWidth) {
       return { render: () => text.split('\n'), invalidate: () => {} };
     }

     const mdTheme = getMarkdownTheme();
     const md = new Markdown(text, 0, 0, mdTheme);

     return {
       render(width) {
         const rawLines = md.render(width);
         const result = [];
         for (const line of rawLines) {
           const subLines = line.split('\n');
           for (const subLine of subLines) {
             if (visibleWidth(subLine) > width) {
               result.push(truncateToWidth(subLine, width, ''));
             } else {
               result.push(subLine);
             }
           }
         }
         return result;
       },
       invalidate() {
         md.invalidate();
       },
     };
   }
   ```

3. **Added `renderResult: renderMarkdownResult`** to all 4 tool registrations:
   - `linear_issue` (line 526)
   - `linear_project` (line 571)
   - `linear_team` (line 600)
   - `linear_milestone` (line 655)

## Current Behavior

- **No crash** - The width truncation fix resolved the crash
- **No Markdown rendering** - Output appears as plain text with raw Markdown syntax (e.g., `**bold**`, `# headers`)

## Problem Analysis

The `renderResult` function returns a custom object with `{ render, invalidate }` methods. However, this may not be the correct interface expected by pi's tool rendering system.

### Possible Issues

1. **Wrong return type**: The `renderResult` callback might expect a `Component` instance (like `Text` or `Markdown`), not a custom object with render/invalidate methods.

2. **Component vs wrapper**: Looking at the pi docs (tui.md):
   > renderResult(result, { expanded, isPartial }, theme) { ... }
   > return new Text(text, 0, 0);  // 0,0 padding - Box handles it

   The docs show returning a `Text` component directly, not a wrapper object.

3. **The Markdown component might need different usage**: The Markdown component from `@mariozechner/pi-tui` may have different requirements when used inside `renderResult`.

## Recommended Next Steps

### Option 1: Return Markdown Component Directly

Try returning the Markdown component directly without wrapping:

```javascript
function renderMarkdownResult(result, options, theme) {
  const text = result.content?.[0]?.text || '';

  if (!Markdown || !getMarkdownTheme) {
    // Import Text as fallback
    return new Text(text, 0, 0);
  }

  const mdTheme = getMarkdownTheme();
  return new Markdown(text, 0, 0, mdTheme);
}
```

### Option 2: Check if Text Component Works

First verify the rendering system works by returning a simple `Text` component:

```javascript
import { Text } from "@mariozechner/pi-tui";

function renderMarkdownResult(result, options, theme) {
  const text = result.content?.[0]?.text || '';
  return new Text(text, 0, 0);
}
```

If this works (text appears styled), the issue is specific to Markdown. If it doesn't work, the issue is with how `renderResult` is being called/used.

### Option 3: Check pi Source Code

Look at how built-in tools use `renderResult`:
- `packages/coding-agent/src/core/tools/read.ts`
- `packages/coding-agent/src/core/tools/bash.ts`

These might show the correct pattern for custom rendering.

### Option 4: Use Text with Styled Output

Instead of Markdown component, manually style with theme:

```javascript
function renderMarkdownResult(result, options, theme) {
  const text = result.content?.[0]?.text || '';
  // Use theme.fg() to apply colors/styles
  return new Text(theme.fg("toolOutput", text), 0, 0);
}
```

## Key Files to Reference

1. **pi-tui Markdown component**:
   - `pi-mono/packages/tui/src/components/markdown.ts`

2. **Built-in tool rendering**:
   - `pi-mono/packages/coding-agent/src/core/tools/*.ts`

3. **Tool execution rendering**:
   - `pi-mono/packages/coding-agent/src/modes/interactive/components/tool-execution.ts`

4. **Extension docs**:
   - `pi-mono/docs/extensions.md` (Custom Tools → Custom Rendering section)
   - `pi-mono/docs/tui.md` (Markdown component section)

## Testing

After making changes:
1. Run `npm test` to ensure tests pass
2. Reinstall extension: `pi remove pi-linear-tools && pi install .`
3. Restart pi completely (not just `/reload`)
4. Test with `list issues` command

## Git Commits

- `c344dab` - feat: add Markdown rendering for tool outputs (INN-241)
- `6223090` - fix: truncate Markdown lines to terminal width (INN-241)
- `a8b1417` - fix: split and truncate Markdown lines properly (INN-241)
