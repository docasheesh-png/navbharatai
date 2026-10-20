# Weak tier: candidate policy versus current routing

Status: implemented behind `AGENTV3_WEAK_SCOPE_POLICY=on`; off/unset keeps current routing. Not deployed or benchmarked against paid provider calls. User request on 2026-10-20 authorizes this candidate for review. Normal and Strong policies are unchanged.

| Concern | Current code | Candidate |
|---|---|---|
| Scope | Binary score with an optional free-router second opinion | One FlashX call for non-template, non-import Weak build/edit requests; exact simple/complex/strong label |
| Classification cost | Depends on router and ambiguity | At most one provider request, 8 output tokens, 5-second timeout, thinking disabled, no SDK retries |
| Simple implementation | FlashX leads | FlashX leads |
| Complex implementation | Skips cheap opener | Kimi leads, including planning |
| Oversized request | May enter full builder | Strong-required is answered before sandbox setup; request can also be narrowed |
| Classifier failure | Usually falls back to cheap build | Does not start unchecked coding; asks to retry or narrow scope |
| Automatic coding fallback | FlashX → Kimi → GLM-5.3 → Nemotron → Haiku | FlashX → Kimi; admin can deliberately override ladder for experiments/emergencies |
| Empty initial build | Can regenerate once | No automatic whole-build regeneration |
| Text-only repair | Multiple lanes/passes | One shared allowance across fast repair and four recorded repair gates, Kimi heal route |
| Cost ceiling | Default $5 measured provider ledger | Default $1 for candidate Weak, adjustable with `AGENTV3_WEAK_BUILD_COST_CEILING_USD`; a smaller global ceiling wins |
| Ready verdict | Existing production/runtime/feature proof gates | Existing proof gates remain in force; classification never awards success |
| Templates/contracts | Existing golden scaffolds and shared-contract machinery | Reused; no additional login/database starter was created in this change |

## Why three labels

Authentication + CRUD is complex enough to justify Kimi upfront but not automatically too large for Weak. A full commercial online battle-royale or large persistent multiplayer strategy game is beyond Weak's budget/scope. A landing page, score tracker, or explicitly small offline prototype about the same game must be sized by the requested implementation, not by the brand name. The classifier receives these distinctions and reads all languages.

The call is an estimate, not a confirmation of feasibility. Strong is an upgrade option, not a promise that a full PUBG-equivalent game can be delivered in one build. The actual selector path is **⚙️ Build options below the message box → Strong**, rather than the global app Settings page. Free users may need wallet credits to unlock it. Public replies expose no model/provider names.

## Cost comparison

Use **actual provider spend per verified working app**, not price per token alone:

`total measured provider spend / number of builds that pass delivery proof`

Also compare first-attempt proof rate, repairs, unanswered calls, completion time, refusal false positives, and saved incomplete work. Replay the same prompts and starter versions under both configurations. Do not report historical build reports as controlled model benchmarks: their prompts, versions, provider health, and routing differ.

The classifier's measured accepted-call usage is included in the provider ledger; rejected preflights log their usage on the server and charge the user zero. No percentages of savings or first-attempt success are claimed without real paired runs.

## Limits requiring further measurement/work

- The dollar ceiling is enforced **between reported turns**. One in-flight call can overshoot it; unreported provider usage and auxiliary paths outside the ledger are not a guaranteed hard invoice cap. Shadow observations are not added to billed ledger entries because some calls appear in both.
- The shared repair allowance covers the named text repair doors. Existing agentic finishing/runtime repair flows still have their own guards and the shared dollar/time ceiling; this is not yet a universal one-pass repair system.
- Imported ZIP/GitHub projects retain their existing inspection pipeline. Prompt-only classification cannot reliably size an unseen repository. Requests exceeding 32,000 characters wait for a narrower scope rather than silently truncating it.
- This change does not add a new tested auth/database starter or replace existing delivery proof. Provider classifiers can misread intent or prompt injection. Paired multilingual examples must be evaluated before broad activation.
- An unavailable classifier temporarily blocks candidate Weak builds even if Kimi is healthy. That is the deliberate cost-protection tradeoff; turning the rollout flag off restores current behaviour.

## Rollout and rollback

Enable the flag on a controlled environment, run the same small prompt set on both policies, inspect real proof/cost records, then decide broad activation. Unset the flag to restore existing routing. Explicit `AGENTV3_LADDER_WEAK` overrides remain authoritative; remove old overrides if testing the two-model default.
