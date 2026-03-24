# pi-linear-tools Project Structure

## 📊 Project Overview - Mermaid Mind Map

```mermaid
mindmap
  root((pi-linear-tools - Linear SDK Integration))
    Core Components
      index.js
        CLI Entry Point
      bin/pi-linear-tools.js
        Binary CLI Command
      extensions/pi-linear-tools.js
        Pi Extension Interface
    Source Files (src/)
      cli.js
        CLI Router & Command Parsing (yargs)
      handlers.js
        Issue Handlers (create/view/update/comment/start/delete)
        Project Handlers (list)
        Team Handlers (list)
        Milestone Handlers (create/view/update/delete)
      linear.js
        Linear API Wrapper (graphql linear.app)
      linear-client.js
        Client Factory (@linear/sdk)
      settings.js
        Configuration Management (settings.json)
        Workspace/Team Persistence
      logger.js
        Structured Logging
    Authentication Layer (src/auth/)
      index.js
        Auth Module Exports
      oauth.js
        OAuth 2.0 Authorization Flow
        PKCE Challenge Generator
      pkce.js
        PKCE Challenge Code
      token-store.js
        Token Persistence (OS Keychain)
      token-refresh.js
        Token Refresh Logic
      callback-server.js
        OAuth Callback Handler
    Tests (tests/)
      test-*.js
        Test Suites
      test-extension-registration.js
        Extension Registration Test
      test-settings.js
        Settings Validation
      test-assignee-flow.js
        Assignee Update Tests
      test-branch-param.js
        Branch Parameter Tests
      test-full-assignee-flow.js
        Full Feature Tests
    Scripts
      dev-sync-local-extension.mjs
        Local Extension Debug
      test-package-manifest.js
        Package Manifest Test
      test-extension-registration.js
        Extension Registration Test
    Configuration
      package.json
        Project Metadata
        NPM Scripts
      settings.json.example
        Example Configuration
    External Dependencies
      @linear/sdk
        GraphQL API Client
        Token Management
        Team/Issue Lookup
      keytar
        OS Keychain Access
        Secure Credential Storage
      graphql
        GraphQL Client Library
    Documentation
      README.md
        Main Documentation
      FUNCTIONALITY.md
        Feature Descriptions
      ARCHITECTURE.md
        Architecture Diagrams
      OAUTH.md
        OAuth 2.0 Guide
      CHANGELOG.md
        Version History
      RELEASE.md
        Release Instructions
      DIAGRAMS.md
        Mermaid Diagrams
    Workflow
      Development
        Plan -> Develop -> Test -> Review -> Release
      Deploy
        Package -> Install -> Configure -> Usage
```

```mermaid
mindmap
  root((pi-linear-tools))
    Entry Points
      index.js
        CLI Entry Point
      bin/pi-linear-tools.js
        Binary CLI Command
      extensions/pi-linear-tools.js
        Pi Extension Interface
    Source Code (src/)
      Core
        cli.js
          CLI Router & Command Parsing
        handlers.js
          Action Handlers (Issue, Project, Team, Milestone)
        linear.js
          Linear API Wrapper
        linear-client.js
          Linear Client Factory
        settings.js
          Configuration Management
        logger.js
          Logging Utility
      Authentication (auth/)
        index.js
          Auth Module Exports
        oauth.js
          OAuth 2.0 Authorization Flow
        pkce.js
          PKCE Challenge Generator
        token-store.js
          Token Persistence
        token-refresh.js
          Token Refresh Logic
        callback-server.js
          OAuth Callback Handler
    Tests
      test-package-manifest.js
        Package Manifest Validation
      test-extension-registration.js
        Extension Registration
      test-settings.js
        Settings Validation
      test-assignee-update.js
        Assignee Update Tests
      test-full-assignee-flow.js
        Full Assignee Flow Tests
      test-branch-param.js
        Branch Parameter Tests
    Documentation
      README.md
        Main Documentation
      FUNCTIONALITY.md
        Feature Descriptions
      OAUTH.md
        OAuth 2.0 Guide
      CHANGELOG.md
        Version History
      ARCHITECTURE.md
        Architecture Documentation
      RELEASE.md
        Release Instructions
    Scripts
      dev-sync-local-extension.mjs
        Local Extension Debug Helper
      test-package-manifest.js
        Package Manifest Test
      test-extension-registration.js
        Extension Registration Test
    Configuration
      package.json
        Project Metadata & Scripts
      settings.json.example
        Example Configuration
    External Dependencies
      node_modules/
        @linear/sdk
          Linear GraphQL API Client
        keytar
          OS Keychain Access
        graphql
          GraphQL Client Library
    Finished
      PLAN-*.md
        Planning Documents
      TODO-*.md
        Task Lists
    License
      LICENSE
        MIT License
```

