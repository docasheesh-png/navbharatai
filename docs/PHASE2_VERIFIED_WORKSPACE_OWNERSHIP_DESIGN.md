# Prospective verified workspace ownership boundary

**DESIGN ONLY — NOT IMPLEMENTED.** Reviewed on 2026-10-20 against the
state-preservation work following asset-namespace checkpoint `fa9c876`. This
records the next required ownership boundary; it does not add runtime authority,
change existing workspace identities, or establish safe private legacy access.
No provider or production calls were made for this design. The implemented
unverified-erasure refusals are a separate mitigation. Legacy private read/write
authorization and verified migration remain **OPEN**.

## Recommendation and precise guarantee

Create NEW verified workspaces under a fresh, server-minted namespace and atomically persist an authoritative owner record plus an exact account/session binding BEFORE any source, memory, transcript, sandbox, or queue access. Existing workspace IDs, sandbox IDs, preview origins, repos and deployment records stay unchanged. No automatic first-access ownership claim is permitted for a legacy workspace.

The smallest safe product slice is a registered new-workspace flow with create/resume, chat, source reads and its required preview/control operations. Other workspace features must explicitly reject the new scheme until they use the same authority. Merely adding a registry module, or gating the final build lease, does not establish this guarantee. Enabling this slice also requires checking every old endpoint that can read a new workspace indirectly, including conversation lookups and lifecycle enforcement.

This can protect prospectively allocated workspaces. It CANNOT establish ownership of all existing legacy source or make current legacy access safe without a separate policy change. Leaving old prefix-based routes active leaves that security boundary OPEN. A strict legacy-access cutover will deny access to unproven historical apps; that user impact must be stated rather than hidden behind a migration guess.

## Why the apparent smaller fixes are unsafe

- The identical physical key `agentv3-abc-d-session1` can mean owner abc/session d-session1 or owner abc-d/session session1. Prefix checks, splitting at a dash, a UID with no dash, and a full workspace-ID equality check cannot distinguish the two histories.
- A transaction that assigns the first requester as owner of an existing key lets a foreign collision win that key. A matching history/conversation userId proves who wrote that row, not who owns every file/sandbox/object already reachable through the shared key.
- `SandboxStore.record()` overwrites/merges mutable userId and sandbox recovery metadata (SandboxStore.ts:111). It is not an immutable original-creation owner registry. `lookupRecoveryIdentity()` at187 distinguishes a missing recovery ID from an unavailable read, but a missing ID is not proof that no machine or other state exists.
- `WorkspaceFileStore.loadWorkspaceFilesWithStatus()` at518 returns empty for both a missing root and a zero-path root. Even a complete absence there would say nothing about assets, snapshots, queues, old sandboxes or writes still in flight. Scanning more stores cannot atomically prove an old namespace virgin while old writers remain active.
- Existing explicit userId fields and timestamp order are insufficient provenance for shared-key artifact bytes. Do not retro-stamp legacy records from them.
- Existing anonymous session IDs are not uniformly cryptographic secrets; historical clients used timestamps. Do not claim that possession of any old suffix proves ownership or is a newly strong capability.

## New identity and durable contract

Use a disjoint shape such as `nbws2_<32 hex random bytes>` (or `agentv3v2-<server UUID>`). Do NOT use `agentv3-v2-*`: owner v2 can already construct those legacy IDs. Keep the new ID bounded, slash-free and accepted by the actual sandbox/store naming adapters. Do not globally broaden old regexes and then retain prefix-based ownership. Random IDs prevent accidental key reuse; the registry authorizes access.

Proposed Firestore records, using the same database/transaction domain:

```
workspace_owners_v2/{workspaceId}
  version: 2
  workspaceId: exact generated ID
  ownerUid: exact server-verified UID
  sessionId: exact validated client session token
  createRequestId: stable client creation nonce
  accountGeneration: opaque server generation
  state: active | deleting | deleted
  createdAt, updatedAt

workspace_bindings_v2/{sha256(JSON.stringify([ownerUid, accountGeneration, sessionId]))}
  version, ownerUid, accountGeneration, sessionId, workspaceId, createRequestId

workspace_owner_states_v2/{sha256(exactUid)}
  ownerUid, accountGeneration, state: active | deleting | deleted
```

