# pi-linear-tools Architecture

## Repository Structure Diagram

```mermaid
graph TB
    subgraph "Entry Points"
        A[index.js<br/>CLI Entry]
        B[bin/pi-linear-tools.js<br/>Binary CLI]
        C[extensions/pi-linear-tools.js<br/>Pi Extension]
    end

    subgraph "Core Source (src/)"
        D[cli.js<br/>CLI Router]
        E[handlers.js<br/>Action Handlers]
        F[linear.js<br/>Linear API Wrapper]
        G[linear-client.js<br/>Client Factory]
        H[settings.js<br/>Config Management]
        I[logger.js<br/>Logging Utility]
    end

    subgraph "Authentication (src/auth/)"
        J[index.js<br/>Auth Exports]
        K[oauth.js<br/>OAuth 2.0 Flow]
        L[pkce.js<br/>PKCE Generator]
        M[token-store.js<br/>Token Storage]
        N[token-refresh.js<br/>Token Refresh]
        O[callback-server.js<br/>OAuth Callback]
    end

    subgraph "External Dependencies"
        P["@linear/sdk<br/>Linear GraphQL API"]
        Q[keytar<br/>OS Keychain]
        R[graphql<br/>GraphQL Client]
    end

    subgraph "Configuration"
        S[settings.json<br/>User Settings]
        T[settings.json.example<br/>Example Config]
    end

    subgraph "Tests"
        U[test-*.js<br/>Test Suites]
    end

    subgraph "Documentation"
        V[README.md]
        W[FUNCTIONALITY.md]
        X[OAUTH.md]
        Y[CHANGELOG.md]
    end

    %% Entry point connections
    A --> D
    B --> D
    C --> E
    C --> H
    C --> J

    %% CLI connections
    D --> E
    D --> H
    D --> J

    %% Handlers connections
    E --> F
    E --> G
    E --> H

    %% Linear client connections
    F --> P
    G --> P

    %% Auth connections
    J --> K
    J --> M
    J --> N
    K --> L
    K --> O
    K --> P
    M --> Q
    O --> K

    %% Settings connections
    H --> S

    %% Test connections
    U --> E
    U --> H
    U --> C

    style A fill:#e1f5fe
    style B fill:#e1f5fe
    style C fill:#e1f5fe
    style P fill:#fff3e0
    style Q fill:#fff3e0
    style R fill:#fff3e0
```

## Data Flow Diagram

```mermaid
flowchart LR
    subgraph "User Input"
        U1[CLI Command]
        U2[Pi Chat /command]
        U3[Tool Call]
    end

    subgraph "Authentication Layer"
        AUTH{Auth Method?}
        OAUTH[OAuth 2.0 Token]
        APIKEY[API Key]
        KEYCHAIN[(OS Keychain)]
    end

    subgraph "Linear API"
        CLIENT[LinearClient]
        GRAPHQL[Linear GraphQL API]
    end

    subgraph "Operations"
        ISSUES[Issue CRUD]
        PROJECTS[Project List]
        TEAMS[Team List]
        MILESTONES[Milestone CRUD]
    end

    U1 --> CLI[CLI Parser]
    U2 --> CMD[Command Handler]
    U3 --> TOOL[Tool Handler]

    CLI --> AUTH
    CMD --> AUTH
    TOOL --> AUTH

    AUTH -->|OAuth| OAUTH
    AUTH -->|API Key| APIKEY
    OAUTH --> KEYCHAIN
    OAUTH --> CLIENT
    APIKEY --> CLIENT

    CLIENT --> GRAPHQL
    GRAPHQL --> ISSUES
    GRAPHQL --> PROJECTS
    GRAPHQL --> TEAMS
    GRAPHQL --> MILESTONES
```

## Component Diagram

