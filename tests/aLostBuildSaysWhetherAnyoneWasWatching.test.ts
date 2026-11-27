/**
 * A LOST BUILD SAYS WHETHER ANYONE WAS STILL CONNECTED (failedbr #2557–#2561, Q-3323 / Q-3354, 2026-11-27).
 * Five builds in a row ended "the server running it was lost", two of them within 23 s (one instance), and none carried a
 * memory band. The remaining suspect is CPU throttling on a server with no open request, so the build's tick now records
 * when the last browser stream left and when one came back (buildWatchPulse.ts).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { noteBuildWatchers, BUILD_UNWATCHED_CODE, BUILD_WATCHED_AGAIN_CODE } from '../src/server/AgentV3/buildPhases/buildWatchPulse';

describe('the watch pulse', () => {
  it('records once when the last viewer leaves and once when one returns, never a line per tick', () => {
    const rec: any[] = []; const st = { unwatchedSince: null as number | null };
    let n = 1;
    const ports = { watching: () => n, inFlight: () => 0, record: (i: any) => rec.push(i) };
    expect(noteBuildWatchers(st, ports, 60_000, 1_000)).toBe('');                 // watched: nothing to say
    n = 0;
    expect(noteBuildWatchers(st, ports, 120_000, 2_000)).toBe(BUILD_UNWATCHED_CODE);
    expect(noteBuildWatchers(st, ports, 180_000, 3_000)).toBe('');                // still nobody: silent
    n = 2;
    expect(noteBuildWatchers(st, ports, 240_000, 47_000)).toBe(BUILD_WATCHED_AGAIN_CODE);
    expect(rec.map((r) => r.code)).toEqual([BUILD_UNWATCHED_CODE, BUILD_WATCHED_AGAIN_CODE]);
    expect(rec[0].message).toMatch(/^120 s in: no browser stream is attached to this build any more \(0 request\(s\) open on this server\); it keeps running/);
    expect(rec[1].message).toBe('240 s in: a browser is connected to this build again, after 45 s with none.');
  });
  it('a broken reading never throws and records nothing', () => {
    const rec: any[] = [];
    expect(noteBuildWatchers({ unwatchedSince: null }, { watching: () => { throw new Error('x'); }, record: (i) => rec.push(i) }, 0)).toBe('');
    expect(noteBuildWatchers({ unwatchedSince: null }, { watching: () => Number.NaN, record: (i) => rec.push(i) }, 0)).toBe('');
    expect(noteBuildWatchers({ unwatchedSince: null }, { watching: () => 0, inFlight: () => { throw new Error('y'); }, record: () => { throw new Error('z'); } }, 0)).toBe('');
    expect(rec).toEqual([]);
  });
  it('🔒 the build\'s tick calls it, beside the memory pulse, with the build\'s own stream count', () => {
    const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toMatch(/Q-3354[^\n]*\n\s*noteBuildWatchers\(watchPulse, \{ watching: \(\) => rb\.subscribers\.size, record: \(issue\) => buildDiagRef\?\.record\(issue\) \}, Date\.now\(\) - memoryPulse\.since\);/);
  });
});