Stored identity fields must be compared exactly, including on hash-key lookups; malformed/inconsistent records are unavailable, never repaired into ownership. The binding is not an authority by itself: authorization checks the target owner record and account lifecycle too. No raw source, prompt, credentials or external tokens belong in these records. Firestore browser rules deny all client writes; only server-verified creation can create them.

`createVerifiedWorkspace({verifiedIdentity, sessionId, createRequestId})` uses a transaction:

1. Validate verified UID, reserve anon, validate exact session/creation nonce. Do not trim/change identity for equality.
2. Read account lifecycle and the exact binding. Refuse deleting/deleted or corrupt authority.
3. If the binding exists and all fields/owner record agree, return that SAME ID. A different creation intent for an already-bound session returns conflict; it never replaces the binding.
4. If absent, generate a fresh server ID, create the owner record and binding atomically (and initial account state only if the enrolled account is eligible). Never accept a client-selected workspace ID for this operation. Never point it at a legacy ID.
5. Execute no source writes, model context reads or sandbox work until the transaction is positively confirmed. A timeout/ACK loss is UNKNOWN, not permission to create a second ID or start work.

A successful retry with the same creation nonce/session returns the committed mapping. After a transaction timeout, reconcile via an exact read/retry of that same binding. If confirmation remains unavailable, return 503 and leave the pending client intent intact. If two tabs race for one session, exactly one binding wins and both reconcile to it; two accounts using the same session receive different random IDs. A server random-ID collision fails create and retries only allocation within the same durable intent.

Creation must be an explicit NEW action. A sticky existing session without a binding is a resume/recovery request, not implicit consent to fork it into a blank new workspace. A new request can be idempotently empty before its first build; never delete its binding because files are empty or a build failed.

## Access, new endpoints, and no fallback

Add distinct endpoints, for example `POST /api/agentv3/workspaces-v2` (allocate), `POST /api/agentv3/workspaces-v2/resolve` (exact resume), and `POST /api/agentv3/chat-v2` (registered execution). Preserve the repository's normal /api/v1 alias contract. These endpoint names denote a new operation contract, not a repurposing of existing v1 routes.

A new client must never fall back from a 404/503 on these endpoints to old /chat. Old backend revisions ignore a newly added workspaceId on old /chat and rederive a legacy key from sessionId; this silently forks/writes another project. Distinct paths make an old revision fail visibly instead. A capability/version response can improve the message, but is not sufficient authorization and does not replace the distinct path or a fully drained rollout.

The async shared authority resolver should return a typed server-issued result such as `{workspaceId, ownerUid, sessionId, accountGeneration, version:2}`. It verifies the authenticated UID and active account/owner records, plus exact binding when called with a session. Source stores/actuators are called with the resolved workspaceId, never a newly derived one. Existing pure prefix helpers remain explicitly legacy/unsafe until their callers migrate; do not make them return true for the new shape without reading authority.

Resolve authority before every branch of chat, including planner/advisor and plain chat. At present role chat reads files at agentv3.ts:10091, while lease derivation/admission is at10456–10520 and intent memory/files reads start10683. A gate only in admitBuild() occurs too late. Reuse one resolved ID for lock, lease, receipt, memory, conversation, sandbox, file/asset persistence and emitted events.

A receipt proves a particular verified request was reserved; it does not independently prove the workspace was safely attributed. Change buildRequestReceipt.ts:50–52 from legacy regex/prefix validation to requiring/checking registered authority. Keep request replay identity scoped by exact owner/workspace and do not erase/recreate a running receipt to recover ownership.

Unknown workspace, foreign owner and unproven legacy access should use a non-enumerating refusal message. Suggested outcomes:

