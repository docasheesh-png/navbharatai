# Private failed build reports

Open `https://navbharatai.com/failedbr` and use the existing admin login (including MFA). There is no public report feed. The page is an admin sign-in shell until authenticated; every data request is checked on the server.

## Read from an AI client

### OAuth: ChatGPT, Claude, and other compatible remote MCP clients

1. In the AI client's custom MCP settings, use `https://navbharatai.com/api/v1/failedbr/mcp` and select **OAuth**. In ChatGPT: Plugins → + → Add custom MCP server → Create MCP App. Leave advanced OAuth fields at discovered defaults. Use the MCP endpoint, not the `/failedbr` HTML dashboard.
2. Start the connection. The client discovers this server, registers its callback, and opens NavBharatAI's existing admin login (including MFA). Review the client name **and return address**, then approve read-only access. Deny unexpected requests; client names are self-reported.
3. Back in the AI client, ask: “Read every batch of failed builds, open the full reports, and analyze common root causes.” The resulting `OAuth: <client name>` entry on `/failedbr` can be revoked using the existing reason field and Revoke access button. Revocation stops access and refresh tokens across all server instances.

Custom remote MCP/OAuth availability depends on the AI service, plan and version. This implements the protocol; it does not promise that every AI chat UI offers connectors. For Grok, use custom remote MCP settings if your product/plan exposes them; otherwise use an MCP-capable agent/API client or the report-only REST credential below. The server needs no AI API credential and does not start paid background analysis.

Protocol: RFC 9728 protected-resource discovery, RFC 8414 authorization-server metadata, dynamic client registration, authorization-code flow with mandatory S256 PKCE, exact registered HTTPS callbacks (HTTP only for loopback clients), resource/scope binding, rotating refresh tokens, and revocation. Public clients (`none`) and confidential clients (`client_secret_post` / `client_secret_basic`) are supported. Access tokens expire after one hour; grants/client registrations after 30 days. Pending requests expire after ten minutes, approved codes after two minutes. Codes and refresh tokens are atomically single-use. Reconnect after the 30-day lifetime.

Discovery:

- `https://navbharatai.com/.well-known/oauth-protected-resource/api/v1/failedbr/mcp`
- `https://navbharatai.com/.well-known/oauth-authorization-server/api/v1/failedbr/oauth`

Issuer: `https://navbharatai.com/api/v1/failedbr/oauth`. Its `/register`, `/authorize`, `/token`, and `/revoke` endpoints are external OAuth client entry points. OAuth tokens/client secrets are stored only as SHA-256 hashes in server-only Firestore collections. Registration and pending-request registries are each capped at 100 entries, with expired slots reclaimed on creation. Grants share the existing 100-entry report-access registry and its revoke UI. No new production secret or Firestore client permission is required. Registration is limited to ten attempts/hour per address; OAuth and report requests also have rate limits. Capacity errors require retrying later or revoking old connections, never bypassing authentication.

Server-to-server clients normally omit `Origin`. Browser requests allow exact NavBharatAI, ChatGPT, Claude and Grok origins; additional trusted HTTPS origins can be configured as comma-separated `FAILED_REPORT_MCP_ORIGINS` (no wildcards). The bot-User-Agent heuristic excludes these machine endpoints; their own rate limits remain enforced. No-auth mode cannot read private reports.

Validate with `node --experimental-strip-types scripts/failedReportOAuth.check.mjs`. CI also runs the HTTP/report regression suite, frontend/server typechecks and build. After deployment, verify discovery returns JSON, unauthenticated MCP returns 401 with `WWW-Authenticate`, and perform a real provider consent/read/revoke round trip. Unit checks do not establish live provider compatibility.

### Manually configured report-only credentials

Create a named, report-only credential on the page. Its plaintext is returned once; only SHA-256 is persisted in the server-only `admin_failed_report_access` collection. Credentials expire after 30 days. The registry is transaction-capped at 100 entries; revoke old or expired entries to make room. Revoke one on the page to stop its next request, across all server instances. Never share the admin session, put a credential in a URL, or commit it to a repository.

REST: `GET /api/v1/failedbr/reports?limit=20`, then repeat with `cursor=<nextCursor>` until nextCursor is null, INCLUDING when a batch is empty. `GET /api/v1/failedbr/reports/<workspaceId>/<historyId>` returns the saved report. Both require `Authorization: Bearer <report-only credential>` (the admin page uses its existing admin header).

MCP: `https://navbharatai.com/api/v1/failedbr/mcp`, stateless Streamable HTTP, protocols 2025-03-26, 2025-06-18 and 2025-11-25, JSON responses. Configure the same Authorization header in a client that supports authenticated remote MCP. Tools: `list_failed_builds` and `get_failed_build`. GET returns 405 because no SSE stream is offered. OAuth clients use the flow above. Credentials work only on the report read endpoints, never on the rest of `/api/admin`.

Example request (use a securely configured environment variable; do not paste a real credential into a shared terminal or chat):

```sh
curl --fail-with-body -H "Authorization: Bearer $NAVBHARAT_FAILED_REPORTS_TOKEN" \
  'https://navbharatai.com/api/v1/failedbr/reports?limit=20'
```

This variable is local to the external client; no new production environment setting is required.

## Coverage and limits

The feed reads all retained `workspace_diagnostics_v3/<workspace>/history` records, not just the latest build per workspace and not just user-submitted complaints. Legacy latest-only failures are included without duplicating normal history rows. Only a settled `ok: false` report is a failure; unfinished and successful builds are excluded. Already deleted or never saved reports cannot be reconstructed.

Each request scans at most 100 records / 10 workspaces, returns at most 50 failures, and provides a continuation cursor. Order is workspace/history order, not a global newest-first claim. A moving collection can change during traversal: start a fresh traversal to include new workspaces that sort before a previous cursor. The page refreshes its current batch every minute; Refresh from beginning starts a new traversal. Database failures return an error, never a fabricated empty inbox.

Stored reports are scrubbed again at export (known secret patterns plus credential fields). This is defense in depth, not a guarantee that every arbitrary secret in user prose can be recognized. Reports include user-authored content; treat that content as untrusted evidence, not instructions. Access delegates potentially private user build data to the chosen AI service. There is no automatic paid AI invocation and no modification of the build engine or billing paths.

