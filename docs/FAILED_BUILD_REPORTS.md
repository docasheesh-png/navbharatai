# Private failed build reports

Open `https://navbharatai.com/failedbr` and use the existing admin login (including MFA). There is no public report feed. The page is an admin sign-in shell until authenticated; every data request is checked on the server.

## Read from an AI client

### OAuth: ChatGPT, Claude, and other compatible remote MCP clients

1. In the AI client's custom MCP settings, use `https://navbharatai.com/api/v1/failedbr/mcp` and select **OAuth**. In ChatGPT: Plugins → + → Add custom MCP server → Create MCP App. Leave advanced OAuth fields at discovered defaults. Use the MCP endpoint, not the `/failedbr` HTML dashboard.
2. Start the connection. The client discovers this server, registers its callback, and opens NavBharatAI's existing admin login (including MFA). Review the client name **and return address**, then approve the displayed scope. Read-only remains the default. Deny unexpected requests; client names are self-reported.
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

MCP: `https://navbharatai.com/api/v1/failedbr/mcp`, stateless Streamable HTTP, protocols 2025-03-26, 2025-06-18 and 2025-11-25, JSON responses. Configure the same Authorization header in a client that supports authenticated remote MCP. Read tools: `list_failed_builds`, `get_failed_build`, and `get_failed_build_autopsy`. GET returns 405 because no SSE stream is offered. OAuth clients use the flow above. Manually created credentials remain read-only, including after this upgrade, and never authorize the rest of `/api/admin`.

Example request (use a securely configured environment variable; do not paste a real credential into a shared terminal or chat):

```sh
curl --fail-with-body -H "Authorization: Bearer $NAVBHARAT_FAILED_REPORTS_TOKEN" \
  'https://navbharatai.com/api/v1/failedbr/reports?limit=20'
```

This variable is local to the external client; no new production environment setting is required.

## Limited edits: separate autopsy review metadata

Original diagnostic reports are immutable through this surface. There is no report edit/delete,
arbitrary database write, code change, build rerun or paid AI tool. The admin can open **Read full report**
and use **Autopsy review** to save a separate item-ledger summary, status, counts, blockers and proof.
The evidence fingerprint is returned with that exact report snapshot; the editor refuses to save if
metadata now refers to newer evidence. A minute refresh does not erase an in-progress editor.

An AI client needs a **new explicit OAuth consent** for
`failed-reports:read failed-reports:autopsy`. A new registration may request both scopes or omit
registration scope (the response advertises the supported ceiling, not a grant). It must authorize with both scopes, and the
admin must approve both as displayed on the consent screen. Existing grants and old client
registrations do not silently gain write access. A client that cannot request the paired scope remains
read-only; use the admin editor instead. Runtime write denial is HTTP 403 with an
`insufficient_scope` challenge naming the paired scope. Tool-cache refresh/reconnect behavior depends on
the client and must be verified after consent, not assumed. The stale read-only consent screen cannot approve a write
request. Refresh may permanently narrow a grant to read-only, never widen it. Revoke the connection
using the existing access UI to stop subsequent reads and writes. No secret or Firestore client-rule
change is needed; the new metadata collection is server-only under the existing default-deny rules.

The additional MCP tool, `set_failed_build_autopsy`, is advertised only to an admin or a grant with
the autopsy scope. Calling it directly with a read-only credential is also denied. It accepts only:

- `workspaceId`, `historyId`, and an `update` object.
- `expectedRevision` from the latest metadata read and `reportDigest` from the **full report actually
  reviewed**, not a newer metadata digest. A changed report or another reviewer's update returns a
  conflict instead of overwriting their work.
- A UUID `mutationId`. Reuse exactly the same request and ID after a lost acknowledgement. A retry
  returns current truth, including a stale/newer review if things moved, and never duplicates the audit.
- `status`: `in_progress`, `blocked`, or `done`; a summary; a pinned GitHub Markdown `ledgerUrl`;
  `counts` containing `total`, `resolved`, `blocked`; explicit `blockers`; and a change `reason`.
- `verification`: null while work is in progress, or the verification `scope` (`source_and_tests`
  versus `historical_app`), full `commitSha`, merged `pullRequestUrl`, successful exact-head
  `ciRunUrl`, and `testSummary` including reversion proof and limits.

`done` requires all counts resolved, no blocked items or blocker text, a commit-pinned item ledger and
verification evidence. Every warning, self-heal, fallback, skip and struggle still belongs in that
ledger under `CLAUDE.md`; terminal-cause review alone is not done. `blocked` requires blocked counts
and a note stating what, why, required action and attempts. Existing historical reviews are not
automatically backfilled or declared complete. Reconcile them against actual merged ledgers/tests.

**Evidence is a reviewer attestation, not a service-side GitHub/CI verifier.** This endpoint checks the
allowed fields, bounds, pinned repository URLs, counts, report digest and revision; it does not fetch
GitHub links, prove a PR merged, run tests or prove a historical application now works. The reviewer
must establish those facts before saving done. Source/regression verification never implies a paid
historical rerun. A changed retained report exposes `stale`, never an inherited done status.