```mermaid
graph TB
    subgraph "Pi Extension Interface"
        CMD1[/linear-tools-config]
        CMD2[/linear-tools-help]
        CMD3[/linear-tools-reload]
        TOOL1[linear_issue]
        TOOL2[linear_project]
        TOOL3[linear_team]
        TOOL4[linear_milestone]
    end

    subgraph "CLI Interface"
        CLI_AUTH[auth login/logout/status]
        CLI_CONFIG[config]
        CLI_ISSUE[issue list/view/create/update/comment/start/delete]
        CLI_PROJECT[project list]
        CLI_TEAM[team list]
        CLI_MILESTONE[milestone list/view/create/update/delete]
    end

    subgraph "Core Handlers"
        H_LIST[executeIssueList]
        H_VIEW[executeIssueView]
        H_CREATE[executeIssueCreate]
        H_UPDATE[executeIssueUpdate]
        H_COMMENT[executeIssueComment]
        H_START[executeIssueStart]
        H_DELETE[executeIssueDelete]
        H_PROJ[executeProjectList]
        H_TEAM[executeTeamList]
        H_MLIST[executeMilestoneList]
        H_MVIEW[executeMilestoneView]
        H_MCREATE[executeMilestoneCreate]
        H_MUPDATE[executeMilestoneUpdate]
        H_MDELETE[executeMilestoneDelete]
    end

    CMD1 --> CONFIG[Config Handler]
    TOOL1 --> ISSUE_H[Issue Dispatcher]
    TOOL2 --> H_PROJ
    TOOL3 --> H_TEAM
    TOOL4 --> MILESTONE_H[Milestone Dispatcher]

    CLI_ISSUE --> ISSUE_H
    CLI_MILESTONE --> MILESTONE_H

    ISSUE_H --> H_LIST
    ISSUE_H --> H_VIEW
    ISSUE_H --> H_CREATE
    ISSUE_H --> H_UPDATE
    ISSUE_H --> H_COMMENT
    ISSUE_H --> H_START
    ISSUE_H --> H_DELETE

    MILESTONE_H --> H_MLIST
    MILESTONE_H --> H_MVIEW
    MILESTONE_H --> H_MCREATE
    MILESTONE_H --> H_MUPDATE
    MILESTONE_H --> H_MDELETE
```

## Authentication Flow

```mermaid
sequenceDiagram
    participant User
    participant CLI
    participant Auth as Auth Module
    participant Keychain as OS Keychain
    participant Browser
    participant Linear as Linear API

    alt API Key Auth
        User->>CLI: config --api-key lin_xxx
        CLI->>Auth: Store API Key
        Auth->>Keychain: Store securely
        Auth-->>User: ✓ API Key saved
    else OAuth Auth
        User->>CLI: auth login
        CLI->>Auth: Start OAuth Flow
        Auth->>Auth: Generate PKCE challenge
        Auth->>Browser: Open authorization URL
        Browser->>Linear: User authorizes
        Linear-->>Browser: Redirect with code
        Browser->>Auth: Callback with code
        Auth->>Linear: Exchange code for tokens
        Linear-->>Auth: Access & Refresh tokens
        Auth->>Keychain: Store tokens
        Auth-->>User: ✓ Authentication successful
    end

    Note over User,Linear: On subsequent requests
    User->>CLI: issue list
    CLI->>Auth: Get credentials
    Auth->>Keychain: Retrieve tokens
    Keychain-->>Auth: Return tokens
    Auth->>Auth: Check if expired
    alt Token Expired
        Auth->>Linear: Refresh token
        Linear-->>Auth: New tokens
        Auth->>Keychain: Update stored tokens
    end
    Auth-->>CLI: Valid credentials
    CLI->>Linear: API request
    Linear-->>CLI: Response
    CLI-->>User: Display results
```

## File Tree Overview

```mermaid
mindmap
  root((pi-linear-tools))
    Entry Points
      index.js
      bin/pi-linear-tools.js
      extensions/pi-linear-tools.js
    Source (src/)
      cli.js
      handlers.js
      linear.js
      linear-client.js
      settings.js
      logger.js
      auth/
        index.js
        oauth.js
        pkce.js
        token-store.js
        token-refresh.js
        callback-server.js
    Tests
      test-*.js
    Scripts
      dev-sync-local-extension.mjs
    Documentation
      README.md
      FUNCTIONALITY.md
      OAUTH.md
      CHANGELOG.md
      ARCHITECTURE.md
    Config
      package.json
      settings.json.example
```
