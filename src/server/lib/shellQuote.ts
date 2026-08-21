// ONE shell-quoting function for the whole server.
//
// WHY IT LIVES HERE. This is a SECURITY primitive: every value it wraps is about to be pasted into a
// shell command that runs inside a user's sandbox, and some of those values are written by a model or
// typed by a user. Until 2026-08-21 there were FOUR independent copies of it — two E2B actuators,
// `ToolDispatcher`, and `versionPreview` — and duplicated security code is the exact drift class the
// fourth absolute rule names. All four happened to be correct, which is luck, not design: the day one
// of them is hardened and the other three are not, the weakest copy is the attack surface, and nothing
// would point at it. One implementation, one test file, one thing to get right.

/**
 * Wrap a value as a single-quoted shell argument.
 *
 * HOW IT IS SAFE: inside single quotes POSIX shells treat every byte literally — `$`, backticks,
 * `;`, `&&`, newlines and backslashes all lose their meaning. The single quote itself is the only
 * character that can end the quoting, so each one is closed, escaped and reopened (`'\''`). There is
 * no input that can escape the resulting argument.
 *
 * `String(s)` is deliberate: a caller handing this a number, null or undefined must still get a
 * quoted argument rather than a crash or the literal text `undefined` splicing into a command.
 */
export function shellQuote(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}
