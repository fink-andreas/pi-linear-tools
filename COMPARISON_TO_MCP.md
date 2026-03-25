# Linear Tools in Pi Agent

This document lists all Linear tools available in the Pi coding agent with their complete parameter specifications.

---

## Issues

### linear_list_issues

List issues in your Linear workspace. For my issues, use "me" as the assignee. Use "null" for no assignee.

**Parameters:**
```json
{
  "limit": number,              // Max results (default: 50, max: 250)
  "cursor": string,             // Next page cursor
  "orderBy": "createdAt" | "updatedAt",  // Sort order (default: "updatedAt")
  "query": string,              // Search issue title or description
  "team": string,               // Team name or ID
  "state": string,              // State type, name, or ID
  "cycle": string,              // Cycle name, number, or ID
  "label": string,              // Label name or ID
  "assignee": string | null,    // User ID, name, email, or "me"
  "delegate": string,           // Agent name or ID
  "project": string,            // Project name, ID, or slug
  "priority": number,           // 0=None, 1=Urgent, 2=High, 3=Normal, 4=Low
  "parentId": string,           // Parent issue ID (e.g., "LIN-123")
  "createdAt": string,         // ISO-8601 date/duration (e.g., "-P1D")
  "updatedAt": string,         // ISO-8601 date/duration (e.g., "-P1D")
  "includeArchived": boolean   // Include archived items (default: true)
}
```

---

### linear_get_issue

Retrieve detailed information about an issue by ID, including attachments and git branch name.

**Parameters:**
```json
{
  "id": string,                 // *REQUIRED* Issue ID or identifier (e.g., "LIN-123")
  "includeRelations": boolean,  // Include blocking/related/duplicate relations (default: false)
  "includeCustomerNeeds": boolean  // Include associated customer needs (default: false)
}
```

---

### linear_save_issue

Create or update a Linear issue. If `id` is provided, updates the existing issue; otherwise creates a new one. When creating, `title` and `team` are required.

**Parameters:**
```json
{
  "id": string,                 // Issue ID or identifier (e.g., "LIN-123") - if provided, updates existing
  "title": string,              // *REQUIRED when creating* Issue title
  "description": string,        // Content as Markdown
  "team": string,               // *REQUIRED when creating* Team name or ID
  "cycle": string,              // Cycle name, number, or ID
  "milestone": string,          // Milestone name or ID
  "priority": number,           // 0=None, 1=Urgent, 2=High, 3=Normal, 4=Low
  "project": string,            // Project name, ID, or slug
  "state": string,              // State type, name, or ID
  "assignee": string | null,   // User ID, name, email, or "me". Null to remove
  "delegate": string | null,   // Agent name or ID. Null to remove
  "labels": string[],           // Label names or IDs
  "dueDate": string,           // Due date (ISO format)
  "parentId": string | null,   // Parent issue ID (e.g., "LIN-123"). Null to remove
  "estimate": number,           // Issue estimate value
  "links": {                   // Link attachments to add (append-only)
    "url": string,
    "title": string
  }[],
  "blocks": string[],           // Issue IDs/identifiers this blocks (append-only)
  "blockedBy": string[],       // Issue IDs/identifiers blocking this (append-only)
  "relatedTo": string[],       // Related issue IDs/identifiers (append-only)
  "duplicateOf": string | null // Duplicate of issue ID/identifier. Null to remove
}
```

---

## Issue Comments

### linear_list_comments

List comments for a specific Linear issue.

**Parameters:**
```json
{
  "limit": number,              // Max results (default: 50, max: 250)
  "cursor": string,             // Next page cursor
  "orderBy": "createdAt" | "updatedAt",  // Sort order (default: "updatedAt")
  "issueId": string             // *REQUIRED* Issue ID or identifier (e.g., "LIN-123")
}
```

---

### linear_save_comment

Create or update a comment on a Linear issue. If `id` is provided, updates the existing comment; otherwise creates a new one. When creating, `issueId` and `body` are required.

**Parameters:**
```json
{
  "id": string,                 // Comment ID - if provided, updates existing
  "issueId": string,            // *REQUIRED when creating* Issue ID (e.g., "LIN-123")
  "parentId": string,           // Parent comment ID (for replies, only when creating)
  "body": string                // *REQUIRED* Content as Markdown
}
```

---

### linear_delete_comment

Delete a comment from a Linear issue.

**Parameters:**
```json
{
  "id": string                  // *REQUIRED* Comment ID
}
```

---

