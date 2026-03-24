**

# Research Report: Implementation Architecture for Linear OAuth 2.0 Integration within Node.js CLI

## 1. Executive Summary

The integration of OAuth 2.0 within the pi-linear-tools Node.js/TypeScript Command Line Interface (CLI) application requires a robust, security-first architectural approach. Because a distributed CLI application operates in environments beyond the developer's control, it cannot securely store a static client secret. Consequently, it must operate as an OAuth 2.0 "public client" and utilize specific cryptographic flows to ensure secure authentication without compromising credentials.

Based on an exhaustive analysis of official Linear documentation, Request for Comments (RFC) standards, and secondary cybersecurity analyses, the following primary directives outline the optimal integration strategy:

- Mandatory PKCE Implementation: The Proof Key for Code Exchange (PKCE) extension is strictly required for public clients.1 The pi-linear-tools CLI must omit the client_secret parameter entirely during token exchange and instead rely on dynamically generated cryptographic challenges (code_challenge and code_verifier) utilizing the S256 hashing method.1
    
- Ephemeral Localhost Callback Strategy: Official Linear documentation does not support the OAuth 2.0 Device Authorization Grant (RFC 8628) commonly used in headless devices.1 Consequently, the CLI must instantiate a temporary, short-lived HTTP server bound to the local loopback interface (localhost) to capture the authorization callback from the system's default web browser.1
    
