# Project Structure Mermaid Diagrams

This document contains multiple mermaid diagrams showing different aspects of the `pi-linear-tools` project structure.

## 1. Directory Structure (Tree View)

```mermaid
flowchart TD
    Root[Root]
    Root --> Docs[docs]
    Root --> Extensions[extensions]
    Root --> Scripts[scripts]
    Root --> Settings[Root Files]
    Root --> Src[src]
    Root --> Tests[tests]
    Root --> NodeModules[node_modules]
    Root --> Bin[bin]

    Docs --> GraphQL[linear-schema.graphql]

    Extensions --> ExtJS[pi-linear-tools.js]

    Scripts --> DevSync[dev-sync-local-extension.mjs]

    Settings --> AGENTS[AGENTS.md]
    Settings --> ARCHITECTURE[ARCHITECTURE.md]
    Settings --> DIAGRAMS[DIAGRAMS.md]
    Settings --> FUNCTIONALITY[FUNCTIONALITY.md]
    Settings --> OAUTH[OAUTH.md]
    Settings --> PLAN[PLAN.md]
    Settings --> POST[POST_RELEASE_CHECKLIST.md]
    Settings --> RELEASE[RELEASE.md]
    Settings --> README[README.md]

    Src --> Auth[auth]
    Src --> Cli[cli.js]
    Src --> Handlers[handlers.js]
    Src --> LinearClient[linear-client.js]
    Src --> LinearCore[linear.js]
    Src --> Logger[logger.js]
    Src --> SettingsJS[settings.js]

    Auth --> AuthCode[auth-code.js]
    Auth --> Token[token-manager.js]
    Auth --> Exchange[token-exchange.js]

    NodeModules --> Base64[base64-js]
    NodeModules --> BufferLib[buffer, bl]
    NodeModules --> GraphQL[ggraphql]
    NodeModules --> LinearSDK[@linear]

    Tests --> AssigneeFix[test-assignee-fix-live.js]
    Tests --> AssigneeUpdate[test-assignee-update.js]
    Tests --> BranchParam[test-branch-param.js]
    Tests --> ExtReg[test-extension-registration.js]
    Tests --> FullFlow[test-full-assignee-flow.js]
    Tests --> PackageManif[test-package-manifest.js]
    Tests --> SettingsTest[test-settings.js]

    Bin --> CLIEntrypoint[pi-linear-tools.js]

    Root -.-> Finished[finished/]

    style Root fill:#e1f5ff,stroke:#01579b,stroke-width:2px
    style Src fill:#e8f5e9,stroke:#2e7d32,stroke-width:1px
    style Tests fill:#fff3e0,stroke:#ef6c00,stroke-width:1px
```

## 2. Component Architecture Diagram

```mermaid
flowchart TB
    subgraph Extension[pi-linear-tools Extension]
        ExtEntry[Entry Point]
        ExtHandler[Message Handler]
        ExtRegistry[Extension Registry]
    end

    subgraph Core[Core System]
        CLI[CLI Interface]
        Auth[Authentication Module]
        Linear[Linear Client]
        Handlers[Command Handlers]
    end

    subgraph Services[Services]
        Settings[Settings Manager]
        Logger[Logger]
    end

    ExtEntry --> ExtHandler
    ExtHandler --> ExtRegistry
    ExtEntry --> CLI

    CLI --> Handlers
    CLI --> Linear
    CLI --> Auth
    Handlers --> Linear
    Handlers --> Auth

    Auth --> Settings
    Auth --> Logger
    Linear --> Logger
    Handlers --> Logger

    style Extension fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    style Core fill:#e8eaf6,stroke:#3f51b5,stroke-width:2px
    style Services fill:#fff8e1,stroke:#fbc02d,stroke-width:2px
```

## 3. Data Flow Diagram

