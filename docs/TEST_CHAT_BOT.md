# Admin Test Chat Bot: Qubax readiness and independent review

Open **Admin → AI Engines → Test Chat Bot**. This isolated surface uses Qubax only,
with no automatic retry or other NavBharatAI provider fallback. It does not change
ordinary Chat, App/Pro Builder, image, voice or embedding routing. The existing
13-position Chat chain remains unchanged, with Qubax after Mitrify and before
CheaperInference. Prompts and replies stay in component memory and are not saved
to conversation history, browser storage or audit records.

## Root cause and evidence limits

The earlier provider status checked only configuration. It did not inspect the
reviewed catalog, exact approval or shared budgets. The transport returned distinct
pre-dispatch skip reasons, but `runTestChat` collapsed them into `approval-or-budget`.
There was no admin route to record a legitimate independent review. These are
verified code defects. **The exact missing production prerequisite is not known
without a read of the intended deployed revision and its safety store.** No live
secret, production catalog, account balance or paid response was inspected during
this implementation.

Configuring `QUBAX_ENABLED=1` and a server key does not supply pricing, quality,
disclosure approval or enforceable supplier liability. A reported account deposit is not evidence of its current balance or this key's ownership.

## Read-only checks

**Check Qubax Readiness** submits the exact pending action to the authenticated
server and reads configuration, independent catalog signatures, pricing/quality/
supplier evidence, exact approval, maintenance/inference policy, and the existing
shared daily/monthly/per-user budget ledgers. It never calls Qubax, creates an
approval, claims a request or reserves money. Budget availability is a snapshot,
not a reservation; send repeats actual atomic admission. All pending read branches
retain a bounded capacity slot until settled, including after a caller deadline.

The result includes separate gate codes and operator actions, not raw Firestore
records or credentials. Missing, malformed, stale, unsigned/revoked catalog,
unverified prices/quality/supplier cap, missing/expired/used/mismatched approval,
duplicate request and insufficient/corrupt budgets are distinct. The diagnostic
is the current check's first failing gate, not a claim to have queried historical
provider logs. Request outcome, latency, actual reported provider/model and safe
error code are shown separately.

**Check provider balance** is a separate, explicit read. It calls only the official
fixed `GET https://api.qubax.ai/v1/billing/balance` with the existing server key.
It is never run on page load or as part of readiness. Its response is a bounded
USD balance snapshot or a fixed safe error; no raw response, key or account
identifier reaches the browser or logs. It proves neither the identity of a
previously funded account nor a supplier-enforced per-request cap.

## Independent reviewer setup: external prerequisite

The security operator must independently enroll reviewer public keys in the
server-only `QUBAX_REVIEWER_KEYS_JSON` configuration. This panel cannot generate,
register, replace or enable a trust key. **No trust keys are seeded, and this
change does not configure production trust or secrets.** Absent or malformed
setup is unavailable, never implicit approval.

The configuration is a JSON array of at most 20 exact-key records:

- `keyId`: unique 1–80-character identifier using letters, digits, `_` or `-`.
- `reviewerId`: the independently verified reviewer's identity, distinct from the
  server-authenticated requesting admin. A second login to the shared admin
  account is not independent review. Governance must verify human/organizational
  independence; differing identifier strings alone cannot prove it.
- `publicKeyPem`: an Ed25519 SubjectPublicKeyInfo `PUBLIC KEY`, never a private key.
- `purpose`: `qubax-catalog-review-v1` or `qubax-exact-payload-v1`.
- `enabled`: boolean; removing or disabling a key revokes its imported evidence.

Only current deployment-controlled keys authorize operations. Key-purpose
separation, signer identity, exact signatures and expiry are checked server-side
on import and again at selection/claim/dispatch. A revoked key archived in an old
receipt cannot restore authority. Rotate/provision keys through the separately
authorized deployment/security process, never by changing a client form.

## Recording a legitimately reviewed catalog

1. Obtain authoritative supplier enforcement evidence and independent exact
   model/revision, price, all-fee and quality review. **Do not fill unknown fields
   with optimistic values.** Public market observations never become a reviewed
   catalog automatically.
2. Run readiness to obtain `catalogDigest` (null if no active catalog). Give the
   independent reviewer this concurrency binding and the desired bounded workload.
3. The catalog reviewer prepares the existing `QubaxCatalog` schema in
   `src/server/lib/qubaxSelector.ts`, with real evidence references and original
   observation timestamps. Import allows at most 50 candidates, validates every
   candidate, rejects unknown fields, and preserves every original timestamp.
4. The reviewer independently signs a canonical payload with exactly: `kind`
   (`qubax-admin-catalog-review-v1`), `catalog`, `previousCatalogDigest`,
   `reviewedAtMs`, and `expiresAtMs`. The signed expiry is at most five minutes
   after review and no later than eligible catalog evidence. Import checks the
   current catalog digest and strictly increasing source observation time in one
   transaction, preventing replay, rollback and overwriting a concurrent update.