- Strict Port Registration and Collision Avoidance: Linear requires precise URI matching for callbacks and does not officially document support for wildcard loopback ports (e.g., http://localhost:*) as suggested by RFC 8252.6 The application must register specific, fixed ports (e.g., 3000, 3001) in the Linear console and implement fallback binding logic if the primary port is occupied.10
    
- Strict Token Expiration and the 2025 Mandate: For OAuth2 applications created after October 1, 2025, refresh tokens are permanently enabled by default. Access tokens feature a strict 24-hour expiration lifecycle, deprecating the legacy 10-year static token model. Applications created prior to this date have until April 1, 2026, to migrate.1
    
- Refresh Token Rotation Mechanics: Linear actively rotates refresh tokens. Upon every successful token refresh request, the previous access and refresh tokens are immediately invalidated. The application must implement single-flight concurrency locking to prevent race conditions across parallel CLI processes that would trigger invalid_grant errors.13
    
- OS-Level Secure Credential Storage: Storing access or refresh tokens in plaintext configuration files (e.g., ~/.pi-linear-tools/credentials.json) introduces critical security vulnerabilities. The CLI must utilize the operating system's native secure keychain (macOS Keychain, Windows Credential Manager, or Linux Secret Service) via secure libraries.14
    
- Granular Scope Minimization: The application must adhere to the principle of least privilege. The broad write or admin scopes must be avoided in favor of highly targeted GraphQL scopes such as issues:create or comments:create.1
    
- Cryptographic State Validation: To mitigate Cross-Site Request Forgery (CSRF) during the browser-to-CLI handoff, a high-entropy, cryptographically secure state parameter must be generated, stored in local memory, and rigorously validated upon receiving the callback.1
    
- Multi-Workspace Contexts: Linear ties authentication directly to a specific workspace. The inclusion of the prompt=consent parameter in the authorization URL is highly recommended, as it forces the consent screen to appear and allows users to explicitly select their target workspace upon re-authentication.1
    
- Resilient Rate Limit Handling: Linear enforces strict API rate limits (5,000 requests per hour or 2,000,000 GraphQL complexity points per hour for OAuth apps).19 The CLI networking layer must actively intercept 429 Too Many Requests HTTP responses and implement exponential backoff algorithms derived from Retry-After headers to ensure stability.20
    

## 2. Linear OAuth Fundamentals

A successful and compliant implementation within pi-linear-tools requires a comprehensive understanding of how Linear has adapted the OAuth 2.0 framework, particularly regarding public client constraints, token lifecycle models updated in late 2025, and GraphQL integration.

### 2.1 Protocol Version and Supported Grant Types

Linear’s public API authentication architecture is built entirely on the OAuth 2.0 framework.1 The Linear platform exposes a GraphQL API which accepts OAuth 2.0 tokens via the standard HTTP Authorization: Bearer <token> header mechanism.7

For a distributed application like a CLI tool, the required grant type is the Authorization Code flow with PKCE. Standard Authorization Code flows (which rely on a statically embedded client_secret to authenticate the application to the authorization server) are fundamentally insecure for distributed binaries where secrets can be easily reverse-engineered from the compiled artifact.3

Linear officially supports three distinct authentication pathways, only one of which is suitable for standard CLI development:

  

|   |   |   |   |
|---|---|---|---|
|Authentication Method|Protocol Mechanism|Target Audience / Use Case|Applicability to pi-linear-tools|
|Personal API Keys|Static token header|Internal developer scripts, single-user automation.|Low. Unsuitable for distributing the CLI to external end-users.7|
|OAuth 2.0 (User Actor)|Authorization Code + PKCE|Third-party applications operating on behalf of a specific user.|Primary. This is the mandated flow for pi-linear-tools.1|
|OAuth 2.0 (App Actor)|Client Credentials Grant|Server-to-server communication where the application acts independently.|Low. Requires confidential server environments to hold a client secret safely.12|

### 2.2 Endpoint Architecture

Linear provides three primary REST endpoints to manage the OAuth lifecycle, operating alongside the primary GraphQL data endpoint 1:

  

|   |   |   |   |
|---|---|---|---|
|Endpoint Role|URL|HTTP Method|Architectural Purpose|
|Authorization|https://linear.app/oauth/authorize|GET|Renders the visual consent screen to the user and redirects the browser back to the callback URI with an authorization code.|
|Token Exchange|https://api.linear.app/oauth/token|POST|Exchanges a short-lived authorization code (or an existing refresh token) for an active JSON Web Token (JWT) or opaque access token.|
|Revocation|https://api.linear.app/oauth/revoke|POST|Explicitly invalidates an access or refresh token, terminating the current session and forcing the user to re-authenticate.1|

#### Authorization Endpoint Parameters

To initiate the OAuth flow, the CLI must construct a heavily parameterized URI targeting the Authorization endpoint. The following parameters dictate the behavior of the authentication session 1:

- client_id (Required): The public identifier of the OAuth application, retrieved from the Linear Developer Console.
    
- redirect_uri (Required): The callback URL. This string must exactly match a registered URI in the Linear developer console to prevent open redirector vulnerabilities.
    
- response_type (Required): Must be explicitly set to code to trigger the Authorization Code flow.
    
- scope (Required): A comma-separated list of required permissions (e.g., read,issues:create).
    
- state (Recommended but practically mandatory): A cryptographically random string generated by the CLI to prevent CSRF attacks. It ensures the response corresponds to the request initiated by the local application.
    
- prompt (Optional): Setting this to consent forces the authorization screen to appear even if permissions were previously granted. This is structurally vital if developers using pi-linear-tools need the opportunity to connect multiple workspaces.1
    
- code_challenge (Required for PKCE): The cryptographic hash of the generated code verifier string.
    
- code_challenge_method (Required for PKCE): Must be set to S256 to denote SHA-256 hashing.
    

#### Token Endpoint Parameters

Upon receiving the code from the browser callback, the CLI must execute a server-to-server POST request to the Token endpoint with the Content-Type header set to application/x-www-form-urlencoded.1

- grant_type (Required): Set to authorization_code.
    
- code (Required): The authorization code extracted from the callback query parameters.
    
- redirect_uri (Required): Must identically match the URI used in the initial authorization step.
    
- client_id (Required): The public application identifier.
    
- code_verifier (Required for PKCE): The original random string used to generate the code_challenge. The authorization server will hash this string and compare it to the original challenge.
    

Conflict Resolution regarding client_secret: An analysis of the documentation reveals a structural contradiction. Linear's general OAuth documentation states that the /token endpoint strictly requires the client_secret parameter.1 However, within the subsection specifically detailing PKCE, the documentation explicitly marks client_secret as "optional".1 Furthermore, RFC 7636 and industry best practices for public clients explicitly forbid the embedding of client secrets in distributed binaries because they cannot be kept confidential.3 Recommendation: The pi-linear-tools CLI must definitively omit the client_secret parameter when submitting the POST request to the /token endpoint. Trust the specific PKCE documentation and the IETF standards over the generalized endpoint documentation.

### 2.3 Scope Model and Permission Behavior

Linear relies on a granular scope model. Security best practices, particularly for command-line utilities that have access to a developer's local filesystem and environment, dictate that an application must request the absolute minimum permissions required to perform its functions.25

  

|   |   |   |
|---|---|---|
|Scope String|Permission Level|Implication for CLI Integration|
|read|Default. Read-only access to the workspace.|This scope is always included implicitly by Linear. It is sufficient for read-only reporting and query tools.1|
|write|Broad write access to all user resources.|Overly permissive. This should be avoided unless the CLI performs highly varied structural changes across the entire workspace architecture.1|
|issues:create|Targeted issue creation.|Optimal for CLIs designed to generate tickets dynamically from terminal errors, bash outputs, or Git commits.|
|comments:create|Targeted comment creation.|Optimal for appending continuous integration logs or deployment statuses to existing issues.|
|admin|Full administrative workspace access.|Extremely dangerous. Must never be requested by a standard developer CLI under any circumstances.1|

If the CLI attempts to execute a GraphQL mutation (e.g., issueCreate) without having requested and been granted the corresponding scope, Linear's API will respond differently than standard REST APIs. Rather than returning a blunt HTTP 403 Forbidden, the GraphQL endpoint often returns an HTTP 200 OK status, but the response body will contain an errors array detailing the authorization failure at the specific field level.7 The CLI must be engineered to inspect the GraphQL response payload for errors, regardless of the HTTP status code.

### 2.4 Access Token Lifecycle and the 2025 Mandate

A major shift in Linear's OAuth architecture occurred in late 2025, heavily impacting the design of new integrations. Applications created prior to October 1, 2025, operated on a static token model where an access token possessed a pseudo-permanent 10-year lifespan (expires_in: 315705599).12

For all applications created after October 1, 2025, refresh tokens are mandatorily enabled for user-initiated OAuth flows, with no configuration option to disable them.1 The updated JSON response payload enforces a strict 24-hour lifespan for access tokens (expires_in: 86399).12 Older applications are subjected to a forced migration deadline of April 1, 2026. Therefore, pi-linear-tools must be built assuming the modern refresh token lifecycle from day one.

#### Token Response Payload

A successful token exchange yields the following confirmed JSON structure for applications under the modern refresh token paradigm 12:

  

JSON

  
  

{  
  "access_token": "00a21d8b0c4e2375...",  
  "token_type": "Bearer",  
  "expires_in": 86399,  
  "scope": "read write",  
  "refresh_token": "sz0c8ffy95zj2ff6..."  
}  
  

#### Refresh Token Rotation and Invalidation

Linear employs a strict "Refresh Token Rotation" security policy. When the CLI utilizes a refresh token to obtain a new access token, the Linear API returns both a new access token and a new refresh token.13

Simultaneously, the previously used refresh token is permanently invalidated. If the CLI attempts to use an invalidated refresh token—a highly common occurrence during race conditions, multi-process concurrency, or aggressive network retries—the Linear API will immediately reject the request with an HTTP 400 Bad Request and an invalid_grant payload 13:

  

JSON

  
  

{  
  "error": "invalid_grant",  
  "error_description": "Token has been expired or revoked."  
}  
  

This aggressive invalidation behavior necessitates sophisticated local state management within the CLI to ensure that tokens are atomically updated in the local credential store immediately upon receipt, and that overlapping refresh requests are blocked.13

### 2.5 Multi-Workspace Topology and App Actors

Linear operates on a multi-tenant organizational model where a single user account (e.g., authenticated via a specific Google Workspace email) can belong to multiple completely isolated workspaces. Each workspace maintains distinct billing, member lists, and data silos.18

An OAuth token is intrinsically bound to a single workspace. When an authorization flow is triggered, the user is prompted to select which workspace the application will be granted access to.33 If a developer using pi-linear-tools wishes to interact with two different workspaces, the CLI must maintain separate token pairs for each workspace context. To facilitate switching workspaces, the CLI must trigger a new OAuth flow using the prompt=consent parameter. Without this parameter, Linear may bypass the consent screen and automatically return a token for the previously authorized workspace, trapping the user in the wrong context.1

Linear also offers an "OAuth Actor Authorization" mode. By appending actor=app to the authorization URL, actions performed with the resulting token will appear to come from the application itself (e.g., "pi-linear-tools via Application") rather than the specific authorizing user.23 This is useful for shared CI/CD pipelines but generally discouraged for local developer tools where audit logs should reflect the actual human developer taking action. For local development, actor should default to the user.

## 3. Recommended OAuth Flow for pi-linear-tools

Given the architectural constraints of a terminal-based application, the implementation must fluidly orchestrate communication between the terminal emulator context, the operating system's default web browser, and the remote Linear authorization servers.

### 3.1 Redirect URI Strategy: Ephemeral Localhost Server vs Device Code Flow

In traditional CLI environments, the OAuth 2.0 Device Authorization Grant (RFC 8628)—often referred to as the Device Flow—is the preferred methodology. It avoids network bindings entirely by presenting the user with a short code (e.g., ABCD-EFGH) to enter on a secondary device or browser window, while the CLI polls an authorization server.5

Conflict Resolution regarding Device Flow: While user forums indicate a strong desire for Device Flow integration 35, an explicit conflict resolution reveals that Linear does not officially document or support a /devicecode endpoint.1 Consequently, attempting to implement the Device Flow will result in immediate failure.

The only reliable architecture is the Ephemeral Localhost Callback. The CLI must momentarily instantiate a lightweight HTTP server bound to the local loopback interface (127.0.0.1) to catch the HTTP GET request redirected by the browser post-authorization.1

Port Registration Constraints: Linear's OAuth console enforces exact URI string matching for security purposes. While RFC 8252 suggests Authorization Servers should allow any random ephemeral port on the loopback interface (to prevent port binding failures) 9, Linear has not implemented support for wildcard ports (http://localhost:*).6 Therefore, the application must register a specific, hardcoded port (e.g., http://localhost:3000/oauth/callback) within the Linear Developer Console, and the CLI must aggressively attempt to bind to this exact port.10

To mitigate port conflicts (e.g., if the user happens to be running a React dev server on port 3000), it is highly recommended to register three specific URIs in the Linear console:

1. http://localhost:42069/oauth/callback
    
2. http://localhost:42070/oauth/callback
    
3. http://localhost:42071/oauth/callback
    

The CLI will then iterate through these ports until it finds an open socket to bind the ephemeral server.

### 3.2 Step-by-Step Sequence Flow

The operational sequence for pi-linear-tools must proceed deterministically as follows:

1. Invocation: The user executes a command requiring authentication (e.g., pi-linear auth login).
    
2. Cryptographic Initialization: The CLI dynamically generates a high-entropy cryptographic state string, a code_verifier string, and computes the code_challenge via S256 hashing.
    
3. Server Initialization: The CLI boots an ephemeral HTTP server listening strictly on an available, pre-registered localhost port.
    
4. Browser Handoff: The CLI utilizes an OS-level integration package (e.g., open in Node.js) to launch the system's default browser, targeting https://linear.app/oauth/authorize parameterized with the generated cryptographic data.
    
5. User Consent: The user interacts with the Linear web UI, selects the target workspace, and explicitly grants the requested granular permissions.
    
6. Callback Interception: Linear redirects the browser to http://localhost:42069/oauth/callback?code=abc...&state=xyz....
    
7. State Verification: The ephemeral server intercepts the incoming request, verifies that the state query parameter perfectly matches the one generated in step 2 (aborting if mismatched), and extracts the authorization code.
    
8. Token Exchange: The CLI executes a server-to-server HTTP POST to Linear's /token endpoint, supplying the code and the code_verifier.
    
9. Storage & Teardown: Upon receiving the JSON payload containing the tokens, the CLI stores them securely in the OS hardware-backed keychain, renders a static HTML success page to the browser ("Authentication complete. You may safely close this window."), and gracefully shuts down the ephemeral HTTP server.
    
10. Resumption: The CLI resumes standard execution in the terminal, capable of executing GraphQL queries.
    

### 3.3 State Transitions and Lifecycle Events

- First Auth: Executes the full sequence above. If no tokens exist in the local store, the CLI forces the user through this pathway.
    
- Token Expiry (Silent Re-auth): When a GraphQL API call returns a 401 Unauthorized status (or specific GraphQL authorization error), the CLI must automatically and silently intercept the failure. It extracts the refresh token from secure storage, negotiates a new token pair via the /token endpoint, securely updates the keychain, and recursively retries the original API call. The user remains completely unaware of this background rotation.
    
- Revocation / Invalid Grant: If the refresh token has expired (exceeding its offline lifecycle), or if the user manually revoked the application in their Linear Workspace settings 13, the API will return an invalid_grant error. The CLI must interpret this explicitly, purge the local keychain credentials to prevent infinite refresh loops, and prompt the user in the terminal: "Session expired or revoked. Please run pi-linear auth login to re-authenticate.".13
    

## 4. Security & Compliance Considerations

As a distributed binary, the CLI operates in a host environment that is entirely beyond the developer's administrative control. The architecture must anticipate token theft via local malware, local network interception, and reverse engineering.

### 4.1 Secret Handling and Storage Best Practices

Storing authentication tokens in plaintext configuration files (such as ~/.pi-linear-tools/config.json) poses a severe, unacceptable security risk. Malware or malicious npm packages installed on the developer's machine can easily scrape these files.38

For a production-ready Node.js CLI, the application must interface directly with the operating system's native secure credential management infrastructure.14 It is highly recommended to use native abstraction libraries (such as keytar, or its modern actively-maintained replacements in 2026 like system-keychain or node-keytar) to route credentials securely. This delegates encryption to hardware-backed or OS-level systems:

- macOS: Keychain Access.
    
- Windows: Credential Manager API.
    
- Linux: Secret Service API / GNOME Keyring / KWallet.
    

#### Continuous Integration (CI) Fallbacks

If the CLI is intended to be executed in headless Continuous Integration environments (e.g., GitHub Actions, GitLab CI), an OS keychain will typically be unavailable or lack the necessary display servers (DBus) to function. In this specific context, the application should fallback to reading a token directly from an environment variable injected by the CI secrets manager (LINEAR_API_TOKEN). Alternatively, if state must be persisted across CI steps, the CLI must encrypt the payload using AES-256-GCM, utilizing an encryption key sourced from a securely injected environment variable, and write the file with strict chmod 600 permissions.14

### 4.2 PKCE Cryptography Details

The Proof Key for Code Exchange (PKCE) flow mitigates Authorization Code Interception Attacks.2 If a malicious local application binds to the callback port milliseconds before the CLI, or registers as the default handler for a custom URL scheme, it could steal the code returned by the browser.

However, because the code alone is insufficient, and the attacker does not possess the high-entropy code_verifier (which remains isolated purely within the legitimate CLI's process memory), the stolen code is mathematically useless and the token exchange will be rejected by Linear.2

The standard defines the cryptographic transformation using LaTeX notation as:

![](data:image/png;base64,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)

The code_verifier must be a high-entropy cryptographically random string between 43 and 128 characters in length, containing only alphanumeric characters and the symbols -, ., _, ~.

### 4.3 CSRF and State Handling

The state parameter prevents Cross-Site Request Forgery (CSRF). An attacker could construct a malicious web page that tricks the user's browser into sending an authorization code (belonging to the attacker's account) to the CLI's ephemeral localhost server.

By generating a cryptographically random state string, storing it in the CLI's memory prior to launching the browser, and asserting that the incoming callback's state parameter perfectly matches, the CLI guarantees that it is processing the specific authentication flow that it initiated.1

### 4.4 Threat Model and Mitigations

  

|   |   |   |
|---|---|---|
|Threat Vector|Description|Mitigation Strategy|
|Auth Code Interception|Malicious local app intercepts the localhost callback URL.|PKCE implementation renders the code useless without the locally held, in-memory code_verifier.2|
|CSRF Injection|Attacker forces a login to a different, potentially malicious account.|Strict validation of the high-entropy state parameter generated per-session.1|
|Refresh Token Race Condition|Concurrent executions of the CLI attempt to refresh tokens simultaneously, invalidating both due to Linear's strict rotation policy.|Implement cross-process or in-process mutex locking during token refresh operations.13|
|Token Extraction / Scraping|Local malware reads CLI configuration files.|Store tokens exclusively in OS-level hardware-backed keychains, entirely avoiding plaintext files.14|
|Rate Limit Exhaustion DoS|A script rapidly invokes the CLI, triggering HTTP 429 responses and locking the user out of the Linear API.|Implement intelligent exponential backoff and rate limit header parsing to throttle execution automatically.19|

## 5. Implementation Blueprint (Node.js/TypeScript)

The following sections provide structural scaffolding and robust TypeScript pseudocode required to build a resilient, compliant OAuth integration within pi-linear-tools.

### 5.1 Architecture Modules

The authentication system should be decoupled into four highly cohesive, loosely coupled modules:

1. TokenStore: An abstraction layer interfacing with the OS keychain to get, set, and delete token payloads securely.
    
2. LocalServerManager: Orchestrates the ephemeral Node.js HTTP server setup, port conflict resolution, and OS browser launch.
    
3. LinearAuthClient: Constructs authorization URLs, handles PKCE cryptographic hashing, and orchestrates the /token and /revoke HTTP calls against the Linear REST API.
    
4. LinearApiClient: Wraps the GraphQL operations, automatically injecting Bearer tokens, evaluating GraphQL errors arrays, and intercepting 401/429 HTTP statuses to trigger transparent refreshes or exponential backoffs.
    

### 5.2 Data Modeling

The token payload must accurately reflect Linear's modern API response structure.12 A strict TypeScript interface ensures compile-time safety.

  

TypeScript

  
  

export interface LinearTokenResponse {  
  access_token: string;  
  token_type: "Bearer";  
  expires_in: number; // 86399 (24 hours) under the modern schema  
  scope: string; // Space separated list, e.g., "read issues:create"  
  refresh_token: string;  
}  
  
export interface TokenRecord {  
  accessToken: string;  
  refreshToken: string;  
  expiresAt: number; // Unix timestamp in milliseconds for reliable expiration checks  
  grantedScopes: string;  
}  
  

### 5.3 TypeScript Implementation Snippets

#### 5.3.1 PKCE Generation and URL Construction

Utilizing the native Node.js crypto module to ensure cryptographically secure entropy, avoiding third-party math libraries which may introduce supply chain vulnerabilities.

  

TypeScript

  
  

import crypto from 'crypto';  
  
export class PkceGenerator {  
  public static generateVerifier(): string {  
    // Generate 32 bytes of entropy, resulting in a 43-character base64url string  
    return crypto.randomBytes(32).toString('base64url');  
  }  
  
  public static generateChallenge(verifier: string): string {  
    return crypto.createHash('sha256').update(verifier).digest('base64url');  
  }  
  
  public static generateState(): string {  
    return crypto.randomBytes(16).toString('hex');  
  }  
}  
  
// Building the Authorization URL  
const clientId = 'YOUR_LINEAR_CLIENT_ID';  
const redirectUri = 'http://localhost:42069/oauth/callback';  
const verifier = PkceGenerator.generateVerifier();  
const challenge = PkceGenerator.generateChallenge(verifier);  
const state = PkceGenerator.generateState();  
  
const authUrl = new URL('https://linear.app/oauth/authorize');  
authUrl.searchParams.append('client_id', clientId);  
authUrl.searchParams.append('redirect_uri', redirectUri);  
authUrl.searchParams.append('response_type', 'code');  
authUrl.searchParams.append('scope', 'read,issues:create');  
authUrl.searchParams.append('state', state);  
authUrl.searchParams.append('code_challenge', challenge);  
authUrl.searchParams.append('code_challenge_method', 'S256');  
authUrl.searchParams.append('prompt', 'consent'); // Enforce workspace selection  
  

#### 5.3.2 Ephemeral Callback Server and Token Exchange

This module instantiates the local server, intercepts the browser callback, extracts the code, and communicates with Linear's token endpoint. Using the native http module avoids bringing in heavy dependencies like Express just for a single route.

  

TypeScript

  
  

import http from 'http';  
import url from 'url';  
  
export async function captureAuthorizationCode(expectedState: string, port: number): Promise<string> {  
  return new Promise((resolve, reject) => {  
    const server = http.createServer((req, res) => {  
      if (!req.url) return;  
      const parsedUrl = url.parse(req.url, true);  
  
      if (parsedUrl.pathname === '/oauth/callback') {  
        const { code, state, error } = parsedUrl.query;  
  
        if (error) {  
          res.writeHead(400, { 'Content-Type': 'text/html' });  
          res.end(`<h1>Authentication Failed</h1><p>Linear returned error: ${error}</p>`);  
          server.close();  
          return reject(new Error(`OAuth Error: ${error}`));  
        }  
  
        if (state!== expectedState) {  
          res.writeHead(400, { 'Content-Type': 'text/html' });  
          res.end(`<h1>Security Error</h1><p>State mismatch. CSRF attempt detected.</p>`);  
          server.close();  
          return reject(new Error('State validation failed. CSRF aborted.'));  
        }  
  
        res.writeHead(200, { 'Content-Type': 'text/html' });  
        res.end(`<h1>Success!</h1><p>Authentication complete. You may safely close this window and return to your terminal.</p>`);  
        server.close();  
        resolve(code as string);  
      }  
    });  
  
    server.listen(port, () => {  
      // Server is active on 127.0.0.1, safe to open the browser via 'open' package  
    });  
  
    server.on('error', (e) => {  
      reject(new Error(`Failed to bind to port ${port}: ${e.message}`));  
    });  
  });  
}  
  
// Exchanging the code for a token (Notice: client_secret is definitively omitted for PKCE)  
export async function exchangeCodeForToken(code: string, verifier: string, port: number): Promise<LinearTokenResponse> {  
  const body = new URLSearchParams({  
    grant_type: 'authorization_code',  
    code: code,  
    redirect_uri: `http://localhost:${port}/oauth/callback`,  
    client_id: 'YOUR_LINEAR_CLIENT_ID',  
    code_verifier: verifier  
  });  
  
  const response = await fetch('https://api.linear.app/oauth/token', {  
    method: 'POST',  
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },  
    body: body.toString()  
  });  
  
  if (!response.ok) {  
    const errPayload = await response.json().catch(() => ({ error_description: response.statusText }));  
    throw new Error(`Token exchange failed: ${errPayload.error_description}`);  
  }  
  
  return response.json();  
}  
  

