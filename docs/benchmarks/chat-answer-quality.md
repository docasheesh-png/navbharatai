# Answer-quality gate: closed-answer benchmark

Transport success and a nonempty response are not accuracy passes. The load
benchmark's synthetic request-marker replies prove matching and routing only.
No real provider answers have been assessed in this workspace. Quality status is
**unmeasured: 0 of 4,000 real responses available**, not 100% accuracy.

The offline evaluator defines 16 independently authored prompts and explicit keys:
Hindi arithmetic/units/facts, English arithmetic/facts, Python and JavaScript
code-output tracing, and one insufficient-information question. Each case appears
250 times in the 1,000-user/four-turn manifest. Repetition measures consistency,
not breadth: 4,000 records are only 16 distinct questions. Coding tasks check output
reasoning; they do not prove generated programs correct. Inputs contain no personal
data. No supplied code is executed and no model grades itself.

Generate the fixed manifest:

```
node scripts/chatAnswerQuality.mjs manifest /tmp/chat-quality-manifest.json
node scripts/chatAnswerQuality.check.mjs
```

A separately authorized real-provider runner must preserve request/user/case IDs,
execute the listed prompts (and actual conversation history for sequential turns),
and save a JSON array containing `requestId`, `userId`, `caseId`, `answer`, `status`
(`ok` only after successful completion), and `source` (`real-provider`). It must
also retain independently reviewable provenance: tested commit/configuration,
provider/model identity, timestamps, cache bypass evidence and provider request IDs
where available, with secrets/private data removed. A source label is not proof:
the evaluator cannot detect an invented answer file. Never relabel mocks as real.
No real-provider runner is invoked or paid testing authorized by this artifact.

Grade actual captured output:

```
node scripts/chatAnswerQuality.mjs grade /tmp/real-responses.json /tmp/quality-report.json
```

All 4,000 expected records must each occur exactly once, match user/case identity,
have successful real-source status and match the independent key. Numeric/array
answers must parse as JSON with the exact value/order and type; strings accept
only listed aliases with Unicode normalization, whitespace trimming and case
folding. Prompts request exactly that format. Explanations containing contradictory
or extraneous answers fail rather than receiving substring credit. Missing,
duplicate, wrong, failed-request and unverified-source records fail; unexpected
records also prevent a batch pass. The report includes every request's result,
exact denominator, reason counts and users receiving all four correct answers.
This strict closed-answer protocol may reject semantically valid format violations;
report that limitation rather than calling it a general intelligence score.

The self-check uses intentionally fabricated positive/negative records to validate
the evaluator, including injected grading instructions, wrong values, missing
answers, duplicate IDs, timeout, mismatched identity and mock-source labels. Its
4,000 positive fixtures are **not 4,000 model responses**. CI checks this distinction
in its output. Production caching is unchanged; real evaluation must separately
verify cache bypass and keep quality results apart from load-transport results.

For open-ended teacher-style answers, add task-specific rubrics and independently
reviewed examples before scoring: factual accuracy, reasoning, completeness,
language and uncertainty. Human/adjudicated review is required for ambiguous
responses; an independent model judge would first need calibration against those
labels and agreement/error reporting. No uncalibrated model judge or universal
100% correctness claim is included here. A 100% pass can only mean all measured
cases met their declared criteria, never that all future answers will be correct.
