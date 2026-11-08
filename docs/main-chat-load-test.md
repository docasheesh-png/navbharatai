# Main-chat staged load preparation

This is **offline preparation**, not a production load result. No model, HTTP,
authentication, quota, cache, database or provider pipeline is exercised by the
scheduler rehearsal. The intended live target is `POST /api/v1/chat/navbharat`.
The separate Mitrify bot and App Builder are outside this test.

## Reproduce the artifacts

```sh
node scripts/mainChatLoad.mjs manifest /tmp/main-chat-manifest.json
node scripts/mainChatLoad.mjs simulate /tmp/main-chat-rehearsal.json
npx vitest run tests/mainChatStagedLoad.test.ts
```

The CLI deliberately has no live mode, credentials, endpoint override or HTTP
transport. The exported scheduler accepts only an injected offline fixture
transport; it is not a way to authorize requests. A fixture with known answers
validates the scheduler and grader, not AI accuracy. Reports omit answer content
and arbitrary error strings. The manifest contains synthetic public questions and
their answer keys; answer keys are never in the request body.

## Workload and interpretation

Stages are 10, 100, 1,000 and 5,000 barrier-released clients, waiting for each whole
stage to settle. Then 1,000 synthetic conversation identifiers each ask one
question in each of four globally synchronized rounds. Total: **10,110 logical
requests**. The four rounds use inventory arithmetic, unit conversion, ordering
and code tracing. Every question changes the problem operands, rather than adding
a meaningless nonce to a repeated prompt. These are 10,110 distinct instances of
four deterministic task families, **not** 10,110 domains or a general intelligence
benchmark. No tool execution or structured-output API options are used.

Conversation history contains only the same user's completed synthetic turns.
Any incorrect, empty, partial, refused, cancelled or failed result stops subsequent
stages; already released peers settle. There are no automatic replays. A request
deadline aborts the fixture signal, and late callbacks are ignored. A future real
transport must actually honor cancellation; a local deadline cannot undo charges
or prove that a server stopped work.

Each stage records actual client launch spread, peak pending clients, latency and
TTFT p50/p95/p99, outcomes, HTTP 429/503 and deterministic correctness. Four-round
success requires all four complete answers to pass independently. First token is
the first nonempty content chunk, not connection acceptance or heartbeat.
Provider/admitted concurrency, physical requests, cache and costs remain explicitly
unknown. A barrier on one event loop does not mean zero launch spread, and 5,000
pending clients does not mean 5,000 simultaneous provider calls. Unique prompts do
not prove a cache miss. Do not infer one provider call per logical request.

## Live prerequisites (not implemented or verified)

The user authorized **₹1,000 total**, including retries and necessary fees, for
this main-chat campaign. This is permission, not an implemented runtime ceiling.
The previous separate Mitrify $10 campaign is not funding for this one.

Before a live adapter or dispatch, an operator must provide:

1. An authorized runtime with permitted destination access and a verified deployed
   revision. The current preparation environment has no outbound cloud identity,
   production runtime variables or secret bindings, and its enforced destination
   allowlist does not include the production chat host. No denied destination was
   retried.
2. Legitimate, isolated test principals/sessions and a reviewed admission plan for
   the unchanged main-chat authentication, guest IP buckets and 20/min/account
   limiter. Synthetic identifiers in this manifest are **not** real identities.
   Do not inject trusted headers, forge sessions, rotate IPs, disable guards or
   create thousands of real accounts. A one-account run mostly measures throttling,
   not 1,000 distinct-user capacity. A staging simulation must be labeled staging.
3. Verified aggregate monetary admission tied to this campaign, runtime and all
   selected suppliers: atomic reservations for documented worst-case charges,
   every retry/failover, concurrent workers and necessary infrastructure fees,
   with no overdraft or unaccounted pre-existing obligations. Alternatively an
   equivalent enforceable capped prepaid arrangement covering all those charges.
   A request counter, estimated tokens, cancelling after dispatch, or the approved
   ₹1,000 number in this manifest is not such enforcement. No new cap is invented.
4. Server-correlated admission, physical attempt, completion, cache and settled
   cost evidence scoped to this campaign, without prompts or credentials. The
   current route emits `{c}` chunks, `{s}` status, error/code/partial events and
   `[DONE]`. It can emit a stalled-answer notice followed by `[DONE]`; therefore
   `[DONE]` alone is insufficient completion proof. Unknown finish/refusal/cache
   or cost evidence must stay unknown, not inferred from answer prose. Do not
   grade the model's own claim of correctness.
5. An approved operating window, bounded deadline, ordinary-user protection and
   stop conditions. Stop escalation after capacity/safety failures or budget
   uncertainty, settle in-flight accounting, and do not replay ambiguous charges.
   Confirm the load generator can measure socket/write launch spread separately
   from local scheduling, plus server and provider admission concurrency.

Once those prerequisites exist, a separately reviewed real adapter must preserve
the existing route and policies, parse incremental SSE across packet boundaries,
propagate disconnects, retain user-isolated history, and attach verified evidence
to a real report. This preparation does **not** add a test-auth bypass, server
endpoint, production setting or dormant production execution switch.

## Accuracy and capacity claims

Exact closed-answer checks deliberately reject extra text and incomplete answers;
they do not establish usefulness for open-ended questions. Report this benchmark's
format failures separately from a broader human-reviewed correctness assessment.
No 99.9% reliability, production throughput, cache avoidance, provider concurrency
or live cost conclusion can be drawn from the offline rehearsal.