---

## 2. Architecture - Flowchart

```mermaid
flowchart TB
    subgraph User_Interaction["User Interaction"]
        U1[CLI Command<br/>pi-linear-tools issue list]
        U2[Pi Chat /command<br/>/linear-tools-config]
        U3[Tool Call<br/>linear_issue list]
    end

    subgraph Entry_Points["Entry Points"]
        A[index.js<br/>CLI Entry]
        B[bin/pi-linear-tools.js<br/>Binary CLI]
        C[extensions/pi-linear-tools.js<br/>Pi Extension]
    end

    subgraph Core_Source["Core Source"]
        D[cli.js<br/>CLI Router]
        E[handlers.js<br/>Action Handlers]
        F[linear.js<br/>Linear API Wrapper]
        G[linear-client.js<br/>Client Factory]
        H[settings.js<br/>Config Management]
        I[logger.js<br/>Logging Utility]
    end

    subgraph Auth_Layer["Authentication Layer"]
        J[auth/index.js<br/>Auth Module]
        K[oauth.js<br/>OAuth Flow]
        L[pkce.js<br/>PKCE]
        M[token-store.js<br/>Token Storage]
        N[token-refresh.js<br/>Token Refresh]
        O[callback-server.js<br/>Callback Handler]
    end

    subgraph External["External Dependencies"]
        P[@linear/sdk<br/>Linear SDK]
        Q[keytar<br/>OS Keychain]
        R[graphql<br/>GraphQL]
    end

    subgraph Configuration["Configuration"]
        S[settings.json<br/>User Settings]
        T[settings.json.example<br/>Example Config]
    end

    subgraph Output["Output"]
        R1[CLI Output]
        R2[Pi Chat Output]
        R3[Tool Results]
    end

    U1 --> A
    U2 --> C
    U3 --> C

    A --> D
    B --> D
    C --> E
    C --> H
    C --> J

    D --> E
    D --> H
    D --> J

    E --> F
    E --> G
    E --> H
    E --> I

    J --> K
    J --> M
    J --> N
    K --> L
    K --> O
    K --> P
    M --> Q

    F --> P
    G --> P

    H --> S

    E --> R1
    D --> R1
    C --> R2
    J --> R3

    style User_Interaction fill:#ffebee
    style Entry_Points fill:#e3f2fd
    style Core_Source fill:#e8f5e9
    style Auth_Layer fill:#fff3e0
    style External fill:#f3e5f5
    style Configuration fill:#fce4ec
    style Output fill:#e0f7fa
```

---

## 3. CLI Command Flow

```mermaid
flowchart LR
    subgraph Start["Start"]
        A[User Command<br/>pi-linear-tools issue list]
    end

    subgraph Parse["Parse Input"]
        B[Argument Parser<br/>yargs]
        C[Validate Arguments]
    end

    subgraph Route["Route Command"]
        D[Command Router<br/>cli.js]
        E[Match Command to Handler]
    end

    subgraph Auth["Authentication Check"]
        F{Auth Required?}
        G[Get Credentials<br/>from Settings/Env]
        H[Store in Session]
    end

    subgraph Execute["Execute Handler"]
        I[Initialize Client<br/>linear-client.js]
        J[Call API<br/>linear.js]
        K[Format Output<br/>format.js]
    end

    subgraph Output["Output Results"]
        L[Display to Terminal]
    end

    Start --> Parse
    Parse --> Route
    Route --> Auth
    Auth --> Execute
    Execute --> Output

    style Start fill:#e1f5fe
    style Parse fill:#b3e5fc
    style Route fill:#81d4fa
    style Auth fill:#4fc3f7
    style Execute fill:#29b6f6
    style Output fill:#039be5
```

