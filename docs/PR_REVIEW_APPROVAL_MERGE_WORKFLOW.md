# Pull Request Review, Approval, and Merge Workflow

This runbook defines the expected path for a pull request (PR) in this repository:

```text
Preflight → Code review → Test review → Smoke test → Adjustments →
Approval → Merge → Post-merge verification → Release follow-up (if needed)
```

The workflow is intentionally evidence-driven. A PR is not ready to merge because a reviewer says it “looks good”; it is ready when the required review gates have passed and the evidence is recorded in the PR.

## 1. Roles and responsibilities

A small PR may be handled by one author and one independent reviewer. A larger or riskier PR should use separate reviewers for implementation correctness and validation.

- **Author** — explains the change, responds to findings, updates the branch, and supplies test/smoke-test evidence.
- **Code reviewer** — checks implementation correctness, regressions, API contracts, security, and maintainability.
- **Test reviewer** — checks that tests exercise the changed behavior and failure paths, not merely that the suite is green.
- **Smoke-test operator** — exercises the built package, CLI, Pi extension, or live Linear workflow as appropriate.
- **Approver/maintainer** — confirms all gates are satisfied and records the approval.
- **Merger** — merges only after approval, required checks, and conflict status are green. This may be the approver, but the authority should be explicit.

For high-risk changes, the approver should not be the only person who performed the code review.

## 2. Rules for commands and tool calls

Use bounded output for every potentially verbose command. This keeps the Pi TUI readable and prevents an accidental dump of a complete diff, test log, or dependency tree.

```bash
# Good: preserve the command exit status while showing only a short tail.
set -o pipefail
npm test 2>&1 | tail -n 15

# Good: inspect a bounded list.
git log --oneline --decorate -n 30 | head -n 40

git status --short --branch | head -n 40

# Avoid these in an interactive review:
# cat package-lock.json
# git diff
# npm test
# find .
```

When output is truncated, do not treat the truncated output as complete evidence. Use targeted file reads, focused searches, or a saved artifact for the complete data.

Never use destructive cleanup (`git reset --hard`, deleting files, or force-pushing) to make a review easier. Preserve unrelated user changes and ask before changing ownership of a dirty worktree.

## 3. Gate 0: preflight and scope

Before reviewing code, establish exactly what is being reviewed.

### 3.1 Confirm the repository and working tree

```bash
git remote -v | head -n 20
git status --short --branch | head -n 40
git branch --show-current
git log -1 --oneline --decorate
```

If the worktree contains unrelated changes, do not reset or overwrite them. Review the PR in an isolated checkout/worktree or ask the author to provide a clean review state.

Read repository rules before judging the change:

```text
read("AGENTS.md")
read("package.json")
read("README.md")
```

Also read any more-specific `AGENTS.md` files in the affected directory.

### 3.2 Inspect the PR metadata

The GitHub CLI is the normal interface for PR metadata:

```bash
REPO="fink-andreas/pi-linear-tools"
PR_NUMBER="123"

# JSON keeps the result focused and machine-readable.
gh pr view "$PR_NUMBER" --repo "$REPO" \
  --json number,title,state,isDraft,author,baseRefName,headRefName,mergeStateStatus,reviewDecision,url \
  --jq '{number,title,state,isDraft,author:.author.login,base:.baseRefName,head:.headRefName,mergeStateStatus,reviewDecision,url}'
```

Confirm:

- The PR targets the intended base branch, normally `main`.
- The PR is not a draft.
- The title and description state the user-visible outcome.
- The scope is narrow enough to review.
- The PR is linked to the relevant issue or release plan when one exists.
- Generated files, unrelated formatting changes, and accidental secrets are absent.

List changed files without printing the complete patch:

```bash
gh pr view "$PR_NUMBER" --repo "$REPO" --json files \
  --jq '.files[] | "\(.path) +\(.additions) -\(.deletions)"' \
  | head -n 100
```

For a local branch, update references without changing the working tree:

```bash
git fetch origin --prune 2>&1 | tail -n 20
git diff --stat "origin/main...HEAD" | head -n 80
git diff --check "origin/main...HEAD"
```

### 3.3 Cross-fork PR heads

A PR head branch may live in the author's fork rather than in the base repository's `origin`. Identify the real head repository and ref before pushing review fixes:

