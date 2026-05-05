# Linear Tools Smoke Test Suite

This document contains smoke tests for all Linear MCP tools. Run these tests periodically to verify the tools are working correctly.

## Prerequisites

- Ensure Linear API credentials are configured
- Be aware of rate limiting (avoid running too many tests in succession)
- For image/attachment issue tests, use an issue that contains at least one markdown-embedded image in the description or comments and at least one Linear attachment. Replace `INN-259` below if needed.

---

## Team Operations

### Test 1: List Teams
```
linear_team(action="list")
```
**Expected:** Returns list of all Linear teams with IDs and names.

---

## Project Operations

### Test 2: List All Projects
```
linear_project(action="list")
```
**Expected:** Returns all projects with their IDs and names.

### Test 3: View Project by Name
```
linear_project(action="view", project="pi-linear-test-repo")
```
**Expected:** Returns full project details including teams, lead, milestones, description.

### Test 4: Create Project
```
linear_project(
  action="create",
  name="Smoke Test Project",
  teams="INN",
  description="## Test Project\n\nAutomated smoke test.",
  priority=2,
  color="#FF5733",
  startDate="2026-04-17",
  targetDate="2026-06-17"
)
```
**Expected:** Creates new project and returns confirmation with project ID.

### Test 5: Update Project by ID
```
linear_project(
  action="update",
  project="<PROJECT_ID>",
  description="Updated description",
  priority=3
)
```
**Expected:** Updates project fields.

### Test 6: Archive Project
```
linear_project(action="archive", project="<PROJECT_ID>")
```
**Expected:** Archives the specified project.

### Test 7: Unarchive Project
```
linear_project(action="unarchive", project="<PROJECT_ID>")
```
**Expected:** Restores archived project.

### Test 8: Delete Project
```
linear_project(action="delete", project="<PROJECT_ID>")
```
**Expected:** Deletes the project permanently.

---

## Issue Operations

### Test 9: List Issues (Default)
```
linear_issue(action="list", limit=10)
```
**Expected:** Returns issues from default project (current directory name).

### Test 10: List Issues with State Filter
```
linear_issue(action="list", states=["Backlog", "Todo"], limit=5)
```
**Expected:** Returns only issues in specified states.

### Test 11: List Issues Assigned to Me
```
linear_issue(action="list", assignee="me", limit=5)
```
**Expected:** Returns only issues assigned to current user.

### Test 12: List All Issues (Unfiltered)
```
linear_issue(action="list", assignee="all", limit=10)
```
**Expected:** Returns all issues across projects.

### Test 13: View Single Issue
```
linear_issue(action="view", issue="INN-259")
```
**Expected:** Returns full issue details including state, team, project, assignee, priority, comments, and attachments when present.

### Test 13a: Fetch Issue Images
```
linear_issue(action="images", issue="INN-259", limit=5)
```
**Expected:** Returns a text summary plus `image` content items for markdown/HTML images embedded in the issue description or comments. Reports failed image fetches without failing the whole request.

### Test 13b: Fetch Issue Images Without Comments
```
linear_issue(action="images", issue="INN-259", includeComments=false, limit=5)
```
**Expected:** Returns only images embedded in the issue description, excluding comment images.

### Test 13c: Download Issue Attachment by Index
```
linear_issue(action="download", issue="INN-259", attachmentIndex=1, directory="downloads", overwrite=false)
```
**Expected:** Downloads the first Linear issue attachment into the relative `downloads` directory and returns the destination path, source URL, and bytes written. Existing files are not overwritten by default.

### Test 13d: Download Issue Attachment by Explicit Selector
```
linear_issue(
  action="download",
  issue="INN-259",
  attachmentTitle="<ATTACHMENT_TITLE>",
  directory="downloads",
  filename="smoke-test-attachment",
  overwrite=false
)
```
**Expected:** Downloads the matching attachment using the provided safe filename. If multiple attachments share the same title, the tool asks for a more specific selector such as `attachmentId`.

### Test 13e: Attachment Download Overwrite Guard
```
linear_issue(action="download", issue="INN-259", attachmentIndex=1, directory="downloads", overwrite=true)
```
**Expected:** Fails unless overwrite support has been explicitly enabled with `/linear-tools-config --allow-overwrite-files true`. Re-run with `overwrite=false` or enable the guard only when intentionally replacing local files.

### Test 14: Create Issue
```
linear_issue(
  action="create",
  project="pi-linear-test-repo",
  title="Smoke Test Issue",
  description="Automated smoke test issue.",
  priority=2,
  team="INN"
)
```
**Expected:** Creates issue and returns confirmation with issue key (e.g., INN-287).

### Test 15: Add Comment to Issue
```
linear_issue(action="comment", issue="INN-287", body="Smoke test comment 🚀")
```
**Expected:** Adds comment to the issue.

### Test 16: View Issue Activity
```
linear_issue(action="activity", issue="INN-259", limit=5)
```
**Expected:** Returns activity history for the issue.

### Test 17: Update Issue State
```
linear_issue(action="update", issue="INN-287", state="Todo")
```
**Expected:** Changes issue state.

### Test 18: Update Issue Priority
```
linear_issue(action="update", issue="INN-287", priority=1)
```
**Expected:** Changes issue priority (0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low).

### Test 19: Update Issue Assignee
```
linear_issue(action="update", issue="INN-287", assignee="me")
```
**Expected:** Assigns issue to current user.

### Test 20: Update Issue Estimate
```
linear_issue(action="update", issue="INN-287", estimate=3)
```
**Expected:** Sets story points/estimate on issue.

