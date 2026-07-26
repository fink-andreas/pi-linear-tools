# Release v0.7.2

**Patch release for compatibility with the renamed Pi packages and safe fallback rendering.**

## Highlights
- Supports Pi installations using the `@earendil-works/*` package scope.
- Prevents fallback tool rendering from exceeding terminal width for CJK/non-ASCII text and tabs.

## Bug Fixes

### Pi package rename compatibility
`pi-linear-tools` can now load Pi APIs from both the legacy `@mariozechner/*` packages and the renamed `@earendil-works/*` packages.

This covers direct package imports as well as globally installed Pi locations used by the extension fallback loader.

### CJK-safe plain-text fallback rendering
When Markdown rendering is unavailable or fails, fallback output now truncates by conservative terminal column width rather than JavaScript string length.

- Printable ASCII counts as one column.
- Tabs use Pi TUI's three-column behavior.
- Non-ASCII characters count as two columns, avoiding over-width output and Pi TUI crashes.

Regression tests cover CJK text, tabs, missing Markdown dependencies, and Markdown construction failures.

---

**npm package:** `@fink-andreas/pi-linear-tools`
**git tag:** `v0.7.2`
