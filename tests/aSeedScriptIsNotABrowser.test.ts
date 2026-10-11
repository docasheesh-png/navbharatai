/**
 * 🌐 A SEED SCRIPT IS NOT A BROWSER — queue row Q-146.
 *
 * 🔴 WHAT IT COST, from the report that recorded it (`PROGRESS.md`, OPEN root cause #2): *"Seed-script
 * rabbit hole — the agent tried to run a browser-oriented localStorage seed in node via `tsx`
 * (recursive mock → stack overflow → `window is not defined`), 4 failures, ~10 min."*
 *
 * Read the chain, because the shape is the point. The first `npx tsx seed.ts` failed with
 * `window is not defined` — **deterministically**: node has no such global and no flag adds one. The
 * agent then did what a model does when a command fails for a reason it cannot act on: it improvised,
 * hand-mocking `window`, and the mock recursed into a stack overflow. Four failures and ten minutes of
 * the user's build went into a command whose outcome was knowable before it ran.
 *
 * 🔑 THE CLASS ALREADY HAS FIVE FIXES IN THIS REPO — a command the engine KNOWS will fail is run anyway,
 * and the agent then improvises around the FAILURE instead of around the CAUSE. `ScaffoldGuard`,
 * `gitCloneGuard`, `PreviewGuard`, `fixNodeModulesTypo` and the empty-command refusal are all the same
 * answer: decide before the shell, and hand back the one path that works. This is the sixth, built in
 * their shape rather than as a new mechanism.
 *
 * **Both layers, because the fifth rule's step 5 says a catch is only the last line of defence:**
 *   1. the WRITE that creates such a script says so while the file is open, so the run is never tried;
 *   2. the `bash` guard refuses the run if it is tried anyway.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  BROWSER_ONLY_GLOBALS,
  browserCodeInNodeHint,
  nodeRunTarget,
  browserOnlyUses,
  withoutCommentsAndStrings,
  shouldRefuseBrowserOnlyRun,
  browserOnlyRunMessage,
  browserOnlyWriteNote,
  looksLikeAScriptToRun,
} from '../src/server/AgentV3/browserCodeInNode';

/** The report's own file: a localStorage seed with no thought given to node. */
const SEED = `import { PRODUCTS } from './data';

export function seedProducts() {
  if (!localStorage.getItem('products')) {
    localStorage.setItem('products', JSON.stringify(PRODUCTS));
  }
  window.dispatchEvent(new Event('seeded'));
}

seedProducts();
`;

describe('🌐 the list of globals is MEASURED in the running node, not assumed', () => {
  it('every name really is undefined here — so the guard can never be quietly wrong', () => {
    // If a future node defines one of these, THIS fails instead of the guard refusing a command that
    // would have worked. That is the whole reason the assertion exists.
    for (const g of BROWSER_ONLY_GLOBALS) {
      expect(typeof (globalThis as Record<string, unknown>)[g], g).toBe('undefined');
    }
  });

  // ⚠️ THE NODE THIS TEST RUNS ON IS NOT ALWAYS THE SANDBOX'S NODE. The sandbox images pin node 22
  // (asserted below); CI (`.github/workflows/ci.yml`) runs node 20, and the first version of this file
  // asserted `process.versions.node` is 22 — green on every developer machine, red on every CI run.
  // `navigator` only exists from node 21, so the two assertions that need the sandbox's node run only
  // where that node is; the undefined-list measurement above holds on 20 and 22 alike (checked on both).
  const nodeMajor = Number(process.versions.node.split('.')[0]);

  it('the two that node 22 DOES define are deliberately not on it', () => {
    // A file using only these runs fine on the sandbox's node and must never be refused.
    expect(BROWSER_ONLY_GLOBALS as readonly string[]).not.toContain('navigator');
    expect(BROWSER_ONLY_GLOBALS as readonly string[]).not.toContain('fetch');
  });

  it.runIf(nodeMajor >= 22)('…and on the sandbox\'s own major this node really defines both', () => {
    expect(typeof globalThis.navigator).not.toBe('undefined');
    expect(typeof globalThis.fetch).not.toBe('undefined');
  });

  it('matches the node the sandbox images actually pin', () => {
    // The measurement above is evidence for the sandbox because the list is undefined on every node
    // major this suite runs on (20 in CI, 22 locally and in the sandbox) — not because CI's node is 22.
    const dockerfile = fs.readFileSync(path.join(__dirname, '../infra/e2b/e2b.Dockerfile'), 'utf8');
    expect(dockerfile).toMatch(/FROM node:22\b/);
    expect(nodeMajor).toBeGreaterThanOrEqual(20);
  });
});

