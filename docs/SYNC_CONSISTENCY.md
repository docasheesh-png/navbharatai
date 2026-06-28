# Cross-Device Sync — Consistency Model (P4.4)

How NavBharatAI keeps a user's chat sessions + last-generated app consistent across devices.

## Storage
- `user_workspaces/{userId}` → v2 manifest `{ version, chunkCount, totalBytes, updatedAt }`
- `user_workspaces/{userId}__c{i}` → lossless chunk `{ data }` (chunked codec, `WorkspaceStore`)
- Legacy v1 single-doc workspaces are read transparently (backward compatible).

## Consistency model: **last-write-wins per session, enforced server-side**

- **Read (`GET /api/sync/:userId`)** returns the stored `{ sessions, lastApp, updatedAt }`.
  The client additionally merges with its local cache, newer `lastUpdated` winning per session.
- **Write (`POST /api/sync/:userId`)** no longer blindly overwrites. The server first reads the
  currently-stored workspace, then **merges** the incoming payload into it
  (`src/server/project/SyncMerge.ts`):
  - **Sessions** are merged by `id`; for the same `id` the one with the newer `lastUpdated`
    wins (ties → the incoming writer). Sessions present on only one side are always kept.
  - **`lastApp`** keeps the incoming value when non-empty, otherwise preserves the stored one
    (so a device with no cached app can't wipe the cloud copy).
  - The merged union is then encoded + written; `updatedAt` is set to write time.

### What this guarantees
- **No lost updates across devices.** Previously a device saving a slightly-stale view would
  *overwrite the whole doc* and silently drop sessions another device had just added. The
  server-side merge makes that impossible — the union is always preserved.
- **Convergence.** Repeated syncs from any set of devices converge to the same set of
  newest-per-id sessions, regardless of write order (the merge is commutative/idempotent on
  distinct ids; for the same id the newest `lastUpdated` always wins).

### Properties & boundaries (honest)
- This is **LWW per session**, not full CRDT field-level merge: two devices editing the *same*
  session concurrently resolve to the one with the newer `lastUpdated` (the older edit's
  changes to that one session are dropped — but no *other* session is ever lost). This matches
  the product (sessions are append-mostly; cross-device same-session concurrent edits are rare).
- Backward compatible: needs **no client change** — existing clients keep POSTing
  `{ sessions, lastApp }` and get the merge for free.
- A future stricter option (optimistic concurrency: client sends `baseUpdatedAt`, server
  returns `409` on a stale base so the client reload-merges) can layer on top without changing
  this server-side merge.

### Verification
`src/server/project/SyncMerge.test.ts` proves: cross-device sessions both survive, stale
incoming never clobbers a newer stored session (and vice-versa), the classic lost-update case
keeps the absent device's session, and `lastApp` preservation.
