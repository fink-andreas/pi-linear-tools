# Plan: remove redundant action lists from tool descriptions

## Goal
Remove redundant `Actions: ...` text from Linear tool description strings where the same action set is already expressed by the `action` parameter enum.

## Relevant files
- `extensions/pi-linear-tools.js` — tool registration schemas and descriptions
- `tests/test-extension-registration.js` — registration regression coverage

## Approach
1. Update tool `description` fields to remove repeated action lists while keeping concise tool purpose text.
2. Add/extend registration tests to assert the simplified descriptions still exist alongside the action enums.
3. Run the relevant test file, then the project test suite.