## Issue Status & Labels

### linear_list_issue_statuses

List available issue statuses in a Linear team.

**Parameters:**
```json
{
  "team": string                // *REQUIRED* Team name or ID
}
```

---

### linear_get_issue_status

Retrieve detailed information about an issue status in Linear by name or ID.

**Parameters:**
```json
{
  "id": string,                 // *REQUIRED* Status ID
  "name": string,               // *REQUIRED* Status name
  "team": string                // *REQUIRED* Team name or ID
}
```

---

### linear_list_issue_labels

List available issue labels in a Linear workspace or team.

**Parameters:**
```json
{
  "limit": number,              // Max results (default: 50, max: 250)
  "cursor": string,             // Next page cursor
  "orderBy": "createdAt" | "updatedAt",  // Sort order (default: "updatedAt")
  "name": string,               // Filter by name
  "team": string                // Team name or ID
}
```

---

### linear_create_issue_label

Create a new Linear issue label.

**Parameters:**
```json
{
  "name": string,               // *REQUIRED* Label name
  "description": string,         // Label description
  "color": string,              // Hex color code
  "teamId": string,             // Team UUID (omit for workspace label)
  "parent": string,             // Parent label group name
  "isGroup": boolean            // Is label group (default: false)
}
```

---

## Attachments

### linear_create_attachment

Create a new attachment on a specific Linear issue by uploading base64-encoded content.

**Parameters:**
```json
{
  "issue": string,              // *REQUIRED* Issue ID or identifier (e.g., "LIN-123")
  "base64Content": string,      // *REQUIRED* Base64-encoded file content to upload
  "filename": string,           // *REQUIRED* Filename (e.g., "screenshot.png")
  "contentType": string,        // *REQUIRED* MIME type (e.g., "image/png", "application/pdf")
  "title": string,              // Optional title for the attachment
  "subtitle": string            // Optional subtitle for the attachment
}
```

---

### linear_get_attachment

Retrieve an attachment's content by ID.

**Parameters:**
```json
{
  "id": string                  // *REQUIRED* Attachment ID
}
```

---

### linear_delete_attachment

Delete an attachment by ID.

**Parameters:**
```json
{
  "id": string                  // *REQUIRED* Attachment ID
}
```

---

## Projects & Milestones

### linear_list_projects

List projects in your Linear workspace.

**Parameters:**
```json
{
  "limit": number,              // Max results (default: 50, max: 250)
  "cursor": string,             // Next page cursor
  "orderBy": "createdAt" | "updatedAt",  // Sort order (default: "updatedAt")
  "query": string,              // Search project name
  "state": string,              // State type, name, or ID
  "initiative": string,         // Initiative name or ID
  "team": string,               // Team name or ID
  "member": string,             // User ID, name, email, or "me"
  "label": string,              // Label name or ID
  "createdAt": string,          // ISO-8601 date/duration (e.g., "-P1D")
  "updatedAt": string,          // ISO-8601 date/duration (e.g., "-P1D")
  "includeMilestones": boolean, // Include milestones (default: false)
  "includeMembers": boolean,    // Include project members (default: false)
  "includeArchived": boolean    // Include archived items (default: false)
}
```

---

### linear_get_project

Retrieve details of a specific project in Linear.

**Parameters:**
```json
{
  "query": string,               // *REQUIRED* Project name, ID, or slug
  "includeMilestones": boolean, // Include milestones (default: false)
  "includeMembers": boolean,    // Include project members (default: false)
  "includeResources": boolean   // Include resources (documents, links, attachments) (default: false)
}
```

---

### linear_save_project

Create or update a Linear project. If `id` is provided, updates the existing project; otherwise creates a new one. When creating, `name` and at least one team (via `addTeams` or `setTeams`) are required.

**Parameters:**
```json
{
  "id": string,                 // Project ID - if provided, updates existing
  "name": string,               // *REQUIRED when creating* Project name
  "icon": string,               // Icon emoji (e.g., ":eagle:")
  "color": string,              // Hex color
  "summary": string,            // Short summary (max 255 chars)
  "description": string,        // Content as Markdown
  "state": string,              // Project state
  "startDate": string,          // Start date (ISO format)
  "targetDate": string,         // Target date (ISO format)
  "priority": number,           // 0=None, 1=Urgent, 2=High, 3=Medium, 4=Low
  "addTeams": string[],         // Team names or IDs to add
  "removeTeams": string[],      // Team names or IDs to remove
  "setTeams": string[],         // Replace all teams (cannot combine with addTeams/removeTeams)
  "labels": string[],           // Label names or IDs
  "lead": string | null,        // User ID, name, email, or "me". Null to remove
  "addInitiatives": string[],   // Initiative names/IDs to add
  "removeInitiatives": string[], // Initiative names/IDs to remove
  "setInitiatives": string[]    // Replace all initiatives (cannot combine with addInitiatives/removeInitiatives)
}
```

