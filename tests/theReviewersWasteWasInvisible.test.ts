import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { repeatedReadSummary, repeatedReadNotice } from '../src/server/AgentV3/repeatedReads';
import { noJourneyReason, NO_DATA_ENTRY_REASON } from '../src/server/AgentV3/journeyDerivation';
import { snapshotConfirmation } from '../src/server/AgentV3/snapshotIdentity';

/**
 * 🔬 AUTOPSY f97eb0ec (2026-09-20) — the falling-block game.
 *
 * The build succeeded in 9 minutes and the app rendered. Two things it said about itself were false
 * or missing, and both were measurements rather than code that runs the app.
 *
 * 1. THE REVIEWER READ `src/App.tsx` SEVEN TIMES, unchanged, with our own nudge quoted back to it
 *    every time. Seven of its twelve lean steps went on it and it timed out with ZERO findings —
 *    so the one pass that would have checked the game against the prompt never reported anything.
 *    `repeatedReadSummary` exists precisely to put that in the build report, and the report carried
 *    NO such finding: the reviewer is a SUB-AGENT with its own `ToolDispatcher`, the ledger is an
 *    instance field, and the route reads the PARENT's.
 *
 *    ⚠️ FIFTH OCCURRENCE OF ONE CLASS. `onFileWrite` (#2988), the framework id, `onCommand`,
 *    `writeTypecheckStats` (#3134) — every one of them a child dispatcher's state that never reached
 *    the parent. The fix here is deliberately the SAME SHAPE as #3134's, two lines above it.
 *
 * 2. THE JOURNEY CHECK TOLD THE GAME IT TAKES NO INPUT. "this app has no form for a journey to fill
 *    in — nothing here takes user input", about an app with a canvas, touch handlers, arrow keys and
 *    on-screen ←/→ buttons. The game-aware sentence already existed one branch above — and is gated
 *    on there being NO pages, so a React game with an `App.tsx` could never reach it.
 */

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
/** Strip comments before asserting ABSENCE or ORDER — a comment describing a line is not the line. */
const codeOnly = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((line) => line.replace(/(^|\s)\/\/.*$/, ''))
  .join('\n');

describe('🔴 a sub-agent’s re-reads are counted in the build’s own numbers', () => {
  const dispatcher = codeOnly(read('src/server/AgentV3/ToolDispatcher.ts'));
  const subAgent = codeOnly(read('src/server/AgentV3/SubAgent.ts'));
  const route = codeOnly(read('src/server/routes/agentv3.ts'));

  it('the dispatcher can hand out its LIVE ledger and adopt another one', () => {
    expect(dispatcher).toContain('sharedReadLedger()');
    expect(dispatcher).toContain('shareReadLedger(');
  });

  it('🔒 it hands out the ledger ITSELF, not a copy — a copy would count nothing', () => {
    // `readLedgerCounts()` already returns a snapshot for the report. If `sharedReadLedger` did the
    // same, the child would accumulate into a dead map and the report would be exactly as blind as
    // it was. The distinction is the entire fix.
    const fn = dispatcher.slice(dispatcher.indexOf('sharedReadLedger()'));
    const body = fn.slice(0, fn.indexOf('\n  }'));
    expect(body).toContain('return this._readLedger');
    expect(body).not.toContain('new Map');
  });

  it('the spawn shares it with the child, through a THUNK', () => {
    // A value would capture `undefined`: the parent dispatcher takes this spawn as a constructor
    // argument, so it does not exist yet when the spawn is built. Same reason as `ignoreRules`.
    expect(subAgent).toContain('readLedger?: () =>');
    expect(subAgent).toContain('deps.readLedger?.()');
    expect(subAgent).toContain('childDispatcher.shareReadLedger(');
  });

  it('🔒 sharing can never block a spawn', () => {
    const at = subAgent.indexOf('deps.readLedger?.()');
    const around = subAgent.slice(Math.max(0, at - 200), at + 200);
    expect(around).toContain('try {');
    expect(around).toContain('catch');
  });

  it('the route passes the parent’s ledger down', () => {
    expect(route).toContain('readLedger: () => dispatcherForSubAgents?.sharedReadLedger()');
  });

  it('it sits beside the sibling fix it copies, so the pair cannot drift apart', () => {
    // #3134 threaded `writeTypecheckStats` the same way. Keeping them adjacent is what makes the
    // NEXT dropped measurement obvious at the same call site.
    const ws = subAgent.indexOf('shareWriteTypecheckStats(');
    const rl = subAgent.indexOf('shareReadLedger(');
    expect(ws).toBeGreaterThan(0);
    expect(rl).toBeGreaterThan(ws);
    expect(rl - ws).toBeLessThan(700);
  });
});