#### 5.3.3 Injecting the Bearer Token, GraphQL Execution, and Handling Refresh

The CLI must wrap all Linear GraphQL calls to transparently manage token expiration and rate limits. Because Linear aggressively rotates refresh tokens, concurrent API calls that trigger a refresh could cause a race condition, leading to an immediate invalid_grant.13 Implementing an in-memory Promise mutex lock resolves this structural issue.

  

TypeScript

  
  

let isRefreshing = false;  
let refreshPromise: Promise<string> | null = null;  
  
export async function linearGraphQLClient(query: string, variables: any = {}) {  
  let tokenRecord = await TokenStore.getRecord();  
  
  // Proactive refresh if token is expired (or expires within 60 seconds)  
  if (Date.now() >= tokenRecord.expiresAt - 60000) {  
    tokenRecord.accessToken = await secureRefreshTokens(tokenRecord.refreshToken);  
  }  
  
  const executeFetch = async (token: string) => {  
    return fetch('https://api.linear.app/graphql', {  
      method: 'POST',  
      headers: {  
        'Content-Type': 'application/json',  
        'Authorization': `Bearer ${token}`  
      },  
      body: JSON.stringify({ query, variables })  
    });  
  };  
  
  let response = await executeFetch(tokenRecord.accessToken);  
  
  // Reactive refresh handling if proactive check missed it or Linear revoked early  
  if (response.status === 401) {  
    const newAccessToken = await secureRefreshTokens(tokenRecord.refreshToken);  
    response = await executeFetch(newAccessToken); // Retry original request seamlessly  
  }  
   
  // Rate Limit Backoff Interceptor  
  if (response.status === 429) {  
    const retryAfter = response.headers.get('Retry-After');  
    // Implement standard exponential backoff or honor Retry-After header  
    throw new Error(`Rate limit exceeded. Retry after ${retryAfter |  
  
| '60'} seconds.`);  
  }  
  
  const jsonPayload = await response.json();  
   
  // GraphQL distinct error handling (200 OK HTTP, but logical payload errors)  
  if (jsonPayload.errors && jsonPayload.errors.length > 0) {  
      throw new Error(`GraphQL Error: ${jsonPayload.errors.message}`);  
  }  
  
  return jsonPayload.data;  
}  
  
