# Repair-count provenance, 2026-10-20

## Root cause and bounded correction

Historical unversioned `counts.autoResolved` has carried different meanings. Some
producers counted **closed events**, including informational messages, fallback
notices and narration. Subtracting only later reclassified warning codes does not
turn that scalar into a repair measurement. The recorder and current `isSelfHeal`
predicate are unchanged; this correction is at the stored-evidence interpretation
boundary and every production metric adapter.

`interpretRepairCount` preserves independent facts:

- Exact finite numeric raw count/rule evidence, with numeric/missing/invalid state.
  Malformed raw objects/strings remain only in the unchanged original report, never
  copied into cheap metadata or listings. The additive interpretation is bounded
  and contains no undefined/nonfinite values that serialization could omit.
- Nullable metric total and explicit producer provenance.
- Historical compatibility arithmetic, not independent measurement evidence.
- Visible current-predicate rows; absent timeline is `null`, not observed zero.
- Strict timeline completeness and its reason, independent of attribution deficit.

The positive closed-event signature requires an absent rule tag, a safe integer raw
count equal to the closed-row census, positive closed informational evidence,
strictly valid rows, exact nonnegative integer total/visible agreement, coherent
issue-channel facts and no recorder cap marker. Malformed tags, malformed rows,
contradictory channel facts and incomplete timelines cannot establish that producer
signature. Neither report identity, date, narrative text nor repeat multiplicity is
used. Zero visible repair rows is not evidence that no repair occurred.

## Compatibility decisions

| Input evidence | Metric interpretation | Preserved compatibility |
| --- | --- | --- |
| Current rule 3, including zero or cropped timeline | Numeric recorded total | Existing normalization unchanged |
| Supported rule 2 | Existing one-time adjusted numeric total | Complete evidence is tagged adjusted; cropped/unknown evidence is tagged visible-adjustment, not exact current-rule truth |
| Future numeric integer rule | Numeric producer total | Explicit future-rule qualification, not assumed definition equivalence |
| Positively identified legacy closed-event counter | Unknown | Raw count and old arithmetic retained separately; legacy `healCountOf` returns null |
| Ambiguous, sparse or malformed-tag legacy evidence | Unknown | `healCountOf` retains historical arithmetic, explicitly unverified; production metrics do not call that compatibility API |
| Missing/invalid recorded count | Unknown | Never coerced to zero |

Fractional count normalization for valid versioned inputs and the historical
compatibility API remain unchanged. Fractional/malformed rule tags are not fabricated
producer evidence. `isSelfHeal`, workaround classification, pricing, money amounts,
provider routing and billing are unchanged.

## Sibling adapters and visible impact

- Both DiagnosticsStore readers already hold the source report and call
  `summarizeHealCodes`; their existing `HealCodeTally` type now carries the additive
  interpretation. No new database read is introduced. Known visible repairs and
  left-open warning codes remain available even when the total is unknown.
- Scorecard and all-builds first-pass projection share `repairCountFromProjection`.
  Explicit null normalization wins over raw fallback. Older numeric normalized
  tallies with valid rule 2/3/future tags preserve their normalized totals even when
  the additive interpretation field is absent.
- Heal averages and trends exclude unknowns. The scorecard names excluded builds;
  cost averages show their own measured denominator, and comparable heal trends
  show both measured sample sizes. Rule-2/future numeric compatibility is qualified.
- Cost-table cells explicitly say unknown; adjusted compatibility values are labeled
  as such, not presented as raw recorded counts. Known zero remains zero. No
  financial amount, price source, money arithmetic or financial denominator changes.
- New admin metadata captures provenance from the source already available **before**
  further storage trimming, and preserves the raw report. Existing metadata has no
  rule tag, only `healCount`/`unresolvedCount`/`leftOpenCount`; a historical scalar
  cannot recover its producer semantics without the source. Such delivered rows are
  excluded from first-pass claims. They are not fetched, backfilled or rewritten.
- Known failures remain failures; explicit User Stop remains excluded; known zero
  plus findings remains warning-only rather than actual repaired. Direct scalar
  first-pass classification requires explicit finite nonnegative repair/unresolved
  measurements. Missing/null/malformed delivered inputs are unknown, never clean.
- The existing first-pass card remains visible for an entirely unknown window.
  It names classifiable coverage and exclusions in both the all-builds and
  reported-only populations. The combined `healed` bucket is labeled "Not
  first-pass", not "Needed repair". Unknown coverage or qualified definitions
  prevent conclusions from comparing the complaint and all-build rates.
- A count deficit is "unattributed". It is not automatically called storage trimming.
  Timeline completeness is independently exposed, including known zero with a
  cropped timeline.

## Regression and proof boundary

The new fixture matrix contains 39 invented cases, never historical private report
payloads. The regression suite exercises the actual core, listing/metadata adapters,
scorecard and cost calculations, and renders the actual dashboard JSX for unknown,
known-zero and complaint-coverage cases. The cost fixtures use settled zero values
and a throwing pricing guard, not paid providers or financial actions.

The whole-repository TypeScript AST census guards raw `counts.autoResolved` readers.
Allowed readers are the interpreter, the normalized scalar classifier, and the
existing BuildDiagnostics text formatter which preserves the literal raw
"auto-resolved" evidence (not a claim about repairs). New readers fail the census.
A second census prevents production imports/calls of the retained `healCountOf`
compatibility wrapper, including renamed imports or namespace accesses.
Sibling search used filenames plus repair, self-heal and autoResolved vocabulary
across the full repository, including root/scripts/infra. Older fixes had centralized
the row predicate but had not established provenance for historical aggregate
counters or nullable downstream projections.

Twelve deliberate regressions were introduced temporarily, caught, and reverted:
legacy-total promotion; an unproven producer signature; null projection fallback;
cost unknown-to-zero; average and trend null denominators; missing scalar-to-clean;
raw metadata promotion; hidden unknown UI; a new raw reader; and a renamed import
of the compatibility API; and arbitrary raw payload duplication into metadata.
Local targeted/static evidence and the individual mutation
logs are recorded with this change's handoff. Full exact-head hosted CI and any release are separate gates.
This change does not reconstruct unknown historical repair totals, prove historical
runtime outcomes or close an entire failed-report autopsy.
