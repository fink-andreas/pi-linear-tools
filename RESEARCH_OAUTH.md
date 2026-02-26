# Linear OAuth Research (INN-239)

This document summarizes the required implementation details for OAuth in `pi-linear-tools`, extracted from `OAUTH.md`.

## Objective
Implement secure OAuth 2.0 authentication for a distributed CLI tool that connects to Linear on behalf of a user.

use the repo https://github.com/cline/linear-mcp as a reference - it implements the oauth flow already (clone into temp dir and find the oauth implementation to use it as reference ).

## Key findings (from `OAUTH.md`)

1. **Use OAuth 2.0 Authorization Code + PKCE (S256)**
   - CLI is a **public client**.
   - Do **not** rely on embedded `client_secret` in distributed binaries.
   - Required PKCE params: `code_challenge`, `code_challenge_method=S256`, `code_verifier`.

2. **Use localhost callback server for auth handoff**
   - Linear flow is browser-based.
   - CLI should spin up temporary localhost HTTP callback server and open the auth URL in the default browser.
   - Register fixed callback URIs in Linear app settings and try multiple fallback ports.
   - For the CLI users via SSH, that have no browser on the host running the extension, print an URL for the handoff to the other host with a browser. Await a localhost URL as response that will be pasted by the user into an input field.

3. **Token lifecycle is short-lived + refresh required**
   - Modern Linear OAuth apps return access tokens with ~24h expiry.
   - Refresh tokens are returned and must be used for silent renewal.
   - Refresh token rotation applies: each refresh invalidates prior refresh token.

4. **Handle refresh race conditions safely**
   - Multiple concurrent refresh attempts can invalidate tokens.
   - Implement single-flight/lock around refresh logic.
   - Persist newly returned token pair atomically.

5. **Secure token storage is mandatory**
   - Avoid plaintext token files for production usage.
   - Use OS keychain/credential manager abstraction where possible.
   - For CI/headless mode, support environment variable token fallback.

6. **Scopes should be minimal**
   - Request only what tool needs (`read` plus targeted mutation scopes like `issues:create`, `comments:create`).
   - Avoid broad scopes unless explicitly required.

7. **Validate OAuth state parameter**
   - Generate high-entropy `state` for each auth flow.
   - Verify callback `state` matches request to mitigate CSRF.

8. **Robust API error handling required**
   - Handle 401/invalid token and trigger refresh flow.
   - Handle refresh `invalid_grant` by clearing local credentials and forcing re-login.
   - Parse GraphQL `errors` payload even on HTTP 200 responses.
   - Add rate-limit retry/backoff behavior for 429 responses.

9. **Multi-workspace behavior**
   - OAuth grants are workspace-specific.
   - Use `prompt=consent` when user needs workspace reselection/re-auth.

---

## High-level implementation plan

### Phase 1 — Auth Flow Foundation
- Add OAuth config fields (client ID, redirect URI list, scopes). USe client ID: a3e177176c6697611367f1a2405d4a34
- Implement PKCE helpers (`code_verifier`, `code_challenge`).
- Build authorization URL generator (with `state`, `prompt=consent`, scopes).
- Add localhost callback server utility with graceful teardown and port fallback. Use this URL: http://localhost:34711/callback

### Phase 2 — Token Exchange + Storage
- Implement token exchange service (`authorization_code` grant).
- Store token payload (`access_token`, `refresh_token`, `expires_at`, `scope`, workspace context).
- Introduce secure storage adapter (keychain-first abstraction, env fallback for CI).

### Phase 3 — API Client Integration
- Inject bearer token into GraphQL requests.
- Add automatic refresh-on-expiry/401 logic.
- Add refresh single-flight lock and atomic token update.
- Retry original request once after successful refresh.

### Phase 4 — Failure & Recovery UX
- Handle `invalid_grant` by clearing credentials and returning actionable message.
- Add clear CLI commands/messages for login/logout/status.
- Add browser completion page and terminal success/failure feedback.

### Phase 5 — Hardening & Tests
- Unit test PKCE/state/token helper logic.
- Integration test auth callback parser and refresh paths.
- Add tests for race-condition guard (single refresh across concurrent requests).
- Add tests for GraphQL error parsing and 429 backoff behavior.

### Phase 6 — Documentation
- Document setup steps for Linear OAuth app registration.
- Document required redirect URIs and scope selection.
- Document local vs CI authentication behavior.
- Provide troubleshooting section for expired/revoked tokens.

---

## Deliverable
This research is ready to be used as implementation guidance for OAuth support in `pi-linear-tools`.