5. Paste the returned signed envelope into **Import reviewed catalog**. An import
   only records independently reviewed evidence; it makes no provider call and
   creates no payload approval. Refresh readiness afterward.

There is intentionally no copy-paste "approved" catalog example. An independent
signature authenticates the reviewer, **not the truth of an invented supplier
contract**. Qubax's public docs checked 2026-11-09 describe key-level routing,
best-effort trusted sellers, internal failover, prepaid funds and monthly key
budgets. They do **not** establish the required enforceable all-in per-HTTP cost
ceiling, exact downstream model/revision pin or comprehensive processor guarantee.
Unless independently obtained authoritative evidence establishes these, Qubax
must remain blocked. Never replace them with token estimates, `min_discount`, a
balance, a local reservation or a signed admin assertion.

## Exact-payload review and one explicit send

1. Use **Prepare synthetic test** for exactly:
   `What is 2 + 2? Reply with one number only.`
   Only this exact single user message with no history is server-classified public
   and limited to 16 output tokens. All other typed/history payloads retain the
   conservative private-and-health review requirement and 1,024 output-token cap.
   Clients cannot submit their own generation limit or data class.
2. Run readiness. When an eligible signed catalog and reviewer trust exist, copy
   the generated review package. Its `body` includes the selected model, and
   `wirePayload` is the exact JSON string sent as UTF-8; hash that string directly.
   It also identifies the request ID, payload
   digest, model/revision, evidence digest, maximum liability, expiry and opaque
   approval ID. The ID binds server UID, endpoint, credential generation,
   selected evidence and request ID; the credential and its digest are not exposed.
3. An independent payload reviewer checks the **entire actual wire payload** and
   all possible downstream processors, terms, disclosure authority and protections.
   They sign exactly these fields: `kind` (`qubax-admin-review-v1`), `approvalId`,
   `payloadDigest`, `requestId`, `model`, `modelRevision`, `evidenceBinding`,
   `maximumNanoUsd`, `reviewedAtMs`, `expiresAtMs`, and `dataReview`.
   `dataReview` contains `entirePayloadReviewed`,
   `gatewayAndAllDownstreamProcessorsReviewed`, `approvedDataClasses`, `reviewRef`,
   `disclosureAuthorityRef`, `processorTermsRef`, and `protectionsRef`, according to
   `QubaxSignedReview` in `qubaxReviewSignature.ts`. These declarations require a
   real review, not an admin checkbox. Review references should identify evidence,
   not contain copied private records.
4. Import the signed approval. The server recomputes every binding against a fresh
   catalog, uses its independently reviewed supplier ceiling, enforces a maximum
   five-minute approval expiry no later than selection/signature expiry, and
   atomically creates an immutable approval plus audit receipt. Existing records
   cannot be overwritten or resurrected. A new explicitly authorized request has
   a distinct approval binding; it still needs a new independent review.
5. Recheck readiness, then explicitly press **Send**. No import/check initiates
   inference. One request claims one approval and reserves the existing shared
   budgets before one HTTP attempt. Concurrent or duplicate sends cannot start a
   second call. The initial verification authorization remains **one paid
   synthetic request maximum**. This work performs none. A later separate test
   requires its own authorization and independent approval.

The disclosure checkbox confirms the intended destination for the submission.
It is never the independent review or authority to mint a supplier cap. Edits,
context changes, model/evidence changes, credential rotation and request-ID changes
invalidate the approval. Selection is force-refreshed before dispatch. Unknown
liability, cancellation, timeout, interruption or provider HTTP error does not
permit automatic replay or release of possible-spend holds. A text response is
not an invoice. Synthetic output is separately checked for `4`; a different valid
text response is not reported as passing that expected-answer check.

### Signing format

The envelope has exactly `keyId`, `payload`, and `signature`. `payload` is the
canonical JSON **string**: recursively sorted object keys, array order unchanged,
no whitespace, and JSON primitive encoding. Duplicate members/noncanonical strings
are rejected. `signature` is the unpadded base64url encoding of a 64-byte Ed25519
signature over UTF-8 domain prefix followed by that exact string:

- Catalog domain: `navbharatai:qubax-catalog-review:v1` followed by one NUL byte.
- Payload domain: `navbharatai:qubax-exact-payload-review:v1` followed by one NUL byte.

Canonicalization and verification contracts are exported in
`qubaxReviewSignature.ts`. The reviewer signs outside this shared admin session
with their separately controlled private key. Private keys are never uploaded.
The exact inference payload digest is SHA-256 of the UTF-8 `wirePayload` string.
Binding, review and send use one shared wire-body helper, including the selected
model and streaming usage options when applicable. The review packet's
`JSON.stringify(body)` equals `wirePayload`; it is distinct from the canonical
signing encoding and should not be reserialized by a different implementation.