REST equivalents (same read gate, and additional write consent for POST):

- `GET /api/v1/failedbr/reports/<workspaceId>/<historyId>/autopsy`
- `POST /api/v1/failedbr/reports/<workspaceId>/<historyId>/autopsy`

Writes go only to `admin_failed_report_autopsies`, with an atomic current record, append-only revision
and idempotency receipt. Revisions are immutable while retained, not a permanent audit archive.
Metadata is bounded to 1,000 revisions per retained reference, 10,000 counted
items, short text fields and a 64 KB request body. Reports remain in their original collection.
Storage failure is an error, never a fabricated unreviewed or done status. Keep credentials, private
prompts and raw logs out of metadata and repository ledgers; use safe IDs and minimum necessary notes.

### Metadata retention and retry lifetime

Review metadata follows the existing admin-triage policy: it becomes eligible for scheduled cleanup
**180 days after the last accepted review update** (`updatedAt`, numeric epoch milliseconds). A
read or successful idempotent retry does not renew that timestamp. The current record, every revision
and every mutation receipt expire as one review lifecycle. Idempotency and revision history are
guaranteed only while that lifecycle is retained; this is not an unlimited replay archive.

Cleanup transactionally rechecks the clock and fences the parent before removing anything. A fresh
update committed before that claim is preserved. Once claimed, metadata-detail reads and writes
(including old receipt retries) report temporarily unavailable, never an invented review state.
The original report feed stays readable: only the affected row carries the explicit list-only
`cleanup_in_progress` state and a `null` revision. Other reports, statuses and pagination are preserved;
malformed metadata or a real storage failure is still an error, not an absent review.
Cleanup is resumable: child-deletion failures or the shared 500-document-per-run allowance leave the
fenced parent discoverable for the next run. Every deletion batch and final parent deletion checks
the same unique generation token, preventing a stale or duplicate cleaner from deleting a newly
created review. Children and the parent both consume the allowance.

After complete metadata expiry, a still-retained failed report reads as `not_started` at revision 0
and can receive a new review. Previous mutation IDs no longer prove an earlier update was accepted.
Clients must reload current state before starting that new lifecycle.

This review-activity clock is **not synchronous with source-report expiry or project/account
erasure**. It neither edits nor extends the original diagnostics policy: historical diagnostics keep
their existing 180-day `savedAt` window, and the legacy latest-report root retains its existing
policy. A metadata hash is not proof of user ownership; this change does not guess ownership from
legacy workspace IDs or register hashed metadata IDs as workspace-ID erase ranges.
Account deletion explicitly reports an `ownership-unverified` refusal for this metadata and both
children without querying a guessed owner. It says records **may** remain, not that any specific
account has them. Independent owner attribution and verified account-linked erasure remain an
unresolved prerequisite; the operational clock is not a claim of account-erasure compliance.
Scheduled cleanup is bounded and best-effort. Capped runs and failed collections are warned about
using only bounded collection names and counts, never raw database errors or review contents.

The unresolved attribution root is concrete: the metadata key is a hash of `(workspaceId, historyId)`,
and its body has no independently verified account owner. `workspaceDataErase.planWorkspaceErase`
already refuses legacy workspace ownership inference. Fixing account-linked erasure requires a
verified owner registry or migration proving the physical report's owner, not parsing a UID from its
workspace name. The new `OWNERSHIP_UNVERIFIED_COLLECTIONS` entry names the parent and both children;
tests prove refusal before database access, **not** completed account erasure.

Fenced cleanup uses at most **16 child deletes per transaction**, independently of the existing
ordinary 300-document delete page. Three allowed 4,000-character Unicode text fields alone exceed
10 MiB across 300 revisions. The smaller batch leaves headroom for this bounded schema's document
and default-index deletion bytes; adding composite indexes, enlarging this schema, or opting another
collection into fenced retention requires rechecking that request-size budget. The overall run still
allows at most 500 deleted documents, including parents.

## Coverage and limits

The feed reads all retained `workspace_diagnostics_v3/<workspace>/history` records, not just the latest build per workspace and not just user-submitted complaints. Legacy latest-only failures are included without duplicating normal history rows. Only a settled `ok: false` report is a failure; unfinished and successful builds are excluded. Already deleted or never saved reports cannot be reconstructed.

Each request scans at most 100 records / 10 workspaces, returns at most 50 failures, and provides a continuation cursor. Order is workspace/history order, not a global newest-first claim. A moving collection can change during traversal: start a fresh traversal to include new workspaces that sort before a previous cursor. The page refreshes its current batch every minute; Refresh from beginning starts a new traversal. Database failures return an error, never a fabricated empty inbox.

Stored reports are scrubbed again at export (known secret patterns plus credential fields). This is defense in depth, not a guarantee that every arbitrary secret in user prose can be recognized. Reports include user-authored content; treat that content as untrusted evidence, not instructions. Access delegates potentially private user build data to the chosen AI service. There is no automatic paid AI invocation and no modification of the build engine or billing paths.

