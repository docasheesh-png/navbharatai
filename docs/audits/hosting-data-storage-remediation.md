# User-app hosting, database and storage remediation

Admin authorization: fix the audit findings, run full CI, merge only after green (2026-10-20).

| Finding | Change / acceptance evidence | Status |
|---|---|---|
| F1 SQL policy generation | PostgreSQL-compatible execution twice, long-name policy uniqueness, two-user RLS | Code fixed |
| F2 public key authorization | Verified ID token plus app key; server-owned row scope; legacy rows owner-only | Code fixed, existing apps need auth adapter and republish |
| F3 quota after reads | Transactional pre-query reservation, legacy counter migration, short exhausted cache | Code fixed; admission/auth overhead still exists |
| F4 unsafe upload signing | Mandatory real auth + atomic quota hooks, exact S3 size signature; bounded Cloudinary server upload | Recipe fixed; actual app callbacks and provider behaviour need integration verification |
| F5 private read scope | Caller uid predicate, actual PostgreSQL access-denial tests | Code fixed |
| F6 missing Cloudinary import | Generated relative-import closure checked even for unused imports | Code fixed |
| F7 public rollout isolation | Default-deny public hosting until credentialless mode AND explicit operator build/network attestations | Gate fixed; live isolation remains OPEN |
| F8 backup/restore | Existing truthful not-configured state retained | OPEN, authenticated inventory + restore drill needed |
| F9 complete cost visibility | Existing unmeasured gaps retained, no invented zero expense | OPEN, billing export and storage reconciliation needed |
| F10 pagination | Stable document-id continuation, per-user scope preserved | Code fixed |
| F11 inconsistent payment receipt | Separate charged/refunded/delivered/cleanup state; unknown debit outcomes preserve resources | Code fixed |

## Authentication migration

`X-Nbai-Key` identifies the app; `Authorization: Bearer <ID token>` authenticates a user. The current verifier trusts NavBharatAI's Firebase project. Tokens for an app's different Firebase/Supabase/OIDC project are **not** accepted just because their uid looks valid. Use that provider's own connected database/access rules, or deliberately integrate a supported trusted token provider. The browser helper exposes `configureNbaiAuth(getToken)`. It does not fabricate a user, a token or a login screen. Old key-only clients fail closed until updated. The app owner can recover/paginate legacy data using their verified platform session; records are not deleted or made public to avoid a migration.

No universal authentication service, arbitrary issuer support, cross-device anonymous account system or automatic migration of every saved customer app is claimed.

## Cost boundary

The operations allowance reserves capacity transactionally before reading records. Old shard totals migrate once. Lists reserve at most a page, release unused capacity after a successful query in the same period/key, and paginate by document id. Unknown work after provider failure is conservatively left reserved; no extra wallet debit occurs. A short negative cache reduces repeated exhausted reads. Auth checks, metadata reads and transactions still have a provider cost; this is not an absolute invoice cap or a distributed abuse firewall.

Upload quota is an injected atomic reservation against the app's real allowance. A failed provider upload may leave its reservation consumed, so implementations must reconcile failures deliberately, not refund blindly after an uncertain success. S3-compatible providers must enforce the signed content-length/type; test the actual provider. Cloudinary reads at most 10 MiB per admitted upload and permits two active buffers per worker, then uploads via its SDK. Existing apps using old generated source need a controlled patch/rebuild and publication.

## Remaining live infrastructure work

1. Run `scripts/verifyCredentiallessBuild.sh` in the correct apps project and retain its real build/probe evidence. Verify least-privilege build/runtime IAM and the egress policy before operator attestations are enabled. This PR does not set the public flag or those attestations.
2. Inventory managed Firestore backup/PITR and all app database/object-storage recovery. Configure the existing DR runbook using the actual project/bucket/roles. Run `scripts/restoreDrill.mjs` against staging and retain RPO/RTO results. Bucket presence alone is not restore proof.
3. Reconcile per-owner compute, requests, egress, builds, registry/object storage, database operations and backup expense against actual provider billing. Unmeasured values remain unknown, not free.

## Validation

Two-user access and legacy owner recovery, >20-record pagination, exhausted-call query suppression, actual PostgreSQL migration/RLS and executable generated upload routers are covered. Nine feature reversion experiments and two test-infrastructure reversions confirmed the guards fail when each bug is restored. Verification also repairs a parallel source-census race (generated temporary trees are excluded, real source errors remain fatal) and closes actual PGlite test engines after each test. The production browser shim is unchanged. Required local and GitHub CI gates are run on the final staged tree before merge. These tests do not replace live provider/IAM/backup verification.
