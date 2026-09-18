// Autopsy c6e4c6ff (2026-09-17, "E commerce website", free Weak engine) — a rendering app was
// failed and made FREE over `src/routes/orders.ts`, a file the build had deleted 224 seconds
// earlier. `analyzeArchitecture` judges the project GRAPH, and `seedGraphFromWorkspace` only ever
// ADDED to it, so the graph described the union of everything the build had ever touched.
//
// PR #3014 closed ONE road into that graph (a recognised single-file `rm`). These tests hold the
// class shut for the rest of them, and the last block is the reversion guard.
import { describe, it, expect } from 'vitest';
import {
  prunableGraphPaths,
  pruneWasRefused,
  pruneRefusedMessage,
  MAX_PRUNE_PROBES,
} from '../src/server/AgentV3/graphReconcile';

const EXCLUDE = /(^|\/)(node_modules|\.git|dist|build|\.next|__pycache__|coverage)\//;
const INDEXABLE = /\.(tsx?|jsx?|mjs|cjs|vue|svelte|astro|html?|css|scss|json)$/i;
/** The seeder's own filter, copied so a change there is visible as a failure here. */
const indexable = (p: string): boolean => !EXCLUDE.test(p) && INDEXABLE.test(p);

describe('the exact build that failed', () => {
  // The real shape: the agent wrote orders.ts, then `rm`'d it; the graph kept it, and its two
  // imports became the blockers that turned a working ShopWave RED.
  const graph = [
    'src/App.tsx', 'src/server/routes.ts', 'src/server/db.ts',
    'src/routes/orders.ts', 'package.json', 'index.html',
  ];
  const disk = [
    'src/App.tsx', 'src/server/routes.ts', 'src/server/db.ts',
    'package.json', 'index.html',
  ];

  it('proposes the deleted file, and only it', () => {
    expect(prunableGraphPaths(graph, disk, indexable)).toEqual(['src/routes/orders.ts']);
  });

  it('proposes nothing once the graph already agrees with the disk', () => {
    expect(prunableGraphPaths(disk, disk, indexable)).toEqual([]);
  });
});

describe('the roads PR #3014 does not cover — the class, not the instance', () => {
  const live = ['src/App.tsx', 'package.json'];

  it('a directory delete (rm -rf src/routes)', () => {
    const graph = [...live, 'src/routes/orders.ts', 'src/routes/cart.ts'];
    expect(prunableGraphPaths(graph, live, indexable)).toEqual(['src/routes/orders.ts', 'src/routes/cart.ts']);
  });

  it('a RENAME leaves the OLD path, and the old path is what must go', () => {
    const graph = [...live, 'src/routes/orders.ts'];
    const disk = [...live, 'src/server/orders.ts'];
    expect(prunableGraphPaths(graph, disk, indexable)).toEqual(['src/routes/orders.ts']);
  });

  it('a delete inside a script, git clean, git checkout — the mechanism is never consulted', () => {
    const graph = [...live, 'src/generated/api.ts'];
    expect(prunableGraphPaths(graph, live, indexable)).toEqual(['src/generated/api.ts']);
  });

  it('`cd src && rm routes/orders.ts` — the path #3014 extracts relative to the cd still reconciles', () => {
    // #3014 yields 'routes/orders.ts', which matches no graph key. The disk answers it directly.
    const graph = [...live, 'src/routes/orders.ts'];
    expect(prunableGraphPaths(graph, live, indexable)).toEqual(['src/routes/orders.ts']);
  });
});

describe('guard 1 — a listing that failed is not an empty workspace', () => {
  const graph = ['src/App.tsx', 'src/routes/orders.ts', 'package.json'];

  it('null (the listing THREW) prunes nothing', () => {
    expect(prunableGraphPaths(graph, null, indexable)).toEqual([]);
  });

  it('an EMPTY listing prunes nothing — it would otherwise wipe the whole graph', () => {
    expect(prunableGraphPaths(graph, [], indexable)).toEqual([]);
  });

  it('a listing of nothing but blanks is treated as empty', () => {
    expect(prunableGraphPaths(graph, ['', '  ', ''], indexable)).toEqual([]);
  });

  it('neither counts as a refusal — there is nothing to report', () => {
    expect(pruneWasRefused(graph, null, indexable)).toBe(false);
    expect(pruneWasRefused(graph, [], indexable)).toBe(false);
  });
});

