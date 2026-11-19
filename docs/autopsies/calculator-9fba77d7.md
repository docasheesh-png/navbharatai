# Calculator build 9fba77d7 — proposed engine repairs

Report: `9fba77d7-7434-44fb-a5a2-633cf74d0902`, prompt hash `1cad59de`.
Request: “Make a simple calculator app that I can upload on playstore”.
Reviewed on 2026-11-19. Status: code proposed; GitHub CI and a fresh production build remain verification gates.

## What the report proves

- It ended after 250.606 seconds on `OUTCOME_WALLET_EMPTY`, before the 25-minute time cap.
- `src/App.tsx:78` still had TS2339 after the model repair and the later `src/types.ts` edit.
- The compiler named the alias `CalcOutcome`, not an expanded `A | B` union. The failure was in
  the `else` of a positive `if (outcome.ok)`, not the negated guard the old cause reader recognized.
- Fast-lane generation took 88.1 seconds; its ineffective repair took 16.3 seconds. The full builder
  then spent about 105 seconds before the wallet stop, mostly inspecting existing source.
- The repair introduced `calc-app` and `calc-result`, while the recorded CSS listing defines
  `calc-page` and `calc-preview`. The ordinary CSS review tolerates fewer than three missing classes.
- The spacing snap already existed, but fast verification returned on compiler errors before reaching it.
- `SIMPLE_BUILD_VERIFY_ERROR` was stamped `autoResolved: true` at handoff, despite no clean recheck.
  `ONESHOT_VERIFY_FAILED` had the same producer behavior.
- A wallet stop explains why execution ended; it does not establish that the generated code is correct.
- The report records a final user charge/debit of zero. AI cost is reported as $0.168504 and sandbox
  cost as $0.011408. Some engine costs are explicitly estimated. These figures are not a wallet ledger audit.
- Reported input is 502,991 tokens, including 346,114 cache-read input tokens, plus 51,049 output tokens.
  Cache-read input is a subset, not another quantity to add. Avoiding an unnecessary handoff is the
  immediate cost lever; this change does not truncate project memory or change provider prices.
- No preview, rendered page, user journey or store-ready bundle was proven. The RED release gate is correct.
- No provider timeout or out-of-memory kill is recorded. VM idle time includes waiting for model replies;
  it is not proof that the builder hung.

## Root-cause ledger

