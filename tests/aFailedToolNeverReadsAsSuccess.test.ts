/**
 * A TOOL THAT FAILED NEVER RETURNS ITS FAILURE AS A SUCCESSFUL RESULT (autopsy 15e69839, 2026-10-12).
 *
 * `replace_symbol` could not find `printBill` (it lived inside a hook), and RETURNED that sentence. A returned
 * string is a successful tool result: the model saw `is_error: false`, the timeline recorded "✓ replace_symbol",
 * and the diagnostics counted no failure. The repo learned this once already for writes ("THROWS rather than
 * returning a string", `ToolDispatcher.assertWritable`) and for the deploy tool — the class survived in 18 more
 * places that validated input or hit an operational failure and returned the words.
 *
 * The census: inside `ToolDispatcher.ts`, a `return` of a string literal that opens with a tool name and says it
 * could not act, or opens with a failure word, fails this test. Use `refuse(...)` — `dispatch` turns it into an
 * `is_error: true` result the model must handle, with the message verbatim.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');

const TOOL_FAILURE = /^\s+return [`'"][a-z_]+: [^\n]*\b(required|not found|could not|cannot|can't|failed|invalid|must be|unknown|no such|empty or missing|did not resolve|pass at least|pass the current|this app has no server)/;
const BARE_FAILURE = /^\s+return [`'"](Error|ERROR|Failed|Could not|Cannot|Can't|No such|Not found|Invalid|Unknown)\b/;

describe('census: a failed tool is a refusal, never a returned sentence', () => {
  it('🔒 no tool returns its own failure as a successful result', () => {
    const offenders = SRC.split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => TOOL_FAILURE.test(line) || BARE_FAILURE.test(line))
      .map(({ line, n }) => `ToolDispatcher.ts:${n}: ${line.trim().slice(0, 110)}`);
    expect(offenders, 'use refuse(...) so the model gets is_error: true').toEqual([]);
  });

  it('replace_symbol refuses when the symbol is not top-level, the file is missing or the input is incomplete', () => {
    const at = SRC.indexOf("case 'replace_symbol': {");
    const body = SRC.slice(at, at + 1400);
    expect(body).toMatch(/refuse\('replace_symbol: "path", "symbol" and "code" are all required\.'\)/);
    expect(body).toMatch(/refuse\(`replace_symbol: file not found:/);
    expect(body).toMatch(/refuse\(result\.error \|\|/);
    // "no change" is not a failure: the file already holds exactly that code.
    expect(body).toMatch(/return `replace_symbol: no change/);
  });

  it('the census can see the shape it forbids', () => {
    expect(TOOL_FAILURE.test("          return 'replace_symbol: \"path\", \"symbol\" and \"code\" are all required.';")).toBe(true);
    expect(BARE_FAILURE.test("          return 'Could not stop this build — stopping is not available here.';")).toBe(true);
    expect(TOOL_FAILURE.test("          return `replace_symbol: no change — the new code for \"x\" is identical.`;")).toBe(false);
  });
});