describe('the finding the shared ledger makes reportable', () => {
  it('names the waste the reviewer actually produced', () => {
    // The real shape from the report: App.tsx ×7, .env ×2, .gitignore ×1.
    const line = repeatedReadSummary(new Map([['src/App.tsx', 7], ['.env', 2], ['.gitignore', 1]]));
    expect(line).toContain('10 file reads');
    expect(line).toContain('3 distinct');
    expect(line).toContain('7 of them');
    expect(line).toContain('7× src/App.tsx');
  });

  it('🔒 stays silent on ordinary work — a couple of re-reads is not a finding', () => {
    expect(repeatedReadSummary(new Map([['a.ts', 2], ['b.ts', 1]]))).toBe('');
    expect(repeatedReadSummary(new Map())).toBe('');
  });

  it('the nudge itself is unchanged, and still returns the content', () => {
    // ⚠️ NOT a cache, and that trade is settled in repeatedReads.ts: a model whose context has been
    // trimmed must still be able to re-read a file. What was missing was the COUNT reaching a human,
    // never the suppression.
    const notice = repeatedReadNotice('src/App.tsx', 7, true);
    expect(notice).toContain('the 7th time');
    expect(notice).toContain('The full content follows');
    expect(repeatedReadNotice('src/App.tsx', 1, true)).toBe('');
    expect(repeatedReadNotice('src/App.tsx', 7, false)).toBe('');
  });
});

describe('🔴 a game is not told that it takes no user input', () => {
  /** The admin's falling-block game, in the shape the report shows it. */
  const GAME = {
    'src/App.tsx': `
      import { useEffect, useRef, useState } from 'react';
      export default function App() {
        const canvasRef = useRef<HTMLCanvasElement>(null);
        useEffect(() => { const ctx = canvasRef.current!.getContext('2d'); }, []);
        useEffect(() => { window.addEventListener('keydown', onKey); }, []);
        return (<div onTouchStart={onTouch}>
          <canvas ref={canvasRef} />
          <button onClick={left}>←</button><button onClick={right}>→</button>
        </div>);
      }`,
    'src/main.tsx': `import { createRoot } from 'react-dom/client'; createRoot(el).render(<App />);`,
  };

  it('says there is nothing to save and reload — not that nothing takes input', () => {
    const reason = noJourneyReason(GAME);
    expect(reason).toBe(NO_DATA_ENTRY_REASON);
    // The exact false sentence from the report.
    expect(reason).not.toContain('nothing here takes user input');
  });

  it('🔒 an app whose form merely sits DEEPER still gets the form wording', () => {
    // The precision lock. `appHasNoDataEntry` scans every file, so a real form anywhere keeps this
    // out of the game branch — which is the defect the form sentence exists to report.
    const deep = {
      'src/App.tsx': `import { createRoot } from 'react-dom/client';
        export default function App() { return <div><Wrapper /></div>; }`,
      'src/deep/Nested.tsx': `export const F = () => <form><input name="email" /></form>;`,
    };
    const reason = noJourneyReason(deep);
    expect(reason).not.toBe(NO_DATA_ENTRY_REASON);
  });

  it('🔒 an app with a real form on the page derives a journey — unchanged', () => {
    const formApp = {
      'src/App.tsx': `import { createRoot } from 'react-dom/client';
        export default function App() {
          return <form onSubmit={save}><input name="title" /><button type="submit">Add</button></form>;
        }`,
    };
    expect(noJourneyReason(formApp)).not.toBe(NO_DATA_ENTRY_REASON);
  });

  it('both branches say the SAME sentence — one explanation, one home', () => {
    // A canvas game with NO App.tsx took the other branch. This file's own history is of one
    // explanation drifting into two slightly different claims.
    const canvasOnly = {
      'src/game.ts': `const ctx = document.querySelector('canvas')!.getContext('2d');
        renderer.render(scene, camera);`,
    };
    expect(noJourneyReason(canvasOnly)).toBe(NO_DATA_ENTRY_REASON);
    expect(noJourneyReason(GAME)).toBe(NO_DATA_ENTRY_REASON);
  });

  it('🔒 an empty project is still "we could not find where to check"', () => {
    // Positive evidence of a UI is required — an absence of data entry is equally true of nothing.
    expect(noJourneyReason({})).not.toBe(NO_DATA_ENTRY_REASON);
  });
});

describe('🔴 the shared-contract pass is skipped ONCE, not twice', () => {
  const builder = read('src/server/AgentV3/SimpleBuilder.ts');

  it('there is exactly one place that logs the skip', () => {
    // The report shows BOTH sentences, in the same millisecond. `if (!contractAffordable)` logged one
    // and the `else` of the run-it branch logged the other, and an unaffordable contract satisfies
    // both — so the user was told twice, for two different-sounding reasons.
    const skips = builder.split("⏭️ Skipping the shared-contract pass").length - 1;
    expect(skips).toBe(2);              // the two REASONS survive…
    const logs = builder.split("deps.log?.(contractCap > 0").length - 1;
    expect(logs).toBe(1);               // …inside ONE call that can only fire once
  });

  it('the old always-true second branch is gone', () => {
    expect(codeOnly(builder)).not.toContain('if (shareContract && contractCap > 0 && !contractAffordable)');
  });
});

