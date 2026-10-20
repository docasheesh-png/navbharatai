# Source annotations at the report redaction boundary

## Proven cause and limit

The generic secret-assignment expression matches TypeScript declarations such as
`password: string;` and `password: string)`, treating the type and its closing
punctuation as a credential. Minimal synthetic examples reproduce that
transformation against the old helper. This proves a current evidence-preservation
defect, not that redaction mutated a generated app or caused a historical failure.
No private report bytes are copied into source fixtures.

## Design

`SecretRedactor.ts` stays the dependency-light generic redactor used by browser
observability. `SourceSecretRedactor.ts` is a server-only adapter using the existing
production TypeScript dependency. It recognizes actual parameter, variable,
property and interface-member declarations, not labels or object values.

Only primitive annotation syntax is preserved. Arbitrary type names, literal
types, comments and expressions cannot earn an exemption. Secret-named default
and initializer expressions are masked in full; preserving the annotation alone
would otherwise leave the value outside the generic assignment match. All text
outside the approved spans still passes through the existing generic redactor.

A parser recovery is not proof: preservation stops at the first syntax error.
A valid earlier annotation remains recognizable when a report is truncated later.
The file protocol's marker lines are blanked only in the parser's copy, without
splitting and reparsing the text. This retains string/comment/template boundaries
when a literal itself contains marker text. Non-code file regions do not receive
annotation exemptions. Generic prose, YAML, JSON and Markdown receive no blanket
primitive-word exemption.

Parsing is bounded to 200,000 characters, 20,000 visited nodes, 128 AST levels and
128 file regions. Ambiguity or an exceeded budget falls back to generic masking.
That intentionally favors confidentiality over preserving every possible type.
The adapter is not a full-fidelity redactor for all languages or markup formats.
Generic-boundary proof also has a fixed 4,000,000-character work budget. Exact
generic-output equivalence may permit local line/semicolon checks; delimiters alone
are never trusted. If proof work is exhausted, every accumulated AST span and
exemption is discarded and the bundled generic redactor processes the original
input. There is no new whole-source erasure fallback.

This is an atomic, bounded enhancement of the generic privacy floor. Fallback
retains that floor, but does not promise the adapter's additional recognition of
short values, escaped unquoted names or direct template interpolations. Those
shapes were already outside the deployed generic recognizer. The bundled generic
also includes the quoted-key enhancement below, so fallback is not promised
byte-identical to the earlier deployed helper.

## Sibling boundaries

The source-aware policy covers command collection (`BuildDiagnostics`), tool
inputs/output (`ToolDispatcher`), persisted reports (`DiagnosticsStore`), failed
report exports (`failedBuildReports`), change-session evidence, fleet mistake
samples and live report narration. Deep recursion and event handling retain the
existing generic implementations through an injected text-redaction function.

Uploaded-content safety (`promptSafety`) and vault/config file views
(`secretFileView`) deliberately retain generic behavior. The census records those
exact exceptions and fails if a new server caller bypasses the source-aware policy.
A real browser build of `observability/sanitize.ts` proves that TypeScript,
ts-morph and the server adapter do not enter that dependency graph.

## Verification

- Synthetic member/parameter examples preserve their exact source and delimiters.
- Adversarial cases cover defaults, initializers, literal/unknown types, comments,
  strings, templates, regexes, envelope spoofing, YAML, Markdown, provider-shaped
  JSON values, provider keys, URLs, private keys, multiline separators and bounds.
- Real collector → storage trimming → failed-report export → repeated redaction
  retains syntax while masking synthetic credentials. Outcome remains failed.
- Historical masked text is never reconstructed or upgraded to a successful build.
- Existing secret-regression cohorts, targeted typechecking and source reversion
  results are recorded in the accompanying validation handoff. Full repository CI
  is still required before shipping; targeted checks are not a full gate.

## Quoted-key sibling found during security review

The original generic assignment expression also missed a JSON-quoted key such as
`{"password":"syntheticCredential"}`. The failed-report export's key-aware masking protects a parsed
object, but not serialized JSON inside report text. A dedicated quoted-field pass
now masks complete quoted values, including whitespace and escaped quotes, while
preserving key/value delimiters. Pretty-printed JSON and bounded Unicode-escaped
key spellings use the same boundary. Short values are protected too: a quoted secret
field is stronger evidence than a prose label. The tested bounded quoted-field
cases remain stable on repeated redaction; arbitrary nested encoded text is not a
universal idempotence guarantee. A nonsecret display label stored under a
secret-shaped quoted key can also be masked; this pass does not infer a field's
application meaning.
Existing typed redaction markers, including encoded trailing newlines, keep their
classification. Known numeric input/output/cache token-count fields remain useful
telemetry; a bare token/password or credential-shaped counter value is never exempt.

