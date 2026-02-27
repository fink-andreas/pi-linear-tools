# Handoff: INN-241 - Add Markdown Rendering for Tool Outputs

## Status
**COMPLETED** - Markdown rendering now works correctly

## Solution

The issue was that `renderResult` was returning a custom object with `{ render, invalidate }` methods, but it should return a **Component instance** directly (like `Markdown` or `Text`).

### Fixed Implementation

The corrected `renderMarkdownResult` function in `extensions/pi-linear-tools.js`:

```javascript
/**
 * Render tool result as markdown
 */
function renderMarkdownResult(result, _options, _theme) {
  const text = result.content?.[0]?.text || '';

  // Fall back to plain text split if markdown packages not available (e.g., in tests)
  if (!Markdown || !getMarkdownTheme) {
    // Return a simple component-like object for test environments
    const lines = text.split('\n');
    return {
      render: () => lines,
      invalidate: () => {},
    };
  }

  // Return Markdown component directly - the TUI will call its render() method
  const mdTheme = getMarkdownTheme();
  return new Markdown(text, 0, 0, mdTheme);
}
```

### Key Changes

1. **Correct signature**: `(result, _options, _theme)` - accepts the options and theme parameters
2. **Return Component directly**: Returns `new Markdown(text, 0, 0, mdTheme)` instead of a wrapper object
3. **Simplified imports**: Removed unused `visibleWidth` and `truncateToWidth` imports

### How It Works

- The `renderResult` callback receives `(result, options, theme)` parameters
- It should return a Component instance (like `Markdown`, `Text`, etc.)
- The TUI framework calls the component's `render(width)` method automatically
- The `Markdown` component handles line width, truncation, and styling internally

## Files Modified

- `extensions/pi-linear-tools.js`:
  - Simplified imports (removed `visibleWidth`, `truncateToWidth`)
  - Fixed `renderMarkdownResult` function signature and return type

## Testing

1. Run `npm test` - all tests pass
2. Reinstall extension: `pi remove /home/afi/dvl/pi-linear-tools && pi install /home/afi/dvl/pi-linear-tools`
3. **Restart pi completely** (not just `/reload`) - required for extension source changes
4. Test with Linear tool commands like `list issues`

## Git Commits

- `c344dab` - feat: add Markdown rendering for tool outputs (INN-241)
- `6223090` - fix: truncate Markdown lines to terminal width (INN-241)
- `a8b1417` - fix: split and truncate Markdown lines properly (INN-241)
- (new commit pending) - fix: return Markdown component directly in renderResult