---

## 4. Pi Extension Flow

```mermaid
flowchart LR
    subgraph Pi["Pi System"]
        P1[/message_received<br/>user request]
        P2[Context Analyzer]
        P3[Tool Dispatcher]
        P4[/tool_call<br/>linear_issue]
    end

    subgraph Extension["Pi Extension"]
        X1[Command Handler<br/>handlers.js]
        X2[Config Manager<br/>settings.js]
        X3[Auth Provider<br/>auth/]
    end

    subgraph Linear["Linear SDK"]
        L1[GraphQL API]
        L2[API Client]
    end

    P1 --> P2
    P2 --> P3
    P3 --> X1
    P3 --> X2
    P3 --> X3
    X1 --> L1
    X3 --> L1
    L1 --> P4
    P4 --> P2

    style Pi fill:#fce4ec
    style Extension fill:#f8bbd0
    style Linear fill:#f48fb1
```

---

## 5. Authentication Flow - Sequence

```mermaid
sequenceDiagram
    participant User as User
    participant CLI as CLI
    participant Auth as Auth Module
    participant Keychain as OS Keychain
    participant Browser as Browser
    participant Linear as Linear API
    participant Settings as Settings

    User->>CLI: /linear-tools-config
    CLI->>Auth: Show setup wizard

    alt API Key Auth (Default)
        User->>Auth: Enter API Key
        Auth->>Settings: Save to ~/.pi/agent/extensions/pi-linear-tools/settings.json
        Settings->>Auth: Credentials stored
        Auth-->>User: ✓ Configuration complete

    else OAuth 2.0 Auth
        User->>Auth: Choose OAuth flow
        Auth->>Auth: Generate PKCE code_verifier & code_challenge
        Auth->>Browser: Open auth URL (linear.com/oauth/authorize)
        Browser->>User: Show Linear authorization page
        User->>Browser: Click "Authorize"
        Browser->>Linear: Redirect to callback URL
        Linear->>Auth: Return code + state
        Auth->>Linear: POST /access_token (exchange code)
        Linear-->>Auth: Access token + Refresh token
        Auth->>Keychain: Store tokens securely
        Keychain->>Auth: Tokens saved
        Auth->>Settings: Save Linear workspace ID & team ID
        Auth-->>User: ✓ OAuth complete
    end

    Note over User,Linear: Subsequent Requests
    User->>CLI: /linear-tools issue list
    CLI->>Auth: Get credentials
    Auth->>Keychain: Retrieve tokens
    Keychain-->>Auth: Return tokens
    Auth->>Auth: Check expiration
    alt Token expired
        Auth->>Linear: POST /refresh_token
        Linear-->>Auth: New tokens
        Auth->>Keychain: Update tokens
    end
    Auth-->>CLI: Valid credentials
    CLI->>Linear: Make API request
    Linear-->>CLI: Response
    CLI-->>User: Display results
```

---

## 6. REST API Flow

```mermaid
flowchart TB
    subgraph Request["API Request"]
        R1[CLI Tool<br/>pi-linear-tools]
        R2[Command<br/>issue list]
        R3[Arguments<br/>--project MyProject]
    end

    subgraph Parse["Parse"]
        P1[Parse CLI args]
        P2[Validate constraints]
    end

    subgraph Config["Load Config"]
        C1[Read settings.json]
        C2[Load API key]
        C3[Load workspace/team]
    end

    subgraph Auth["Authenticate"]
        A1{Method?}
        APIKEY[API Key]
        OAUTH[OAuth Tokens]
        CHK[Validate tokens]
    end

    subgraph Build["Build Request"]
        B1[Construct GraphQL query]
        B2[Populate variables]
    end

    subgraph Execute["Execute"]
        E1[Call Linear SDK]
        E2[Execute GraphQL]
    end

    subgraph Response["Response"]
        Res1[Parse JSON response]
        Res2[Format output]
    end

    Request --> Parse
    Parse --> Config
    Config --> Auth
    Auth --> Build
    Build --> Execute
    Execute --> Response
    Response --> Output["Display to user"]

    style Request fill:#e1bee7
    style Parse fill:#ce93d8
    style Config fill:#ba68c8
    style Auth fill:#ab47bc
    style Build fill:#9c27b0
    style Execute fill:#8e24aa
    style Response fill:#7b1fa2
```