---

### linear_list_milestones

List all milestones in a Linear project.

**Parameters:**
```json
{
  "project": string             // *REQUIRED* Project name, ID, or slug
}
```

---

### linear_get_milestone

Retrieve details of a specific milestone by ID or name.

**Parameters:**
```json
{
  "project": string,            // *REQUIRED* Project name, ID, or slug
  "query": string               // *REQUIRED* Milestone name or ID
}
```

---

### linear_save_milestone

Create or update a milestone in a Linear project. If `id` is provided, updates the existing milestone; otherwise creates a new one. When creating, `name` is required.

**Parameters:**
```json
{
  "project": string,            // *REQUIRED* Project name, ID, or slug
  "id": string,                 // Milestone name or ID - if provided, updates existing
  "name": string,               // *REQUIRED when creating* Milestone name
  "description": string,        // Milestone description
  "targetDate": string | null   // Target completion date (ISO format, null to remove)
}
```

---

## Project Status

### linear_get_status_updates

List or get project/initiative status updates. Pass `id` to get a specific update, or filter to list.

**Parameters:**
```json
{
  "limit": number,              // Max results (default: 50, max: 250)
  "cursor": string,             // Next page cursor
  "orderBy": "createdAt" | "updatedAt",  // Sort order (default: "updatedAt")
  "type": "project",            // *REQUIRED* Type of status update
  "id": string,                 // Status update ID - if provided, returns this specific update
  "project": string,           // Project name, ID, or slug
  "initiative": string,         // Initiative name or ID
  "user": string,               // User ID, name, email, or "me"
  "createdAt": string,          // ISO-8601 date/duration (e.g., "-P1D")
  "updatedAt": string,          // ISO-8601 date/duration (e.g., "-P1D")
  "includeArchived": boolean    // Include archived items (default: false)
}
```

---

### linear_save_status_update

Create or update a project/initiative status update. Omit `id` to create, provide `id` to update.

**Parameters:**
```json
{
  "type": "project",            // *REQUIRED* Type of status update
  "id": string,                 // Status update ID - if provided, updates existing
  "project": string,            // Project name, ID, or slug
  "initiative": string,          // Initiative name or ID
  "body": string,               // Content as Markdown
  "health": "onTrack" | "atRisk" | "offTrack",  // Health status
  "isDiffHidden": boolean       // Hide diff with previous update
}
```

---

### linear_delete_status_update

Delete (archive) a project or initiative status update.

**Parameters:**
```json
{
  "type": "project",            // *REQUIRED* Type of status update
  "id": string                  // *REQUIRED* Status update ID
}
```

---

## Documents

### linear_list_documents

List documents in your Linear workspace.

**Parameters:**
```json
{
  "limit": number,              // Max results (default: 50, max: 250)
  "cursor": string,             // Next page cursor
  "orderBy": "createdAt" | "updatedAt",  // Sort order (default: "updatedAt")
  "query": string,              // Search query
  "projectId": string,          // Filter by project ID
  "initiativeId": string,       // Filter by initiative ID
  "creatorId": string,          // Filter by creator ID
  "createdAt": string,          // ISO-8601 date/duration (e.g., "-P1D")
  "updatedAt": string,          // ISO-8601 date/duration (e.g., "-P1D")
  "includeArchived": boolean    // Include archived items (default: false)
}
```

---

### linear_get_document

Retrieve a Linear document by ID or slug.

**Parameters:**
```json
{
  "id": string                  // *REQUIRED* Document ID or slug
}
```

---

### linear_create_document

Create a new document in Linear.

**Parameters:**
```json
{
  "title": string,              // *REQUIRED* Document title
  "content": string,            // Content as Markdown
  "project": string,            // Project name, ID, or slug
  "issue": string,              // Issue ID or identifier (e.g., "LIN-123")
  "icon": string,               // Icon emoji
  "color": string               // Hex color
}
```

---

### linear_update_document

Update an existing Linear document.