```mermaid
sequenceDiagram
    participant User as User
    participant CLI as CLI Interface
    participant Linear as Linear Client
    participant Auth as Authentication
    participant LinearSDK as Linear SDK
    participant Pi as pi Environment
    participant Extension as Extension

    User->>CLI: Execute command
    CLI->>Settings: Load config/settings
    Settings-->>CLI: Return settings
    CLI->>Auth: Initialize or refresh tokens
    Auth->>LinearSDK: Exchange auth code for token
    LinearSDK-->>Auth: Return access token
    Auth-->>CLI: Set up auth headers
    CLI->>LinearSDK: GraphQL request (query)
    LinearSDK-->>CLI: GraphQL response
    CLI->>Extension: Send result via message
    Extension-->>User: Display result
```

## 4. Extension Architecture Diagram

```mermaid
graph LR
    A[pi CLI] --> B[Extension Container]
    B --> C[Extension Entry Point]
    C --> D[Message Handler]
    D --> E[Command Router]
    E --> F{Command Type}
    F -->|Setup| G[Initialize Extension]
    F -->|Execute| H[Run Command]
    G --> I[Load Config]
    I --> J[Initialize Handlers]
    H --> K[Prepare Request]
    K --> L[Execute Linear Query]
    L --> M[Process Response]
    M --> N[Return Result]

    style A fill:#ffcc80,stroke:#ef6c00
    style B fill:#ffab91,stroke:#d84315
    style C fill:#ff8a65,stroke:#bf360c
    style D fill:#ff7043,stroke:#e64a19
    style E fill:#ff5722,stroke:#bf360c
    style F fill:#ef6c00,stroke:#e64a19
    style G fill:#f4511e,stroke:#bf360c
    style H fill:#d84315,stroke:#bf360c
    style I fill:#ffcc80
    style J fill:#ffab91
    style K fill:#ff8a65
    style L fill:#ff7043
    style M fill:#ff5722
    style N fill:#ef6c00
```

## 5. Module Dependency Graph

```mermaid
graph TB
    Subgraph Main
        CLI[cli.js]
        CLI_H[Handlers]
        CLILinear[linear.js]
        CLI_Settings[settings.js]
        CLI_Logger[logger.js]
    end

    Subgraph AuthModule
        AuthMain[auth/]
        AuthToken[token-manager.js]
        AuthCode[auth-code.js]
        AuthExchange[token-exchange.js]
    end

    Subgraph LinearClient
        LinearClient[linear-client.js]
    end

    CLI --> CLI_H
    CLI --> CLILinear
    CLI --> CLI_Settings
    CLI --> CLI_Logger
    CLI --> LinearClient

    CLI_H --> CLILinear
    CLI_Settings --> CLI_Logger
    AuthMain --> AuthToken
    AuthMain --> AuthCode
    AuthMain --> AuthExchange

    LinearClient --> CLILinear

    CLI --> bin[bin/pi-linear-tools.js]
    CLI --> scripts[scripts/dev-sync-local-extension.mjs]
    CLI --> tests[tests/]

    style Main fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style AuthModule fill:#fce4ec,stroke:#c2185b,stroke-width:2px
    style LinearClient fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style bin fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style scripts fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style tests fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
```

## 6. Test Structure Diagram