```bash
gh api "repos/$REPO/pulls/$PR_NUMBER" \
  --jq '{headRepo:.head.repo.full_name,headOwner:.head.user.login,headRef:.head.ref,headSha:.head.sha,baseRef:.base.ref,maintainerCanModify:.maintainer_can_modify}'
```

When `.head.repo.full_name` is available, push explicitly to that repository and branch:

```bash
HEAD_REPO=$(gh api "repos/$REPO/pulls/$PR_NUMBER" --jq '.head.repo.full_name')
HEAD_REF=$(gh api "repos/$REPO/pulls/$PR_NUMBER" --jq '.head.ref')
git push "https://github.com/$HEAD_REPO.git" "HEAD:refs/heads/$HEAD_REF"
```

If the head repository is unavailable, ask the author to push the fix instead of guessing a base-repository branch. Verify the resulting `headRefOid` with `gh pr view` before reviewing or merging; `maintainerCanModify` does not make a fork branch part of the base repository's `origin`.

## 4. Gate 1: code review

The code review answers: **Does the implementation do the right thing, safely, without breaking existing behavior?**

### 4.1 Review the changed implementation

Use targeted reads and searches rather than a giant terminal diff:

```text
read("src/changed-file.js", offset=1, limit=240)
read("tests/changed-file.test.js", offset=1, limit=240)

fff_grep({
  query: "TODO|FIXME|throw new Error|console\\.(log|warn|error)",
  glob: ["src/**", "extensions/**", "tests/**"],
  regex: true,
  maxResults: 100,
  context: 2
})
```

For each changed area, check:

- **Correctness:** normal path, empty input, invalid input, missing data, retries, and error paths.
- **Regression risk:** existing callers, public tool schemas, CLI flags, return shapes, and compatibility with supported Node/Pi versions.
- **API contracts:** GraphQL variables, field names, mutation behavior, null handling, pagination, and rate-limit behavior.
- **Host callback contracts:** For Pi custom tools, validate the actual `renderResult(result, options, theme, context)` signature. Do not use the fourth `context` argument as a test-only dependency-injection slot. If mocks are needed, use a separate fifth test parameter or a factory, and test with a real context-shaped fourth argument. A pre-existing bug in a touched function should be labeled as pre-existing, but must not be hidden by an invalid mock.
- **Security:** credentials, OAuth scopes, file paths, shell execution, URL handling, downloads, and accidental secret logging.
- **Data safety:** destructive actions require explicit intent, and failures do not silently report success.
- **Performance:** avoid unbounded API calls, repeated lookups, or unnecessary full-list queries.
- **Observability:** errors are actionable and logs do not corrupt Pi TUI output.
- **Documentation:** user-facing behavior, release notes, examples, and migration/re-authentication instructions are updated when needed.

A code review finding should include:

1. Severity: blocker, major, minor, or question.
2. File and line/function.
3. Concrete failure scenario.
4. Why the issue matters.
5. Smallest safe fix or a reason no fix is required.

Example finding:

```text
Blocker — extensions/pi-linear-tools.js:renderMarkdownResult
A display-wide CJK line can be shorter in UTF-16 units than the terminal width,
so the current length guard skips column truncation and Pi can still receive an
over-wide line. Add a regression test and truncate whenever a width is supplied.
```

### 4.2 Optional independent Pi reviewer

For non-trivial PRs, use a fresh-context, read-only reviewer. The reviewer must inspect the actual PR diff and must not edit, commit, approve, or merge.

Example Pi tool call:

```javascript
subagent({
  async: true,
  context: "fresh",
  workflowScript: `return runs.run("pr-code-review", {
    agent: "reviewer",
    cwd: "/home/afi/dvl/pi-linear-tools",
    task: [
      "Review the current PR diff against origin/main.",
      "Focus on correctness, regressions, API/security risks, and missing tests.",
      "Inspect changed files directly; do not rely on the author's summary.",
      "Do not edit files, commit, approve, or merge.",
      "Return only actionable findings with severity, path/line, evidence, and suggested fix.",
      "Keep shell output bounded with head/tail/grep."
    ].join("\\n")
  })`
})
```

When the parent request must finish in the same turn, wait for that exact run rather than polling:

```javascript
subagent_wait({ id: "<returned-run-id>" })
```

For two independent angles, launch separate read-only reviewers, for example `code-review` and `security-review`. Do not launch multiple writers into the same worktree.