---

## 7. Test Flow

```mermaid
flowchart TB
    subgraph Start["Test Execution"]
        T1[Run npm test]
    end

    subgraph TestFiles["Test Files"]
        F1[test-package-manifest.js]
        F2[test-extension-registration.js]
        F3[test-settings.js]
        F4[test-assignee-update.js]
        F5[test-full-assignee-flow.js]
        F6[test-branch-param.js]
    end

    subgraph EachTest["Each Test"]
        P1[Load configuration]
        P2[Set up environment]
        P3[Execute test case]
        P4[Check assertions]
        P5[Clean up]
    end

    subgraph Results["Results"]
        S1[Print to console]
        S2[Return exit code]
    end

    Start --> TestFiles
    TestFiles --> F1
    TestFiles --> F2
    TestFiles --> F3
    TestFiles --> F4
    TestFiles --> F5
    TestFiles --> F6

    F1 --> EachTest
    F2 --> EachTest
    F3 --> EachTest
    F4 --> EachTest
    F5 --> EachTest
    F6 --> EachTest

    EachTest --> P1
    EachTest --> P2
    EachTest --> P3
    EachTest --> P4
    EachTest --> P5

    EachTest --> Results

    style Start fill:#fff9c4
    style TestFiles fill:#fff176
    style EachTest fill:#ffee58
    style Results fill:#ffeb3b
```

---

## 8. Development Workflow

```mermaid
flowchart LR
    subgraph Development["Development Cycle"]
        D1[Write Code]
        D2[Run Tests<br/>npm test]
        D3[Check Release<br/>npm run release:check]
        D4[Fix Issues]
    end

    subgraph Code_Changes["Code Changes"]
        C1[Modify src/ files]
        C2[Modify handlers.js]
        C3[Modify auth/ files]
    end

    subgraph Validation["Validation"]
        V1[Test Package Manifest]
        V2[Test Extension Registration]
        V3[Test Settings]
        V4[Test Assignee Update]
        V5[Test Full Flow]
        V6[Test Branch Param]
    end

    subgraph Release_Check["Release Check"]
        RC1[Build completes]
        RC2[Tests pass]
        RC3[Pack dry-run]
    end

    D1 --> C1
    D1 --> C2
    D1 --> C3
    C1 --> D2
    C2 --> D2
    C3 --> D2
    D2 --> V1
    V1 --> V2
    V2 --> V3
    V3 --> V4
    V4 --> V5
    V5 --> V6
    V6 --> D3
    D3 --> RC1
    RC1 --> RC2
    RC2 --> RC3
    RC3 -->|Pass| D4
    RC3 -->|Fail| D1

    style Development fill:#e0f2f1
    style Code_Changes fill:#b2dfdb
    style Validation fill:#80cbc4
    style Release_Check fill:#4db6ac
```

---

## 9. Component Interaction