describe('🔴 a plan the fast lane paid for is handed over, not thrown away', () => {
  const builder = codeOnly(read('src/server/AgentV3/SimpleBuilder.ts'));
  const route = codeOnly(read('src/server/routes/agentv3.ts'));

  it('the lane carries the planned PATHS, not only their count', () => {
    // `plannedFiles` already existed and is a NUMBER for the ETA, so the list itself had no home —
    // which is why 62s and 2,220 output tokens of planning were discarded on the bail.
    expect(builder).toContain('let plannedPaths: string[] = []');
    expect(builder).toContain('plannedPaths = manifest.map((f) => f.path)');
    expect(builder).toContain('plannedPaths?: string[]');
  });

  it('the bail result carries it — the bail is the whole point', () => {
    const at = builder.indexOf('salvagedPaths,\n      plannedFiles,');
    expect(at).toBeGreaterThan(0);
    expect(builder.slice(at, at + 120)).toContain('plannedPaths');
  });

  it('the route offers it to the full builder', () => {
    expect(route).toContain('SIMPLE_BUILD_PLAN_HANDOFF');
    expect(route).toContain('sb.plannedPaths?.length');
  });

  it('🔒 offered as a PLAN, never as work already done', () => {
    // The salvage block above it says "CONTINUE — DO NOT START OVER" about files that EXIST. Saying
    // that about files that do not is the confident-and-wrong instruction this codebase forbids.
    const at = route.indexOf('SIMPLE_BUILD_PLAN_HANDOFF');
    const block = route.slice(at, at + 1400);
    expect(block).toContain('NOT written yet');
    expect(block).not.toContain('DO NOT START OVER');
    expect(block).not.toContain('YOUR OWN prior work');
  });

  it('🔒 only when nothing was salvaged — real files are the stronger signal', () => {
    const at = route.indexOf('sb.plannedPaths?.length');
    expect(route.slice(Math.max(0, at - 120), at)).toContain('!sb.salvagedPaths?.length');
  });
});

describe('🔴 a stale copy names WHICH files differ', () => {
  const taken = (filesHash: string, filePaths?: string[]) => ({ url: 'https://x.example/app', filesHash, filePaths });

  it('says a CONTENT change when both sides hold the same files', () => {
    const v = snapshotConfirmation({
      taken: taken('aaa', ['src/App.tsx', 'index.html']),
      persistedHash: 'bbb',
      persistedPaths: ['index.html', 'src/App.tsx'],   // same set, any order
    });
    expect(v.action).toBe('stale');
    expect(v.reason).toContain('same 2 file(s)');
    expect(v.reason).toContain('CONTENT changed');
  });

  it('🔑 says FILE-SET MISMATCH when the two sides cover different files', () => {
    // The suspicion the old sentence could not rule out: the copy's hash is taken over the SANDBOX
    // tree and the confirmation's over the DURABLE set. One extra path on either side and the copy is
    // stale on every build, for ever, looking exactly like a late write.
    const v = snapshotConfirmation({
      taken: taken('aaa', ['src/App.tsx', 'node_modules/.vite/x']),
      persistedHash: 'bbb',
      persistedPaths: ['src/App.tsx', '.env'],
    });
    expect(v.reason).toContain('DIFFERENT files');
    expect(v.reason).toContain('node_modules/.vite/x');
    expect(v.reason).toContain('.env');
    expect(v.reason).toContain('not necessarily a late write');
  });

  it('🔒 stays silent about the difference when it cannot know it', () => {
    // A copy from before paths were carried. Saying nothing is right; guessing would be worse than
    // the sentence being replaced.
    const v = snapshotConfirmation({ taken: taken('aaa'), persistedHash: 'bbb' });
    expect(v.action).toBe('stale');
    expect(v.reason).not.toContain('DIFFERENT files');
    expect(v.reason).not.toContain('CONTENT changed');
  });

  it('🔒 a matching copy is still promoted — unchanged', () => {
    const v = snapshotConfirmation({ taken: taken('same', ['a.ts']), persistedHash: 'same', persistedPaths: ['a.ts'] });
    expect(v.action).toBe('restamp');
  });

  it('🔒 the hash still decides, never the paths', () => {
    // Identical paths, different hashes ⇒ still stale. The paths only explain.
    const v = snapshotConfirmation({ taken: taken('aaa', ['a.ts']), persistedHash: 'zzz', persistedPaths: ['a.ts'] });
    expect(v.action).toBe('stale');
  });
});