// Single-flight refresh token logic to prevent Linear invalid_grant race conditions  
async function secureRefreshTokens(currentRefreshToken: string): Promise<string> {  
  // If a refresh is already in progress by another parallel CLI function, wait for it  
  if (isRefreshing && refreshPromise) {  
    return refreshPromise;  
  }  
  
  isRefreshing = true;  
  refreshPromise = (async () => {  
    try {  
      const body = new URLSearchParams({  
        grant_type: 'refresh_token',  
        refresh_token: currentRefreshToken,  
        client_id: 'YOUR_LINEAR_CLIENT_ID'  
      });  
  
      const res = await fetch('https://api.linear.app/oauth/token', {  
        method: 'POST',  
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },  
        body: body.toString()  
      });  
  
      if (!res.ok) {  
        const errorData = await res.json();  
        // Crucial: Handle revoked/invalid refresh tokens explicitly  
        if (errorData.error === 'invalid_grant') {  
          await TokenStore.clear(); // Purge corrupted tokens from OS Keychain  
          throw new Error("Session expired or revoked by user. Please run 'pi-linear auth login'.");  
        }  
        throw new Error("Failed to refresh token via API.");  
      }  
  
      const newTokens: LinearTokenResponse = await res.json();  
      await TokenStore.save({  
        accessToken: newTokens.access_token,  
        refreshToken: newTokens.refresh_token,  
        expiresAt: Date.now() + (newTokens.expires_in * 1000)  
      });  
  
      return newTokens.access_token;  
    } finally {  
      isRefreshing = false;  
      refreshPromise = null;  
    }  
  })();  
  
  return refreshPromise;  
}  
  