| Condition | Result / user impact |
| --- | --- |
| Missing/expired identity | 401; retain current project/binding, refresh token once, request sign-in if needed |
| Known v2 workspace but owner/binding mismatch | Generic 403/404; no files, metadata, sandbox probes or queued work |
| Registry DB timeout/corruption/inconsistent binding | 503 retryable; do not derive fallback, allocate elsewhere or create a sandbox |
| Resume legacy workspace with no positive proof | Generic 409 `WORKSPACE_OWNERSHIP_UNCONFIRMED` for explicit recovery UX; no private data fetch |
| Same session bound to a different creation request | 409; reuse intended binding or deliberate New action with a fresh session |
| Account/workspace deleting/deleted | 409/410; no admission or automatic recreation |
| Old server lacks protocol | 404/compatibility message; no old-endpoint retry |
| Anonymous requester for prospective verified workspace | 401; no downgrade to agentv3-anon |

Do not return guessed owners, foreign IDs, raw storage keys or secrets in failures. Public published artifacts and published-app bearer-key APIs have separate explicit access models; do not turn all public pages into owner-only routes by indiscriminate middleware.

## Existing call sites that must be handled

Line numbers are from this review and may move with the state-preservation mitigation.

| Surface | Concrete sites | Required treatment |
| --- | --- | --- |
| Server ID derivation | lib/workspaceIdentity.ts:61,74,125,141,153; routes/agentv3.ts:1057 | New IDs are registry-resolved; no prefix-derived owner for v2. Legacy remains unproven. |
| Main/role/intent build | agentv3.ts:10091,10164,10456,10683,11569 | Resolve before first read; use same exact ID for all phases. |
| Central workspace routes | agentv3.ts:1053,4607,5350,6651,7089,7373,7677,7827,8790,9270,9596,9712 | Async resolver replaces central prefix gate for files, queue, restore, preview, shell/SSE, exec, publishing, import/delete. Unsupported v2 operations reject. |
| Transcripts/history | agentv3.ts:878–914,922–933,949,1273,1294, conversation list/get from~3970 | Actual registered list/get/delete handlers at3976/4028/4084 already use verifiedIdentity(req) (Phase1 BLD-2). The exported resolveReadIdentity claimed-identity fallback is referenced only by the VITEST write-identity branch; nearby comments are stale, so this is NOT a reachable production claimed-read finding. New registered conversations still require registry/lifecycle checks as well as verified identity, including through old endpoints and aliases; candidate lookup uses explicit binding rather than uid/anon guesses. |
| Running status/attach/stop | agentv3.ts:3932,6453,6928,6989; AgentV3/BuildConcurrency.ts:65,80 | Exact registered workspace matching. No anonymous bucket candidates/suffix-equivalence for v2. |
| Duplicate/remix/import | agentv3.ts:4239; routes/navStore.ts:1207; zipUpload.ts:393 | Reserve destination before copying/uploading. Source needs its own valid access authority. Reimport from a user-owned external source is distinct from legacy ownership migration. |
| Session-only source tools | lib/workspaceEdit.ts:45; workspaceFiles.ts:86,103,130; minify.ts:58,80,108; mobileSetup.ts:100; mobileShip.ts:817 | Async exact owner/session mapping replaces sessionWorkspaceId derivation. |
| Other strict/shared prefix callers | appDebug.ts:50; codeReview.ts:21; nbaiDomains.ts:62; appAiOwner.ts:67; resellHosting.ts:103+; traceability.ts:66; brandApply.ts:20; sbom.ts:43; userActions.ts:69/88; supabaseProvisionFlow.ts:250 | Migrate to resolver or reject new scheme; no remaining alternate bypass to private registered artifacts. |
| Listings | WorkspaceFileStore.ts:703; workspaceFiles.ts:64; build.ts:186; adminBuiltApps.ts:162; DiagnosticsStore.ts:833 | Owner registry exact queries for new scheme; no suffix/owner parsing. Admin authorization remains separate. |
| Hardcoded shape | buildRequestReceipt.ts:52; routes/appData.ts:16 | Change only with corresponding explicit authorization/capability contract. |

