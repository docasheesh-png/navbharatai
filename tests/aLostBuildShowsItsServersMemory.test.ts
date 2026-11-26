/**
 * A BUILD THAT MAY BE LOST CARRIES ITS SERVER'S MEMORY (failedbr #2521–#2530, Q-3354, 2026-11-25).
 * Seven "server lost" builds in one evening; no report said how much memory the instance used. The build's tick now records
 * it once per band crossed (serverMemoryPulse.ts) — so the next loss shows how close the server was to its limit.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { noteServerMemory, SERVER_MEMORY_CODE } from '../src/server/AgentV3/buildPhases/serverMemoryPulse';

const MiB = 1024 * 1024;
const at = (rssMb: number, limitMb: number | null) => () => ({ memoryRssBytes: rssMb * MiB, memoryLimitBytes: limitMb ? limitMb * MiB : null, memoryPercent: limitMb ? Math.round((rssMb / limitMb) * 1000) / 10 : null, inFlightRequests: 3 });

describe('the memory pulse', () => {
  it('records once per higher band, never a line per tick, and warns near the limit', () => {
    const rec: any[] = []; const st = { band: 0 };
    const ports = (s: ReturnType<typeof at>) => ({ record: (i: any) => rec.push(i), snapshot: s });
    expect(noteServerMemory(st, ports(at(1000, 4096)), 60_000)).toBe(0);            // 24 %: nothing to say
    expect(noteServerMemory(st, ports(at(2600, 4096)), 120_000)).toBe(60);
    expect(noteServerMemory(st, ports(at(2650, 4096)), 180_000)).toBe(0);           // same band: silent
    expect(noteServerMemory(st, ports(at(3800, 4096)), 240_000)).toBe(90);
    expect(rec.map((r) => [r.code, r.severity])).toEqual([[SERVER_MEMORY_CODE, 'info'], [SERVER_MEMORY_CODE, 'warning']]);
    expect(rec[1].message).toMatch(/^240 s in: the server running this build is using 3800 MiB of its 4096 MiB limit \(92\.8%\), with 3 request/);
  });
  it('an unknown limit falls back to absolute sizes; a broken reading never throws', () => {
    const rec: any[] = [];
    expect(noteServerMemory({ band: 0 }, { record: (i) => rec.push(i), snapshot: at(2100, null) }, 1000)).toBe(2048);
    expect(rec[0].message).toMatch(/its limit is unknown/);
    expect(noteServerMemory({ band: 0 }, { record: () => { throw new Error('x'); }, snapshot: () => { throw new Error('y'); } }, 0)).toBe(0);
  });
  it('🔒 the build\'s tick calls it', () => {
    const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toMatch(/noteServerMemory\(memoryPulse, \{ record: \(issue\) => buildDiagRef\?\.record\(issue\) \}, Date\.now\(\) - memoryPulse\.since\);\s*\/\/ Q-3354[^\n]*\n\s*etaTick \+= 1;/);
  });
});
