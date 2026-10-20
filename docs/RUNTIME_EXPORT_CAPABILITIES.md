# Runtime export capability contract

## Scope and status

This hardens the current source's local-module contract checks and deterministic import/barrel repairs. It is not a replay of a retained generated application, a production build, or a whole-report closure. Publication, full exact-head CI, review and an explicitly approved merge remain separate gates.

## Root cause

A TypeScript export table answers whether a name is declared, not whether the generated JavaScript provides a value. Interfaces, type aliases, ambient declarations, type-only forwarding and runtime declarations were flattened into the same name set. That caused both false-negative contract checks and unsafe repair suggestions. A second loss occurred when rebuilding a moved import: the local alias survived but the type-only modifier did not.

The shared `exportCapabilities.ts` graph preserves three runtime states:

- `value`: a local declaration emits a runtime value.
- `erased`: the declaration or forwarding edge is type-only or ambient in source.
- `unknown`: an external or declaration-file implementation cannot be established from the supplied files.

The graph is built with TypeScript's real parser and binder, in memory, without reading installed packages or a filesystem. Type-only re-export edges remain visible rather than being erased by alias resolution. Merged declarations may provide both a type and a value. Resolved re-export aliases and stars carry the producer's capability; unknown or conflicting forwarding cannot authorize a runtime repair.

Consumer requirements come from bound references, not spelling. Ordinary imports used only as types remain legal under TypeScript erasure. Runtime reads include JSX components, computed expressions, shorthand values and class inheritance, but not type queries, `implements`, intrinsic JSX tags, property/declaration names or shadowing locals. Invalid interface-as-value references need a lexical lookup across both namespaces because TypeScript does not return a value symbol for them.

## Consumers and safety

| Consumer | Invariant |
| --- | --- |
| `ImportExportAnalysis` | A runtime read of an erased export is an honest mismatch, with an emitted-value explanation. |
| `ContractMap` | Repair context sees the same producer/consumer capability, not a regex-derived name-only verdict. |
| `addMissingProjectImports` | A project export is a runtime-import candidate only when it demonstrably emits a value. Existing package-index behavior is unchanged. |
| `fixWrongSourceImports` | Select a unique provider capable of satisfying the consumer; preserve aliases, declaration/specifier type modifiers and unrelated side-effect imports. |
| `fixTypeOnlyValueImports` | Promote only a binding actually read as a value and a producer proven to emit it. Ambient/.d.ts guesses and lexical shadows cannot authorize promotion. |
| `reconcileImportExports` | Named/default conversion cannot manufacture a runtime import for a type/ambient declaration; per-specifier modifiers survive. |
| `generateMissingBarrels` | Combine all consumers first, choose unique capable leaves and emit `export type` for erased exports. A first type-only consumer cannot conceal a later runtime requirement. |

This does not replace the compiler, inspect installed package implementations, repair namespace imports, or redesign the existing enum-member drift check. Declaration files describe implementations; they do not prove the corresponding JavaScript exists. Such unknowns remain conservative rather than being reported as successful repairs.

The barrel writer uses the shared module resolver before creating an index, including
existing `.mts`, `.cts`, `.mjs` and `.cjs` indexes. Explicit module-format leaf imports
retain their output suffix (`.mts` → `.mjs`, `.cts` → `.cjs`) instead of generating an
unresolvable extensionless specifier. These cases are verified with esbuild's actual
filesystem resolver, independently of the in-memory capability graph.

### CommonJS and emitted import specifiers

An ESM export table is not a complete description of CommonJS. Actual `module.exports`,
`exports`, dynamic/aliased export mutation, TypeScript `export =`, and a CommonJS-format
file without ESM export syntax remain uncertain. This avoids falsely rejecting their working
default imports without inventing static named exports. Uncertainty also prevents
named/default and lazy-selector reconciliation, not just missing-import repairs.
Local variables, parameters and imported aliases named `module` or `exports` are
lexical shadows, not CommonJS globals; ambient declarations do not create runtime
shadows. Genuine ESM declarations remain exact, including in explicit-format files.
Actual bundler probes distinguish import-only `.cts`/`.cjs` files (a CommonJS default
still exists) from `export type`, exported interfaces, ambient exports and `export {}`
(no default export). TypeScript syntax inside `.cjs` is a parser error, not an
alternative valid module contract.
Unknown is not a typechecking success: TypeScript's ESNext/Bundler mode rejects
an import-only `.cts` default with TS1192 even when esbuild accepts it. That
disagreement is tested explicitly; the real compiler gate remains authoritative.

