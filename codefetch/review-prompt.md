# Code Review Prompt

Review this repository and the included PR summary with one goal: **find problems**.

## Objective
Identify concrete, high-value issues in the implementation for PR #1:
- correctness bugs
- regressions
- broken CLI/tool behavior
- data-loss or state-corruption risks
- sync-doc edge cases
- API/schema mismatches
- missing validation
- missing or misleading tests

Do **not** spend time on praise, style, or minor refactors unless they hide a real defect.

## What is included
- `codebase.md` contains a compact snapshot of the repository, including source files, docs, tests, and the PR summary (`PR1.md`).

## Review instructions
1. Focus on the newly added behavior around:
   - project updates
   - issue activity
   - sync-doc workflows
   - CLI argument handling
   - handler registration / extension exposure
2. Look for inconsistencies between:
   - handlers ↔ Linear API layer
   - CLI ↔ tool schemas
   - implementation ↔ tests
   - docs ↔ actual behavior
3. Prefer findings that can cause user-visible failure, silent incorrect behavior, broken upgrades, or hard-to-debug edge cases.
4. Call out any area where tests appear to miss a risky path.

## Output format
For each finding, provide:
- **Severity**: high / medium / low
- **Location**: file + function/symbol (and line if available)
- **Problem**: what is wrong
- **Why it matters**: impact / failure mode
- **Evidence**: reasoning from code
- **Suggested fix**: brief actionable recommendation

If you find no issues, say that explicitly and list the areas you checked most carefully.
