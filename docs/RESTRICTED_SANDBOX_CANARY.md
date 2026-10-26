# Dormant restricted sandbox envelope — not an activated benchmark

This change adds no public route, client activation field, authority issuer, provider
credentials, account mutation or live run. The existing model guard stays restricted;
FlashX admission is a separate narrow engineering slice; it does not require duplicate
provider permission within the already approved API scope. A future driver must
enter the model and privacy scopes before any prompt/context assembly. This controller
is not that driver and must not be reported as a completed app benchmark.

## Exact envelope

A server-reviewed manifest binds UID, job, synthetic fixture hash, deterministic isolated
workspace, immutable template evidence, provider credential digest, account tariff,
2-vCPU/4-GiB resources, all-resource billing window and explicit all-cost authorization.
Missing proof is refusal. Public rates are merely floors, never invoice evidence.
The model authority binds the manifest hash. Compute is reserved in the SAME durable
liability total as API calls; subsequent API calls retain the stricter combined cap.
The maximum is 100,000 paise, not a new allowance per app or component.

The create adapter makes exactly one pinned REST POST with `redirect: error` and no
retry, bounds response size and timeout, and validates connection fields before the
locked SDK's local-only constructor. Unknown outcomes keep the reservation.

One optimistic transaction creates the global workspace claim before any provider work.
The provider call happens outside the retriable transaction. There is no replacement,
reconnect, resume, TTL extension, SDK retry, or reservation refund. A crash, lost database
acknowledgement or unknown HTTP result cannot silently create a second VM. Cross-worker
halt is checked before each tool. Raw native handles/IDs never leave the controller or
enter normal SandboxStore, logs, public preview URLs or fixture results.

The absolute **job/tool** deadline is not an absolute provider kill guarantee. E2B create
accepts a relative TTL: a late unknown creation may outlive the local job deadline.
Reserve the whole reviewed provider TTL/billing-rounding window even then; retain the
hold, abort locally, and attempt a bounded kill only if a handle becomes known. Do not
claim a timed-out create was cancelled or that a kill/refund succeeded without evidence.

## Restricted execution, not normal production routing

Creation explicitly uses lifecycle kill, auto-resume false, no replay, an empty
environment, no public traffic and provider-level deny-all egress. A verified immutable
template must already include Node, Vite, React, Playwright/browser and the read-only
runner/config/journey files in `scripts/benchmark-sandbox`. No npm install, arbitrary
shell, user package scripts, project Vite configuration, external URLs, MCP, deploy,
DNS, database provisioning, keys or payment operations are allowed.

Only bounded source/public file read/write/list and fixed build/test commands exist.
The runner rejects traversal/symlinks and caps files/output/time. The template must
also enforce unprivileged filesystem/process confinement: path prechecks alone are
not proof against a concurrent malicious process changing directory symlinks. This
OS/template property has NOT been verified or provisioned by this patch.

The supplied browser journey is explicitly **one English, accessible todo fixture**:
add, reload persistence, complete, delete and mobile overflow/screenshot. It is not
all ten fixture journeys, a Hinglish-label evaluator, hosting/database coverage, or a
successful result merely because a model returned source. No template has been built
or deployed, and no cloud sandbox has executed these scripts.

## Isolation and ordinary traffic

Valid normal app workspaces have the `agentv3-` prefix. Isolated workspace names are
server-derived `nbai_canary_v1_` hashes of owner/job/fixture and are structurally disjoint.
Normal actuator acquisition/heartbeat/viewer-ping refuses that namespace even outside
ALS. Existing ordinary IDs and behavior remain unchanged; no global registry lookup
is added to normal requests.

Traced resume routes obtain native IDs only from the owned workspace SandboxStore;
its writer uses the normal actuator and clients cannot write its collection. The new
controller never joins that graph. Source census tests require review when another
resume caller or writer appears. This is evidence for the traced paths, not a promise
that arbitrary future internal callers cannot misuse provider IDs.

**No private-reader integration ships in this controller-only slice.** Vault, attachment,
episodic and engineering-memory source files remain exactly as on the base revision.
The isolation scope is only a dormant primitive; ordinary readers do not consult it.
It must not be described as protecting private context or permitting safe prompt ingress.
A future integration requires separate review before any prompt/context assembly or
model orchestration. Captured context is not retroactively sanitized. Source census
checks keep production controller/driver entry points absent in this slice.

## Existing template evidence is not an isolated-template receipt

`infra/e2b/build.mjs` and `.github/workflows/e2b-template.yml` configure the ordinary
`navbharat-builder` default at 2 vCPU/4096 MiB. Runtime template selection still reads
`E2B_TEMPLATE_ID`; committed defaults do not prove the deployed template ID, digest,
or billed shape. The ordinary Dockerfile has useful preinstalled dependencies, but
not the immutable `/opt/nbai-canary` runner or verified process/filesystem confinement.
A separately reviewed, hashed trusted bootstrap into a verified existing template may
be sufficient if it establishes root-owned read-only runner files and an unprivileged
workspace-only build identity before model-authored execution; a new template is not
inherently mandatory. Neither that bootstrap nor a replacement template is deployed here.

## Still required before live use

- Explicit answer covering API plus sandbox/fees inside the same total allowance.
- Verified account-specific provider prices, fees/FX ceiling and billable resource/window
  contract, including one physical creation request producing at most one sandbox.
- Complete command transport containment: the locked SDK RPC transport follows redirects.
  A pinned one-shot create does not by itself prove command credential containment.
- Verified immutable offline template, actual resource shape, no-egress/no-credential
  contract and unprivileged filesystem/process confinement.
- Reviewed private-reader integration and safe prompt/context ingress; neither ships here.
- Current account eligibility and trusted synthetic driver/fixture binding, with all
  model, tool, queued and auxiliary descendants inside their reviewed scopes.
- Independent review and required CI, then separate activation review. No safety
  claim here authorizes creating credentials, subscriptions, recharges or cloud resources.

Primary contract references: https://github.com/e2b-dev/E2B/blob/main/packages/js-sdk/src/sandbox/sandboxApi.ts
and https://github.com/e2b-dev/E2B/blob/main/spec/openapi.yml . Installed locked SDK declarations
and runtime implementation are also checked; external `main` documentation is not a
substitute for the deployed account/template contract.
