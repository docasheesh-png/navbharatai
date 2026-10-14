/**
 * Build `413d29a1` (2026-10-14, the MP4→MP3 converter) — Q-1062.
 *
 * 171 model calls in 13.4 minutes, averaging 52,163 input tokens in and 33 output tokens out; 166 made
 * exactly one tool call and 170 of 171 finished with `tool_use` — the model never once tried to stop.
 * Minutes 10–13 are `: > /tmp/x && node -e 'console.log("noop")'`, over and over. It cost NavBharatAI
 * $1.87 of real provider spend for a build that ended RED and was correctly charged ₹0 to the user.
 *
 * THREE guards should each have ended it, and none could, for one reason: every guard that asks "did
 * anything happen?" was answered YES by a command that did nothing.
 *   1. `noteMutations` counted it as a mutation → it reset its OWN repeat count on every call, so the loop
 *      guard could never reach its threshold at any repeat count.
 *   2. `isNoOpTurn` was therefore never true → `MAX_NO_OP_TURNS_AFTER_FINAL` could never end the run.
 *   3. the futility breaker counts "a COMMAND completed" as progress, and a no-op exits 0.
 *
 * THE CLASS is this engine's own sentence: "A CALL THAT CANNOT DO ANYTHING IS NOT A CHANGE." Q-738 fixed the
 * INSTANCE (a literally empty string). A written-out no-op is the same thing spelled differently — and this
 * shape was described in TWO earlier autopsies (`repeatedReads.ts`, `devServerLaunchLog.ts`) without the
 * engine ever being given a way to recognise it.
 *
 * ⚠️ HALF THIS FILE IS THE PRECISION BATTERY, and that is deliberate. A false "inert" is the dangerous
 * direction — `isNoOpTurn` can end a run — so a wide set of genuine commands must never be read as inert.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { isInertCommand, isInertSegment } from '../src/server/AgentV3/inertCommand';
import { stripCodeComments } from '../src/server/AgentV3/stripCodeComments';
import {
  isInertCommandCall, isEmptyCommandCall, newRepeatProbeState, noteMutations, collectRepeatProbeSteer, isNoOpTurn,
} from '../src/server/AgentV3/RepeatProbeGuard';

/** The reported build's own command, verbatim from report 12ef62b2 / build 413d29a1. */
const REPORTED = ': > /tmp/x && node -e \'console.log("noop")\'';
/** The "Universal Remote" autopsy's own loop (repeatedReads.ts, 2026-09-27). */
const UNIVERSAL_REMOTE = ': > /tmp/empty.css && wc -l /tmp/empty.css';

describe('the reported no-op is recognised', () => {
  it('the exact command from build 413d29a1 is inert', () => {
    expect(isInertCommand(REPORTED)).toBe(true);
  });

  it('and so is the one the September autopsy wrote down but could not detect', () => {
    expect(isInertCommand(UNIVERSAL_REMOTE)).toBe(true);
  });

  it('every form the two autopsies recorded', () => {
    for (const cmd of [
      ':', 'true', 'false', ':;', 'sleep 3', 'sleep 0.5',
      ': > /tmp/x', '> /dev/null', ':>> /tmp/empty.css',
      'echo done', 'echo "hello world"', 'printf ok',
      'echo done > /dev/null', 'echo hi > /tmp/log',
      'wc -l /tmp/empty.css', 'cat /tmp/x', 'ls /tmp', 'head -5 /tmp/a /tmp/b',
      'node -e \'console.log("noop")\'', 'node --eval "console.log(1)"', 'node -e \'\'',
      'node -e \'console.log("a"); console.error("b")\'',
      ': > /tmp/x && echo done && sleep 1', 'true; true; true', 'echo a | cat /tmp/b',
    ]) {
      expect(isInertCommand(cmd), cmd).toBe(true);
    }
  });
});

