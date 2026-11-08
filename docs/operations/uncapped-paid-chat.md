# Uncapped owner-funded chat

This mode removes the daily and monthly monetary admission ceilings for the legacy free-tier paid fallback and Free Chat Chain. It does not promise unlimited provider capacity. Rate limits, privacy attestations, model allowlists, per-user counts, request deadlines, provider balances, and the separate Inference Gateway plan limits remain enforced.

## Deploy and activate

1. Pass required CI and deploy this version to every serving instance. Retire older revisions first, with an atomic traffic cutover where supported: older code does not understand the new mode and can reinstate finite limits. Do not leave mixed-version traffic serving.
2. The first Free Chat Chain turn or legacy paid admission automatically migrates the shared policy once to `budgetMode: "uncapped"`. No admin activation is required. The transaction increments its revision, records a deployment audit, and stamps `uncappedRolloutVersion: 1`; it never resets accounting. It applies to all users, not only administrators.
3. Existing safety-trip policies are not overridden. A later explicit capped/zero admin change remains authoritative because the migration marker is preserved. Investigate a safety trip rather than deleting it.
4. Verify the deployed revision, trigger an authorized ordinary chat smoke test, then read the admin status for **Uncapped (usage still recorded)** and the incremented policy revision. Inspect actual provider outcome and quota/balance. Merging code alone is not evidence of live restoration.

The finite `capUsd` field remains a standby capped-mode value, not the effective ceiling in uncapped mode. Remaining money is `null` in uncapped snapshots; mode distinguishes this from an unavailable authority. Neither JSON Infinity nor a fake large budget is stored. Existing holds, settled costs, original accounting days, replay tombstones, and audit records are not reset. Monthly holds continue recording usage beyond the old monthly ceiling. Unknown usage still retains liability.

## Return to capped mode

Use the normal reviewed budget change to a finite amount, including zero to block further monetary admission. The revision-checked change returns to capped mode even if the finite amount is unchanged. It does not cancel already-dispatched work or erase holds. A capped deployment observation can then reinstate a lower limit as before. Before rolling back to an older application version, explicitly return the authority to capped mode and verify it.

The separate Inference Gateway's authorized plan budgets are deliberately unchanged. Keep the existing Gateway-OFF setting for this activation unless that separate system has its own reviewed configuration. Merging alone does not change live state. Once deployed, normal chat traffic performs the one-time policy migration.
