# Phase 1 dependency security review

Reviewed: **2026-10-20 UTC**. Baseline: `adc53ee215beb5b7f7c5042245b2817c16a2deca`.
Manual exception re-review due: **2026-11-03**, or sooner when the upstream fix or dependency reachability changes.

## Measured result

`npm audit --json` reports vulnerable **package entries**, including inherited dependency chains; these counts are not distinct vulnerabilities or confirmed exploits.

| Audit | Critical | High | Moderate | Total |
|---|---:|---:|---:|---:|
| Baseline committed lockfile | 0 | 5 | 28 | 33 |
| Patched lockfile | 0 | 4 | 21 | 25 |

The high/critical gate passes with **four explicit reviewed exceptions**. This is not a zero-vulnerability claim. The three CLI-related high entries share one underlying advisory; the other is an unreachable signature-verification path in the keystore-generation dependency. Production credentialed flows and deployed containers were not exercised by this dependency review.

## Compatible fixes applied

- `brace-expansion`: every installed 1.x copy `1.1.18 -> 1.1.21`, 2.x copy `2.1.4 -> 2.1.7`, and 5.x copy `5.0.9 -> 5.0.12`. This addresses GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p and GHSA-q2hr-2g5m-vwhr while retaining each parent's major version and CommonJS API. The old blanket v5 override was previously incompatible with legacy glob/minimatch; it is not reinstated.
- `fast-uri`: `3.1.7 -> 3.1.9`, minimum override raised to `^3.1.9` (GHSA-hrr3-gc8f-f4qj).
- `ip-address`: `10.4.0 -> 10.7.4`, minimum override raised to `^10.7.4` (GHSA-rpw4-54j3-4h4q, GHSA-2vr4-cq9g-pvrc, GHSA-j6r3-76f7-8jcv, GHSA-h3mg-xc3c-68pw).
- `hono`: `4.13.3 -> 4.13.13` (GHSA-gqvv-2mrq-wpjv, GHSA-g6gw-c38x-mqfc, GHSA-crvj-82cr-hjcx, GHSA-hxh3-vqpv-xpqv).
- `morgan`: `1.11.0 -> 1.12.1` (GHSA-jxfw-x594-9x9m, GHSA-9f6g-j8ch-79g4).
- `postcss-selector-parser`: `7.1.5 -> 7.1.6` (GHSA-rj75-hqrm-r3gf).
- `dompurify`: `3.4.8 -> 3.4.17` through a scoped `monaco-editor` override. Monaco 0.56.0 pins its old patch exactly; the override updates only that sanitizer dependency, retaining the editor API. Removes its reported sanitizer advisories (GHSA-cmwh-pvxp-8882, GHSA-vxr8-fq34-vvx9, GHSA-55q2-fjhq-7xh7, GHSA-c2j3-45gr-mqc4, GHSA-6688-9rhm-gjv2).

No direct native, payment, database, editor or AI SDK major version was changed. No forced audit fix, package downgrade or high/critical gate weakening was used. Obsolete allowlist entries, including the fixed brace-expansion exception, were removed; a new high/critical in those packages must be reviewed again.

## Remaining high exceptions

| Package entries | Advisory and current upstream state | Actual reachability and required follow-up |
|---|---|---|
| `node-forge@1.4.0` | GHSA-86w9-cpqp-85rv: RSA PKCS#1 v1.5 signature verification accepts malformed signatures. Registry latest remains 1.4.0; audit reports no fixed version. | Only production importer is `src/server/lib/androidKeystore.ts`, creating/self-signing certificates and exporting PKCS#12. RSA key generation uses native Node crypto; it never verifies an untrusted signature. Existing `tests/nodeForgeNeverVerifies.test.ts` rejects another importer or verification call; `tests/androidKeystore.test.ts` reads generated keystores back. Update immediately when patched, or replace/re-review before any verification use. |
| `braces@3.0.3`, inherited by `chokidar@3.6.0` and `firebase-tools@15.28.2` | GHSA-vfj7-8cjw-p6xm: nested-pattern stack exhaustion. Registry latest braces remains 3.0.3; latest firebase-tools 15.34.0 still declares chokidar `^3.6.0`. | All three lock entries have `dev: true`. Chain: firebase-tools -> chokidar -> braces. No production application importer in `src`, `scripts`, or `server.ts`; not retained in a production `npm prune --omit=dev` dependency graph. CLI patterns are trusted repository/deployment configuration, not application user input. A chokidar v4 override would be a breaking parent substitution and was not made. Upgrade when the supported parent removes or patches the chain. |

`.audit-allowlist.json` records `reviewedAt`, `reviewBy`, exact advisory IDs and this evidence. **`reviewBy` is a manual deadline, not an automatically enforced expiry.** The gate still blocks a new high/critical advisory ID inside an already excepted package.

## Remaining moderate backlog

The remaining 21 package entries are visible in the audit and are not treated as fixed:

- Firebase deployment CLI chains: `@google-cloud/pubsub`, `@opentelemetry/core`, `body-parser`, `csv-parse`, nested `express`, `qs`, `stream-json`. Application Express/qs use their separate non-flagged copies. Several fixes require a parent/major upgrade; do not force the CLI's stream/parser dependencies across majors without deploy/emulator validation.
- Runtime Firebase administration chains: `firebase-admin`, `@google-cloud/firestore`, `@google-cloud/storage`, `gaxios`, `google-gax`, `retry-request`, `teeny-request`. The current parent is 13.10.0; npm suggests a Firebase Admin 14.5.0 major upgrade. Validate storage, token verification, transactions, retries and deployment compatibility in that migration. Do not label the aggregate entries unreachable merely because the CLI also uses some of them.
- Document parser chain: `mammoth`, `argparse`, `sprintf-js`. The advisory is unbounded precision in sprintf-js, not a reason to downgrade mammoth to 0.3.29. Production document parsing uses mammoth; further review must establish whether application-controlled format strings reach this path before accepting a risk or replacing the parser.
- Legacy UUID/native tooling chain: `uuid`, `exceljs`, `xcode`, `@capacitor/cli`. The reported UUID advisory concerns caller-supplied output buffers for v3/v5/v6; a blanket UUID major override could break legacy consumers. Keep separate Excel roundtrip and native generation checks during any parent migration. npm's suggested ExcelJS/Capacitor downgrades are not accepted as security fixes.

These moderate items remain tracked work. An npm audit alone does not demonstrate their exploitable reachability or absence of risk.

## Validation and reproduction

Run with the repository's declared Node 22 runtime for final CI validation:

```sh
npm ci
npm audit --json
npm run audit:gate
npx vitest run tests/auditGate.test.ts tests/nodeForgeNeverVerifies.test.ts tests/androidKeystore.test.ts tests/aSpreadsheetIsAFileNotAnApp.test.ts
npm run typecheck
npm run typecheck:server
npm run build
npm run native:guard
```

A direct local compatibility probe exercised real `src/server/{lib,routes}/*.ts` brace patterns through legacy CommonJS glob 7 (ExcelJS/archiver-utils), Firebase glob 10, and E2B glob 13; all returned real matches. This specifically checks the historical CommonJS export-shape failure without a cross-major override. Full CI results and merge evidence belong in the phase roadmap/PR; they are not assumed by this document.