Every import writer now uses the same emitted-specifier helper: barrels, missing
project imports and wrong-source repairs map `.mts` to `.mjs` and `.cts` to `.cjs`.
The source resolver and emitted path spelling are separate contracts. A resolver
that accepts a source file is not proof that TypeScript permits its source suffix
in an import without `allowImportingTsExtensions`.

## Regression proof

`exportCapabilities.test.ts` exercises the production functions with real in-memory TypeScript diagnostics and esbuild bundles, not mocked export tables. Cases include the `formatDate` type/ambient failure shape, the `User` interface-as-value shape, TS1484 modifier preservation, aliases, re-exports, merged type/value declarations, classes, enums, overload implementations, namespaces, `.d.ts` uncertainty, JSX, heritage, lexical shadowing, all repair siblings and strict barrel syntax. A source census requires every semantic export-table consumer to join the shared model or carry an explicitly reviewed descriptive-only exception.

Validation counts and reverted-source failure evidence are recorded in the associated change's verification log. No raw retained report payload or credential is included in these tests or documentation.

`exportModuleFormats.test.ts` additionally checks actual CommonJS and `export =`
files through esbuild's filesystem resolver. Its TypeScript probe uses the real
module resolver, not a custom `resolveModuleNames` hook: a hook returning only a
filename drops `resolvedUsingTsExtension` and can hide TS5097. Negative controls
prove the probe rejects raw `.mts`/`.cts` imports before checking repaired output.

## 2026-10-20 — PR #3872: isolate cooldown, starvation and build-bench regression fixtures

Hosted CI run `39490035922`, job `118860455747`, exposed four assertion failures after the missing
cooldown default was restored to 60 seconds. The bounded reproduction matched all four failures
(38 other tests passed). The root was test coupling, not a changed starvation/timeout classifier:
the old fixtures implicitly relied on the missing-config bug disabling the shared cooldown, and
StudyRacer also leaked the first test's singleton cooldown into the second. Explicit `0` made the
unchanged baseline pass 42/42; running StudyRacer's second case alone changed its actual GLM calls
from zero to one, proving the additional inter-test contamination.

| Problem | Root / class | Fix and regression proof |
| --- | --- | --- |
| Non-first pool key never reached the starvation control | A first timeout correctly cooled the service before the synthetic second-key starvation | Inject a private disabled cooldown only into that starvation-key unit test; its original `[1,1,0,0,0,0]` and family-key assertions remain. Reverting family retirement to per-key makes it fail. |
| Timeout retry fixture expected an immediate second attempt | Transient cooldown and permanent dead-rung retirement were conflated by the fixture | Keep a first-strike 60-second cooldown enabled, prove suppression at 59,999 ms and retry at 60,000 ms, with the dead-rung map empty throughout. Treating timeout as permanent starvation makes it fail. |
| StudyRacer without-shared-bench control stopped at one call | Process cooldown masked the separate build-lifetime bench | Inject a private disabled cooldown; retain the original three-call negative control. |
| StudyRacer shared-bench case saw zero calls | Same masking plus singleton state leaked by the prior case | Inject a fresh private disabled cooldown; retain the original two-call and one-announcement assertions. Removing the shared build registry makes this case fail. |

The production singleton tests now cover both request timeout and per-key 429, missing/blank/explicit-off
configuration, first-strike suppression, exact expiry and successful recovery. Default-on pool controls
prove timeout/overload suppress both same-model and different-model sibling keys, preserve a different
provider family, and recover after expiry; ordinary per-key quota 429 still rotates to a healthy sibling.
Existing starvation tests retain healthy-model/family boundaries. Singleton users reset before and after
each case, including failed assertions. No production source, provider policy or live environment changed.
Removing the missing-value guard again makes 12 of the 26 production-default tests fail.

Validation: frontend and server typechecks and the unused-import/local gate passed. The six-file
bounded suite passed **147/147**, including all 65 runner tests and all 14
measured-timeout-cost-floor tests. All four deliberate source mutations failed their targeted controls
and were restored. Validation used an empty credential environment and the offline guard under the shared
validation lock. Full local suite deliberately not run; the complete hosted gate remains required before
any merge, and this entry does not mark the PR or report merged or complete.
