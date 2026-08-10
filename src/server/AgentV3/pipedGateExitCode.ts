// AgentV3 — "the pipe ate the exit code": catch a gate command that reports SUCCESS while its own output
// is full of errors (autopsy build 56ee622f, 2026-08-04).
//
// WHAT HAPPENED. The agent verified its work with:
//     ./node_modules/.bin/tsc --noEmit 2>&1 | head -30   → exit 0
// and moved on believing the app typechecked. It did not. That same command's stdout contained ~10 real
// errors — `Property 'tone' does not exist`, `Property 'setState' does not exist on type 'ErrorBoundary'`,
// `Type '"warning"' is not assignable to …`. The preview then failed to start, both in the live server and
// in-browser, and the user was told the app "isn't fully working" with no idea why.
//
// ROOT CAUSE. In a pipeline, the shell reports the exit status of the LAST command. `head` always succeeds,
// so `tsc | head` is ALWAYS exit 0 no matter how badly tsc failed. The agent asked the only question it
// could ("did the command succeed?") and got a truthful-looking answer that was a lie.
//
// WHY NOT `set -o pipefail`. That is a bashism. This repo has already been burned by exactly that: the
// bulk-landing command silently never engaged on a plain-sh sandbox until it was rewritten POSIX-only
// (PROGRESS 2026-08-03). Rewriting every piped command is also risky — the pipe is often what keeps a
// 10,000-line log from blowing the tool budget.
//
// So we do not touch the shell at all. We READ THE OUTPUT the command already produced: if a recognised
// gate tool ran through a pipe, reported success, and printed real compiler/test errors anyway, the exit
// code is not to be trusted, and the agent is told so in the words it needs to act on.
//
// This is the same disease as the rest of that day's findings — a check that says "pass" while checking
// nothing — and it is fixed the same way: make the system tell the truth about its own state.
//
// Pure + deterministic: no I/O, no shell, no LLM. Kill switch lives at the call site.

/** A verification tool whose real verdict lives in its OUTPUT, not just its exit status. */
const GATE_TOOL = /\b(tsc|vue-tsc|svelte-check|eslint|vitest|jest|mocha|pytest|mypy|ruff)\b|\bnpm\s+(?:run\s+)?(?:test|typecheck|type-check|lint|build)\b|\b(?:yarn|pnpm|bun)\s+(?:test|lint|build|typecheck)\b/i;

/**
 * Error signatures that mean a REAL failure — deliberately narrow, so a passing run that merely mentions
 * the word "error" (a filename, a test title like "renders error state") never trips this.
 */
const REAL_ERROR: RegExp[] = [
  /^[^\s].*?\(\d+,\d+\):\s*error TS\d+/m,     // tsc:  src/App.tsx(307,44): error TS2322: …
  /\berror TS\d+:/,                            // tsc, alternate formatting
  /^\s*✗|^\s*×\s|\bFAIL\b\s+\S+\.(?:spec|test)\./m, // vitest/jest failing file
  /\bTests?:\s+\d+\s+failed/i,                 // jest summary
  /\b\d+\s+failed\b/i,                         // vitest summary
  /^\s*\d+\s+problems?\s*\(\d+\s+errors?/m,    // eslint summary with errors
  /^\s*error\s+[A-Z]\w+:/m,                    // mypy/ruff style
  /\bSyntaxError\b|\bTypeError\b(?=.*\n\s+at\s)/, // a thrown error with a stack
  // THE MISSING BINARY (autopsy build 6414138d, 2026-08-09). The most common way a piped build lies is
  // not a compiler error at all — it is the compiler never running. `npm run build 2>&1 | tail -10`
  // printed `sh: 1: tsc: not found` and the pipe reported exit 0, so the agent told the user "the app
  // compiles cleanly and is ready to use" about an app that had not been compiled at all. None of the
  // signatures above match that text, because a missing binary produces a SHELL message, not a tool
  // message. The same build in the very next turn ran the command WITHOUT a pipe and got the truth:
  // exit 127, `sh: 1: vite: not found`. So the pipe was the only difference between a lie and a fact.
  /^(?:[\w./-]*sh|bash|zsh):\s*(?:\d+:\s*)?\S+:\s*(?:command\s+)?not found/mi, // sh: 1: tsc: not found
  /\bcommand not found\b/i,                    // bash phrasing
  /^\s*(?:npm\s+)?ERR!\s+.*\bENOENT\b/mi,     // npm could not find the script/binary
];

/** Does the command send a gate tool's output through a pipe (so the shell reports the LAST stage)? */
export function isPipedGateCommand(command: string): boolean {
  if (typeof command !== 'string' || !command.includes('|')) return false;
  // `||` is a logical OR, not a pipeline — it does NOT mask the exit code.
  const withoutOr = command.replace(/\|\|/g, ' ');
  if (!withoutOr.includes('|')) return false;
  const head = withoutOr.split('|')[0] ?? '';
  return GATE_TOOL.test(head);
}

/**
 * The command claimed success but its output proves otherwise — return the honest warning to hand back to
 * the agent, or `null` when the verdict can be trusted.
 *
 * Fires ONLY when all three are true: the command piped a gate tool, the shell reported success, and the
 * output carries a real compiler/test error signature. Any one missing ⇒ silence, so an ordinary passing
 * command is never second-guessed. PURE.
 */
export function pipedGateExitCodeWarning(
  command: string,
  exitCode: number,
  output: string,
): string | null {
  if (exitCode !== 0) return null;              // it already told the truth
  if (!isPipedGateCommand(command)) return null;
  const text = (output ?? '').slice(0, 20000);
  if (!text.trim()) return null;
  if (!REAL_ERROR.some((re) => re.test(text))) return null;
  const first = (text.match(/^[^\n]*error[^\n]*$/im) || [''])[0].trim().slice(0, 200);
  return [
    '⚠️ THIS COMMAND DID NOT ACTUALLY PASS. It exited 0 only because the LAST stage of the pipe (e.g.',
    '`head`, `tail`, `grep`) succeeded — a pipeline reports the exit status of its last command, so the',
    'real tool\'s failure was thrown away. Its output above contains genuine errors, for example:',
    first ? `  ${first}` : '  (see the output above)',
    'Treat this as a FAILURE and fix the errors. To get a trustworthy verdict, run the tool WITHOUT a pipe',
    '(redirect to a file and read it if the output is long) — do not rely on the exit code of a piped run.',
  ].join('\n');
}
