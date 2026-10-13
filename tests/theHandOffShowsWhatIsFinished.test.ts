// Q-422 (autopsy 1eaa5f5a, 2026-10-04). The fast lane decided to hand off at 29 s, but the tier waited
// for the call still in flight until 96 s, and nothing reached the user's screen in between; they
// pressed Stop at 96.5 s. The admin chose: keep waiting (that call salvaged App.tsx), but show the
// finished files at once. So the files done when the decision is taken are saved and announced
// immediately, each in-flight file as it lands, and the final salvage still writes last.
//
// UPDATED 2026-10-13 (build report 9c612cdb, Q-982): the salvage no longer writes everything again. The writer here
// now answers per file, as the route's does (writeOutcomes.ts), so the lane knows the early saves landed and the
// salvage writes only what is missing or changed — here nothing, so the early saves ARE the last word. The old
// expectation ("the salvage writes everything last") pinned the double write itself; a writer that answers
// nothing still gets exactly that behaviour, and the last test below keeps it pinned.
import { describe, it, expect } from 'vitest';
import { runSimpleBuild, handOffEarlySaveEnabled } from '../src/server/AgentV3/SimpleBuilder';
import type { OneShotFile } from '../src/server/AgentV3/OneShotBuilder';

const manifest = ['src/components/Alpha.tsx :: alpha', 'src/components/Beta.tsx :: beta', 'src/components/Gamma.tsx :: gamma'].join('\n');
const block = (p: string) => `<<<FILE ${p}>>>\nexport const x = 1;\n<<<ENDFILE>>>`;

function run(env: Record<string, string | undefined> = {}, opts: { answers?: boolean } = {}) {
  const answers = opts.answers ?? true;
  const saved = Object.assign({}, process.env);
  Object.assign(process.env, env);
  let releaseBeta!: () => void;
  const betaHeld = new Promise<void>((r) => { releaseBeta = r; });
  let alphaDone = false;
  let betaReleased = false;
  const events: string[] = [];
  const ready: string[][] = [];
  const p = runSimpleBuild({
    prompt: 'a small app', framework: 'vite-react', scaffoldPaths: ['src/App.tsx', 'src/main.tsx'],
    depOrder: false, concurrency: 2,
    generate: async (system: string, user: string) => {
      if (user.includes('Plan the file list')) return manifest;
      if (system.includes('SHARED CONTRACT')) return '';
      const path = (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || 'src/x.ts';
      if (path.endsWith('Beta.tsx')) { await betaHeld; betaReleased = true; }
      // Alpha yields first, so Beta's call is already in flight when the decision is taken.
      if (path.endsWith('Alpha.tsx')) { await new Promise((r) => setTimeout(r, 10)); alphaDone = true; }
      return block(path);
    },
    // The hand-off decision is taken once Alpha is done; Gamma's call is the one that sees it.
    stopLane: () => (alphaDone ? 'the next engine reasons before every answer' : null),
    writeFiles: async (files: OneShotFile[]) => {
      events.push(`${betaReleased ? 'after' : 'before'}:${files.map((f) => f.path.split('/').pop()).join(',')}`);
      // Beta is held until the early save has been seen, so the test proves the save did not wait for it.
      if (!betaReleased) setTimeout(releaseBeta, 0);
      // The route's writer answers per file (Q-982); `answers: false` is a writer that answers nothing.
      return answers ? files.map((f) => ({ path: f.path, ok: true })) : undefined;
    },
    onFilesReady: (files: OneShotFile[]) => { ready.push(files.map((f) => f.path.split('/').pop()!)); },
  } as never);
  // A safety release, so a regression fails on the assertion rather than hanging the suite.
  setTimeout(() => releaseBeta(), 2_000);
  return { p: p.finally(() => { process.env = saved; }), events, ready };
}

describe('Q-422: the finished files are saved when the hand-off is decided', () => {
  it('🔴 Alpha is saved and announced BEFORE the in-flight Beta call returns', async () => {
    const { p, events, ready } = run();
    const r = await p;
    expect(r.ok).toBe(false);
    expect(events[0]).toBe('before:Alpha.tsx');
    expect(ready[0]).toEqual(['Alpha.tsx']);
  });

  it('the in-flight file is saved as it lands, and the salvage writes only what is not there yet — here nothing', async () => {
    // Was: `expect(events[events.length - 1]).toBe('after:Alpha.tsx,Beta.tsx')` — the salvage rewriting both files
    // the early saves had just written. Changed deliberately (Q-982): that second write was the double write.
    const { p, events, ready } = run();
    const r = await p;
    expect(events).toContain('after:Beta.tsx');
    expect(ready).toContainEqual(['Beta.tsx']);
    expect(events).toEqual(['before:Alpha.tsx', 'after:Beta.tsx']);
    expect([...(r.salvagedPaths ?? [])].sort()).toEqual(['src/components/Alpha.tsx', 'src/components/Beta.tsx']);
  });

  it('a writer that answers nothing keeps the old behaviour: the salvage writes everything last', async () => {
    // Unknown is never confirmed, so the lane cannot skip a file it never heard landed (writeOutcomes.ts).
    const { p, events } = run({}, { answers: false });
    const r = await p;
    expect(events[events.length - 1]).toBe('after:Alpha.tsx,Beta.tsx');
    expect([...(r.salvagedPaths ?? [])].sort()).toEqual(['src/components/Alpha.tsx', 'src/components/Beta.tsx']);
  });

  it('AGENTV3_HANDOFF_EARLY_SAVE=off restores the old behaviour: one save, after the wait', async () => {
    const { p, events, ready } = run({ AGENTV3_HANDOFF_EARLY_SAVE: 'off' });
    await p;
    expect(events).toEqual(['after:Alpha.tsx,Beta.tsx']);
    expect(ready).toEqual([]);
  });

  it('the switch reads off in any case, and on otherwise', () => {
    expect(handOffEarlySaveEnabled({})).toBe(true);
    expect(handOffEarlySaveEnabled({ AGENTV3_HANDOFF_EARLY_SAVE: ' OFF ' })).toBe(false);
    expect(handOffEarlySaveEnabled({ AGENTV3_HANDOFF_EARLY_SAVE: 'on' })).toBe(true);
  });
});
