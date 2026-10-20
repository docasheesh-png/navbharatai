# Phase 1 workspace authorization evidence — 2026-10-20

Status: implemented locally; repository CI and Phase 1 completion are tracked separately. Starting snapshot: `adc53ee215beb5b7f7c5042245b2817c16a2deca`.

## Findings and resulting behavior

Three AgentV3 preview endpoints accepted a body/query `userId` as ownership authority when token verification failed. A caller who learned another user's workspace ID could claim its embedded UID and reach diagnostics writes, preview health probes, or sandbox revival/repair. Workspace IDs should identify a resource; a real account's identity must come from the verified token.

| Registered route | Operation | Resulting owner rule |
| --- | --- | --- |
| `POST /api/agentv3/preview-error` | Append preview diagnostics | Verified owner for an account workspace |
| `POST /api/agentv3/preview-diagnose` | Restore/start/restart sandbox, including recovery work | Verified owner before sandbox work |
| `POST /api/agentv3/preview-health` | Read workspace state and probe its preview | Verified owner before workspace reads or sandbox probes |
| `POST /api/agentv3/queue/enqueue` | Add a future build prompt | Already used verified ownership; behavior retained |
| `GET /api/agentv3/queue` | Read queued prompts | Already used verified ownership; behavior retained |
| `POST /api/agentv3/queue/cancel` | Cancel a queued item | Already used verified ownership; behavior retained |
| `POST /api/agentv3/queue/next` | Claim next queued prompt | Already used verified ownership; behavior retained |
| `POST /api/agentv3/queue/complete` | Complete current queue item | Already used verified ownership; behavior retained |

The unused route-local claimed-UID guard was removed. A source census permits no registered AgentV3 handler to reintroduce that guard. Shared pure policy exports were retained for existing consumers; they are not new authorization grants.

The preview client uses `previewRequest` for these three preview endpoints. On HTTP 401/403 it discards the refusal body, force-refreshes the token and retries **once**. Other responses and network failures are not replayed. The request preserves its JSON body, signal, keepalive and response stream without adding a short timeout to the long-running sandbox wake. A repeated refusal remains a refusal.

## Verification boundaries

`tests/previewWorkspaceAuthorization.test.ts` exercises the real registered handler, authorization-header parsing, production token-verification path and workspace-owner comparison. The test unsets `VITEST` while handling requests and replaces only the identity SDK boundary. Missing, expired/invalid and other-account tokens must return 403 despite a matching claimed UID, before diagnostics access/writes, queue access/mutation or actuator construction. An owner request after a refusal succeeds. Anonymous capability behavior is covered separately.

The SDK double tests integration with a verifier's accepted/rejected identity; it does **not** independently validate Firebase's cryptographic implementation. The direct-handler harness omits global middleware, so it does not establish HTTP deployment, rate-limit or App Check behavior. No production exploit, paid sandbox call or live identity-provider call was run for these tests.

`previewRequest.test.ts` verifies forced refresh, bounded retry, header replacement, caller signal/body/keepalive preservation and no retry for network failures or non-auth responses. Existing preview listener, watchdog, wake, source-access, client-response and API-caller census checks cover integration.

Local evidence before final integration: frontend/server typechecks passed; focused six-file authorization/client/caller suite passed **78 tests**. A broader nine-file suite passed 408 tests and exposed one stale discarded-call census entry, which was corrected by teaching that census to inspect the authenticated preview wrapper too. Its subsequent two-file retry/census run passed 19 tests. Final full-suite and CI results supersede these local intermediate results; do not interpret this document as a merge or deployment record.

## Regression reversion proof

The same new `previewWorkspaceAuthorization.test.ts` was run in a detached temporary worktree rooted at the original `adc53ee` snapshot, using the existing installed dependencies. With the original `agentv3.ts`, **12 tests failed and 26 passed**: missing/expired/invalid token preview requests returned HTTP 200 instead of 403, and the three refusal-then-owner cases failed their initial refusal assertion. After copying **only** the fixed `agentv3.ts` into that temporary worktree, the identical suite passed **38/38**. The working repository source was not reverted or modified for this proof. This demonstrates that the tests detect the original claimed-owner preview flaw; queue and anonymous-policy cases remained unchanged. Temporary worktree removed after the run; local logs retained at `/tmp/phase1-auth-reversion-baseline.log` and `/tmp/phase1-auth-reversion-fixed.log` for this session.

## Explicit residual contracts

