// AUTOPSY 303e8a6f (2026-10-12), item O — "Peak memory: not available on this machine (no cgroup accounting
// exposed)", on this build and on every E2B build since the probe shipped (2026-09-11); six autopsies read the
// sentence as fact and the template-RAM decision has waited on it ever since. The probe read
// `/sys/fs/cgroup/memory.peak` — a file the kernel never creates in the ROOT cgroup (`CFTYPE_NOT_ON_ROOT`). An E2B
// sandbox is a VM: envd runs every build command in `/sys/fs/cgroup/user`, whose `memory.peak` holds the real
// high-water mark. The probe looked one directory too high, and the report blamed the machine.
//
// The CLASS: a non-root-only cgroup-v2 file read at the mount root instead of in the process's own cgroup — right
// in a namespaced container, silently empty on a VM — and "could not read" reported as "the machine has no
// accounting". The probe is executed here against real fixture trees for each layout, not pinned as a string.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { peakMemoryProbe, PEAK_MEMORY_PROBE, parsePeakMemory, describePeakMemory } from '../src/server/AgentV3/sandboxSessions';
import { ownCgroupV2Dir, cgroupV2FileCandidates } from '../src/server/lib/cgroupSelf';
import { readMemoryLimitBytes } from '../src/server/lib/serverLoad';

let base = '';
const layout = (name: string, files: Record<string, string>): { root: string; self: string } => {
  const dir = join(base, name);
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(dir, p, '..'), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  mkdirSync(join(dir, 'cg'), { recursive: true });
  return { root: join(dir, 'cg'), self: join(dir, 'self-cgroup') };
};
const run = (l: { root: string; self: string }) => execFileSync('sh', ['-c', peakMemoryProbe(l.root, l.self)], { encoding: 'utf8' }).trim();

let VM: { root: string; self: string };
let CONTAINER: { root: string; self: string };
let V1: { root: string; self: string };
let EMPTY: { root: string; self: string };

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'cgroup-own-'));
  // The E2B layout (build 303e8a6f): no memory.peak at the root — the kernel guarantees it — and the build's
  // commands in /user.
  VM = layout('vm', {
    'self-cgroup': '0::/user\n',
    'cg/cgroup.controllers': 'cpu memory pids\n',
    'cg/user/memory.peak': '1610612736\n',
    'cg/user/memory.events': 'low 0\nhigh 12\nmax 0\noom 0\noom_kill 0\n',
    'cg/user/memory.max': '4160749568\n',
  });
  // A container with a private cgroup namespace: its own cgroup IS the mount root.
  CONTAINER = layout('ctr', { 'self-cgroup': '0::/\n', 'cg/memory.peak': '734003200\n', 'cg/memory.events': 'oom_kill 2\n' });
  V1 = layout('v1', { 'self-cgroup': '4:memory:/\n', 'cg/memory/memory.max_usage_in_bytes': '524288000\n' });
  EMPTY = layout('empty', { 'self-cgroup': '0::/user\n' });
});
afterAll(() => { if (base) rmSync(base, { recursive: true, force: true }); });

describe('1 · the probe reads the build\'s own cgroup, on every layout', () => {
  it('the report\'s VM: 1.50 GB in /user, 0 out-of-memory kills — not "unavailable"', () => {
    expect(run(VM)).toBe('v2 1610612736 oom_kill=0 cgroup=/user');
    const peak = parsePeakMemory(run(VM));
    expect(describePeakMemory(peak, 4)).toBe('Peak memory: 1.50 GB of 4 GB (38%, cgroup-v2 /user — an upper bound: it includes reclaimable file cache; 0 out-of-memory kills)');
  });

  it('a namespaced container reads exactly what it read before', () => {
    expect(run(CONTAINER)).toBe('v2 734003200 oom_kill=2 cgroup=/');
    expect(parsePeakMemory(run(CONTAINER))).toMatchObject({ kind: 'value', bytes: 734003200, oomKills: 2 });
  });

  it('a cgroup-v1 machine falls back to its counter', () => {
    expect(parsePeakMemory(run(V1))).toMatchObject({ kind: 'value', bytes: 524288000, source: 'cgroup-v1' });
  });

  it('nothing to read is said as exactly that, naming the cgroup looked in', () => {
    expect(run(EMPTY)).toBe('unavailable cgroup=/user');
    expect(describePeakMemory(parsePeakMemory(run(EMPTY)), 4)).toContain("the build's cgroup (/user) keeps no memory.peak");
  });

  it('production runs the tested builder', () => {
    expect(PEAK_MEMORY_PROBE).toBe(peakMemoryProbe());
  });

  it('a probe that never answered is "not measured", never a claim about the machine', () => {
    expect(describePeakMemory(parsePeakMemory(undefined), 4)).toMatch(/not measured/);
    expect(describePeakMemory(parsePeakMemory(undefined), 4)).not.toMatch(/accounting exposed/);
  });
});

describe('2 · one place resolves a process\'s own cgroup', () => {
  it('own directory from /proc/self/cgroup', () => {
    expect(ownCgroupV2Dir('0::/user\n')).toBe('/sys/fs/cgroup/user');
    expect(ownCgroupV2Dir('0::/\n')).toBe('/sys/fs/cgroup');
    expect(ownCgroupV2Dir('0::/system.slice/envd.service')).toBe('/sys/fs/cgroup/system.slice/envd.service');
    expect(ownCgroupV2Dir('4:memory:/\n')).toBeNull(); // cgroup v1 has no unified line
    expect(ownCgroupV2Dir('0::/../etc')).toBeNull();
    expect(cgroupV2FileCandidates('memory.max', '0::/user')).toEqual(['/sys/fs/cgroup/user/memory.max', '/sys/fs/cgroup/memory.max']);
    expect(cgroupV2FileCandidates('memory.max', '0::/')).toEqual(['/sys/fs/cgroup/memory.max']);
  });

  it('the server\'s own memory limit is read in its own cgroup first (the sibling in serverLoad.ts)', () => {
    const files: Record<string, string> = { '/proc/self/cgroup': '0::/user\n', '/sys/fs/cgroup/user/memory.max': '4160749568\n' };
    expect(readMemoryLimitBytes((p) => { if (p in files) return files[p]!; throw new Error('ENOENT'); })).toBe(4160749568);
    // A namespaced container: identical to before.
    const ctr: Record<string, string> = { '/proc/self/cgroup': '0::/\n', '/sys/fs/cgroup/memory.max': '536870912' };
    expect(readMemoryLimitBytes((p) => { if (p in ctr) return ctr[p]!; throw new Error('ENOENT'); })).toBe(536870912);
  });
});

describe('3 · 🔒 census: no code reads a non-root-only cgroup-v2 file at the mount root', () => {
  it('outside cgroupSelf.ts, no literal /sys/fs/cgroup/memory.{peak,current,max,high,min,low,events}', () => {
    const ROOT = join(__dirname, '..');
    const walk = (d: string, out: string[] = []): string[] => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (n === 'node_modules' || n === 'dist') continue;
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.(?:ts|tsx|mjs|js)$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
      }
      return out;
    };
    const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    const hits: string[] = [];
    for (const f of [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'scripts')), join(ROOT, 'server.ts')]) {
      if (f.endsWith('src/server/lib/cgroupSelf.ts')) continue;
      if (/\/sys\/fs\/cgroup\/memory\.(?:peak|current|max|high|min|low|events)\b/.test(stripComments(readFileSync(f, 'utf8')))) hits.push(f.slice(ROOT.length + 1));
    }
    expect(hits).toEqual([]);
  });
});