The server adapter recognizes statically named quoted, computed-string and private
properties as well as ordinary identifiers. Their proven primitive annotations
survive; their initializers and unknown/literal types do not receive an exemption.
Dynamic computed keys and arbitrary obfuscated encodings are not decoded or treated
as proof of a secret field. This is a bounded recognizer, not a universal data-loss
prevention guarantee.

`aQuotedSecretKeyStillProtectsItsValue.test.ts` has 24 synthetic regressions.
The first 14-case sibling probe failed 11 cases before the repair. Independent
review added pretty-printing, Unicode-key, typed-marker and numeric-counter guards.
The final affected cohort passes 308 tests in 11 files; existing assertions were
not weakened. The broader exact-head CI and release checks remain required.

Boundary recorded separately: generic `redactDeep` redacts string leaves, not
object keys. For example, a short ordinary string in a parsed `password` property
is unchanged there. The actual failed-report export's `redactFailedReport` is
key-aware and masks that property independently. Changing all generic object-field
semantics needs a separate caller/schema review and is not claimed by this patch.

## Repeated source passes and evidence-bound digests

Integration review reproduced a source-only sibling: an unquoted mask inserted into
an object value can make a later parser pass reject a legitimate primitive annotation.
The server adapter now masks complete, statically identified syntax values with quoted
literal placeholders, rather than leaving partial expressions or swallowed delimiters.
Credential-bearing literal/template/regexp regions and block-comment bodies keep their
syntactic boundary only where splitting does not weaken the generic redactor. Cross-boundary
assignments and exhausted privacy-check budgets retain conservative generic protection.
These are sanitized evidence, not executable or type-correct replay; arbitrary prose,
invalid/truncated input and budget exhaustion are not promised stable source syntax.
No existing marker text earns a secret exemption, and computed keys are never evaluated.
The original size cap applies to every pass: quoted masks can expand a near-200k
input beyond that cap, causing a later pass to use the generic fallback and lose
primitive-type fidelity. The source layer therefore cannot supply an unconditional
idempotence assumption to the metadata layer.

The report reader independently binds its digest to the exact once-scrubbed snapshot
it returns. REST and MCP forward that digest instead of redacting the exported report a
second time. The legacy internal report-only reader keeps its response contract. Tests
cover list/detail/metadata agreement, a real local HTTP read-to-transaction-save flow,
conflict after genuine evidence changes, and old-policy metadata remaining explicitly
stale without migration. Boundary regressions include near-cap expansion, already
redacted oversized stored source, and proof-budget fallback. A completed synthetic
review remains done for an unchanged stored snapshot, but a genuine evidence change
invalidates it and an idempotent retry returns current stale truth. Reverting route
forwarding reproduced two failures before the
source adapter's independent stability repair; digest CAS and read-only scope checks
were not weakened. This is synthetic integration evidence, not a historical rerun.

## Empty-test census syntax-boundary repair

PR #3874 CI run `39498429831` reported `SourceSecretRedactor.test.ts:224` as an empty
loop even though its body still contained assertions. The census's `for (...) {}`
regex stopped at the first `)` inside a multiline header's source-code template,
then treated that fixture's `function login(...) {}` as the real loop body. The
same lexical-boundary class also missed empty loops with nested header parentheses
and mistook multiline quoted/commented source for executable tests or loops.

The test-only census now uses the existing TypeScript parser and each file's actual
TS/TSX/JS/MJS extension to locate real bodies. Empty/comment-only blocks still fail;
nonempty bodies and source fixtures do not. The previous call/loop scope is retained,
including direct `suite.it(...)` calls; `test`, `describe`, modifier/computed calls,
function/parameter/typed callbacks, explicit timeouts and `for await` are not newly
added. No production source, existing redactor assertion, dependency, workflow,
timeout or census exclusion was changed.

A conservative lexical prefilter rejects only files containing no possible
empty/comment-only brace block; it never decides a failure. This reduces AST work
from 2,863 files to 1,331 while retaining nested-header cases and all JavaScript line
terminators (LF, CRLF, CR, U+2028, U+2029), BOM and comment controls. Focused V8 coverage
measured the full census at 9.295s, down from 15.706s before the prefilter, below the
unchanged 20s test timeout.

Local proof: the original census reproduced 1 failed / 1 passed with the exact
reported line. The final focused cohort passes 240 tests in 2 files (18 census
cases and all 222 unchanged redactor cases), including under V8 coverage. Reverting
only the detector to its original implementation makes 11 of the 18 census tests
fail, including the original report, nested headers, quoted fixtures and non-LF
comment boundaries. The fixed detector was restored. Targeted strict TypeScript
checking with unused-local checks, the repository unused-import gate and diff
whitespace checks pass. These are focused local checks, not a full-suite or hosted
CI result; exact-head hosted CI remains required before shipping.