## 5. Gate 2: test review

The test review answers: **Do the tests prove the intended behavior and protect the risky paths?**

### 5.1 Inspect the test diff

Check that tests cover:

- The new or changed happy path.
- Invalid arguments and validation errors.
- Empty, missing, archived, or not-found data.
- API failures, rate limits, and authentication failures where relevant.
- Regression cases from the implementation bug.
- CLI/tool schema and output details.
- No real credentials or uncontrolled production data.

A test that only asserts a function does not throw may be insufficient if the user-visible result or API variables are wrong.

### 5.2 Run focused tests first

Use the narrowest relevant tests while iterating:

```bash
set -o pipefail
node tests/test-render-fallback.js 2>&1 | tail -n 20
node tests/test-project-lifecycle.js 2>&1 | tail -n 20
```

Replace the examples with tests relevant to the PR. A missing file or a test that is not part of the package script should be reported, not silently ignored.

### 5.3 Run the repository suite

Project guidance requires the full suite to be run with concise output:

```bash
set -o pipefail
npm test 2>&1 | tail -n 15
```

The command must exit successfully; the final lines alone are not enough if the pipeline is not using `pipefail`.

For release/package-impacting changes, also run:

```bash
set -o pipefail
npm run release:check 2>&1 | tail -n 30
```

If `release:check` is too broad for an iteration, run its relevant parts separately and record which checks were omitted:

```bash
set -o pipefail
npm pack --dry-run 2>&1 | tail -n 30
```

Record the command, exit status, and a concise result in the PR.

If `gh pr checks` reports `no checks reported`, record that explicitly as **no CI checks configured/reported**. Do not describe this as a green CI result; local test evidence is still required, and `--admin` must not be used to bypass repository policy.

## 6. Gate 3: smoke test

The smoke test answers: **Does the built/user-facing path work outside isolated unit tests?**

Choose smoke tests based on the changed surface. Do not perform live mutations against production data.

### Custom smoke-test guide requirements

A generic instruction such as "run a smoke test" is not sufficient. For each PR, provide a short, copy/pasteable guide for the exact surface that changed. The guide should let another operator reproduce the check without guessing which package, Pi session, command, resource, or expected result to use.

Every custom guide should state:

- **Changed surface:** package, CLI, Pi extension, renderer, or live Linear workflow.
- **Prerequisites:** checkout/package location, authentication state, designated test workspace/project, fixture data, and rate-limit or keybinding constraints.
- **Exact setup and launch path:** distinguish shell commands from Pi commands. For a local unpublished Pi extension that is not already loaded, launch the checkout directly:

  ```bash
  cd /path/to/pi-linear-tools
  pi -e ./index.js
  ```

  For extension source installation/removal, use the exact source shown by `pi list`, then `pi remove <source>` and `pi install .`; fully restart Pi before validating. `/reload` is a useful follow-up for already-loaded code changes but is not a reliable replacement for a restart after source add/remove.

- **Registration check:** after Pi starts, run `/linear-tools-help` and confirm the changed command/tool is registered. If the change adds parameters, confirm the schema/help exposes them.
- **Feature-specific action:** give the exact read-only CLI command or Pi tool call, with realistic placeholders and all required arguments. These must be labeled as shell commands or Pi tool calls; do not present one as the other.
- **Observable assertions:** describe what must be visible in the result, what must be present in structured details, and which success and expected-error paths must be exercised. Assert behavior, not merely that the command did not throw.
- **Surface-specific interaction:** include steps such as preview/expand/collapse, custom keybindings, Markdown rendering, CLI output, or Linear filter composition only when the changed surface requires them.
- **Evidence:** record the redacted invocation, timestamp, exit/result status, result count or identifiers, and pass/fail decision. Never record credentials, tokens, or unnecessary private data.
- **Cleanup and safety:** state whether the test is read-only. If temporary Linear data is created, use unique names, delete/archive it with the supported action, and verify cleanup. If no cleanup is applicable, say so explicitly.
- **Failure handling:** explain how authentication failures, rate limits, no-result responses, malformed output, and crashes should be classified.

Use this template when adding a custom guide:

````markdown
### Smoke test: <feature or changed surface>

**Prerequisites:** <checkout/package, credentials, designated test resource, fixture, and limits>