### Test 21: Update Issue Title
```
linear_issue(action="update", issue="INN-287", title="New Title")
```
**Expected:** Changes issue title.

### Test 22: Update Issue Description
```
linear_issue(action="update", issue="INN-287", description="New description")
```
**Expected:** Changes issue description.

### Test 23: Assign Milestone to Issue
```
linear_issue(action="update", issue="INN-287", milestone="First Steps")
```
**Expected:** Assigns milestone.

### Test 24: Add Blocked By Dependency
```
linear_issue(action="update", issue="INN-287", blockedBy=["INN-259"])
```
**Expected:** Issue is now blocked by INN-259.

### Test 25: Add Related To Dependency
```
linear_issue(action="update", issue="INN-287", relatedTo=["INN-256"])
```
**Expected:** Creates "related to" link between issues.

### Test 26: Start Issue (Create Branch)
```
linear_issue(action="start", issue="INN-287")
```
**Expected:** Returns branch name for the issue.

### Test 27: Start Issue from Specific Branch
```
linear_issue(action="start", issue="INN-287", fromRef="main")
```
**Expected:** Creates branch from specified ref.

### Test 28: Delete Issue
```
linear_issue(action="delete", issue="INN-287")
```
**Expected:** Permanently deletes the issue.

---

## Milestone Operations

### Test 29: List Milestones
```
linear_milestone(action="list", project="pi-linear-test-repo")
```
**Expected:** Returns milestones for project. Note: May show API error about "order" field.

### Test 30: View Milestone
```
linear_milestone(action="view", milestone="<MILESTONE_ID>")
```
**Expected:** Returns milestone details.

### Test 31: Create Milestone
```
linear_milestone(
  action="create",
  project="pi-linear-test-repo",
  name="Smoke Test Milestone",
  description="Automated smoke test milestone.",
  targetDate="2026-05-01"
)
```
**Expected:** Creates milestone and returns confirmation.

### Test 32: Update Milestone
```
linear_milestone(
  action="update",
  milestone="<MILESTONE_ID>",
  description="Updated milestone description."
)
```
**Expected:** Updates milestone fields.

### Test 33: Delete Milestone
```
linear_milestone(action="delete", milestone="<MILESTONE_ID>")
```
**Expected:** Permanently deletes the milestone.

---

## Project Update Operations

### Test 34: List Project Updates
```
linear_project_update(action="list", project="pi-linear-test-repo", limit=5)
```
**Expected:** Returns project updates with health status, author, date.

### Test 35: View Project Update
```
linear_project_update(action="view", projectUpdate="<UPDATE_ID>")
```
**Expected:** Returns full update content.

### Test 36: Create Project Update
```
linear_project_update(
  action="create",
  project="pi-linear-test-repo",
  body="## Smoke Test Update\n\nAutomated test.",
  health="onTrack"
)
```
**Expected:** Creates update and returns ID.

### Test 37: Update Project Update
```
linear_project_update(
  action="update",
  projectUpdate="<UPDATE_ID>",
  body="Updated content",
  health="atRisk"
)
```
**Expected:** Modifies update content and/or health status.

### Test 38: Archive Project Update
```
linear_project_update(action="archive", projectUpdate="<UPDATE_ID>")
```
**Expected:** Archives the update.

### Test 39: Unarchive Project Update
```
linear_project_update(action="unarchive", projectUpdate="<UPDATE_ID>")
```
**Expected:** Restores archived update.

---

## Advanced Issue Operations

### Test 40: Mark Issue as Duplicate
```
linear_issue(action="update", issue="INN-287", duplicateOf="INN-259")
```
**Expected:** Marks issue as duplicate of another.

### Test 41: Clear Milestone Assignment
```
linear_issue(action="update", issue="INN-287", milestone="none")
```
**Expected:** Removes milestone from issue.

### Test 42: Set Blocking Dependencies
```
linear_issue(action="update", issue="INN-287", blocking=["INN-256"])
```
**Expected:** Issue now blocks INN-256.

### Test 43: Create Issue with Parent
```
linear_issue(
  action="create",
  project="pi-linear-test-repo",
  title="Sub-issue",
  parentId="<PARENT_ISSUE_ID>",
  team="INN"
)
```
**Expected:** Creates issue as child of parent.

### Test 44: Set Sub-Issue Parent
```
linear_issue(action="update", issue="INN-287", subIssueOf="INN-259")
```
**Expected:** Makes INN-287 a sub-issue of INN-259.

### Test 45: Set Multiple Children
```
linear_issue(action="update", issue="INN-259", parentOf=["INN-287", "INN-288"])
```
**Expected:** INN-259 becomes parent of specified issues.

### Test 46: Include Archived Issues
```
linear_issue(action="list", includeArchived=true, limit=5)
```
**Expected:** Includes archived/canceled issues in results.

---

## Known Issues & Limitations

| Issue | Status |
|-------|--------|
| Milestone name lookup | ✅ Fixed - name lookup now works |
| Project name update fails | Use project ID instead of name |
| `Cannot query field "order"` on milestone list | Ignore error, results may still be returned |
| Aggressive rate limiting | Space out requests, wait 60+ seconds between sessions |

---

## Cleanup Checklist

After running smoke tests, clean up test data:

- [ ] Delete test issues: `linear_issue(action="delete", issue="<ID>")`
- [ ] Delete test milestones: `linear_milestone(action="delete", milestone="<ID>")`
- [ ] Delete test projects: `linear_project(action="delete", project="<ID>")`
- [ ] Archive test project updates: `linear_project_update(action="archive", projectUpdate="<ID>")`
- [ ] Remove downloaded smoke-test files from `downloads/` if attachment tests were run