describe('🌐 which commands are even looked at', () => {
  it('finds the file in every runner form the agent actually uses', () => {
    expect(nodeRunTarget('npx tsx src/lib/seed.ts')).toEqual({ file: 'src/lib/seed.ts', runner: 'tsx' });
    expect(nodeRunTarget('tsx ./src/seed.ts')).toEqual({ file: 'src/seed.ts', runner: 'tsx' });
    expect(nodeRunTarget('node scripts/seed.mjs')).toEqual({ file: 'scripts/seed.mjs', runner: 'node' });
    expect(nodeRunTarget('npx ts-node src/seed.ts')).toEqual({ file: 'src/seed.ts', runner: 'ts-node' });
    expect(nodeRunTarget('cd /home/user/workspace && npx tsx src/seed.ts')?.file).toBe('src/seed.ts');
    expect(nodeRunTarget('node --loader tsx src/seed.ts')?.file).toBe('src/seed.ts');
  });

  it('needs the runner to be a real interpreter — dropping one is caught', () => {
    // ⚠️ RECORDED BECAUSE A REVERSION PROBE DISPROVED MY FIRST CLAIM. I wrote that `npm run seed` is
    // excluded *by the runner list*, then put `npm` into that list and NO test failed — because the
    // file pattern rejects `run` anyway, so the exclusion is over-determined. What the list really
    // protects is the FINDING, and that is what this asserts: removing `tsx` from it fails 3 tests.
    // `npm run seed.ts`, a script named like a file, is null through both mechanisms at once.
    expect(nodeRunTarget('npm run seed.ts')).toBeNull();
    expect(nodeRunTarget('npx tsx src/seed.ts')?.runner).toBe('tsx');
  });

  it('says nothing about the commands it cannot know about', () => {
    // Each of these would be a WRONG refusal, which is worse than the failure this guard prevents.
    for (const cmd of [
      'npm run seed',                       // the script body lives in package.json — never guessed at
      'npm run build',
      'node -e "console.log(1)"',           // no file at all
      'node --version',
      'node node_modules/.bin/vite build',  // a tool's own binary is not the user's app
      'npx vitest run',
      'cat src/seed.ts',
      'npx tsc --noEmit',
      '',
    ]) expect(nodeRunTarget(cmd), cmd).toBeNull();
  });
});