**Setup (shell commands):**
```bash
<exact setup and launch commands>
```

**Pi session / tool calls:**
1. Run `/linear-tools-help`; confirm `<command/tool/parameter>` is registered.
2. Run `<exact read-only command or tool call>`.
3. Confirm `<visible result>` and `<structured result>`.
4. Confirm `<feature-specific interaction or expected error>`.

**Expected result:** <observable pass criteria>

**Evidence:** <what to record, with secrets and private data excluded>

**Cleanup:** <exact cleanup commands and verification, or "read-only; no Linear cleanup">
```
````

The following sections provide surface-specific examples. Keep their concrete launch, registration, user-action, assertion, and cleanup steps when adapting them; do not reduce a custom guide to a generic test command.

### 6.1 Package and CLI smoke test

```bash
set -o pipefail
node bin/pi-linear-tools.js --help 2>&1 | head -n 80
npm pack --dry-run 2>&1 | tail -n 30
```

For a release candidate, install the generated package into a temporary directory and run help from there. Keep the temporary directory outside the repository and remove it only after recording the result.

### 6.2 Pi extension smoke test

For unpublished extension changes:

```bash
set -o pipefail
npm run dev:sync-local-extension 2>&1 | tail -n 20
```

Then in Pi:

```text
/reload
```

If extension sources were installed or removed, fully restart Pi before validation; `/reload` is not reliable for source add/remove changes.

Exercise the changed tool or command in the real Pi session. Confirm both the visible result and structured details. For example, a read-only tool smoke test should verify:

- The tool is registered.
- The schema/help text exposes the intended parameters.
- The command returns the expected text.
- The structured result contains the expected identifiers/status fields.
- An expected error is rendered as a useful tool result rather than crashing Pi.

#### Rendering-specific Pi smoke test

For a local, unpublished renderer change, launch the checkout directly when it is not already auto-loaded:

```bash
cd /path/to/pi-linear-tools
pi -e ./index.js
```

In the Pi session:

1. Run `/linear-tools-help` and confirm the changed tool is registered.
2. Invoke a **read-only** Linear `view`/`list` operation that produces more than the preview limit (for example, an issue with comments).
3. Confirm the initial result shows the leading preview and an expansion hint.
4. Press the configured `app.tools.expand` key, normally `Ctrl+O`, and confirm the complete result appears; press it again to collapse.
5. Confirm Markdown headings, emphasis, lists, links, and structured details still render correctly.

To verify custom keybindings, use a disposable Pi configuration or merge this setting into a temporary config:

```json
{
  "app.tools.expand": "alt+e"
}
```

Run `/reload`, then confirm the hint changes to `alt+e to expand` and `Alt+E` toggles the result. Do not overwrite a user's real keybinding file just for a review. For rendering-only changes, a live Linear mutation is not applicable; use an existing read-only resource and record that no test data was created.

### 6.3 Live Linear smoke test

Run live smoke tests only with an explicitly designated test workspace/project and credentials. Follow [`SMOKE_TESTS.md`](SMOKE_TESTS.md), use unique test names, and clean up test data.

These are Pi tool-call examples, not shell commands:

```javascript
linear_team({
  action: "list"
})

linear_project({
  action: "create",
  name: "PR smoke test <timestamp>",
  teams: "<test-team-key>",
  description: "Temporary PR smoke-test project",
  priority: 4
})

linear_issue({
  action: "create",
  team: "<test-team-key>",
  project: "<temporary-project-id>",
  title: "PR smoke test issue",
  description: "Temporary test data; delete after validation.",
  priority: "low"
})

linear_issue({
  action: "view",
  issue: "<temporary-issue-id>",
  includeComments: true
})
```

Use the appropriate `linear_project_update`, `linear_milestone`, or `linear_issue` action for the changed feature. Afterward, delete/archive temporary resources with the corresponding supported action and verify cleanup. Never paste API keys or access tokens into PR comments, tool arguments, or logs.

If the PR changes only local rendering, parsing, or documentation, a live Linear mutation is unnecessary; state that the live smoke test was not applicable.

## 7. Gate 4: adjustments and review loop

Findings must be dispositioned before approval.

### 7.1 Classify findings

- **Blocker:** merge is prohibited until fixed and re-reviewed.
- **Major:** fix before merge unless the maintainer explicitly rejects the PR scope.
- **Minor:** fix when low-risk and local; otherwise record a follow-up issue.
- **Question:** resolve with evidence or document the accepted behavior.

Do not turn a review comment into a code change without checking that it is within the PR scope. Escalate product, API, security, release, or merge-policy decisions to the maintainer.

### 7.2 Apply and validate adjustments

After changes, inspect the new diff and rerun affected checks:

```bash
git status --short --branch | head -n 40
git diff --stat | head -n 40
git diff --check