describe('🔒 THE PRECISION BATTERY — a real command is never read as a no-op', () => {
  it('nothing the build actually does is inert', () => {
    for (const cmd of [
      // the reported build's own REAL commands, verbatim from the report
      'ls -la && cat package.json',
      'npm install @ffmpeg/ffmpeg @ffmpeg/util 2>&1 | tail -20',
      'ls node_modules/@ffmpeg/ffmpeg/dist && ls node_modules/@ffmpeg/util/dist',
      'ls -la src && find src -type f -name "*.tsx" -o -name "*.ts" | head -50',
      './node_modules/.bin/tsc --noEmit 2>&1 | head -40',
      'npm run build 2>&1 | tail -40',
      // and a spread of ordinary build work
      'npm ci', 'npm run dev', 'npx vitest run', 'git status', 'git add -A && git commit -m x',
      'mkdir -p src/components', 'rm -rf dist', 'cp a b', 'mv a b', 'chmod +x run.sh',
      'ffmpeg -i in.mp4 out.mp3', 'curl -s http://localhost:5173',
      'cat package.json', 'wc -l src/App.tsx', 'ls src', 'head -5 src/App.tsx',
      'echo "body { margin: 0 }" > src/index.css',
      'printf "x" >> src/App.tsx',
      'node -e \'require("fs").writeFileSync("src/App.tsx","x")\'',
      'node -e \'console.log(require("fs").readdirSync("src"))\'',
      'node -e \'process.exit(1)\'',
      'node script.js', 'node -p 1+1',
      ': > src/App.tsx', '> src/index.css', 'echo hi > ./notes.txt',
      'sleep 3 && npm run build',
      'npm run dev -- --host 0.0.0.0 --port 5173 &',
      'echo $(date)', 'echo `pwd`', 'cat ${FILE}',
      'true && npm run build',
    ]) {
      expect(isInertCommand(cmd), cmd).toBe(false);
    }
  });

  it('a redirect is judged by its TARGET, not by looking inert', () => {
    expect(isInertSegment(': > /tmp/x')).toBe(true);
    expect(isInertSegment(': > src/App.tsx')).toBe(false);
    expect(isInertSegment('echo x > /dev/null')).toBe(true);
    expect(isInertSegment('echo x > src/a.css')).toBe(false);
  });

  it('a read is inert only when every path it names is outside the workspace', () => {
    expect(isInertSegment('wc -l /tmp/a /tmp/b')).toBe(true);
    expect(isInertSegment('wc -l /tmp/a src/App.tsx')).toBe(false);
    expect(isInertSegment('cat src/App.tsx')).toBe(false);
    expect(isInertSegment('wc -l')).toBe(false); // no path at all — unrecognised, so real
  });

  it('anything unknowable is REAL — a substitution or a background job', () => {
    for (const cmd of ['echo $(rm -rf src)', 'echo `npm run build`', ': > /tmp/x & npm run build', 'cat <(ls src)']) {
      expect(isInertCommand(cmd), cmd).toBe(false);
    }
  });

  it('one real segment makes the whole command real', () => {
    expect(isInertCommand(': > /tmp/x && npm run build')).toBe(false);
    expect(isInertCommand('echo start; ./node_modules/.bin/tsc --noEmit')).toBe(false);
  });

  it('a non-string is never inert, and an empty string is', () => {
    expect(isInertCommand(undefined)).toBe(false);
    expect(isInertCommand(null)).toBe(false);
    expect(isInertCommand(42)).toBe(false);
    expect(isInertCommand('   ')).toBe(true);
  });
});