**Parameters:**
```json
{
  "id": string,                 // *REQUIRED* Document ID or slug
  "title": string,              // Document title
  "content": string,            // Content as Markdown
  "project": string,            // Project name, ID, or slug
  "icon": string,               // Icon emoji
  "color": string               // Hex color
}
```

---

## Teams & Users

### linear_list_teams

List teams in your Linear workspace.

**Parameters:**
```json
{
  "limit": number,              // Max results (default: 50, max: 250)
  "cursor": string,             // Next page cursor
  "orderBy": "createdAt" | "updatedAt",  // Sort order (default: "updatedAt")
  "query": string,              // Search query
  "includeArchived": boolean,   // Include archived items (default: false)
  "createdAt": string,          // ISO-8601 date/duration (e.g., "-P1D")
  "updatedAt": string           // ISO-8601 date/duration (e.g., "-P1D")
}
```

---

### linear_get_team

Retrieve details of a specific Linear team.

**Parameters:**
```json
{
  "query": string               // *REQUIRED* Team UUID, key, or name
}
```

---

### linear_list_users

Retrieve users in the Linear workspace.

**Parameters:**
```json
{
  "limit": number,              // Max results (default: 50, max: 250)
  "cursor": string,             // Next page cursor
  "orderBy": "createdAt" | "updatedAt",  // Sort order (default: "updatedAt")
  "query": string,              // Filter by name or email
  "team": string                // Team name or ID
}
```

---

### linear_get_user

Retrieve details of a specific Linear user.

**Parameters:**
```json
{
  "query": string               // *REQUIRED* User ID, name, email, or "me"
}
```

---

## Cycles

### linear_list_cycles

Retrieve cycles for a specific Linear team.

**Parameters:**
```json
{
  "teamId": string,             // *REQUIRED* Team ID
  "type": "current" | "previous" | "next"  // Filter: current, previous, next, or all
}
```

---

## Labels

### linear_list_project_labels

List available project labels in the Linear workspace.

**Parameters:**
```json
{
  "limit": number,              // Max results (default: 50, max: 250)
  "cursor": string,             // Next page cursor
  "orderBy": "createdAt" | "updatedAt",  // Sort order (default: "updatedAt")
  "name": string                // Filter by name
}
```

---

## Other

### linear_search_documentation

Search Linear's documentation to learn about features and usage.

**Parameters:**
```json
{
  "query": string,              // *REQUIRED* Search query
  "page": number                // Page number (default: 0)
}
```

---

### linear_extract_images

Extract and fetch images from markdown content. Use this to view screenshots, diagrams, or other images embedded in Linear issues, comments, or documents.

**Parameters:**
```json
{
  "markdown": string            // *REQUIRED* Markdown content containing image references (e.g., issue description, comment body)
}
```

---

## Type Summary

| Category | Tool | Required Params |
|----------|------|-----------------|
| Issues | `linear_list_issues` | - |
| | `linear_get_issue` | `id` |
| | `linear_save_issue` | `title`, `team` (when creating) |
| Comments | `linear_list_comments` | `issueId` |
| | `linear_save_comment` | `body` (when creating) |
| | `linear_delete_comment` | `id` |
| Status | `linear_list_issue_statuses` | `team` |
| | `linear_get_issue_status` | `id`, `name`, `team` |
| Labels | `linear_list_issue_labels` | - |
| | `linear_create_issue_label` | `name` |
| Attachments | `linear_create_attachment` | `issue`, `base64Content`, `filename`, `contentType` |
| | `linear_get_attachment` | `id` |
| | `linear_delete_attachment` | `id` |
| Projects | `linear_list_projects` | - |
| | `linear_get_project` | `query` |
| | `linear_save_project` | `name`, team (when creating) |
| Milestones | `linear_list_milestones` | `project` |
| | `linear_get_milestone` | `project`, `query` |
| | `linear_save_milestone` | `project`, `name` (when creating) |
| Status Updates | `linear_get_status_updates` | `type` |
| | `linear_save_status_update` | `type` |
| | `linear_delete_status_update` | `type`, `id` |
| Documents | `linear_list_documents` | - |
| | `linear_get_document` | `id` |
| | `linear_create_document` | `title` |
| | `linear_update_document` | `id` |
| Teams | `linear_list_teams` | - |
| | `linear_get_team` | `query` |
| Users | `linear_list_users` | - |
| | `linear_get_user` | `query` |
| Cycles | `linear_list_cycles` | `teamId` |
| Project Labels | `linear_list_project_labels` | - |
| Other | `linear_search_documentation` | `query` |
| | `linear_extract_images` | `markdown` |
