# Explicit compiler modes are not typecheck proof

A successful compiler process does not necessarily check types. An echoed script such as
`tsc --version && vite build` must not earn typecheck credit merely because the bundle completed.
The same applies to silent `--noCheck` invocations and other explicit nonchecking modes.

## Shared correction

The bounded command-mode reader uses the existing TypeScript argv parsers for option arity,
aliases, boolean values, and last-option precedence. Build `-v` remains verbose; ordinary `-d`
remains declaration. Active help/version/config/list-only/init modes, build dry/clean modes,
and ordinary or build `--noCheck` cannot earn positive checking credit. Response-file tokens
are rejected before parsing; command-referenced files are never opened.

The shared veto covers build-script evidence, standalone history, command outcome text,
piped warnings, and shell memory updates. A nonchecking process cannot clear known type errors
or mark compilation clean. Actual TypeScript diagnostics retain precedence; fixed internal
checks and output-only APIs retain their existing behavior.

## Supported boundary

Build echoes require literal `&&` chains with compiler-only clauses before the first checking
invocation. Transparent compiler prefixes and quoted literal project paths remain supported.
Canonical full/clipped compiler and write-time wrappers retain compatibility. Setup-prefixed
build echoes, exec, substitutions, control grammar, response files, and unsupported syntax
abstain rather than declare app failure. Recognized unsupported standalone argv abstains;
opaque standalone wrappers preserve legacy behavior. This is not general shell-execution,
executable-identity, configuration-driven `noCheck`, or incremental-freshness proof.

## Local verification

The regression matrix passed 316 tests in 19 related suites, including 121 new mode controls.
Frontend and server typechecks and the unused-import guard passed. Reverting the command veto
and build eligibility guard caused 28 expected assertion failures; source was restored before
final validation. Independent review found no remaining findings within the bounded scope.
Tests used credential-free offline execution and synthetic fixtures. This is local proof only:
the final integrated change still needs targeted build, bundle, boot, and regression checks,
followed by full exact-head hosted CI before release. No historical run outcome or production closure is claimed.
