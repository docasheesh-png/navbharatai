# Initial lane answers are not parser failures

## Failure and boundary

The initial SimpleBuilder manifest and OneShot file-block lanes used to convert every zero-artifact response into a parser failure. An explicit decline therefore lost its original answer and started another generation lane before the route's existing final-answer safeguards could inspect it.

The shared initial-lane reader now produces additive, typed decline metadata. Its contract is deliberately narrow:

- Accepted raw artifacts take precedence, before scaffold filtering, entry injection or minimum-file thresholds.
- The same initial, unambiguous statement must satisfy existing refusal semantics and a direct action construction. Quoted, conditional, indirect and affirmative-idiom examples stand down.
- Fenced code, partial file envelopes and structured/malformed manifest attempts keep existing recovery.
- Unsupported wording, empty output and non-decline parser failures keep existing fallback. This is not a general policy classifier or a promise to recognize every language or preamble.
- The original answer is retained byte-for-byte. Provider errors are not model answers.
- The boundary is the initial response only. Shared-contract, per-file, repair and partial-work handling are unchanged. Stop and timeout retain precedence.

## Caller settlement

A trusted initial decline settles as `ok: false`, with the original `modelAnswer`, the accumulated usage and no build-readiness claim. The lane's write lease is revoked. No later lane is purchased solely to recover that answer.

A stable caller flag prevents two existing maintenance admissions from manufacturing artifacts after a text-only answer: the post-answer integrity block and the finishing-pass invocation. Other turns retain those passes. It also suppresses the misleading high-cost “try again” narration for this answer, not the cost cap or accounting.

The handler does not return early. Original answer capture, existing retry/upsell safeguards, usage reconciliation, diagnostics, zero-artifact billing and finalization remain in the normal flow. No provider, authorization, payment or HTTP API contract is changed.

The normal final-outcome branch records an informational, resolved `OUTCOME_INITIAL_DECLINED` only for this trusted, non-aborted state when no stronger outcome exists. Unknown failures and aborts keep their old behavior. If finalization later throws, only this new informational outcome yields to the actual exception: an existing sandbox-unavailable outcome or a neutral finalization-failed outcome. Other prior outcomes and ordinary exception behavior remain unchanged. The outcome has neutral panel/retrospective labels, is not an app finding or a repair suggestion, and cannot count as completed-delivery ETA evidence or successful readiness.

## Regression proof

`tests/initialLaneDecline.test.ts` exercises the real builders and shared reader with synthetic responses, including successful generation, accepted raw artifacts, malformed recovery, original text, Stop, timeout and later-stage preservation.

`tests/initialLaneDeclineRoute.test.ts` is a bounded caller-effects integration harness. It executes actual route AST statements with real builders, write leases, deterministic mutation helpers and diagnostics against an in-memory workspace. It covers both terminal routes across clean, integrity-trigger and existing-E2E fixtures, plus non-decline positive controls and low/high usage. Independent reversion witnesses show the protected handoffs and writes reappear when each admission is removed.

`tests/initialLaneDeclineOutcome.test.ts` covers the explicit outcome readers, readiness non-proof, no repair suggestions and non-delivery ETA measurement.

This is not a complete HTTP/provider/storage replay. The harness explicitly names the route slices it executes; hosted exact-head CI remains the full repository gate.

Targeted validation:

```sh
npx vitest run tests/initialLaneDecline.test.ts tests/initialLaneDeclineRoute.test.ts tests/initialLaneDeclineOutcome.test.ts
```

All published fixtures are synthetic. Retained request/response text and private report/account/workspace metadata do not belong in repository tests or documentation.
