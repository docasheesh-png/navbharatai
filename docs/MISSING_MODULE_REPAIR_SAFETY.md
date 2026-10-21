# Missing-module repair safety

These are bounded prevention contracts for deterministic missing-module repair. The fixtures are synthetic, not a reconstruction of a historical build. Successful repair of an import does not establish complete styling, a working user journey, or closure of a historical incident.

## CSS-module consumers

`generateMissingCssModules(files, existingPaths?)` reads actual source from `files`. It uses a single TypeScript syntax parse per source file, without a Program, type checker, filesystem lookup, package resolution, or model call. Source extensions follow the shared `EXPORT_CODE_FILE` convention, including `.mts`, `.mjs`, `.cts`, and `.cjs`.

- Only real, non-type default imports of relative `*.module.css` targets are candidates. Comments, quoted examples, package imports, absolute/alias imports, named-only imports, and namespace imports are not repair evidence.
- Every consumer contributes before a target is rendered, including different bindings in one source file and multiple relative spellings of the same target. Classes are deduplicated and sorted; a target produces at most one stub.
- Only direct identifier property reads and quoted literal element reads contribute class names. The original ASCII class-name filter is retained. Comments, strings, and nested properties of unrelated objects do not contribute.
- Parse-invalid source is skipped. Dynamic keys and lexical aliases are not guessed. This is syntax analysis, not a lexical binding resolver: a locally shadowed identifier may add an extra empty hook. The helper does not claim exhaustive runtime class inference.
- Inputs are not mutated. Existing stylesheet content is never repaired or overwritten by this helper. Generated files retain the explicit auto-generated, add-real-styles marker.

### Compiler proof and styling limits

The compiler regression bundles the generated sheet with Vite's default PostCSS CSS-module pipeline and executes the JavaScript output in an isolated context. For both consumer orders, `card`, `column`, and `is-active` are non-undefined scoped exports. Restoring first-consumer-only aggregation makes this check fail even though the bundle still compiles.

Empty rules intentionally add no visual styling. They are not a substitute for the intended design. In an offline check with Vite 8.3.4 using its optional Lightning CSS transformer, empty rules and their exports were removed, leaving an empty class map, even without minification. The same removal occurred when calling the installed Lightning CSS transformer directly. Consequently, scoped exports from empty hooks are a tested default-PostCSS property, not a promise for every compiler. This change does not add decorative declarations or claim to resolve that separate compiler compatibility limitation.

## Presence metadata is not source

An existing path and readable source bytes are different evidence. The optional `existingPaths` argument contributes only to the no-overwrite presence set; it is never converted into an empty source file or parsed. This prevents unread scaffold files from being treated as evidence that they contain no imports or exports.

The sibling builder integration must pass actual written source and scaffold path metadata separately to deterministic generators. In particular, barrel analysis cannot infer the export surface of an unread file from a fabricated empty string: transitive `export *` can otherwise appear unambiguous when it is not. Both production lanes pass the metadata separately. Fast-lane regression checks exercise scaffold preservation through `runSimpleBuild`, and helper-level checks exercise unknown transitive exports. Unread unrelated siblings do not automatically block explicit known-leaf forwarding; uncertainty on a transitive unread export-star target does block the affected barrel repair.

## Regression coverage

The focused helper tests cover multi-consumer union in both orders, same-file aliases, unused initial imports, misleading comments and quoted examples, direct static usage syntax, malformed input, exact class-name filtering, separate targets, existing bytes, presence-only metadata, and unsupported import forms. The Vite compiler regression verifies emitted class exports rather than merely checking generated CSS text. Mutation checks must restore first-consumer-only aggregation and remove presence metadata protection independently, observe the expected failures, then restore the passing implementation.