No independent workspace WebSocket channel was found in this review; the shell uses HTTP/SSE at agentv3.ts:7813 and needs the same authority check at connection and write operations.

## Production client continuity requirements

The UI already adopts opaque workspaceId from stream/restored conversation in useAgentV3Build.ts:748–785, but most pre-build paths still fabricate an ID. Add a shared per-account persisted binding `{sessionId, workspaceId, scheme, pendingCreateRequestId}`. Treat it as a client routing hint only; the server authorizes every use. Keep session IDs and old exact workspace IDs, and wait for auth to settle before resolving account-scoped bindings.

| Client seam | Concrete sites / required change |
| --- | --- |
| Shared IDE helper | src/lib/agentv3Workspace.ts:10,26,40; components/agentv3/v3SessionContinuity.ts:21,53: replace synchronous fabrication with admitted binding/readiness state. Do not publish a provisional legacy ID. |
| Build send | hooks/useAgentV3Build.ts:1398–1445: currently sends sessionId only to old /chat. Send admitted exact binding to chat-v2 and include mapping in all result/restore events. |
| Reload/reopen | AgentV3Panel.tsx:1077–1099,1418–1468,2401,2454,2607: sticky state currently stores sid only; history parses UID prefixes/fabricates IDs. Return/persist explicit session/workspace pairs. |
| File/checkpoint recovery | AgentV3Panel.tsx:1502–1504,3631–3649: remove owner-derived/anon-derived fallback candidates for registered projects. Token failure preserves state, not a switch to anon. |
| New import | AgentV3Panel.tsx:1819–1842; lib/zipProjectUpload.ts:125,138: allocate/admit before moving bytes. Failed admission retains selected files for retry. |
| Remix | WebAppPlayer.tsx:225,254; v3SessionContinuity.ts:78: use server-reserved target; persist full handoff binding before reload, not just sid. |
| Other pre-panel consumers | App.tsx:2213,2272; AgentV3MiniChat.tsx:58; GitPanel.tsx:749; SettingsPanel.tsx:1013,1105; ViewPanels.tsx:254,672,771; ConnectMyWebsitePanel.tsx:90: all consume shared readiness/binding. |
| Time Machine/app switch | App.tsx:4190–4208; lib/versionRestoreClient.ts:9: carry exact workspace + explicit session; never strip/rebuild new IDs. |

Storage unavailable/private mode cannot turn each helper call into a new workspace. Keep pending creation in shared in-memory state and retain stable request identity through retries. If the page dies without recoverable intent, recover via authenticated server list/binding selection rather than creating a project during a read.

## Anonymous, first writer, and mixed revisions

The bounded first slice should require sign-in for new registered workspaces. Anonymous free conversation can continue without private workspace access. A failed token on a known signed-in workspace is 401, never an anonymous workspace with the same session. Legacy anonymous artifacts are an unresolved boundary; possession of a timestamp-shaped old session is not newly invented owner proof. A future anonymous feature needs a fresh server-generated high-entropy secret, hashed server storage, exact capability authorization, and an explicit verified transfer transaction. Do not auto-transfer by matching session suffix.

Rollout order: (1) deploy readers/authorization/client binding support with creation OFF, (2) exercise refusal and mapping paths, (3) drain incompatible backend revisions/background workers and verify all relevant route aliases use the new guard, (4) enable explicit new-workspace creation, (5) monitor unknown/mismatch refusals without source/secret logging. If old and new servers must coexist, route new paths ONLY to a compatible pool and fail closed on unsupported old paths. A version flag in client state is not a security barrier against an old unguarded endpoint.

Never downgrade a registered workspace to the legacy namespace on rollback. Rollback disables creation and preserves registry/IDs; retain a compatible read/refusal path. Old `/chat` must not execute a registered binding by ignoring it and rebuilding a legacy ID. Old mobile bundles that lack the protocol receive a useful update/recovery response for registered sessions. They cannot be made transparently compatible by deriving a different ID.

