# Release v0.8.1

**Release adding direct Linear document management for Pi agents.**

## Highlights

- Read and maintain Linear documents with the new `linear_document` tool.
- Filter and paginate document lists safely.
- Create, reassign, and fully replace document content with stale-write protection.
- Treat document text returned by Linear as untrusted external data.

## New features

### Linear document tool

`linear_document` supports:

- `list` with optional title and project filters, bounded pagination, and continuation cursors.
- `view` with Markdown content, document ID, URL, and `updatedAt` metadata.
- `create` for unparented documents or documents parented to exactly one project or issue.
- `update` for title/content replacement and project-or-issue parent reassignment.

Document listing returns 50 documents by default and permits at most 250 per call. Use `nextCursor` to continue through additional pages.

### Safe replacement updates

Update fields are replacement-oriented: omitted fields are preserved, while `content: ""` explicitly clears content. Passing `expectedUpdatedAt` performs a guarded preflight check and rejects stale writes with retry guidance. Linear does not provide an atomic expected-timestamp mutation condition, so a small read/replace race remains.

## Error handling

Non-rate-limit Linear tool failures now include a consistent operation prefix while preserving the original cause and error type for diagnostics.

## Security and safety

Document titles, metadata, and Markdown are labeled and delimited as untrusted external data. They are not agent instructions or user confirmation. Consequential actions derived from document text require explicit user confirmation.

## Tests

Added regression and production-contract coverage for pagination, filters, rendering, parent validation and reassignment, empty-content clearing, authentication precedence, cache isolation, and scoped-router naming compatibility.

## Contributor credits

Thank you to [@dgalarza](https://github.com/dgalarza) (Damian Galarza) for [PR #36](https://github.com/fink-andreas/pi-linear-tools/pull/36), which introduced the Linear document tool.

---

**npm package:** `@fink-andreas/pi-linear-tools`
**git tag:** `v0.8.1`
