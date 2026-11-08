/**
 * Q-2301 — A RUNTIME ERROR REACHES THE BUILDER WITH THE FILE IT WAS THROWN IN (autopsy c71e56de / 7aa2fe7c / 8701aaa1,
 * build report #1846 and its two predecessors).
 *
 * Every browser lane records `error.stack`, and the readers kept only `e.text`. So the preview repair, the builder's
 * own `console_errors` tool and the game playtest all said "Cannot read properties of undefined (reading 'rotation')"
 * and nothing else; the builder guessed `Bird.ts` — whose rotations were already inside a try/catch — and about
 * fifteen edits across three builds landed in files that were not the source. `formatRuntimeErrors` (autopsy
 * 95598899) had learned to read the stack; only its own lane used it. The class: an error's site captured, then
 * dropped before the model sees it. Locked here by the shared helper, every reader, and a census.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { locatedErrorText } from '../src/server/AgentV3/runtimeErrorSite';
import { formatRuntimeErrors } from '../src/server/AgentV3/AutoFix';
import { firstPlayError } from '../src/server/AgentV3/gamePlaytest';

// The shape Chrome gives Playwright for an uncaught error in a Vite dev page: absolute URL, `?t=` cache-buster,
// the framework's own frames first.
const STACK = [
  "TypeError: Cannot read properties of undefined (reading 'rotation')",
  '    at driveVehicle (http://localhost:5173/src/game/three/objects.ts?t=1793638810000:1188:31)',
  '    at Object.update (http://localhost:5173/src/game/RacingGame.tsx?t=1793638810000:121:9)',
].join('\n');
const STACK_APP_FIRST = [
  "TypeError: Cannot read properties of undefined (reading 'rotation')",
  '    at Object.update (http://localhost:5173/src/game/RacingGame.tsx?t=1793638810000:121:9)',
  '    at GameLoop.tick (http://localhost:5173/node_modules/.vite/deps/chunk.js:10:2)',
].join('\n');
const MESSAGE = "Cannot read properties of undefined (reading 'rotation')";

describe('📍 the shared rule: the message, then where it was thrown', () => {
  it('the report case: the bare message gains the first app frame, cache-buster and origin stripped', () => {
    expect(locatedErrorText({ text: MESSAGE, stack: STACK_APP_FIRST })).toBe(`${MESSAGE} [at src/game/RacingGame.tsx:121:9]`);
    expect(locatedErrorText({ text: MESSAGE, stack: STACK })).toBe(`${MESSAGE} [at src/game/three/objects.ts:1188:31]`);
  });
  it('no stack, or no app frame, leaves the message byte-identical — a site is never invented', () => {
    expect(locatedErrorText({ text: MESSAGE })).toBe(MESSAGE);
    expect(locatedErrorText({ text: MESSAGE, stack: 'at x (http://localhost:5173/node_modules/.vite/deps/react.js:1:1)' })).toBe(MESSAGE);
  });
  it('the AutoFix lane formats through the same rule (one implementation, not two)', () => {
    expect(formatRuntimeErrors([{ t: 1, kind: 'pageerror', text: MESSAGE, stack: STACK_APP_FIRST }]))
      .toBe(`- [pageerror] ${MESSAGE} [at src/game/RacingGame.tsx:121:9]`);
  });
  it('the game playtest names the site of the first error it hit, after its own 160-character cap', () => {
    expect(firstPlayError({ errors: [MESSAGE], errorStacks: [STACK_APP_FIRST] })).toBe(`${MESSAGE} [at src/game/RacingGame.tsx:121:9]`);
    const long = `${'x'.repeat(200)}`;
    expect(firstPlayError({ errors: [long], errorStacks: [STACK_APP_FIRST] })).toBe(`${'x'.repeat(160)} [at src/game/RacingGame.tsx:121:9]`);
    expect(firstPlayError({ errors: [MESSAGE] })).toBe(MESSAGE); // an older script's output: no stacks
    expect(firstPlayError({})).toBe('');
  });
});

describe('📍 every reader that hands an error to the builder carries its site', () => {
  const agentv3 = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  const dispatcher = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
  const playtest = readFileSync('src/server/AgentV3/gamePlaytest.ts', 'utf8');
  it('the three render checks that feed the preview repair prompt', () => {
    const located = agentv3.match(/consoleErrs = renderJudgingConsole\(filterActionableErrors\(\(await actuator\.getConsoleErrors\([^\n]*\.map\(locatedErrorText\)\)/g) ?? [];
    expect(located.length).toBe(3);
  });
  it("the builder's own console_errors tool", () => {
    expect(dispatcher).toContain('errors.slice(0, 30).map((e) => `- [${e.kind}] ${locatedErrorText(e)}`)');
  });
  it('the game playtest keeps the stack beside each error and reports through firstPlayError', () => {
    expect(playtest).toContain("errorStacks.push(String(e && e.stack || '').slice(0, 1200))");
    expect(playtest).toContain('out.errorStacks = errorStacks.slice(0, 5);');
    expect(playtest).toContain("evidence: run.errors?.[0] ? firstPlayError(run)");
  });
  it('🔒 CENSUS: no server reader maps a console capture to its bare text unless it is listed with why', () => {
    // A console capture turned into strings with `.map((e) => e.text)` drops the stack. A NEW one fails here.
    const ALLOWED: Array<[string, RegExp, string]> = [
      ['src/server/routes/agentv3.ts', /errs = \(await actuator\.getConsoleErrors\(workspaceId, caseStart\)\)\.errors\.map\(\(e\) => e\.text\)/,
        'red-team fuzz: the texts are CLASSIFIED (did the input crash the page?), never handed to a builder as a repair'],
    ];
    const files = ['src/server/routes/agentv3.ts', 'src/server/AgentV3/ToolDispatcher.ts', 'src/server/AgentV3/AutoFix.ts', 'src/server/AgentV3/gamePlaytest.ts'];
    const offenders: string[] = [];
    for (const f of files) {
      const lines = readFileSync(f, 'utf8').split('\n');
      lines.forEach((l, i) => {
        if (/getConsoleErrors|filterActionableErrors|captured\.errors/.test(l) && /\.map\(\(e\) => e\.text\)/.test(l)
          && !ALLOWED.some(([af, re]) => af === f && re.test(l))) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