## 6. Testing Strategy

Ensuring the stability and security of a localized OAuth integration demands rigorous testing methodologies spanning unit, integration, and manual execution layers. A broken auth flow renders the entire CLI completely unusable.

### 6.1 Unit and Integration Tests

- Cryptography Mocking: Utilize a testing framework (e.g., Jest) to mock the Node crypto module. Assert that PKCE methods produce expected, deterministically encoded strings (e.g., verifying code_challenge_method=S256 logic correctly transforms specific test vectors).
    
- Network Mocking: Utilize libraries such as msw (Mock Service Worker) or nock to intercept and mock calls to https://api.linear.app/oauth/token. This allows the test suite to rapidly simulate JSON responses for successful exchanges, simulate invalid_grant errors, and assert that the CLI correctly parses HTTP 429 rate limit headers.
    
- Concurrency Verification: Write asynchronous Jest tests that fire multiple simultaneous API requests using a mocked expired token. Assert that the fetch stub for the /oauth/token refresh endpoint is invoked precisely once, thereby validating the critical single-flight mutex lock designed to prevent race conditions.
    

### 6.2 Manual Verification Checklist

Real-world sandbox testing against an isolated Linear workspace is crucial because network latency, OS-level firewall restrictions, and actual browser behavior cannot be perfectly mocked.