```mermaid
graph TB
    subgraph Interface["Interfaces"]
        CMD[/linear-tools-config]
        HELP[/linear-tools-help]
        TOOL[linear_issue]
        EXT[pi-linear-tools.js]
    end

    subgraph CLI["CLI Component"]
        CLI_PARSER[Argument Parser]
        ROUTER[Command Router]
        FORMATTER[Output Formatter]
    end

    subgraph Handlers["Handlers Component"]
        ISSUES[Issue Handlers]
        PROJECTS[Project Handlers]
        TEAMS[Team Handlers]
        MILESTONES[Milestone Handlers]
    end

    subgraph Core["Core Component"]
        CLIENT[LinearClient]
        API[LinearAPI]
        CONFIG[Settings Manager]
        LOG[Logger]
    end

    subgraph Auth["Auth Component"]
        OAuth[OAuth Flow]
        Token[Token Manager]
        Store[Token Store]
    end

    subgraph ExtSDK["Linear SDK"]
        SDK[@linear/sdk]
    end

    CMD --> ROUTER
    HELP --> FORMATTER
    TOOL --> ISSUES

    ROUTER --> ISSUES
    ROUTER --> PROJECTS
    ROUTER --> TEAMS
    ROUTER --> MILESTONES

    ISSUES --> CLI_PARSER
    PROJECTS --> CLI_PARSER
    TEAMS --> CLI_PARSER
    MILESTONES --> CLI_PARSER

    CLI_PARSER --> CONFIG
    CLI_PARSER --> FORMATTER

    ISSUES --> CLIENT
    PROJECTS --> CLIENT
    TEAMS --> CLIENT
    MILESTONES --> CLIENT

    CLIENT --> API
    API --> SDK

    CONFIG --> AUTH
    CLIENT --> AUTH

    AUTH --> Store
    Store --> Token
    Token --> OAuth

    style Interface fill:#ffebee
    style CLI fill:#e3f2fd
    style Handlers fill:#e8f5e9
    style Core fill:#fff3e0
    style Auth fill:#f3e5f5
    style ExtSDK fill:#fce4ec
```

---

## 10. Deployment Flow

```mermaid
flowchart LR
    subgraph Preparation["Preparation"]
        P1[Run Tests<br/>npm test]
        P2[Verify Release<br/>npm run release:check]
    end

    subgraph Build["Build"]
        B1[Package Files<br/>npm pack]
        B2[Exclude Node_modules<br/>except files[]]
    end

    subgraph Install["Install"]
        I1[Users: pi install<br/>@fink-andreas/pi-linear-tools]
        I2[Global: npm install<br/>-g @fink-andreas/pi-linear-tools]
    end

    subgraph Configure["Configure"]
        C1[Run /linear-tools-config]
        C2[Select workspace/team]
        C3[Enter API Key or<br/>Authorize OAuth]
    end

    subgraph Usage["Usage"]
        U1[CLI: pi-linear-tools<br/>issue list]
        U2[Pi: /linear-tools-config]
        U3[Tools: linear_issue<br/>linear_project]
    end

    Preparation --> Build --> Install --> Configure --> Usage

    style Preparation fill:#e8f5e9
    style Build fill:#c8e6c9
    style Install fill:#a5d6a7
    style Configure fill:#81c784
    style Usage fill:#66bb6a
```

---

## 11. Issue Management Flow

```mermaid
sequenceDiagram
    participant User as User
    participant CLI as CLI
    participant Handler as Issue Handler
    participant Client as LinearClient
    participant API as Linear API

    Note over User,API: Create Issue
    User->>CLI: issue create --title "Fix bug" --team ENG
    CLI->>Handler: createIssue(title, team)
    Handler->>Client: getTeamByCode('ENG')
    Client->>API: GET /teams/by-code/ENG
    API-->>Client: Return team
    Client-->>Handler: Team ID
    Handler->>Client: createIssue({ title, teamId })
    Client->>API: POST /issues { title, teamId }
    API-->>Client: Created issue
    Client-->>Handler: Issue details
    Handler->>CLI: Output issue ID

    Note over User,API: List Issues
    User->>CLI: issue list --project "My Project"
    CLI->>Handler: listIssues(project)
    Handler->>Client: getProjectByName('My Project')
    Client->>API: GET /projects
    API-->>Client: Return projects
    Client-->>Handler: Project
    Handler->>Client: listIssues({ filter: projectId })
    Client->>API: GET /issues (GraphQL query)
    API-->>Client: Issues
    Client-->>Handler: Formatted list
    Handler->>CLI: Display to user
```

---

## 12. Data Storage Architecture