The import action is `{ action, attestation }`, where `action` is the exact same
validated pending chat action and `attestation` is the envelope. Payload review
strings are bounded to 16,000 characters; catalog review strings to 128,000.
There is no arbitrary URL fetch, document attachment, client key-registration or
unchecked JSON-to-Firestore writer.

## Authentication, storage and auditing

All routes use the existing server admin token gate and no-store responses:

- GET `/api/v1/admin/test-chat-bot/providers` (configuration presence only).
- POST `/api/v1/admin/test-chat-bot/readiness` (exact pending action, read-only).
- POST `/api/v1/admin/test-chat-bot/catalog` (independently signed evidence import).
- POST `/api/v1/admin/test-chat-bot/approval` (independently signed exact review).
- POST `/api/v1/admin/test-chat-bot/balance` (empty object, explicit metadata read).
- POST `/api/v1/admin/test-chat-bot/chat` (one explicitly initiated dispatch).

The permanent unversioned compatibility URLs remain available. The central
parser limits readiness/chat/approval JSON to 256 KiB, catalog JSON to 512 KiB,
and balance to 1 KiB. Reads share a 30/minute limit; sends/imports share 6/minute.
Typed context stays bounded to 64 alternating messages and 32,000 total characters.

Firestore client rules remain default-deny for `qubax_catalog`,
`qubax_chat_approvals`, and `qubax_review_audit`. The active catalog is replaced
atomically. Approval and immutable audit records deliberately persist as replay
and liability fences. Audit receipts archive the bounded signed evidence envelope,
public SPKI verification key, fingerprint, purpose, actor hash and timestamps for
historical verification. No prompt, response or credential is in those receipts.
Archived keys never authorize live use. The request audit log contains only
server actor, operation/request IDs and fixed safe outcome codes, never envelopes,
raw upstream bodies or private conversations.

The ordinary Chat path retains its existing trusted-server legacy evidence format
for compatibility. **Admin test sends require independently signed catalog and
payload evidence.** Imported signed evidence is reverified even when used by a
legacy consumer, so trust revocation cannot be bypassed through that path.

## Verification status and commands

All added automated scenarios use generated ephemeral test signing keys, synthetic
credentials, in-memory transactional stores and mocked network responses. The new
lifecycle test exercises real import/readiness/transport code returning mocked `4`,
including concurrent claims. It is not a live provider result, invoice, production
configuration check or actual-emulator proof of the new import transactions.

Focused command (run only when the shared validation slot is available):

```sh
npx vitest run src/lib/testChatBot.test.ts src/server/lib/testChatBot.test.ts src/server/lib/qubaxReadiness.test.ts src/server/lib/qubaxBalance.test.ts src/server/routes/testChatBot.test.ts src/components/admin/TestChatBotPanel.test.tsx tests/qubaxSelector.test.ts tests/qubaxTransport.test.ts tests/everyCollectionIsClassified.test.ts tests/everySubcollectionIsClassified.test.ts tests/adminActionsNeedAReason.test.ts tests/aRequestBodyIsOnlyAsLargeAsItsRouteNeeds.test.ts
```

The repository's full current CI workflow, coverage, typechecks, lint/source
censuses, build/boot/dependency gates and applicable database drills remain required.
Do not call unrun checks passed. Production deployment, trust/secret configuration,
real supplier enforcement evidence and a separately authorized single live test
remain external gates. No status is complete without its own evidence.

Official references checked read-only:
https://qubax.ai/docs/chat-completions
https://qubax.ai/docs/routing-modes
https://qubax.ai/docs/pricing
https://qubax.ai/legal/privacy

### Final maintenance and policy boundary

Admin paid tests use a request-scoped observed-maintenance revocation latch and a
strict initial status read: an unavailable status blocks this isolated test even
when the general serving path retains its existing recent-off fail-open behavior.
The final catalog/approval transaction also reads `platform_settings/ai_maintenance`.
A missing document retains the existing default-off policy; an existing malformed,
paused or unavailable state cannot authorize the call.
An opt-in observer also latches locally known failed reads or watch errors without
changing the general serving policy. Immediately before HTTP,
the request checks its observed-maintenance latch and the current synchronous
inference policy, without an intervening await. Listeners are always removed.
Readiness likewise rechecks config, signing roots, evidence expiry and observed
policy changes after its awaited reads, rather than labeling old gates freshly ready.

This gives a coherent authorization snapshot at atomic admission and immediately
honors locally observed revocation. It cannot synchronously observe a remote
maintenance write that occurs after admission but before watcher delivery, and it
does not claim to cancel such an unseen change or revoke an already dispatched call.

The separately added real-emulator transaction drill is invoked with:

```sh
npm run test:qubax-readiness:emulator -- --emulator 127.0.0.1:18781 --project demo-navbharatai-phase2
```

It requires the loopback demo-project emulator and uses only synthetic credentials
and mocked provider calls. Its execution status must be reported separately from
source review and the unit suite.