1. Happy Path Execution: Execute pi-linear auth login, grant access in the browser, verify token storage in the OS keychain, and successfully run a read-only GraphQL query (e.g., fetching the current workspace name).7
    
2. Clock Skew & Refresh Simulation: Manually edit the stored expiresAt timestamp in the local OS keychain to simulate an immediate expiration. Run a standard CLI command and verify via network logs that the CLI seamlessly negotiates a refresh cycle in the background before executing the requested command.
    
3. Invalidation & Revocation Path: Navigate to Linear's web UI (Settings > Security & Access) and manually revoke the OAuth application's access. Return to the terminal and run a CLI command. Verify that the CLI gracefully catches the resulting invalid_grant exception, successfully deletes local credentials to prevent a refresh loop, and prints a user-friendly re-authentication prompt.
    
4. Port Conflict Resilience: Before initiating login, manually start a Python HTTP server on the primary callback port (e.g., python3 -m http.server 42069). Run pi-linear auth login. Verify the CLI identifies the EADDRINUSE error and successfully falls back to an alternate registered port (e.g., 42070).
    

## 7. High-Level Implementation Plan

The integration of the OAuth module into pi-linear-tools should be structured across five sequential phases to ensure stability, mitigate security regressions, and provide clear deliverable milestones.

- Phase 1: Research Validation and Configuration Design
    

- Objectives: Register the application in the Linear Developer Console. Configure the required http://localhost:port/oauth/callback redirect URIs. Define the exact required GraphQL scopes based on the CLI's intended functional scope.
    
- Deliverables: Linear OAuth Client ID, finalized architectural design document.
    
- Risks: Over-scoping permissions, leading to excessive security exposure and user hesitancy during the consent flow.
    

- Phase 2: Core OAuth Lifecycle Implementation
    

- Objectives: Implement the Ephemeral Server binding, PKCE cryptographic generation, browser handoff (open package), and the fundamental token exchange logic.
    
- Deliverables: A functionally viable linear auth login command that successfully retrieves a LinearTokenResponse.
    

- Phase 3: Token Persistence & Secure Refresh Mechanisms
    

- Objectives: Integrate the OS keychain abstraction layer. Implement the proactive/reactive token refresh logic, ensuring the single-flight mutex locking is rigorously applied to handle Linear's rotation policies.
    
- Deliverables: Persistent authenticated sessions across terminal restarts without requiring repetitive browser logins.
    
- Dependencies: Selection and security auditing of an active Node.js keychain library.
    

- Phase 4: API Integration and Error Handling
    

- Objectives: Wrap the fetch client to automatically inject the Bearer token into GraphQL queries. Implement rate limit interceptors, exponential backoff, and GraphQL-specific error payload handling.
    
- Deliverables: Fully authenticated CLI commands capable of seamlessly reading/writing to the Linear workspace.
    

- Phase 5: Automated Testing, Documentation, and Hardening
    

- Objectives: Write comprehensive Jest test suites covering network failures and concurrency. Document the login architecture and token storage locations for internal maintainers. Execute the manual verification checklist across macOS, Windows, and Linux.
    
- Risks: Platform-specific discrepancies in how Windows/macOS/Linux handle localhost routing, firewalls, or keychain permissions may require late-stage polyfills.
    

## 8. Open Questions / Unknowns

Before finalizing the integration architecture, the development team must address the following outstanding platform constraints:

1. Strict Validation of Wildcard Port Support: The official Linear documentation does not explicitly confirm or deny support for RFC 8252 wildcard localhost ports (e.g., http://localhost:*).9 If multiple developers attempt to run the CLI simultaneously on shared infrastructure, or if ports are heavily contested, fixed-port binding will cause collisions. Experimental testing against the production Linear OAuth configuration is required to validate if wildcard matching is silently accepted.
    
2. Linux Keychain Fragmentation: While macOS and Windows provide highly reliable secure storage APIs, Linux environments rely on DBus and gnome-keyring or kwallet, which are notoriously fragmented and often fail in headless or SSH environments. A robust fallback strategy (e.g., encrypted dotfiles) must be engineered and exhaustively tested for Linux distributions to prevent silent authentication failures.
    
3. App Actor Contexts in CLI Usage: The actor=app authorization model was recently updated.23 If pi-linear-tools intends to support server-to-server automated operations without a user context in the future, the differences in data access between standard member tokens and app actor tokens must be modeled carefully to prevent permission drift or missing audit trails.

## 9. Source Index

The findings, architectural recommendations, and conflict resolutions in this report are strictly derived from the following index of official documentation, Request for Comments (RFC) standards, and validated engineering analyses:

1. Linear API and Webhooks Overview - https://linear.app/docs/api-and-webhooks [Official]
    
2. Linear Developer Portal: GraphQL API & TypeScript SDK - https://linear.app/developers [Official]
    
3. Linear OAuth 2.0 Authentication Documentation - https://linear.app/developers/oauth-2-0-authentication [Official]
    
4. Linear OAuth Actor Authorization Documentation - https://linear.app/developers/oauth-actor-authorization [Official]
    
5. Linear API Rate Limiting Specifications - https://linear.app/developers/rate-limiting [Official]
    
6. Linear Workspace Settings and Multi-Workspace Architecture - https://linear.app/docs/workspaces [Official]
    
7. Linear GraphQL Error Formatting - https://linear.app/developers/graphql [Official]
    
8. IETF RFC 7636: Proof Key for Code Exchange by OAuth Public Clients.
    
9. IETF RFC 8252: OAuth 2.0 for Native Apps (Localhost Port Specifications).
    
10. IETF RFC 8628: OAuth 2.0 Device Authorization Grant.
    
11. Nango Developer Blog: Analysis of Linear OAuth Refresh Token Invalid Grants - https://nango.dev/blog/linear-oauth-refresh-token-invalid-grant/
    
12. Node.js Security Best Practices: Credential Storage in CLI Applications - https://nodejs.org/en/learn/getting-started/security-best-practices
    
13. GitHub Discussions: Secure Token Storage Best Practices for CLI Tools - https://github.com/cli/cli/discussions/12488
    
14. Microsoft Entra Documentation: Reply URL limitations and localhost port binding - https://learn.microsoft.com/en-us/entra/identity-platform/reply-url
    

#### Works cited

1. OAuth 2.0 authentication – Linear Developers, accessed February 25, 2026, [https://linear.app/developers/oauth-2-0-authentication](https://linear.app/developers/oauth-2-0-authentication)
    
2. PKCE support for LINE Login - LINE Developers, accessed February 25, 2026, [https://developers.line.biz/en/docs/line-login/integrate-pkce/](https://developers.line.biz/en/docs/line-login/integrate-pkce/)
    
3. OAuth 2.0: Implicit Flow is Dead, Try PKCE Instead | Postman Blog, accessed February 25, 2026, [https://blog.postman.com/pkce-oauth-how-to/](https://blog.postman.com/pkce-oauth-how-to/)
    
4. Implement the OAuth 2.0 Authorization Code with PKCE Flow | Okta Developer, accessed February 25, 2026, [https://developer.okta.com/blog/2019/08/22/okta-authjs-pkce](https://developer.okta.com/blog/2019/08/22/okta-authjs-pkce)
    
5. Microsoft identity platform and the OAuth 2.0 device authorization grant flow, accessed February 25, 2026, [https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code)
    
6. Configuring a custom port for the 'localhost' redirect URL in Google OAuth 2.0, accessed February 25, 2026, [https://stackoverflow.com/questions/23618245/configuring-a-custom-port-for-the-localhost-redirect-url-in-google-oauth-2-0](https://stackoverflow.com/questions/23618245/configuring-a-custom-port-for-the-localhost-redirect-url-in-google-oauth-2-0)
    
7. Getting started – Linear Developers, accessed February 25, 2026, [https://linear.app/developers/graphql](https://linear.app/developers/graphql)
    
8. Redirect URI (reply URL) best practices and limitations - Microsoft identity platform, accessed February 25, 2026, [https://learn.microsoft.com/en-us/entra/identity-platform/reply-url](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url)
    
9. Allow Wildcard port in Redirect URI as per RFC 8252 - Auth0 Community, accessed February 25, 2026, [https://community.auth0.com/t/allow-wildcard-port-in-redirect-uri-as-per-rfc-8252/98409](https://community.auth0.com/t/allow-wildcard-port-in-redirect-uri-as-per-rfc-8252/98409)
    
10. Linear OAuth2 API fails with 503 error - Questions - n8n Community, accessed February 25, 2026, [https://community.n8n.io/t/linear-oauth2-api-fails-with-503-error/135227](https://community.n8n.io/t/linear-oauth2-api-fails-with-503-error/135227)
    
11. Can the redirect_uri contain port number? - Stack Apps, accessed February 25, 2026, [https://stackapps.com/questions/4596/can-the-redirect-uri-contain-port-number](https://stackapps.com/questions/4596/can-the-redirect-uri-contain-port-number)
    
12. OAuth 2.0 authentication – Linear Developers, accessed February 25, 2026, [https://linear.app/developers/oauth-2-0-authentication#exchange-code-for-an-access-token](https://linear.app/developers/oauth-2-0-authentication#exchange-code-for-an-access-token)
    
13. Linear OAuth refresh token invalid_grant — What it means & how to fix it | Nango Blog, accessed February 25, 2026, [https://nango.dev/blog/linear-oauth-refresh-token-invalid-grant](https://nango.dev/blog/linear-oauth-refresh-token-invalid-grant)
    
14. Best practices for storing API tokens in CLI tools? · cli cli · Discussion #12488 - GitHub, accessed February 25, 2026, [https://github.com/cli/cli/discussions/12488](https://github.com/cli/cli/discussions/12488)
    
15. Securely store data in a Node CLI app - javascript - Stack Overflow, accessed February 25, 2026, [https://stackoverflow.com/questions/35283148/securely-store-data-in-a-node-cli-app](https://stackoverflow.com/questions/35283148/securely-store-data-in-a-node-cli-app)
    
16. Scopes | Authentication (OAuth) - Autodesk Platform Services, accessed February 25, 2026, [https://aps.autodesk.com/en/docs/oauth/v2/developers_guide/scopes](https://aps.autodesk.com/en/docs/oauth/v2/developers_guide/scopes)
    
17. [BUG] Oauth2 with linear.app is broken · Issue #259 · slackapi/deno-slack-sdk - GitHub, accessed February 25, 2026, [https://github.com/slackapi/deno-slack-sdk/issues/259](https://github.com/slackapi/deno-slack-sdk/issues/259)
    
18. Workspaces – Linear Docs, accessed February 25, 2026, [https://linear.app/docs/workspaces](https://linear.app/docs/workspaces)
    
19. Rate limiting – Linear Developers, accessed February 25, 2026, [https://linear.app/developers/rate-limiting](https://linear.app/developers/rate-limiting)
    
20. linear-common-errors - claude-code-plugins-plus-skills - playbooks, accessed February 25, 2026, [https://playbooks.com/skills/jeremylongshore/claude-code-plugins-plus-skills/linear-common-errors](https://playbooks.com/skills/jeremylongshore/claude-code-plugins-plus-skills/linear-common-errors)
    
21. Linear API Essential Guide - Rollout, accessed February 25, 2026, [https://rollout.com/integration-guides/linear/api-essentials](https://rollout.com/integration-guides/linear/api-essentials)
    
22. Linear Developers, accessed February 25, 2026, [https://linear.app/developers](https://linear.app/developers)
    
23. OAuth actor authorization – Linear Developers, accessed February 25, 2026, [https://linear.app/developers/oauth-actor-authorization](https://linear.app/developers/oauth-actor-authorization)
    
24. OAuth2 with CAS 6.1.4: is a client secret needed for PKCE authorization_code grant type?, accessed February 25, 2026, [https://stackoverflow.com/questions/60529635/oauth2-with-cas-6-1-4-is-a-client-secret-needed-for-pkce-authorization-code-gra](https://stackoverflow.com/questions/60529635/oauth2-with-cas-6-1-4-is-a-client-secret-needed-for-pkce-authorization-code-gra)
    
25. OAuth Scopes Best Practices | Curity, accessed February 25, 2026, [https://curity.io/resources/learn/scope-best-practices/](https://curity.io/resources/learn/scope-best-practices/)
    
26. Best Practices - OAuth for Mobile Apps - Curity, accessed February 25, 2026, [https://curity.io/resources/learn/oauth-for-mobile-apps-best-practices/](https://curity.io/resources/learn/oauth-for-mobile-apps-best-practices/)
    
27. API and Webhooks – Linear Docs, accessed February 25, 2026, [https://linear.app/docs/api-and-webhooks](https://linear.app/docs/api-and-webhooks)
    
28. Linear Common Errors | Claude Code Skill for API Debugging - MCP Market, accessed February 25, 2026, [https://mcpmarket.com/tools/skills/linear-api-error-resolver](https://mcpmarket.com/tools/skills/linear-api-error-resolver)
    
29. Access Token Response - OAuth 2.0 Simplified, accessed February 25, 2026, [https://www.oauth.com/oauth2-servers/access-tokens/access-token-response/](https://www.oauth.com/oauth2-servers/access-tokens/access-token-response/)
    
30. Refresh Token Rotation - Auth0 Docs, accessed February 25, 2026, [https://auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation](https://auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation)
    
31. Consider removing or extending refresh token expiration for OAuth apps · Issue #107873 · getsentry/sentry - GitHub, accessed February 25, 2026, [https://github.com/getsentry/sentry/issues/107873](https://github.com/getsentry/sentry/issues/107873)
    
32. Login methods – Linear Docs, accessed February 25, 2026, [https://linear.app/docs/login-methods](https://linear.app/docs/login-methods)
    
33. Configure Linear - Ona Documentation, accessed February 25, 2026, [https://ona.com/docs/ona/configure-linear](https://ona.com/docs/ona/configure-linear)
    
34. OAuth 2.0 Device Flow Explained - Curity, accessed February 25, 2026, [https://curity.io/resources/learn/oauth-device-flow/](https://curity.io/resources/learn/oauth-device-flow/)
    
35. Setting up OAuth 2.0 user-agent Flow manually for Linear - APIs - Bubble Forum, accessed February 25, 2026, [https://forum.bubble.io/t/setting-up-oauth-2-0-user-agent-flow-manually-for-linear/332440](https://forum.bubble.io/t/setting-up-oauth-2-0-user-agent-flow-manually-for-linear/332440)
    
36. Device code oauth flow : r/googlecloud - Reddit, accessed February 25, 2026, [https://www.reddit.com/r/googlecloud/comments/1n8net3/device_code_oauth_flow/](https://www.reddit.com/r/googlecloud/comments/1n8net3/device_code_oauth_flow/)
    
37. Allowed OAuth 2.0 Redirect URIs for Native App - Stack Overflow, accessed February 25, 2026, [https://stackoverflow.com/questions/69380049/allowed-oauth-2-0-redirect-uris-for-native-app](https://stackoverflow.com/questions/69380049/allowed-oauth-2-0-redirect-uris-for-native-app)
    
38. security-collab-space/docs/npm-security-best-practices.md at main - GitHub, accessed February 25, 2026, [https://github.com/openjs-foundation/security-collab-space/blob/main/docs/npm-security-best-practices.md](https://github.com/openjs-foundation/security-collab-space/blob/main/docs/npm-security-best-practices.md)
    
39. The largest Node.js CLI Apps best practices list - GitHub, accessed February 25, 2026, [https://github.com/lirantal/nodejs-cli-apps-best-practices](https://github.com/lirantal/nodejs-cli-apps-best-practices)
    
40. Node.js Security Best Practices for 2026 | by Sparkle Web - Medium, accessed February 25, 2026, [https://medium.com/@sparklewebhelp/node-js-security-best-practices-for-2026-3b27fb1e8160](https://medium.com/@sparklewebhelp/node-js-security-best-practices-for-2026-3b27fb1e8160)
    
41. How to find workspace name? - Stack Overflow, accessed February 25, 2026, [https://stackoverflow.com/questions/57811140/how-to-find-workspace-name](https://stackoverflow.com/questions/57811140/how-to-find-workspace-name)
    