```mermaid
graph TB
    subgraph Runtime["Runtime Data"]
        R1[Session<br/>active sessions]
        R2[Cache<br/>recent results]
        R3[Temp<br/>temporary data]
    end

    subgraph Config["Configuration"]
        C1[settings.json<br/>~/.pi/agent/extensions/pi-linear-tools/settings.json]
        C2[API Key]
        C3[Workspace ID]
        C4[Team ID]
        C5[Default Project]
        C6[Preferences]
    end

    subgraph Secure["Secure Storage"]
        S1[OS Keychain<br/>keytar]
        S2[Access Tokens]
        S3[Refresh Tokens]
        S4[OAuth State]
    end

    subgraph Linear["External Linear"]
        L1[Linear API<br/>linear.app]
        L2[Issue Data]
        L3[Project Data]
        L4[Milestone Data]
        L5[Team Data]
    end

    subgraph Code["Application Code"]
        M1[settings.js<br/>config management]
        M2[auth/token-store.js<br/>token persistence]
        M3[handlers.js<br/>data processing]
    end

    M1 --> Config
    M2 --> Secure
    M3 --> Runtime

    Config --> M2
    Secure --> M2

    M1 -->|reads/writes| Config
    M2 -->|reads/writes| Secure
    M3 -->|reads/writes| Linear

    R1 --> M3
    R2 --> M3
    R3 --> M3

    style Runtime fill:#e3f2fd
    style Config fill:#e8f5e9
    style Secure fill:#ffebee
    style Linear fill:#f3e5f5
    style Code fill:#fff3e0
```

---

## 13. Authentication Methods Comparison

```mermaid
graph TB
    subgraph Auth_Modes["Authentication Methods"]
        A1[API Key]
        A2[OAuth 2.0]
        A3[Session Tokens]
    end

    subgraph API_Key["API Key Method"]
        P1[Enter API Key]
        P2[CLI: --api-key lin_xxx]
        P3[Config file]
        P4[Environment Variable<br/>LINEAR_API_KEY]
        P5[Store in Keychain]
        P6[Simple]
        P7[Less Secure]
    end

    subgraph OAuth["OAuth 2.0 Method"]
        O1[PKCE Flow]
        O2[Browser Authorization]
        O3[Access Token]
        O4[Refresh Token]
        O5[Auto Refresh]
        O6[More Secure]
        O7[More Complex]
    end

    subgraph Session["Session Tokens"]
        S1[Long-lived access token]
        S2[Refresh token]
        S3[Store in Keychain]
        S4[Auto-refresh]
        S5[Store workspace/team]
        S6[Balanced]
        S7[Stored securely]
    end

    A1 --> P1 --> P2 --> P3 --> P4 --> P5 --> P6 --> P7
    A2 --> O1 --> O2 --> O3 --> O4 --> O5 --> O6 --> O7
    A3 --> S1 --> S2 --> S3 --> S4 --> S5 --> S6 --> S7

    style A1 fill:#c8e6c9
    style A2 fill:#c8e6c9
    style A3 fill:#c8e6c9
    style API_Key fill:#a5d6a7
    style OAuth fill:#a5d6a7
    style Session fill:#a5d6a7
```

---

## 14. Extension Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Initialized
    Initialized --> Loaded: pi install
    Loaded --> Active: Reopen Pi
    Active --> Idle: No activity
    Idle --> Active: User request
    Active --> Error: Exception
    Error --> Reinitialize: Retry
    Active --> Unloaded: Restart Pi
    Unloaded --> [*]

    note right of Initialized
        Extension installed
        Source file loaded
        Package manifest validated
    end note

    note right of Loaded
        Extension source available
        Package.json available
        Ready for execution
    end note

    note right of Active
        Handles tool calls
        Processes commands
        Returns results
    end note

    note right of Idle
        Extension loaded
        Waiting for user
    end note

    note right of Error
        Runtime exception
        Error logged
    end note

    note right of Unloaded
        Restart Pi to reload
        Changes take effect
    end note