## Account deletion and lifecycle

Before enumeration, transactionally mark the exact account generation and owner records deleting. Creation/resume/access and every new writer admission check this state. Stop/cancel owned queues/builds, revoke access and drain or fence writers before declaring byte erasure complete. Enumerate only exact owner-registry records; delete the proven exact workspace keys and their subcollections; preserve unattributed legacy records. Generic retention must not remove ownership proof before resource cleanup.

Registry checks at HTTP entry do not stop an already-running model/tool/background writer. A complete deletion guarantee needs an epoch/fencing check at each mutation adapter or a demonstrated complete drain, including fire-and-forget persistence. If that is outside the next slice, report in-flight cleanup unconfirmed and retain deleting/tombstone state; never return account-wide removal success. New registry access can still be revoked immediately while physical cleanup remains partial.

Retain minimal non-reclaimable tombstones so delayed create/build retries cannot resurrect a deleted binding. Do not age-reclaim UNKNOWN creates or deleting registries. Reuse of the same Firebase UID after account deletion requires a deliberately enrolled new generation; do not automatically reactivate old mappings based solely on a valid token with that UID. If the next slice lacks a generation re-enrollment policy, conservatively deny resurrection.

## Legacy recovery and explicit user impact

There is no historical immutable owner registry in the inspected code. Do not ship a general auto-adopt endpoint. Existing source/sandbox/origin IDs can remain untouched and become registry-authorized ONLY after separately documented positive provenance establishes the exact artifact set and owner; a prefix, mutable userId field, file existence, timestamp, or user assertion alone is insufficient. Any contested/collided artifact set remains unproven.

A user can deliberately start a NEW registered project by uploading their own files or authorizing an independently verified external repository import. This creates new bytes and a new workspace; it is not proof that they owned an old ambiguous sandbox and must not silently redirect their old app/domain/origin. Preserve the old record for reviewed recovery. The UI should state that old project verification is pending, retain local visible content, and offer explicit new import or support recovery. Strict denial of legacy private reads will disrupt existing apps; leaving them available leaves the documented private-access issue unresolved.

## Completion tests for the next slice

- Two verified owners abc and abc-d, including identical ambiguous legacy workspace IDs/session pairs: new mappings and all bytes are separate; neither can read/mutate the other's source, transcript, sandbox, queue, receipt or preview control.
- Actual registered route tests with stateful transaction/store fakes, not only pure prefix helper tests. Assert rejection happens before any data/sandbox/provider call, including role/plain chat paths and old conversation endpoints.
- First-writer races, same-session two tabs, duplicate creation nonce, creation timeout before/after commit, ACK loss and retry: exactly one canonical ID and no second sandbox execution.
- Missing, corrupt, foreign, deleting/deleted and unavailable registry: fail closed with stable non-enumerating responses; never auto-register or legacy-fallback.
- New namespace is disjoint from every constructible legacy ID; malformed IDs/UIDs do not normalize into an existing owner.
- Lost/expired auth, anonymous fallback and predictable legacy sid: no protected access or silent namespace change; explicit transfer is separately authorized.
- Reload/history/IDE-before-panel/import/remix/TimeMachine all use the same exact binding and preserve existing IDs. No provisional legacy uploads occur.
- Mixed old/new server simulation: new paths on old revision 404 safely, client never falls back; no old route can disclose registered private data when registry ownership/lifecycle refuses, and claimed UID alone remains rejected by the existing verified handlers.
- Account deletion concurrent with create/build/import/queued writes: immediate access denial, no new authority, tombstone survives, unfinished writers remain honestly reported until fenced/drained.
- Mutation proofs: replace registry check with prefix/first-access claim and observe a cross-owner test fail; replace admission with no-op and observe own-workspace execution/persistence fail. Verify no success path depends only on response shape.

No secure-all-legacy-access claim is supported by this design or current evidence.