describe('🌐 which files are refused, and which are left alone', () => {
  it('refuses the report\'s own seed script', () => {
    const target = nodeRunTarget('npx tsx src/lib/seed.ts')!;
    const uses = shouldRefuseBrowserOnlyRun(target, SEED);
    expect(uses.map((u) => u.global).sort()).toEqual(['localStorage', 'window']);
    const msg = browserOnlyRunMessage(target, uses);
    expect(msg).toMatch(/REFUSED \(browser-only guard\)/);
    expect(msg).toMatch(/localStorage is not defined|window is not defined/);
    // The two things the failing command could not say: do not mock, and here is the path that works.
    expect(msg).toMatch(/Do NOT hand-mock/);
    expect(msg).toMatch(/seedIfEmpty\(\)/);
    expect(msg).toMatch(/src\/main\.tsx/);
  });

  it('says the TRUE sentence for each of the two real outcomes', () => {
    // The report's seed calls `seedProducts()` at module scope, so loading it really does throw.
    const target = nodeRunTarget('npx tsx src/lib/seed.ts')!;
    const top = browserOnlyUses(SEED, 'src/lib/seed.ts');
    expect(top.some((u) => u.topLevel)).toBe(true);
    expect(browserOnlyRunMessage(target, top)).toMatch(/would fail with "/);

    // A file that only EXPORTS browser work does not throw on load — it defines and exits 0. Claiming
    // "would fail with … is not defined" about it would be a wrong verdict, so it says the other thing.
    const exportOnly = "export function seedIfEmpty() {\n  localStorage.setItem('k', '1');\n}\n";
    const uses = browserOnlyUses(exportOnly, 'src/lib/seed.ts');
    expect(uses).toHaveLength(1);
    expect(uses[0].topLevel).toBe(false);
    const msg = browserOnlyRunMessage(target, uses);
    expect(msg).not.toMatch(/would fail with/);
    expect(msg).toMatch(/cannot do anything useful/);
  });

  it('stands down when the author already handled node', () => {
    // Any of these means the file was written with node in mind; the guard does not argue.
    for (const src of [
      "if (typeof window !== 'undefined') { window.x = 1; }",
      "globalThis.window = {} as any;\nwindow.localStorage.getItem('a');",
      "global['document'] = {};\ndocument.querySelector('a');",
      "const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem('k');",
    ]) expect(browserOnlyUses(src, 'src/seed.ts'), src).toEqual([]);
  });

  it('never reads a word out of prose or a string', () => {
    for (const src of [
      "// seeds window.localStorage when the app boots\nexport const A = 1;",
      "/* document.querySelector is browser-only */\nexport const B = 2;",
      "export const msg = 'window.localStorage is not available';",
      'export const q = `document.title`;',
    ]) expect(browserOnlyUses(src, 'src/seed.ts'), src).toEqual([]);
  });

  it('never reads a local of the same name, or someone else\'s property', () => {
    for (const src of [
      "const window = { width: 10 };\nconsole.log(window.width);",
      "function document(a: string) { return a; }\ndocument('x');",
      "export const f = (ctx: { window: { w: number } }) => ctx.window.w;",
      "import { location } from './router';\nexport const p = location.pathname;",
    ]) expect(browserOnlyUses(src, 'src/seed.ts'), src).toEqual([]);
  });

  it('a test file is never judged', () => {
    expect(browserOnlyUses(SEED, 'src/lib/seed.test.ts')).toEqual([]);
    expect(browserOnlyUses(SEED, 'tests/seed.ts')).toEqual([]);
  });

  it('the kill switch turns the whole thing off', () => {
    const target = nodeRunTarget('npx tsx src/lib/seed.ts')!;
    expect(shouldRefuseBrowserOnlyRun(target, SEED, { AGENTV3_BROWSER_ONLY_GUARD: 'off' } as NodeJS.ProcessEnv)).toEqual([]);
    expect(browserOnlyWriteNote('src/lib/seed.ts', SEED, { AGENTV3_BROWSER_ONLY_GUARD: 'off' } as NodeJS.ProcessEnv)).toBe('');
  });

  it('never throws on rubbish', () => {
    expect(shouldRefuseBrowserOnlyRun(null, SEED)).toEqual([]);
    expect(shouldRefuseBrowserOnlyRun(nodeRunTarget('npx tsx a.ts'), null)).toEqual([]);
    expect(browserOnlyUses('', '')).toEqual([]);
    expect(withoutCommentsAndStrings('')).toBe('');
    expect(() => withoutCommentsAndStrings("const a = 'unterminated")).not.toThrow();
  });
});

describe('🌐 the write note — the first layer, and it is narrow on purpose', () => {
  it('fires on a file whose own name says it is a script to run', () => {
    const note = browserOnlyWriteNote('src/lib/seed.ts', SEED);
    expect(note).toMatch(/CANNOT be run with `node` or `npx tsx`/);
    expect(note).toMatch(/seedIfEmpty\(\)/);
    expect(note).toMatch(/recurses into a stack overflow/);
    expect(browserOnlyWriteNote('scripts/migrate.ts', SEED)).toMatch(/CANNOT be run/);
    expect(browserOnlyWriteNote('src/data/populate.ts', SEED)).toMatch(/CANNOT be run/);
  });

  it('says NOTHING about an ordinary app file that uses browser storage — it SHOULD', () => {
    // A note on every component touching localStorage would be the nag READ_LOOP exists to replace.
    for (const p of ['src/components/Cart.tsx', 'src/hooks/useTheme.ts', 'src/App.tsx', 'src/lib/storage.ts']) {
      expect(looksLikeAScriptToRun(p), p).toBe(false);
      expect(browserOnlyWriteNote(p, SEED), p).toBe('');
    }
  });

  it('says nothing about a script that is already node-safe', () => {
    expect(browserOnlyWriteNote('scripts/seed.ts', "import fs from 'fs';\nfs.writeFileSync('a.json', '[]');")).toBe('');
  });
});

describe('🔒 both layers are wired, in the shape the other five guards use', () => {
  const DISPATCH = fs.readFileSync(path.join(__dirname, '../src/server/AgentV3/ToolDispatcher.ts'), 'utf8');

  it('the bash case decides BEFORE the shell and returns instead of running', () => {
    const at = DISPATCH.indexOf('const runTarget = nodeRunTarget(command);');
    expect(at).toBeGreaterThan(-1);
    const block = DISPATCH.slice(at, at + 1200);
    expect(block).toMatch(/shouldRefuseBrowserOnlyRun\(runTarget, runSource\)/);
    // TD-10: a refusal is an error (refuse throws), not a returned string the model can read as done.
    // It still happens before the shell runs.
    expect(block).toMatch(/refuse\(bmsg\)/);
    // Audited like every other guard, so a refusal is never invisible.
    expect(block).toMatch(/recordAudit\(/);
    // The read happens only inside the `if (runTarget)`, so an ordinary command pays nothing.
    expect(DISPATCH.indexOf('readFile(this.workspaceId, runTarget.file)')).toBeGreaterThan(at);
  });

  it('the write note is a term of the ONE shared return every write door uses', () => {
    expect(DISPATCH).toMatch(/\+ browserScript;/);
    expect(DISPATCH).toMatch(/browserScript \+= browserOnlyWriteNote\(p, files\[p\]\)/);
  });

  it('all three layers read ONE list of globals — the drift that cost safeRelPath four copies', () => {
    // The post-failure hint (#3534) kept its own alternation until these were merged. One list now, so
    // the hint and the two preventive layers can never disagree about what a browser global is.
    const MOD = fs.readFileSync(path.join(__dirname, '../src/server/AgentV3/browserCodeInNode.ts'), 'utf8');
    expect(MOD).toMatch(/BROWSER_GLOBAL = new RegExp\(/);
    expect(MOD).toMatch(/BROWSER_ONLY_GLOBALS\.join\('\|'\)/);
    // Every global on the list really is recognised by the hint…
    for (const g of BROWSER_ONLY_GLOBALS) {
      expect(browserCodeInNodeHint('node a.js', `ReferenceError: ${g} is not defined`), g).toMatch(new RegExp(`\`${g}\``));
    }
    // …and `navigator`, which node 22 DEFINES, is not — that alternative was dead code here.
    expect(browserCodeInNodeHint('node a.js', 'ReferenceError: navigator is not defined')).toBeNull();
  });
});
