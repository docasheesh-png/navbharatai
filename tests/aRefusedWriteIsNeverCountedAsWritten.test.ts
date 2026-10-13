// Q-912 (build report 9c612cdb) — the half of the item every lane shares: a platform write's per-file answer.
//
// The workspace's write door (`ToolDispatcher.dispatch('write_file')`) reports a refusal as `{ is_error: true }`,
// never as a throw. Every platform writer in the route dropped that answer, so "the promise resolved" was read as
// "the file is there" by the fast lane, the one-shot lane, the in-lane fixes inside the fast verify, and the
// post-build passes that announce "generated N file(s)". One writer now returns one outcome per file, the lanes
// and passes count and name only what landed, and a writer that answers nothing keeps the old assumption.
//
// The CONTINUE note's opening clause is the same report's other honesty defect (Q-912 E): one reason, "before
// running out of time", stood for every ending but a failed compile — including that build's planned hand-off.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { readWriteOutcomes, writePlatformFiles, type DispatchWrite } from '../src/server/AgentV3/writeOutcomes';
import { writesAreUnread } from '../src/server/AgentV3/unreadWrites';
import { createLaneWriteFence } from '../src/server/AgentV3/laneWriteFence';
import { runOneShot } from '../src/server/AgentV3/OneShotBuilder';
import { salvageWhyClause } from '../src/server/AgentV3/handoffRule';
import { PROCESS_ONLY_CODES } from '../src/server/AgentV3/BuildDiagnostics';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('readWriteOutcomes — what a write reported, read against what it was given', () => {
  const files = [{ path: 'src/a.ts', content: 'a' }, { path: 'src/b.ts', content: 'b' }];

  it('🔴 a refused file is not landed, and keeps the workspace\'s reason', () => {
    const r = readWriteOutcomes(files, [{ path: 'src/a.ts', ok: true }, { path: 'src/b.ts', ok: false, error: 'refused' }]);
    expect(r.known).toBe(true);
    expect(r.landed.map((f) => f.path)).toEqual(['src/a.ts']);
    expect(r.failed).toEqual([{ path: 'src/b.ts', error: 'refused' }]);
  });

  it('a writer that answers nothing is UNKNOWN: every file assumed written, as before outcomes existed', () => {
    for (const nothing of [undefined, null]) {
      const r = readWriteOutcomes(files, nothing);
      expect(r.known).toBe(false);
      expect(r.landed).toEqual(files);
      expect(r.failed).toEqual([]);
    }
  });

  it('a list that is silent about a file does not confirm it', () => {
    const r = readWriteOutcomes(files, [{ path: 'src/a.ts', ok: true }]);
    expect(r.landed.map((f) => f.path)).toEqual(['src/a.ts']);
    expect(r.failed.map((f) => f.path)).toEqual(['src/b.ts']);
  });
});

describe('writePlatformFiles — the one place a platform write_file is dispatched', () => {
  it('🔴 ok follows the dispatch\'s is_error, one outcome per file, in order; every dispatch is an unread write', async () => {
    const calls: Array<{ id: string; path: unknown; unread: boolean }> = [];
    const dispatch: DispatchWrite = async (call) => {
      calls.push({ id: call.id, path: call.input.path, unread: writesAreUnread() });
      return call.input.path === 'src/b.ts'
        ? { is_error: true, content: "Could not read the existing src/b.ts safely (transient sandbox error) — not overwriting it. Retry in a moment.\nmore" }
        : { is_error: false, content: 'Created src/a.ts (1 bytes).' };
    };
    const out = await writePlatformFiles(dispatch, [{ path: 'src/a.ts', content: 'a' }, { path: 'src/b.ts', content: 'b' }, { path: 'src/c.ts', content: 'c' }], { idPrefix: 'fast-w', concurrency: 2 });
    expect(out).toEqual([
      { path: 'src/a.ts', ok: true },
      { path: 'src/b.ts', ok: false, error: 'Could not read the existing src/b.ts safely (transient sandbox error) — not overwriting it. Retry in a moment.' },
      { path: 'src/c.ts', ok: true },
    ]);
    expect(calls.map((c) => c.id).sort()).toEqual(['fast-w0', 'fast-w1', 'fast-w2']);
    expect(calls.every((c) => c.unread)).toBe(true);
  });

  it('an answer without is_error:false is not a confirmation', async () => {
    const out = await writePlatformFiles(async () => undefined, [{ path: 'x.ts', content: '' }], { idPrefix: 'p' });
    expect(out[0].ok).toBe(false);
  });
});

describe('the lane write fence passes the answer through', () => {
  it('🔴 the outcome of the real writer reaches the lane, and a writer that answers nothing still works', async () => {
    const answering = createLaneWriteFence(async (files) => files.map((f) => ({ path: f.path, ok: f.path !== 'b' })));
    expect(await answering.open('simple-build')([{ path: 'a', content: '' }, { path: 'b', content: '' }]))
      .toEqual([{ path: 'a', ok: true }, { path: 'b', ok: false }]);
    const silent = createLaneWriteFence(async () => {});
    expect(await silent.open('one-shot')([{ path: 'a', content: '' }])).toBeUndefined();
  });
});