```mermaid
flowchart TD
    TestRunner[Test Runner]

    Test1[test-assignee-fix-live.js]
    Test2[test-assignee-update.js]
    Test3[test-branch-param.js]
    Test4[test-extension-registration.js]
    Test5[test-full-assignee-flow.js]
    Test6[test-package-manifest.js]
    Test7[test-settings.js]

    Test1 --> Test1Desc[Live test - fixes assignee]
    Test2 --> Test2Desc[Updates assignee field]
    Test3 --> Test3Desc[Branch parameter validation]
    Test4 --> Test4Desc[Extension registration flow]
    Test5 --> Test5Desc[Full assignee flow end-to-end]
    Test6 --> Test6Desc[Package.json manifest validation]
    Test7 --> Test7Desc[Settings file management]

    TestRunner --> Test1
    TestRunner --> Test2
    TestRunner --> Test3
    TestRunner --> Test4
    TestRunner --> Test5
    TestRunner --> Test6
    TestRunner --> Test7

    Test1Desc -->|Live Environment| Auth[Authentication]
    Test1Desc -->|Uses| Linear[Linear Client]
    Test5Desc -->|Full Flow| Setup[Setup]
    Test5Desc -->|Validate| Response[Response Processing]

    style TestRunner fill:#bbdefb,stroke:#1976d2,stroke-width:2px
    style Test1 fill:#c8e6c9,stroke:#388e3c,stroke-width:1px
    style Test2 fill:#c8e6c9,stroke:#388e3c,stroke-width:1px
    style Test3 fill:#c8e6c9,stroke:#388e3c,stroke-width:1px
    style Test4 fill:#c8e6c9,stroke:#388e3c,stroke-width:1px
    style Test5 fill:#a5d6a7,stroke:#2e7d32,stroke-width:2px
    style Test6 fill:#c8e6c9,stroke:#388e3c,stroke-width:1px
    style Test7 fill:#c8e6c9,stroke:#388e3c,stroke-width:1px
```

## 7. Authentication Flow Diagram

```mermaid
flowchart LR
    Start[Start] --> NewUser{New User?}
    NewUser -->|Yes| AuthCode[Get Auth Code]
    NewUser -->|No| CheckToken{Token Valid?}
    AuthCode --> Exchange[Exchange Code]
    Exchange --> SaveToken[Save Token]
    SaveToken --> CheckToken
    CheckToken -->|Yes| AuthReady[Auth Ready]
    CheckToken -->|No| RefreshToken[Refresh Token]
    RefreshToken --> UseExisting{Has Refresh?}
    UseExisting -->|Yes| RedeemRefresh[Redeem Refresh]
    UseExisting -->|No| AuthCode
    RedeemRefresh --> SaveToken
    CheckToken -->|No, Try Refresh| CheckStored{Stored Refresh?}
    CheckStored -->|Yes| RedeemRefresh
    CheckStored -->|No| AuthCode

    AuthReady --> Execute[Execute Command]
    Execute --> End[End]

    style Start fill:#fff9c4,stroke:#fbc02d,stroke-width:2px
    style AuthCode fill:#ffccbc,stroke:#d84315,stroke-width:1px
    style Exchange fill:#ffab91,stroke:#bf360c,stroke-width:2px
    style SaveToken fill:#ff8a65,stroke:#e64a19,stroke-width:2px
    style AuthReady fill:#c8e6c9,stroke:#2e7d32,stroke-width:2px
    style Execute fill:#a5d6a7,stroke:#2e7d32,stroke-width:2px
    style End fill:#c8e6c9,stroke:#2e7d32,stroke-width:2px
```

## 8. Project Configuration Hierarchy

```mermaid
graph TB
    RootProject[Project Root]
    ProjectFiles[Key Files]
    ProjectSubdirs[Subdirectories]

    ProjectFiles --> Package[package.json]
    ProjectFiles --> Settings[settings.json.example]
    ProjectFiles --> Keys[KEYS.md]
    ProjectFiles --> Plan[PLAN.md]
    ProjectFiles --> Docs[Documentation/*.md]

    ProjectSubdirs --> Src[src/]
    ProjectSubdirs --> Tests[tests/]
    ProjectSubdirs --> Docs[docs/]
    ProjectSubdirs --> Extensions[extensions/]
    ProjectSubdirs --> Bin[bin/]
    ProjectSubdirs --> Scripts[scripts/]

    Src --> Main[core files]
    Src --> Auth[auth/]
    Src --> Handlers[handlers]

    Tests --> Unit[unit tests]
    Tests --> Integration[integration tests]

    RootProject --> ProjectFiles
    RootProject --> ProjectSubdirs

    style RootProject fill:#e3f2fd,stroke:#1565c0,stroke-width:3px
    style ProjectFiles fill:#bbdefb,stroke:#1976d2,stroke-width:2px
    style ProjectSubdirs fill:#bbdefb,stroke:#1976d2,stroke-width:2px
```