describe('site 1 + 2 — the loop guard can now reach its threshold', () => {
  const call = (command: string) => ({ name: 'bash', input: { command } });

  it('the no-op no longer counts as a change, so it stops resetting its own repeat count', () => {
    const st = newRepeatProbeState();
    noteMutations(st, [call(REPORTED)]);
    expect(st.mutations).toBe(0);
    // A real command still counts — the breaker must keep seeing genuine work.
    noteMutations(st, [call('npm run build')]);
    expect(st.mutations).toBe(1);
  });

  it('🔴 THE REPORTED LOOP: before this fix the guard could not steer at ANY repeat count', () => {
    const st = newRepeatProbeState();
    let steers = 0;
    for (let i = 0; i < 60; i++) {
      noteMutations(st, [call(REPORTED)]);
      if (collectRepeatProbeSteer(st, [call(REPORTED)], 3)) steers++;
    }
    expect(steers).toBeGreaterThan(0); // it used to be exactly 0, for all 60
  });

  it('a genuinely converging build is NOT nagged: a real command between checks still resets', () => {
    const st = newRepeatProbeState();
    let steers = 0;
    for (let i = 0; i < 30; i++) {
      // check, fix, check again — the shape PROBE_TOOLS' safety note exists to protect
      noteMutations(st, [call('./node_modules/.bin/tsc --noEmit'), { name: 'write_file', input: { path: 'src/App.tsx' } }]);
      if (collectRepeatProbeSteer(st, [{ name: 'grep', input: { pattern: 'x' } }], 3)) steers++;
    }
    expect(steers).toBe(0);
  });

  it('a turn of only no-ops is a no-op turn, so the run can end honestly', () => {
    const never = () => false;
    expect(isNoOpTurn([call(REPORTED)], never)).toBe(true);
    expect(isNoOpTurn([call(REPORTED), call(UNIVERSAL_REMOTE)], never)).toBe(true);
    expect(isNoOpTurn([call(REPORTED), call('npm run build')], never)).toBe(false);
    expect(isNoOpTurn([], never)).toBe(false);
  });

  it('the narrow literal question still exists and still answers only about an EMPTY command', () => {
    expect(isEmptyCommandCall(call(''))).toBe(true);
    expect(isEmptyCommandCall(call(REPORTED))).toBe(false); // ← the Q-738 instance vs the Q-1062 class
    expect(isInertCommandCall(call(REPORTED))).toBe(true);
    expect(isInertCommandCall({ name: 'write_file', input: { command: REPORTED } })).toBe(false);
  });
});

describe('site 3 — the futility breaker stops seeing a no-op as progress', () => {
  const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');

  it('the progress counter asks the shared predicate', () => {
    const fn = route.slice(route.indexOf('const noteCommandCompleted ='), route.indexOf('};', route.indexOf('const noteCommandCompleted =')) + 2);
    expect(fn).toContain('isInertCommand(command)');
    expect(fn).toContain('commandsRun += 1');
  });

  it('BOTH lanes hand it the real command text — the architect and its sub-agents', () => {
    // The a2b9c802 autopsy had to add the architect's hook because only sub-agents' commands were counted;
    // a fix that threads the text through one of the two lanes would re-open exactly that gap.
    expect((route.match(/noteCommandCompleted\(c\?\.command\)/g) ?? []).length).toBe(2);
    expect(route).not.toMatch(/noteCommandCompleted\(\)/); // no call site left passing nothing
  });

  it('the predicate has ONE home — no call site re-implements the comparison', () => {
    // 🔴 COMMENTS ARE STRIPPED FIRST, ON PURPOSE. Written over the raw source this failed on the route's own
    // new comment, which QUOTES the reported command as evidence — the autopsy trail this repo keeps
    // deliberately. The property is that no CODE matches the one reported string; a comment naming it is the
    // documentation, not a second implementation. (The same trap as `codeOnly` in
    // `aCallOutsideTheLoopIsStillOnTheRecord`, where I asserted against an inline comment the stripper ate.)
    const guard = readFileSync(join(__dirname, '../src/server/AgentV3/RepeatProbeGuard.ts'), 'utf8');
    for (const src of [route, guard]) {
      const code = stripCodeComments(src);
      expect(code).not.toMatch(/console\\?\.log\\?\("noop"\)/); // nobody special-cases the one reported string
      expect(code).not.toMatch(/\/tmp\/x/);
      expect(code).not.toMatch(/OUTSIDE_WORKSPACE|isPrintOnlyNodeEval|PRINT_ONLY/); // no copy of the rules
    }
    expect(route).toContain("from '../AgentV3/inertCommand'");
  });
});
