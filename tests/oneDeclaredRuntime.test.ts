// ONE DECLARED RUNTIME, AND EVERY PLACE THAT NAMES ONE AGREES WITH IT (Q-1060).
//
// 🔴 THE DEFECT: A GATE THAT EXERCISED A DIFFERENT RUNTIME FROM THE ONE IT GUARDS. `ci.yml` ran the whole
// 38,000-test suite on **Node 20** while the Dockerfile (`node:22`, `node:22-slim`), the `.aab` and `.ipa`
// workflows and `@capacitor/cli` 8 (`engines: >=22`) all run **Node 22**. So the suite tested a runtime
// nobody ships, and any test needing the Capacitor CLI could not run there at all — *"The Capacitor CLI
// requires NodeJS >=22.0.0"*. Found by the iOS template test's first CI run (2026-10-14, #3740).
//
// 🧬 THE CLASS, which is why this test exists rather than two edited literals: **nothing declared the
// project's runtime at all.** `package.json` had no `engines` field, so six workflows and a Dockerfile each
// carried their own number and two of them drifted — and a seventh could drift tomorrow with nothing to
// catch it. The requirement is now declared ONCE, in `engines.node`, and every declaration is checked
// against it here.
//
// ⚠️ AND THE ROW NAMED ONLY `ci.yml`. `dast.yml` was on 20 as well — the sibling a per-instance fix would
// have left behind, which is the whole reason rule 3 says to hunt them.
//
// 🔒 THE EVIDENCE FOR FLIPPING, because the row asked for it before the change: this repo's own container
// runs Node 22.22.0, and the full suite was run on it repeatedly on 2026-10-16 — 2705 files, 38,974 passed,
// 0 failed. The runtime was not taken on trust.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { engines?: { node?: string } };
const WORKFLOW_DIR = join(root, '.github/workflows');
const workflows = readdirSync(WORKFLOW_DIR).filter((f) => /\.ya?ml$/.test(f));

/** The major version a `>=22`-style range requires. */
const requiredMajor = (): number => {
  const m = /(\d+)/.exec(String(pkg.engines?.node ?? ''));
  return m ? Number(m[1]) : Number.NaN;
};

describe('🔒 the project declares its runtime in exactly one place', () => {
  it('package.json has engines.node', () => {
    expect(pkg.engines, 'nothing declared the runtime — that is how six literals drifted').toBeDefined();
    expect(pkg.engines!.node, 'engines.node is the single source of truth').toMatch(/^>=\d+$/);
  });

  it('and it is the version production actually runs', () => {
    const docker = readFileSync(join(root, 'Dockerfile'), 'utf8');
    const froms = [...docker.matchAll(/^FROM node:(\d+)/gm)].map((m) => Number(m[1]));
    expect(froms.length, 'the Dockerfile must name its runtime').toBeGreaterThan(0);
    for (const major of froms) expect(major, 'the image and the declaration must agree').toBe(requiredMajor());
  });
});

describe('🧭 CLASS GUARD: no workflow may name a different runtime', () => {
  const declared = workflows.flatMap((file) => {
    const src = readFileSync(join(WORKFLOW_DIR, file), 'utf8');
    // Only the value of a real `node-version:` key — a mention inside a comment is not a declaration.
    return [...src.matchAll(/^\s*node-version:\s*'?"?(\d+)/gm)].map((m) => ({ file, major: Number(m[1]) }));
  });

  it('every workflow that sets one is found — the census is not empty', () => {
    expect(declared.length, 'if this is 0 the key was renamed and this guard went blind').toBeGreaterThanOrEqual(6);
  });

  it.each(declared.map((d) => [d.file, d.major] as const))('%s runs Node %i', (file, major) => {
    expect(major, `${file} disagrees with engines.node — one declaration, or none of them can be trusted`)
      .toBe(requiredMajor());
  });

  it('🔴 THE TWO THAT HAD DRIFTED are on the declared version', () => {
    for (const file of ['ci.yml', 'dast.yml']) {
      const src = readFileSync(join(WORKFLOW_DIR, file), 'utf8');
      expect([...src.matchAll(/^\s*node-version:\s*'?"?(\d+)/gm)].map((m) => Number(m[1])), file)
        .toEqual([requiredMajor()]);
    }
  });

  it('…and the gate in particular, since a gate on another runtime proves nothing about what ships', () => {
    const ci = readFileSync(join(WORKFLOW_DIR, 'ci.yml'), 'utf8');
    expect(ci).toMatch(/node-version:\s*'22'/);
    expect(ci, 'the reason is written where the version is, so nobody lowers it back').toContain('Q-1060');
  });
});

describe('🔒 PRECISION: the tool that could not run here at all', () => {
  it('@capacitor/cli requires the version CI now has', () => {
    // The concrete symptom from #3740: the CLI refuses to start below 22, so a template test could not run
    // in CI even though the code was right. Read from the installed package, not from memory.
    let engines: string | undefined;
    try {
      engines = (JSON.parse(readFileSync(join(root, 'node_modules/@capacitor/cli/package.json'), 'utf8')) as
        { engines?: { node?: string } }).engines?.node;
    } catch { engines = undefined; }
    if (!engines) return; // not installed in this checkout — nothing to claim
    const needs = Number(/(\d+)/.exec(engines)?.[1] ?? Number.NaN);
    expect(requiredMajor(), `@capacitor/cli needs node ${engines}`).toBeGreaterThanOrEqual(needs);
  });
});