## 9. Release Workflow Diagram

```mermaid
flowchart TD
    A[Start Release] --> B[Create Branch]
    B --> C[Update README]
    C --> D[Update Changelog]
    D --> E[Update Version]
    E --> F[Run Tests]
    F --> G{Tests Pass?}
    G -->|Yes| H[Commit Changes]
    G -->|No| I[Fix Bugs]
    I --> F
    H --> J[Push to Remote]
    J --> K[Create Release]
    K --> L[Update GitHub Release]
    L --> M[Send Notifications]
    M --> N[Finish]

    style A fill:#e8f5e9,stroke:#2e7d32
    style H fill:#fff9c4,stroke:#fbc02d
    style K fill:#fff9c4,stroke:#fbc02d
    style L fill:#fff9c4,stroke:#fbc02d
    style N fill:#e8f5e9,stroke:#2e7d32
```

## 10. Extension Lifecycle Diagram

```mermaid
sequenceDiagram
    participant User as User
    participant Pi as pi
    participant Loader as Extension Loader
    participant Registry as Extension Registry
    participant Extension as Extension Entry

    User->>Pi: Install Extension
    Pi->>Loader: Load Extension
    Loader->>Registry: Register Extension
    Registry->>Extension: Send Message

    Extension->>Extension: Initialize
    Extension-->>Registry: Send Ready Message
    Registry-->>Loader: Notify Ready
    Loader-->>Pi: Extension Ready

    Note over User,Pi: Runtime

    User->>Pi: Use Extension
    Pi->>Registry: Forward Command
    Registry->>Extension: Execute Command
    Extension-->>Registry: Send Result
    Registry-->>Pi: Return Result
    Pi-->>User: Display Result

    Note over User,Pi: Unload

    User->>Pi: Remove Extension
    Pi->>Registry: Unregister Extension
    Registry->>Extension: Send Unload
    Extension->>Extension: Cleanup
    Extension-->>Registry: Unloaded
```

## 11. File Organization by Purpose

```mermaid
mindmap
  root((Project Organization))
    Core
      cli.js
      linear.js
      linear-client.js
      handlers.js
      settings.js
      logger.js
    Auth
      auth-code.js
      token-manager.js
      token-exchange.js
    Configuration
      package.json
      settings.json.example
      AGENTS.md
      ARCHITECTURE.md
    Tests
      Unit Tests
      Integration Tests
    Documentation
      README.md
      DIAGRAMS.md
      CHANGELOG.md
      RELEASE.md
    Scripts
      dev-sync-local-extension.mjs
    Bin
      pi-linear-tools.js
    Extensions
      pi-linear-tools.js
```

## 12. Component Interaction Matrix

```mermaid
graph TB
    subgraph Frontend
        User[User]
    end

    subgraph System
        CLIShell[CLI Shell]
        Extension[Extension]
        PiCore[pi Core]
        Linear[Linear Service]
        Config[Settings]
    end

    User --> CLIShell
    CLIShell -->|Message| Extension
    CLIShell -->|Extension Info| PiCore
    Extension -->|Command| PiCore
    PiCore -->|REST/GraphQL| Linear
    Extension -->|Config| Config
    Config -->|Config| Extension

    style User fill:#f5f5f5,stroke:#9e9e9e
    style CLIShell fill:#e0f2f1,stroke:#00695c
    style Extension fill:#e3f2fd,stroke:#1565c0
    style PiCore fill:#fff3e0,stroke:#ef6c00
    style Linear fill:#f3e5f5,stroke:#7b1fa2
    style Config fill:#ffe0b2,stroke:#ef6c00
```

---

**Usage:** These diagrams can be rendered by any mermaid-compatible viewer. Copy the diagram code blocks into your markdown files or mermaid editor.