set -o pipefail
npm test 2>&1 | tail -n 15
```

Commit only the intended files. Do not include `PLAN.md` or `TODO.md` in the PR unless explicitly requested by the maintainer:

```bash
git add path/to/changed-file.js path/to/changed-test.js
git commit -m "Fix review findings"
git push origin HEAD
```

Then rerun the relevant reviewer and smoke-test gates. A follow-up approval must refer to the latest commit, not the version that was originally reviewed.

### 7.3 Record the disposition

Use a PR comment or review summary containing:

```text
Review disposition
- Blockers: none / <links to fixes>
- Major findings: none / <links to fixes>
- Minor findings deferred: <issue links>
- Focused tests: <commands and results>
- Full suite: `npm test` passed
- Smoke test: <path and result>
- Remaining risk: <none or explicit description>
```

## 8. Gate 5: approval

Approve only when all of the following are true:

- The PR is not a draft and targets the correct base branch.
- The final diff is understood and within scope.
- Code review has no unresolved blocker/major findings.
- Test review confirms adequate regression coverage.
- Required CI checks are green.
- The appropriate smoke test passed, or was explicitly marked not applicable.
- Review comments and requested changes are resolved.
- The branch is mergeable and not stale relative to the base branch.
- Documentation, changelog, migration, and release implications are handled.
- Any deferred risk is explicitly accepted by the maintainer.

Check the final GitHub state immediately before approval:

```bash
gh pr view "$PR_NUMBER" --repo "$REPO" \
  --json state,isDraft,mergeStateStatus,reviewDecision,baseRefName,headRefName,url \
  --jq '{state,isDraft,mergeStateStatus,reviewDecision,base:.baseRefName,head:.headRefName,url}'

set -o pipefail
gh pr checks "$PR_NUMBER" --repo "$REPO" 2>&1 | tail -n 30
```

If authorized to approve, use a concise review record. The approval command is an external side effect and must not be run merely because a local test passed:

```bash
cat > /tmp/pr-approval.md <<'EOF'
Approved after:
- code review of the final diff
- test review and `npm test`
- applicable Pi/CLI/Linear smoke tests
- resolution of all blocker and major findings

Residual risk: none / <explicit risk>
EOF

gh pr review "$PR_NUMBER" --repo "$REPO" \
  --approve --body-file /tmp/pr-approval.md
```

Do not use a Linear comment as a substitute for GitHub approval. If a PR is linked to a Linear issue, an optional tracking comment may be added separately:

```javascript
linear_issue({
  action: "comment",
  issue: "ABC-123",
  body: "PR #<number> passed code review, test review, and applicable smoke tests; GitHub approval was recorded."
})
```

## 9. Gate 6: merge

The merger performs one final state check and merges only the reviewed head commit.

```bash
gh pr view "$PR_NUMBER" --repo "$REPO" \
  --json state,isDraft,mergeStateStatus,reviewDecision,headRefOid,baseRefName \
  --jq '{state,isDraft,mergeStateStatus,reviewDecision,headRefOid,base:.baseRefName}'

set -o pipefail
gh pr checks "$PR_NUMBER" --repo "$REPO" 2>&1 | tail -n 30
```

Preferred merge path, subject to repository policy:

```bash
gh pr merge "$PR_NUMBER" --repo "$REPO" --squash --delete-branch
```

Use the repository's agreed merge strategy instead of assuming squash. Do not use `--admin` to bypass required checks, and do not merge a stale or conflicting head. If the branch changed after approval, pause, rerun the affected review/tests, and obtain renewed approval.

A local merge is only a fallback when the maintainer explicitly owns that process and branch protection permits it:

```bash
git switch main
git pull --ff-only origin main
git merge --no-ff origin/<feature-branch>
git push origin main
```

Do not push directly to `main` when the repository policy requires GitHub PR merges.

For a squash merge, the original feature commits may not be ancestors of `main`; retain the GitHub merge commit as the authoritative post-merge identifier.

## 10. Gate 7: post-merge verification

After merging, verify the external result and the repository state:

```bash
gh pr view "$PR_NUMBER" --repo "$REPO" \
  --json state,mergedAt,mergeCommit,url \
  --jq '{state,mergedAt,mergeCommit:.mergeCommit.oid,url}'