describe('the one-shot lane counts what landed', () => {
  const output = '<<<FILE src/App.tsx>>>\nexport default function App() { return null; }\n<<<ENDFILE>>>\n<<<FILE src/Card.tsx>>>\nexport const Card = 1;\n<<<ENDFILE>>>';
  const base = { prompt: 'a counter', framework: 'vite-react', scaffoldPaths: [], generate: async () => output };

  it('🔴 a lane whose every file was refused did not build the app — and does not say it could not GENERATE it', async () => {
    const r = await runOneShot({ ...base, writeFiles: async (files) => files.map((f) => ({ path: f.path, ok: false })) });
    expect(r.ok).toBe(false);
    expect(r.filesWritten).toBe(0);
    expect(r.summary).toBe('One-shot generated the app, but the workspace refused its files — switching to the full builder.');
  });

  it('🔴 a partly refused write counts only the files that landed', async () => {
    const r = await runOneShot({ ...base, writeFiles: async (files) => files.map((f) => ({ path: f.path, ok: f.path !== 'src/Card.tsx' })) });
    expect(r.ok).toBe(true);
    expect(r.filesWritten).toBe(1);
    expect(r.summary).toContain('1 file(s)');
  });

  it('a writer that answers nothing counts every file, as before', async () => {
    const r = await runOneShot({ ...base, writeFiles: async () => {} });
    expect(r.ok).toBe(true);
    expect(r.filesWritten).toBe(2);
  });
});

describe('Q-912 (E): the CONTINUE note says why the lane stopped', () => {
  // The report's own ending: the route's stopLane wording, thrown at the tier boundary.
  const REPORT_REASON = "simple-build fast lane stopped early — the lane's engine fell to kimi-k2.7-code, which reasons before every answer; the lane's per-file budget cannot carry that, so the files finished so far go to the full builder now";

  it('🔴 the report\'s hand-off is not "running out of time"', () => {
    const why = salvageWhyClause(REPORT_REASON, true);
    expect(why).not.toMatch(/before running out of time/);
    expect(why).toBe('and then handed the rest of the app to you on purpose (its next engine reasons before every answer, which that lane cannot carry), not because it ran out of time');
  });

  it('every ending gets its own words; time is named only about time', () => {
    expect(salvageWhyClause('verify_failed', false)).toBe('and they do not compile yet');
    expect(salvageWhyClause('simple-build timed out after 240000ms', false)).toBe('before running out of time');
    expect(salvageWhyClause('simple-build 2 stage(s) left would need about 468s but only 90s remain', false)).toContain('stages left could not finish inside its time budget');
    expect(salvageWhyClause("simple-build fast lane stopped early — the app's root component (src/App.tsx) was not written, so the files built so far are not connected to the page yet", false))
      .toBe("but not the app's root component, so they are not connected to the page yet");
    expect(salvageWhyClause('simple-build fast lane stopped early — something new', false)).toBe('before it stopped');
  });

  it('🔒 the route builds the note from the helper, never from one fixed reason', () => {
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toContain('const salvageWhy = salvageWhyClause(sb.reason, sb.handedOff);');
    expect(route).not.toContain(": 'before running out of time';");
  });
});

describe('🔒 the route counts and names only what landed', () => {
  const route = read('src/server/routes/agentv3.ts');

  it('no platform write dispatches write_file itself; the fast lane\'s writer returns the outcomes', () => {
    expect(route.split('\n').filter((l) => /name: 'write_file'/.test(l))).toEqual([]);
    expect(route).toContain("return writePlatform(files, 'fast-w', 6);");
    expect(route).toMatch(/const fastWriteRaw = async \(files: \{ path: string; content: string \}\[\]\): Promise<WriteOutcome\[\]> =>/);
  });

  it('every pass that ANNOUNCES or RECORDS a write reads the outcome first', () => {
    // A pass whose verdict re-measures the workspace may ignore the answer; one that says "generated N" may not.
    for (const prefix of ['fast-foundation-', 'fast-tsconfig-', 'scaffold-restore-', 'cssmod-w', 'barrel-w']) {
      expect(route, prefix).toMatch(new RegExp(`readWriteOutcomes\\([^;]*await writePlatform\\([^;]*'${prefix}'`));
    }
    for (const site of ['await fastWrite(toWrite)', 'await fastWrite([{ path: patch.path', 'await fastWrite(snaps.map(']) {
      const at = route.indexOf(site);
      expect(at, site).toBeGreaterThan(0);
      expect(route.slice(at - 60, at), site).toContain('readWriteOutcomes(');
    }
  });

  it('a refused platform write leaves evidence, filed as our own process', () => {
    expect(route).toContain("code: 'PLATFORM_WRITE_REFUSED'");
    expect(PROCESS_ONLY_CODES.has('PLATFORM_WRITE_REFUSED')).toBe(true);
  });
});