| Queue item | Finding and class | Proposed action and siblings | Verification / remaining evidence |
| --- | --- | --- | --- |
| Q-2756 | Boolean union aliases and positive guards escaped the existing narrowing diagnosis; a model changed the contract instead of the guard. | `booleanDiscriminant.ts` follows actual compiler locations and imported types, requires a genuine true/false discriminant and the same receiver symbol, and edits only the guard. Shared deterministic endgame plus the per-file/one-shot text-repair boundary use it before a model call. Generation, one-shot, architect and repair prompts share the literal-comparison rule. | `aBooleanAliasKeepsItsFailureBranch.test.ts` contains the exact reported App.tsx, reproduces line 78 with the real compiler, keeps the original as a failing control, and checks both null-checking modes. Negative controls cover shadowed names, string flags, explicit guards and genuinely missing fields. CI pending. |
| Q-2757 | A compiler handoff ordered a full survey of already written files, despite naming one offender. | `salvageReadInstruction` carries the existing cause analysis and prioritizes compiler-named files and their declarations. Non-compiler handoffs retain the original instruction. Project history and requirements remain intact. | The report fixture checks that the handoff names App.tsx and the literal comparison. Actual time/cost savings require the next real build; none are claimed from a synthetic test. |
| Q-2758 | A compiler repair could silently introduce one or two unstyled classes while preserving the compiler error count. | `repairStyleRegression` compares the existing tree with the whole proposed batch before writes. SimpleBuilder, one-shot text repair and endgame all use the shared rule. Real stylesheet updates in the same batch are allowed; pre-existing misses are not newly blamed on the repair. | `calculatorBuildHonesty.test.ts` exercises the report's two names and their correct same-batch stylesheet alternative. The ordinary threshold remains unchanged. CI pending. |
| Q-2759 | Handing off was reported as resolving a failed verification. | Both producer codes start unresolved; the recorder enforces that invariant. A completed project compiler recheck can resolve compiler-only findings. Stylesheet/mixed findings require the corresponding full verifier. One-shot also retains its actual verify errors. | Both codes are tested against wallet stops, genuine passes, piped exits, interrupted checks, help pages, noCheck, partial projects and stylesheet failures. CI pending. |
| Q-2760 | The report omitted the budget that admitted the build and the amount that crossed its wallet guard. | Carry the actual admission balance and estimate into `BUILD_WALLET_BUDGET`; record provisional priced cost in `WALLET_BALANCE_EXHAUSTED`. Unknown values stay null. Preserve all refusal, exemption, markup, stop and settlement policies. | Pure diagnostic tests plus the real admission helper's injected wallet/estimate test. Production ledger/reservations were not read; a zero final bill does not prove that the guard malfunctioned. |
| Q-2761 | A budget/supersession stop claimed the app was not defective, despite surviving code errors. | Wallet, cost-cap and lock-reclaimed outcomes state that the stop does not establish whether code compiles or runs. Their canonical outcome codes and platform-stop classification remain unchanged. | `calculatorBuildHonesty.test.ts` checks all three and retains the compiler finding alongside the wallet outcome. CI pending. |
| Q-2762 | A failed compile skipped the platform's free spacing normalization and independent CSS evidence. | Reach the existing spacing/CSS pass before returning compiler failure; preserve both compiler and CSS messages through `combinedVerifyErrors`. | Tests cover combined evidence and the real verifier's ordering. No claim that the stopped production stylesheet has already changed. CI pending. |
| Q-2763 | The worker cached a manifest missing from the recorded public listing; offline/store readiness was not established. | Planner instruction now includes every manifest linked/cached by the shell and distinguishes a web shell from a signed Android bundle. | BLOCKED on the complete project or a fresh verified build: the report only contains App.tsx in full, not the final HTML/worker/manifest. Already checked the public listing and saved file manifest. A prompt instruction alone does not prove asset completeness or offline operation. |
| Q-2764 | Surplus used `stale_or_missing_snapshot`, so the declared alternative path ran. | Retain the configured fallback; do not bypass reviewed pricing or change the owner's provider order. | BLOCKED on production registry evidence / a fresh reviewed snapshot. Already checked the report's explicit reason and current fallback design. A code-only PR cannot certify or refresh an inaccessible live registry. |
| Q-2765 | Some engine usage lacked a single issued receipt and costs were estimated. | Preserve the recorded zero user bill and existing accounting policy; do not invent a receipt or label estimates as measured provider debits. | BLOCKED on the accounting store's per-call receipts and supplier reconciliation. Already compared the report's receipt warnings, estimated-call summary and final billing fields. No production ledger or provider invoice is available here. |
| Q-2766 | Response previews show MAX_EXPRESSION_LENGTH exported from data.ts as 60 and calc.ts as 120. | Confirm the intended canonical constant owner before altering another generated module. | BLOCKED on complete final types.ts, data.ts and calc.ts source. Already compared both generation previews and the reported consumer import. App.tsx alone cannot establish the final exports/uses or safely repair them. |

The pre-existing ladder-depth classifier-count item remains in Q-2751; it is not silently closed by this PR.

## Validation and release boundary

The owner explicitly instructed this session to stop running local CI and let GitHub run the checks.
No local typecheck, test suite, coverage run, database drill or app build was executed. Static diff
review and `git diff --check` are not a substitute for those checks. The new tests are proposed checks,
not claimed passes. The repository's existing CI workflow remains intact.

Do not call this live or merged. After CI succeeds, the PR remains open for the owner's merge decision.
A new production build must demonstrate compilation, preview/render and calculator interaction before
claiming that this particular saved calculator is repaired. Offline behavior and a signed store bundle
need their own evidence.

### Publication blocked in this session

The local code commit is `9c997272e3b0ebccf18295b01da4fb4b2a73387f` on
`codex/calculator-build-repair`, based on `a9ecb055af30d49e38a7c06b83dde84e84b0b6c5`.
Automatic approval review rejected the public GitHub push: it required explicit authorization
to publish the complete payload to the public repository. A read-only remote-ref check found no
matching branch. No alternate write route was attempted. Consequently no PR or GitHub CI run
exists for this change yet. A private, reviewable patch is the delivery pending that authorization.
