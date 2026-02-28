# Release Notes v0.2.0

## Overview

This release adds OAuth 2.0 authentication support and Markdown rendering for tool outputs.

## New Features

### OAuth 2.0 Authentication (INN-242)
- **PKCE-based OAuth flow**: Secure OAuth 2.0 with PKCE (Proof Key for Code Exchange)
- **Automatic token refresh**: Tokens are refreshed automatically before expiry
- **Fallback storage**: When keychain is unavailable, tokens are stored in a secure local file
- **Seamless UX**: Clear guidance for authentication setup and token management

### Markdown Rendering (INN-241)
- **Rich output**: Tool outputs now render Markdown with proper formatting
- **Terminal-aware**: Lines are truncated to terminal width to prevent overflow
- **Clean display**: Proper handling of headers, lists, and code blocks

## Improvements

- **Milestone usability**: Improved list/delete operations for follow-up actions
- **Pi integration fixes**: Resolved import issues for pi-tui and pi-coding-agent when installed from npm or source
- **Better error handling**: Clear error messages for OAuth scope issues

## Installation

```bash
pi install @fink-andreas/pi-linear-tools
```

Or update existing installation:

```bash
pi remove @fink-andreas/pi-linear-tools
pi install @fink-andreas/pi-linear-tools
```

## Links

- **npm**: https://www.npmjs.com/package/@fink-andreas/pi-linear-tools
- **GitHub**: https://github.com/fink-andreas/pi-linear-tools
