// AgentV3 — deterministic shell-command safety transforms applied before a bash tool call runs.
//
// PulseBoard autopsy (2026-07-20): the builder ran `mkdir -p src/app/(auth)/login …` to create Next.js
// App-Router route-group directories. Unquoted parentheses are a bash SUBSHELL syntax, so the whole
// command aborted with `exit 2` (syntax error) and the directories were never made — a recurring class
// for EVERY Next.js app, because route groups `(auth)`, `(dashboard)`, `(marketing)` are idiomatic and
// the model writes their literal paths into shell commands.
//
// THE FIX (the class, not the instance): a `/(` sequence can NEVER occur in a legitimate bash construct
// — a subshell is a bare `(` or `$(`/`<(`  and always has a NON-slash char before the paren. So a path
// token containing `/(name)` is unambiguously a literal directory path with a route group, and quoting
// it makes the exact same command succeed. Pure + dependency-free = fully unit-testable.

/**
 * Quote path tokens that contain a Next.js-style route group (`.../(name)/...`) so an unquoted
 * parenthesis is treated as a literal directory-name character instead of a bash subshell. Targeted and
 * safe: only whitespace-delimited tokens containing `/(` are wrapped, and `/(` never appears in a bash
 * subshell / command-substitution / process-substitution (`(`, `$(`, `<(` all have a non-slash char
 * before the paren), so no legitimate shell construct is ever altered. Already-quoted tokens and tokens
 * with no `/(` are left exactly as-is (idempotent). Pure.
 */
export function quoteShellRouteGroupPaths(command: string): string {
  if (typeof command !== 'string' || !command.includes('/(')) return command;
  // A token = a run of non-space, non-quote chars that contains at least one `/(name)` segment (a
  // route-group path). `\([^\s'"()]*\)` matches a single simple `(name)` group (no nested parens,
  // spaces, or quotes — exactly the Next.js route-group shape), with arbitrary path chars around it.
  return command.replace(
    /(^|\s)((?:[^\s'"]*\/)\([^\s'"()]*\)[^\s'"]*)/g,
    (_full, pre: string, tok: string) => `${pre}"${tok}"`,
  );
}