git fetch origin --prune 2>&1 | tail -n 20
git log origin/main --oneline --decorate -n 8 | head -n 12
git status --short --branch | head -n 40
```

For code changes, run the smallest meaningful post-merge verification on `main` or the release branch:

```bash
set -o pipefail
npm test 2>&1 | tail -n 15
```

For package/release changes, follow [`RELEASE.md`](RELEASE.md) and [`POST_RELEASE_CHECKLIST.md`](POST_RELEASE_CHECKLIST.md). Merging is not the same as publishing: npm authentication, publishing, tagging, and GitHub release creation require their own authorization and verification.

If the merge introduced a regression, prefer a revert PR or an authorized `git revert` of the merge commit. Do not rewrite shared history:

```bash
# Use -m 1 only when the merged object is an actual merge commit.
git revert -m 1 <merge-commit-sha>

# For squash/rebase merges that produced one ordinary commit, use:
# git revert <squash-commit-sha>

git push origin <revert-branch>
```

After a confirmed squash merge, update the local checkout before cleaning up:

```bash
git switch main
git pull --ff-only origin main
```

Only with explicit cleanup authorization, delete the now-merged local feature branch. `git branch -d` can reject a squash-merged branch because its original commits are not ancestors of `main`; after verifying the merge commit, `git branch -D <feature-branch>` is acceptable. Preserve unrelated untracked files and never use a reset to force cleanup.

## 11. Required evidence record

The PR should retain enough information for another maintainer to reproduce the decision:

- PR URL, base branch, head repository/ref, pushed head SHA, and final merge commit.
- Changed-file summary and scope decision.
- Code-review findings and their disposition.
- Test-review summary and commands run with exit status.
- CI status, including an explicit `no checks reported` result when applicable.
- Smoke-test path, configured keybinding/result behavior, test data scope, and cleanup result.
- Approval identity/time and merge method.
- Post-merge verification result.
- Deferred risks, follow-up issue links, or rollback instructions.

Do not store credentials, tokens, private customer data, or unbounded raw logs in the PR. Link to an access-controlled CI artifact when complete logs are required.

## 12. Final checklist

Copy this checklist into a PR comment or review note:

```text
### PR review gate
- [ ] Scope, target branch, author, and linked issue confirmed
- [ ] Worktree/diff inspected; unrelated changes and secrets excluded
- [ ] Host API/callback contracts verified against the actual runtime invocation
- [ ] Code review complete
- [ ] Test review complete
- [ ] Focused tests pass
- [ ] `npm test` passes (`set -o pipefail; npm test 2>&1 | tail -n 15`)
- [ ] Package/release checks run when applicable
- [ ] Pi/CLI smoke test passed or marked not applicable
- [ ] Custom smoke-test guide matches the changed surface and includes exact setup, registration, user actions, assertions, evidence, and cleanup
- [ ] Custom Pi rendering and remapped keybinding behavior tested when applicable
- [ ] Live Linear smoke test passed and temporary data cleaned up, or marked not applicable
- [ ] All blocker/major findings resolved
- [ ] Minor findings and deferred risks recorded
- [ ] Final CI checks are green, or the absence of reported checks is explicitly recorded, and the branch is mergeable
- [ ] Approval recorded on the final commit
- [ ] Merge performed using the agreed strategy
- [ ] Post-merge commit/state verified
- [ ] Release/tag/npm follow-up handled separately when applicable
```

## Related documentation

- [`DIAGRAMS.md`](DIAGRAMS.md) — repository Git workflow and feature pipeline diagrams.
- [`SMOKE_TESTS.md`](SMOKE_TESTS.md) — live Linear tool smoke tests and cleanup.
- [`RELEASE.md`](RELEASE.md) — npm and GitHub release runbook.
- [`POST_RELEASE_CHECKLIST.md`](POST_RELEASE_CHECKLIST.md) — post-release verification.
- [`../AGENTS.md`](../AGENTS.md) — project-specific development and release constraints.
