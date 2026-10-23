# Shared Free answer ceiling

This policy does not activate the inference gateway or change provider selection, prices, paid fallback budgets, or wallet billing. It applies with the legacy provider route and with an independently enabled gateway.

## Scope and entitlements

- Signed-in accounts: 20 answers per India calendar day, combined across both Free chat aliases, Free-classified professional chat, fully-Free exam generations (one usable paper = one answer), and authenticated Repo Analyst chat/generate.
- Guests: five Free-chat answer credits per India calendar day. Existing shared guest device/IP attempt protections remain across all guest-accessible surfaces. These are abuse limits, not five guaranteed successful provider responses. Clearing a device ID cannot remove the trusted-address attempt backstop; IPv6 address grouping is preserved.
- The existing professional/Doctor allowance and paid-after-free behavior remain unchanged. The shared ceiling is not a grant of 20 professional answers. Mixed/paid exam papers, paid professionals, Doctor/SDA, Pro Builder tiers, images and nonconversational tools retain their own policies.
- Reaching this ceiling refuses the request; it never switches the request to a paid route. The existing shared $10/day paid gateway cap is untouched.

## Atomic admission, failures, and retries

Firestore transactions reserve one answer before expensive work and enforce one logical active answer per verified account (or guest device/address). A 30-second renewable ownership lease has a 90-second request deadline. All new dispatch/fallback and visible output are fenced against lost/expired ownership. Normal completion releases ownership. A process crash leaves its credit consumed as uncertain; the logical lock expires rather than permanently blocking the user.

A real successful response or non-whitespace provider text already delivered counts once, including an interrupted partial answer. Synthetic busy/error notices do not count. A known no-answer provider failure restores the user's answer credit exactly once. A client disconnect without output, expired ownership, lost settlement, or other uncertain result does not automatically refund. Late callbacks cannot refund or release a newer owner's reservation. Restoring an answer credit never refunds provider spend, quota, model occupancy, or uncertain money holds.

This is logical user-turn admission, not proof that every physical upstream request has stopped. Streaming and supported SDK requests receive cancellation. Some already-dispatched legacy nonstream calls cannot be cancelled through their existing provider interface and may continue to their existing timeout; subsequent dispatches/output are fenced. The gateway's stricter physical-provider/accounting controls remain independent.

Each logical client send has one UUID reused across retries and endpoint fallback. Durable principal-bound request records reject duplicate execution, including across midnight and after failure. The ID is not authorization. Older clients without a valid UUID receive a fresh server ID and remain subject to the same quotas. Separate daily attempt ceilings and existing rate limiters limit deliberate repeated failures; duplicate/busy/shared-limit rejection does not consume the old guest attempt allowance.

## Status and reset

`GET /api/free-answers/status` is no-store and independently rate-limited. Identity comes only from Firebase verification or the validated guest device/trusted address, never a requested user ID. It returns remaining answer credits, consumed credits, current-day reservation, active generation, and the next midnight IST. An answer admitted before midnight keeps its original-day credit while its active lock still applies across midnight.

The badge rechecks on account changes, focus, visibility, turn completion, cross-tab invalidation, and midnight. It never treats browser storage as authoritative, never invents a count when status is unavailable, and does not disable paid actions. Existing professional/question allowance displays are preserved.

## Storage and retention

The new `free_answer_quota` collection is server-only under existing default-deny Firestore rules. Keys/ownership use SHA256-derived identity, not raw UID/IP/device IDs; no prompt or response is stored. Account erasure uses the exact hash of the verified account identity. Guest/shared-address records are not attributed to an account.

Records carry an eight-day expiry for the existing bounded scheduled retention service. Reusable principal records have no Firestore TTL: the retention transaction rechecks expiry and active ownership, so a freshly renewed/reserved record cannot be removed by a stale purge selection. No production TTL/index/credential/flag setup is performed by this change.

## Validation boundary

All inference tests use mocks or local storage fixtures. No live inference, credentials, provider account verification, or production settings changes are required or performed. Hosted CI on the repository's target runtime is the final merge gate.