- `agentv3-anon-<sessionId>` keeps the established capability model: possession of its unguessable session/workspace ID grants access without a verified account. This patch does not convert anonymous sessions to authenticated ownership. Token-bearing, expiring scoped capabilities would require a separately planned migration, including older bundled clients.
- Account ownership still uses the existing `agentv3-<uid>-<sessionId>` prefix contract in `workspaceIdentity.ts`. This patch does not migrate persisted IDs or replace prefix ownership with stored owner records. Identifier-shape and UID/session parsing changes need independent compatibility review.
- These changes address the identified preview paths and verify existing queue guards. They do not certify every application route or production infrastructure as secure.
- The API-caller baseline has no undecided AgentV3 entries: its existing entries identify admin URL callers, legacy bundled terminal callers, and the injected preview keepalive script. No route was deleted or reclassified by this patch.

## Additional workspace-source findings and fixes

The read-only audit found two further concrete authorization defects outside the preview routes:

1. `POST /api/integrations/supabase/provision` accepted an arbitrary `workspaceId` after verifying only the caller's identity. `provisionDatabaseForUser` could read that workspace's migration SQL and apply it to a database in the caller's own provider account. The flow now checks `ownedByVerifiedUid` before any vault, provider or source operation, covering HTTP and internal build callers. Settings provisioning without an app remains supported. Ten flow cases cover foreign/malformed/anonymous workspaces, refusal before effects, legitimate owner schema application and omitted-app Settings operation.
2. Version-history authorization checked that the caller owned an app with a session suffix, but storage used the suffix alone. Two accounts could deliberately choose the same session id and reach the same stored versions and legacy build-session results. `restorePointKey`, tool restore points and history routes now use the complete authorized workspace id. Existing bare-session API URLs and the Time Machine picker contract remain supported; the server resolves them after token verification.

### History namespace migration and legacy attribution

New versions live in `build_history_v2/{workspaceId}/versions/{versionId}`. A parent `{workspaceId, storageVersion: 2}` is written before the version so future account erasure can discover it even after the workspace-source record is removed. Transient build sessions use `build_sessions_v2/{workspaceId}` with the existing 90-day TTL. Both namespaces are included in workspace erasure, including version children.

Using full ids inside the old collections would be unsafe: an old arbitrary bare session id could already equal a victim's full workspace id. Reading it as a new canonical row would expose or mix ownerless old data. The new namespaces therefore never fall back to `build_history` or `build_sessions`, including for ids shaped like full workspaces. A source-census test rejects direct application access to either legacy collection. This is a namespace change, not an in-place data rewrite.

**OPEN — legacy owner attribution and recovery.** Old records do not persist sufficient trustworthy owner provenance. Matching a session suffix, current workspace, or a user-indexed historical session reference does not establish exclusive ownership of a shared legacy key. No snapshot is reassigned, copied, deleted or disclosed on that basis. Legacy collections remain retained and unavailable for ordinary reads pending independently verified attribution; existing transient-session TTL retention is unchanged. Empty owner timelines show the same migration notice without probing whether any old global row exists, avoiding an existence leak. Current app source is unchanged. A recovery process with authenticated provenance is required before old restore points can safely be exposed or erased for a particular account.

Local validation: 31 route cases use the real authorization-header and production verifier path with the SDK boundary replaced. Before the routing fix, 11 fail, reproducing the collision. Actual store tests additionally seed poisoned legacy ids shaped like victim workspaces and verify fresh-namespace isolation, source preservation, and discoverable v2 metadata. The combined local history/source/flow suite passed 156 tests in 10 files. These results do not establish production exploitability or replace final CI.

### Supabase regression reversion proof

The new flow suite was copied into a detached temporary worktree at `adc53ee`. Against the original provision flow, **7 cases failed and 3 passed**: unauthorized workspace inputs proceeded instead of refusing, and whitespace normalization was inconsistent. Replacing only `supabaseProvisionFlow.ts` with the fixed file made the same suite pass **10/10**. No shared working-tree source was reverted. Temporary worktree removed; session logs: `/tmp/navbharatai-provision-original-proof.log` and `/tmp/navbharatai-provision-fixed-proof.log`.

The erasure integration also reports a constant legacy-history limitation without asserting whether a particular account owns any such rows. Account-deletion responses preserve measured per-store counts and sign-in outcome, and no longer claim that every record was erased while unattributed snapshots remain retained. Targeted erasure/classification validation passed 70 tests across seven files, including actual canonical child-before-parent erasure after app-source removal and preservation of another account and both forms of unowned legacy ids. The separate profile deletion-response suite passed 3/3.