describe('guard 2 — only what this seeder would have indexed', () => {
  const disk = ['src/App.tsx'];

  it('a path the tree filter would never list is left alone', () => {
    // README.md and dist/ are absent from the listing BECAUSE the filter excludes them, not because
    // they were deleted. Their absence is evidence of nothing.
    const graph = ['src/App.tsx', 'README.md', 'dist/bundle.js', 'node_modules/x/index.js'];
    expect(prunableGraphPaths(graph, disk, indexable)).toEqual([]);
  });

  it('a filter that THROWS means unknown, and unknown means KEEP', () => {
    const graph = ['src/App.tsx', 'src/routes/orders.ts'];
    const throwing = (): boolean => { throw new Error('boom'); };
    expect(prunableGraphPaths(graph, disk, throwing)).toEqual([]);
  });

  it('a directory-shaped or dot entry is never a candidate', () => {
    const graph = ['src/App.tsx', 'src/routes/', '.', '..'];
    expect(prunableGraphPaths(graph, disk, indexable)).toEqual([]);
  });
});

describe('guard 3 — a huge disagreement is a broken listing, not a deleted app', () => {
  const disk = ['src/App.tsx'];
  const many = (n: number): string[] =>
    ['src/App.tsx', ...Array.from({ length: n }, (_, i) => `src/gone/f${i}.ts`)];

  it(`exactly ${MAX_PRUNE_PROBES} missing is still proposed`, () => {
    expect(prunableGraphPaths(many(MAX_PRUNE_PROBES), disk, indexable)).toHaveLength(MAX_PRUNE_PROBES);
    expect(pruneWasRefused(many(MAX_PRUNE_PROBES), disk, indexable)).toBe(false);
  });

  it('one past the cap refuses the WHOLE batch — never a truncated prefix', () => {
    expect(prunableGraphPaths(many(MAX_PRUNE_PROBES + 1), disk, indexable)).toEqual([]);
    expect(pruneWasRefused(many(MAX_PRUNE_PROBES + 1), disk, indexable)).toBe(true);
  });

  it('the refusal has words, because a silent no-op is indistinguishable from a broken one', () => {
    expect(pruneRefusedMessage()).toContain(String(MAX_PRUNE_PROBES));
    expect(pruneRefusedMessage()).toMatch(/left alone/i);
  });
});

describe('path shapes', () => {
  it('./ and / prefixes and backslashes match the same file', () => {
    expect(prunableGraphPaths(['./src/App.tsx'], ['src/App.tsx'], indexable)).toEqual([]);
    expect(prunableGraphPaths(['/src/App.tsx'], ['src/App.tsx'], indexable)).toEqual([]);
    expect(prunableGraphPaths(['src\\App.tsx'], ['src/App.tsx'], indexable)).toEqual([]);
    expect(prunableGraphPaths(['src//App.tsx'], ['src/App.tsx'], indexable)).toEqual([]);
  });

  it('a duplicate graph entry is proposed once', () => {
    const graph = ['src/gone.ts', './src/gone.ts', 'src/App.tsx'];
    expect(prunableGraphPaths(graph, ['src/App.tsx'], indexable)).toEqual(['src/gone.ts']);
  });

  it('a non-string entry on either side is ignored, never thrown on', () => {
    const graph = ['src/App.tsx', null, 42, undefined] as unknown as string[];
    expect(() => prunableGraphPaths(graph, ['src/App.tsx', null] as unknown as string[], indexable)).not.toThrow();
  });
});

describe('REVERSION GUARD — the seeder must ask, and must pass the unswallowed listing', () => {
  // The behavioural tests above all pass against a seeder that never calls this module. These read
  // the call site, because the whole defect was a question nobody asked.
  const fs = require('node:fs') as typeof import('node:fs');
  const src = fs.readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
  const seeder = src.slice(
    src.indexOf('private async seedGraphFromWorkspace'),
    src.indexOf('private async ensureViteScaffold'),
  );

  it('the seeder is actually wired to the reconciler', () => {
    expect(seeder).toContain('prunableGraphPaths');
    expect(seeder).toContain('reconcileDeletions');
  });

  it('the listing failure is NOT swallowed into an empty array', () => {
    // `.catch(() => [])` here is the one edit that turns this fix into a whole-graph wipe.
    expect(seeder).not.toMatch(/listFiles\([^)]*\)\s*\.catch\(\(\)\s*=>\s*\[\]/);
    expect(seeder).toMatch(/listFiles\([^)]*\)\s*\.catch\(\(\)\s*=>\s*null\)/);
  });

  it('the refusal is reported rather than silently dropped', () => {
    expect(seeder).toContain('pruneWasRefused');
    expect(seeder).toContain('pruneRefusedMessage');
  });
});