```

---

## 15. Directory Tree (ASCII-style)

```
pi-linear-tools/
├── bin/
│   └── pi-linear-tools.js          # CLI binary entry point
├── extensions/
│   └── pi-linear-tools.js          # Pi extension interface
├── src/
│   ├── auth/                        # Authentication modules
│   │   ├── index.js
│   │   ├── oauth.js
│   │   ├── pkce.js
│   │   ├── token-store.js
│   │   ├── token-refresh.js
│   │   └── callback-server.js
│   ├── cli.js                       # CLI router
│   ├── handlers.js                  # Action handlers
│   ├── linear.js                    # Linear API wrapper
│   ├── linear-client.js             # Client factory
│   ├── settings.js                  # Configuration management
│   └── logger.js                    # Logging utility
├── tests/
│   ├── test-package-manifest.js
│   ├── test-extension-registration.js
│   ├── test-settings.js
│   ├── test-assignee-update.js
│   ├── test-full-assignee-flow.js
│   └── test-branch-param.js
├── docs/
│   └── linear-schema.graphql        # Linear API schema
├── scripts/
│   └── dev-sync-local-extension.mjs  # Local extension helper
├── index.js                         # Main entry point
├── package.json                     # Project metadata
├── settings.json.example            # Example configuration
├── README.md                        # Documentation
├── ARCHITECTURE.md                  # Architecture docs
├── FUNCTIONALITY.md                 # Feature descriptions
├── OAUTH.md                         # OAuth guide
├── CHANGELOG.md                     # Version history
├── RELEASE.md                       # Release instructions
└── POST_RELEASE_CHECKLIST.md        # Post-release checklist
```

---

## 16. Data Relationships

```mermaid
erDiagram
    ISSUE ||--o{ ISSUE_COMMENT : has
    ISSUE ||--o{ ISSUE_SUB_ISSUE : has
    ISSUE ||--o{ ISSUE_HISTORY : has
    ISSUE}o--|| TEAM : belongs_to
    ISSUE}o--|| PROJECT : belongs_to
    ISSUE}o--|| MILESTONE : has
    ISSUE}o--|| ASSIGNEE : assigned_to
    ISSUE}o--|| LABEL : labeled_with
    ISSUE}o--|| PRIORITY : has
    ISSUE}o--|| STATUS : has

    PROJECT ||--o{ ISSUE : contains
    PROJECT ||--o{ MILESTONE : has

    TEAM ||--o{ ISSUE : contains
    TEAM ||--o{ PROJECT : has

    MILESTONE ||--o{ ISSUE : has

    CONFIG ||--o{ SETTINGS : contains
    SETTINGS ||--o{ API_CREDENTIAL : contains

    USER ||--o{ CONFIG : owns
    USER ||--o{ ASSIGNEE : is_assignee
```

---

## 17. Network Request Flow

```mermaid
sequenceDiagram
    participant Client as Client Code
    participant LinearSDK as @linear/sdk
    participant GraphQL as GraphQL Client
    participant LinearAPI as Linear API (graphql.linear.app)

    Note over Client,LinearAPI: GraphQL Query Execution

    Client->>LinearSDK: CreateLinearClient()
    LinearSDK->>LinearSDK: Initialize SDK with config

    Client->>LinearSDK: { issue: { list: { filter } } }
    LinearSDK->>GraphQL: new Query(...)
    GraphQL->>GraphQL: Build GraphQL document
    GraphQL->>GraphQL: Add variables
    GraphQL->>LinearAPI: POST graphql.linear.app
    LinearAPI-->>GraphQL: { data: { issues: [...] } }
    GraphQL-->>LinearSDK: Raw response
    LinearSDK->>LinearSDK: Parse data
    LinearSDK->>LinearSDK: Map to SDK types
    LinearSDK-->>Client: Issue[] objects

    Note over Client,LinearAPI: Token Management

    Client->>LinearSDK: executeQuery(query, variables)
    LinearSDK->>LinearSDK: Check session/token
    LinearSDK->>TokenStore: getToken()
    TokenStore-->>LinearSDK: token

    LinearSDK->>LinearSDK: validateToken()
    alt Token expired
        LinearSDK->>LinearAPI: refreshAccessToken()
        LinearAPI-->>LinearSDK: new token
        LinearSDK->>TokenStore: saveToken(newToken)
    end

    LinearSDK->>LinearAPI: executeQuery(query, variables, token)
    LinearAPI-->>LinearSDK: Result
```

---

## 18. Git Workflow

```mermaid
flowchart LR
    subgraph Local["Local Repository"]
        L1[main branch<br/>stable version]
        L2[feature branches<br/>feature/xxx]
        L3[uncommitted changes]
    end

    subgraph Actions["Actions"]
        A1[git checkout -b<br/>feature/new-feature]
        A2[develop feature]
        A3[git add .]
        A4[git commit -m "Description"]
        A5[git push origin<br/>feature/new-feature]
        A6[create Pull Request]
        A7[git checkout main]
        A8[git pull origin main]
        A9[git merge feature/new-feature]
        A10[git push origin main]
    end

    L2 --> A1
    A2 --> A3
    A3 --> A4
    A4 --> A5
    A5 --> A6
    A6 --> A7
    A7 --> A8
    A8 --> A9
    A9 --> A10
    A10 --> L1

    L3 -.-> A3

    style Local fill:#e8f5e9
    style Actions fill:#c8e6c9
```

---

## 19. Feature Development Pipeline

```mermaid
flowchart LR
    subgraph Design["Design"]
        D1[Analyze Requirement]
        D2[Design Solution]
        D3[Plan Implementation]
    end

    subgraph Develop["Develop"]
        Dev1[Write Code]
        Dev2[Update Handlers]
        Dev3[Add Tests]
    end

    subgraph Test["Test"]
        T1[Unit Tests]
        T2[Integration Tests]
        T3[Manual Testing]
    end

    subgraph Review["Review"]
        R1[Code Review]
        R2[Test Review]
        R3[Approval]
    end

    subgraph Release["Release"]
        Re1[NPM Pack]
        Re2[NPM Publish]
        Re3[Update Documentation]
    end

    Design --> Develop --> Test --> Review --> Release

    style Design fill:#e3f2fd
    style Develop fill:#bbdefb
    style Test fill:#90caf9
    style Review fill:#64b5f6
    style Release fill:#42a5f5
```

---

## 20. Error Handling Flow

```mermaid
flowchart TD
    Start[Start Operation] --> Parse[Parse Input]
    Parse --> Validate{Validate Arguments}
    Validate -->|Invalid| Error1[Display Error]
    Validate -->|Valid| LoadConfig[Load Configuration]

    LoadConfig --> CheckAuth{Authentication Required?}
    CheckAuth -->|Yes| GetAuth[Get Credentials]
    GetAuth --> CheckValid{Valid Credentials?}
    CheckValid -->|No| Error2[Show Auth Error]
    CheckValid -->|Yes| BuildRequest[Build API Request]
    CheckAuth -->|No, No Auth| BuildRequest

    BuildRequest --> Execute{Execute API Call}
    Execute -->|Success| ParseResponse[Parse Response]
    ParseResponse --> Format[Format Output]
    Execute -->|Error| TryRetry{Retry Available?}

    TryRetry -->|Yes| Retry[Retry Request]
    Retry --> Execute
    TryRetry -->|No| HandleError[Handle Error]

    HandleError --> Log[Log Error Details]
    Log --> Show[Show User-friendly Error]
    Show --> End[Exit]

    Error1 --> End
    Error2 --> End

    style Start fill:#e3f2fd
    style Validate fill:#bbdefb
    style CheckAuth fill:#90caf9
    style CheckValid fill:#64b5f6
    style Execute fill:#42a5f5
    style TryRetry fill:#2196f3
    style HandleError fill:#0d47a1
    style End fill:#01579b
```

---

## All Diagrams Reference

| Diagram | Type | Purpose |
|---------|------|---------|
| 1 | Mind Map | Overall project structure |
| 2 | Flowchart | Architecture overview |
| 3 | Flowchart | CLI command flow |
| 4 | Flowchart | Pi extension flow |
| 5 | Sequence | Authentication flow |
| 6 | Flowchart | API request flow |
| 7 | Flowchart | Test execution flow |
| 8 | Flowchart | Development workflow |
| 9 | Graph | Component interaction |
| 10 | Flowchart | Deployment flow |
| 11 | Sequence | Issue management flow |
| 12 | Graph | Data storage architecture |
| 13 | Graph | Authentication methods |
| 14 | State Diagram | Extension lifecycle |
| 15 | Text Tree | Directory tree (ASCII) |
| 16 | ER Diagram | Data relationships |
| 17 | Sequence | Network request flow |
| 18 | Flowchart | Git workflow |
| 19 | Flowchart | Feature development pipeline |
| 20 | Flowchart | Error handling flow |
