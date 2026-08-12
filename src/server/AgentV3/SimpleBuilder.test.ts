import { describe, it, expect } from 'vitest';
import { parseFileManifest, runSimpleBuild, manifestSystemPrompt, fileUserPrompt, fileSystemPrompt, repairSystemPrompt, contractBlock, contractSystemPrompt, repairUserPrompt, generationTier, dependencyContext, blueprintAdvisoryBlock, cssBraceImbalance, repairStrategyForAttempt, REPAIR_LADDER, offendingFiles, exportImportConvention } from './SimpleBuilder';
import type { OneShotFile } from './OneShotBuilder';

describe('exportImportConvention — framework-aware (ShopSphere/Nuxt autopsy: React rules were fed to Nuxt)', () => {
  const join = (fw: string) => exportImportConvention(fw).join('\n');

  it('Vue/Nuxt gets the Vue convention (SFC + auto-import), NOT React', () => {
    for (const fw of ['nuxt', 'vue', 'Nuxt 3']) {
      const t = join(fw);
      expect(t).toContain('Vue 3 / Nuxt');
      expect(t).toContain('Single-File Components');
      expect(t).toContain('AUTO-IMPORTED');
      expect(t).not.toContain('A React COMPONENT'); // the React-convention marker must be absent
      // the exact ShopSphere mistakes are explicitly forbidden
      expect(t).toContain('useSupabaseClient');
      expect(t).toContain('EXACTLY ONCE'); // duplicate-import guard
    }
  });

  it('Svelte/SvelteKit gets the Svelte convention', () => {
    const t = join('sveltekit');
    expect(t).toContain('Svelte');
    expect(t).toContain('export let');
    expect(t).toContain('$lib');
    expect(t).not.toContain('A React COMPONENT');
  });

  it('React family (react / vite-react / next / remix) keeps the React convention', () => {
    for (const fw of ['react', 'vite-react', 'nextjs', 'remix']) {
      expect(join(fw)).toContain('A React COMPONENT file');
    }
  });

  it('unknown / Angular falls back to the framework-neutral convention (no React specifics)', () => {
    const t = join('angular');
    expect(t).not.toContain('A React COMPONENT');
    expect(t).not.toContain('Vue 3');
    expect(t).toContain('IDIOMATIC');
  });

  it('fileSystemPrompt + repairSystemPrompt both carry the framework-correct convention for Nuxt', () => {
    expect(fileSystemPrompt('nuxt')).toContain('Single-File Components');
    expect(repairSystemPrompt('nuxt')).toContain('Single-File Components');
    expect(fileSystemPrompt('nuxt')).not.toContain('A React COMPONENT');
  });
});

describe('parseFileManifest', () => {
  it('parses "path :: purpose" lines, stripping bullets', () => {
    const text = [
      'Here is the plan:',
      '- src/App.tsx :: the root component wiring the todo list',
      '2. src/components/TodoItem.tsx :: a single todo row',
      'src/index.css :: global styles',
    ].join('\n');
    const m = parseFileManifest(text);
    expect(m.map((f) => f.path)).toEqual(['src/App.tsx', 'src/components/TodoItem.tsx', 'src/index.css']);
    expect(m[0].purpose).toContain('root component');
  });

  it('drops unsafe / non-file / dependency lines and de-dupes', () => {
    const text = [
      '/etc/passwd :: bad', '../secret :: bad', 'node_modules/react/index.js :: dep',
      'just some prose with no separator',
      'src/App.tsx :: first', 'src/App.tsx :: dup (ignored)',
      'README :: no extension so not a file',
    ].join('\n');
    expect(parseFileManifest(text).map((f) => f.path)).toEqual(['src/App.tsx']);
  });

  it('caps at 60 files (Fix 38a — the old silent 40 cap dropped planned pages) and returns [] for empty', () => {
    expect(parseFileManifest('')).toEqual([]);
    const many = Array.from({ length: 70 }, (_, i) => `src/f${i}.tsx :: file ${i}`).join('\n');
    expect(parseFileManifest(many)).toHaveLength(60);
  });

  it('does NOT eat a leading digit/dot that is part of a real path (only strips true list markers)', () => {
    // The old greedy `[-*\d.)\s]+` strip corrupted `2fa/verify.tsx` → `fa/verify.tsx` and dropped
    // dotfiles like `.env` (→ `env`, then failed the extension test). Real markers still strip.
    const text = [
      '2fa/verify.tsx :: two-factor page',
      '3d/Scene.tsx :: 3d scene',
      '.env.example :: sample env',
      '- src/App.tsx :: bullet still stripped',
      '1) src/main.tsx :: ordinal still stripped',
    ].join('\n');
    expect(parseFileManifest(text).map((f) => f.path)).toEqual([
      '2fa/verify.tsx',
      '3d/Scene.tsx',
      '.env.example',
      'src/App.tsx',
      'src/main.tsx',
    ]);
  });
});

describe('prompts', () => {
  it('manifest prompt asks for the "path :: purpose" format', () => {
    expect(manifestSystemPrompt('vite-react')).toContain(':: one concise sentence');
  });
  it('file prompt includes the full file list so imports line up', () => {
    const manifest = [{ path: 'src/App.tsx', purpose: 'root' }, { path: 'src/Btn.tsx', purpose: 'button' }];
    const p = fileUserPrompt('a todo app', manifest[0], manifest);
    expect(p).toContain('src/Btn.tsx');
    expect(p).toContain('write THIS file in full');
  });
  it('both the file and repair prompts carry the export/import convention (prevents default-vs-named mismatch)', () => {
    for (const p of [fileSystemPrompt('vite-react'), repairSystemPrompt('vite-react')]) {
      expect(p).toContain('EXPORT/IMPORT CONVENTION');
      expect(p).toContain('export default'); // components
      expect(p).toContain('NAMED exports'); // hooks/utils/types
      expect(p).toContain('NEVER default-import something that is exported named');
    }
  });
});

describe('runSimpleBuild — plan → per-file → assemble', () => {
  const baseDeps = (over: Partial<Parameters<typeof runSimpleBuild>[0]> = {}) => ({
    prompt: 'build a todo app', framework: 'vite-react', scaffoldPaths: ['index.html', 'src/App.tsx'],
    // First call = manifest; subsequent calls = one FILE block each (keyed off the requested path).
    generate: async (_system: string, user: string) => {
      if (user.includes('Plan the file list')) {
        return 'src/App.tsx :: root\nsrc/TodoList.tsx :: the list\nsrc/index.css :: styles';
      }
      const path = (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || 'src/App.tsx';
      return `<<<FILE ${path}>>>\n// ${path}\nexport default function X(){return null}\n<<<ENDFILE>>>`;
    },
    writeFiles: async (_f: OneShotFile[]) => {},
    ...over,
  });

  it('emits a REAL per-file progress line only on a genuine successful generation, numbered out of the real manifest size', async () => {
    const logs: string[] = [];
    const r = await runSimpleBuild(baseDeps({ log: (m) => logs.push(m) }));
    expect(r.ok).toBe(true);
    const fileTicks = logs.filter((l) => l.startsWith('✓ '));
    expect(fileTicks).toHaveLength(3); // one per genuinely-generated file, not a guess
    // Every path in the manifest gets its own tick, each counting up against the REAL total (3).
    for (const path of ['src/App.tsx', 'src/TodoList.tsx', 'src/index.css']) {
      expect(fileTicks.some((l) => l.startsWith(`✓ ${path} (`) && l.endsWith('/3)'))).toBe(true);
    }
  });

  it('bails FAST on a slow PLAN call (bounded plan timeout) instead of running to the overall cap (buildId 9a88c6e7)', async () => {
    // Root cause: a storming provider once ran the manifest call 247 s, blowing the 240 s overall budget so
    // the fast lane always timed out. With planTimeoutMs the plan bails quickly → the full builder recovers.
    const start = Date.now();
    const r = await runSimpleBuild(baseDeps({
      shareContract: false,
      planTimeoutMs: 40,
      overallTimeoutMs: 5000,
      generate: async (_s: string, user: string) => {
        if (user.includes('Plan the file list')) { await new Promise((res) => setTimeout(res, 400)); return 'src/App.tsx :: root'; }
        return '<<<FILE src/App.tsx>>>\nexport default function X(){return null}\n<<<ENDFILE>>>';
      },
    }));
    const elapsed = Date.now() - start;
    expect(r.ok).toBe(false); // the fast lane bailed → the caller hands off to the full builder
    expect(elapsed).toBeLessThan(2500); // bailed on the ~40ms plan cap, NOT the 5000ms overall cap
  });

  // WIRING TESTS for the budget allocation (admin report 858f6d7b). FastLaneBudget's own unit tests prove
  // the arithmetic; these prove runSimpleBuild actually USES it. Without them the pure functions could be
  // perfect and the lane could still starve its file-generation phase — which is precisely the bug that
  // shipped. Scaled-down timings (a 1000ms lane instead of 240s) keep the same ratios and run fast.
  it('a slow PLAN shrinks the contract phase instead of compounding with it (budget allocation)', async () => {
    // The reported build: the plan consumed nearly the whole preamble, then the contract took another 70s
    // on top because its cap was INDEPENDENT — 159s of a 240s lane gone before the first file was written.
    //
    // Scaled down: a 1000ms lane, so the preamble's share is 40% = 400ms. The plan eats 380ms of it, which
    // leaves the contract a ~20ms sliver. The contract then needs 300ms, so it is abandoned and the
    // file-generation phase keeps its reserved majority. Under the OLD independent cap (900ms) the contract
    // would have completed comfortably and its text would appear in every per-file prompt.
    //
    // The assertion is on that OBSERVABLE — whether the contract reached the per-file prompts — deliberately
    // NOT on wall-clock elapsed time or on r.ok, both of which drift when the whole suite runs in parallel.
    // A flaky test that reddens CI at random is worse than no test.
    //
    // SINGLE-TIER MANIFEST (dukaan report 2026-08-12): all three files are foundation-tier, so this lane
    // runs ONE generation stage. That is not incidental — `canFinishAfterPreamble` now bails a lane whose
    // plan call proves the remaining stages cannot fit, and a plan eating 38% of the budget across THREE
    // stages is doomed by arithmetic (0.38 × 3 > 1). Keeping this fixture multi-tier would test the new
    // bail, not the contract cap. The property under test is unchanged: a slow plan must starve the
    // contract rather than compound with it.
    const filePrompts: string[] = [];
    await runSimpleBuild(baseDeps({
      shareContract: true,
      planTimeoutMs: 900,          // the OLD independent cap — comfortably longer than the contract needs
      overallTimeoutMs: 1000,
      generate: async (_s: string, user: string) => {
        if (user.includes('Plan the file list')) {
          await new Promise((res) => setTimeout(res, 380));
          return 'src/types.ts :: shared types\nsrc/utils.ts :: helpers\nsrc/index.css :: styles';
        }
        if (user.includes('Design the shared contract')) {
          await new Promise((res) => setTimeout(res, 300));
          return 'export type CONTRACT_MARKER = 1;';
        }
        filePrompts.push(user);
        const path = (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || 'src/App.tsx';
        return `<<<FILE ${path}>>>\n// ${path}\nexport default function X(){return null}\n<<<ENDFILE>>>`;
      },
    }));
    expect(filePrompts.length).toBeGreaterThan(0);   // the assertion below must not be vacuous
    // The contract never made it in — its cap was what the budget could afford, not its own 900ms.
    for (const p of filePrompts) expect(p).not.toContain('CONTRACT_MARKER');
  });

  it('a fast plan still gets its full contract phase — the cap only bites when the budget is tight', async () => {
    let contractCalled = false;
    const r = await runSimpleBuild(baseDeps({
      shareContract: true,
      overallTimeoutMs: 5000,
      generate: async (_s: string, user: string) => {
        if (user.includes('Plan the file list')) return 'src/App.tsx :: root\nsrc/TodoList.tsx :: the list\nsrc/index.css :: styles';
        if (user.includes('Design the shared contract')) { contractCalled = true; return 'export type T = 1;'; }
        const path = (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || 'src/App.tsx';
        return `<<<FILE ${path}>>>\n// ${path}\nexport default function X(){return null}\n<<<ENDFILE>>>`;
      },
    }));
    expect(contractCalled).toBe(true);
    expect(r.ok).toBe(true);
  });

  it('a file that fails to generate gets NO tick — the counter only advances on real success', async () => {
    let calls = 0;
    const logs: string[] = [];
    const r = await runSimpleBuild(baseDeps({
      shareContract: false,
      log: (m) => logs.push(m),
      generate: async (_s, user) => {
        if (user.includes('Plan the file list')) return 'a.tsx :: a\nb.tsx :: b\nc.tsx :: c';
        calls++;
        if (calls === 1) throw new Error('network error'); // one file's call fails → no tick for it
        const path = (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || 'x.tsx';
        return `<<<FILE ${path}>>>\nok\n<<<ENDFILE>>>`;
      },
    }));
    expect(r.ok).toBe(true);
    expect(r.filesWritten).toBe(2);
    expect(logs.filter((l) => l.startsWith('✓ '))).toHaveLength(2); // NOT 3 — the failed file is honestly absent
  });

  it('plans a manifest, generates each file individually, writes them, returns ok', async () => {
    let written: OneShotFile[] = [];
    const r = await runSimpleBuild(baseDeps({ writeFiles: async (f) => { written = f; } }));
    expect(r.ok).toBe(true);
    expect(r.filesWritten).toBe(3);
    expect(written.map((f) => f.path).sort()).toEqual(['src/App.tsx', 'src/TodoList.tsx', 'src/index.css']);
  });

  // STREAMING FIRST-PAINT — the onFilesReady hook hands the healed files to the caller early so an
  // in-browser preview can render before the slow verify+install+dev-boot tax.
  it('streaming preview: calls onFilesReady once with the final files before returning', async () => {
    let handed: OneShotFile[] | null = null;
    let callCount = 0;
    const r = await runSimpleBuild(baseDeps({ onFilesReady: (f) => { callCount += 1; handed = f; } }));
    expect(r.ok).toBe(true);
    expect(callCount).toBe(1); // fired exactly once
    expect(handed).not.toBeNull();
    expect((handed as unknown as OneShotFile[]).map((f) => f.path).sort()).toEqual(['src/App.tsx', 'src/TodoList.tsx', 'src/index.css']);
  });

  it('streaming preview: a throwing onFilesReady never fails or blocks the build', async () => {
    const r = await runSimpleBuild(baseDeps({ onFilesReady: () => { throw new Error('hook boom'); } }));
    expect(r.ok).toBe(true); // the hook is best-effort — its failure is swallowed
    expect(r.filesWritten).toBe(3);
  });

  it('streaming preview: omitting onFilesReady leaves the build exactly as before', async () => {
    const r = await runSimpleBuild(baseDeps()); // no hook wired
    expect(r.ok).toBe(true);
    expect(r.filesWritten).toBe(3);
  });

  it('auto-adds a forgotten shared-symbol import before writing (jungle-game CANVAS_HEIGHT crash)', async () => {
    // Reproduce the real bug: constants.ts exports CANVAS_HEIGHT; Background.ts uses it but imports
    // only the type. Without the fix, the written file crashes the preview with a ReferenceError.
    let written: OneShotFile[] = [];
    const r = await runSimpleBuild(baseDeps({
      writeFiles: async (f) => { written = f; },
      generate: async (_s: string, user: string) => {
        if (user.includes('Plan the file list')) {
          return 'src/game/constants.ts :: shared consts\nsrc/game/Background.ts :: forest bg\nsrc/App.tsx :: root';
        }
        const path = (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || 'src/App.tsx';
        if (path === 'src/game/constants.ts') return `<<<FILE ${path}>>>\nexport const CANVAS_HEIGHT = 450;\nexport interface LayerConfig { id: number }\n<<<ENDFILE>>>`;
        if (path === 'src/game/Background.ts') return `<<<FILE ${path}>>>\nimport type { LayerConfig } from './constants';\nexport class Background { draw(c: any){ c.fillRect(0,0,10,CANVAS_HEIGHT); } }\n<<<ENDFILE>>>`;
        return `<<<FILE ${path}>>>\nexport default function App(){return null}\n<<<ENDFILE>>>`;
      },
    }));
    expect(r.ok).toBe(true);
    const bg = written.find((f) => f.path === 'src/game/Background.ts');
    expect(bg?.content).toContain('import { CANVAS_HEIGHT } from "./constants"'); // the forgotten import was added
  });

  it('deterministically generates a missing *.module.css from the component usage (fast-lane sibling-hunt)', async () => {
    let written: OneShotFile[] = [];
    const r = await runSimpleBuild(baseDeps({
      writeFiles: async (f) => { written = f; },
      generate: async (_s: string, user: string) => {
        if (user.includes('Plan the file list')) return 'src/App.tsx :: root\nsrc/Card.tsx :: a card\nsrc/index.css :: styles';
        const path = (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || 'src/App.tsx';
        if (path === 'src/Card.tsx') return `<<<FILE ${path}>>>\nimport styles from './Card.module.css';\nexport const Card = () => <div className={styles.box}/>;\n<<<ENDFILE>>>`;
        return `<<<FILE ${path}>>>\nexport default function App(){return null}\n<<<ENDFILE>>>`;
      },
    }));
    expect(r.ok).toBe(true);
    const css = written.find((f) => f.path === 'src/Card.module.css'); // never in the manifest — generated deterministically
    expect(css).toBeDefined();
    expect(css!.content).toContain('.box {');
  });

  it('deterministically generates a missing barrel index from existing leaves (fast-lane sibling-hunt)', async () => {
    let written: OneShotFile[] = [];
    const r = await runSimpleBuild(baseDeps({
      writeFiles: async (f) => { written = f; },
      generate: async (_s: string, user: string) => {
        if (user.includes('Plan the file list')) return 'src/App.tsx :: root\nsrc/icons/Star.tsx :: an icon\nsrc/index.css :: styles';
        const path = (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || 'src/App.tsx';
        if (path === 'src/App.tsx') return `<<<FILE ${path}>>>\nimport { Star } from './icons';\nexport default () => <Star/>;\n<<<ENDFILE>>>`;
        if (path === 'src/icons/Star.tsx') return `<<<FILE ${path}>>>\nexport const Star = () => null;\n<<<ENDFILE>>>`;
        return `<<<FILE ${path}>>>\nbody{}\n<<<ENDFILE>>>`;
      },
    }));
    expect(r.ok).toBe(true);
    const barrel = written.find((f) => f.path === 'src/icons/index.ts'); // the forgotten barrel, generated from the leaf
    expect(barrel).toBeDefined();
    expect(barrel!.content).toContain(`export { Star } from './Star';`);
  });

  it('falls back (ok:false) when the manifest is too small', async () => {
    const r = await runSimpleBuild(baseDeps({ generate: async () => 'src/App.tsx :: only one' }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('manifest_too_small');
  });

  it('a single file\'s failed call does not kill the build (others still ship)', async () => {
    let calls = 0;
    const r = await runSimpleBuild(baseDeps({
      shareContract: false, // isolate per-file resilience from the contract call
      generate: async (_s, user) => {
        if (user.includes('Plan the file list')) return 'a.tsx :: a\nb.tsx :: b\nc.tsx :: c';
        calls++;
        if (calls === 1) throw new Error('network error'); // first file's call fails
        const path = (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || 'x.tsx';
        return `<<<FILE ${path}>>>\nok\n<<<ENDFILE>>>`;
      },
    }));
    expect(r.ok).toBe(true); // 2 of 3 files still generated → meets minFiles
    expect(r.filesWritten).toBe(2);
  });

  it('a hung generate does NOT hang — bails to fallback within the overall timeout', async () => {
    const r = await runSimpleBuild(baseDeps({ generate: () => new Promise(() => {}), overallTimeoutMs: 30 }));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('timed out');
  });

  // === TIMEOUT HANDOFF (StudySync root cause, 2026-07-16) ==========================================
  // The real failure: the 240s timeout fired mid-generation, the full builder started on an EMPTY
  // workspace, and the ORPHANED (zombie) closure finished minutes later and dumped its files in —
  // two parallel module trees → 4 broken imports → dead app. These tests lock the fix:
  // salvage-once at timeout, zombie can never write, later generations stop burning tokens.

  it('TIMEOUT SALVAGE — completed files are written ONCE at timeout and reported as salvagedPaths', async () => {
    const writes: OneShotFile[][] = [];
    const r = await runSimpleBuild(baseDeps({
      shareContract: false,
      overallTimeoutMs: 60,
      generate: async (_s, user) => {
        if (user.includes('Plan the file list')) return 'src/lib/types.ts :: types\nsrc/lib/seed.ts :: seed\nsrc/App.tsx :: app';
        const path = (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || 'x.ts';
        // Foundation tier (src/lib/*, tier 0) completes fast; the shell (src/App.tsx, tier 2) hangs
        // past the deadline — exactly the StudySync shape (foundation done, shell never finished).
        if (path === 'src/App.tsx') return new Promise<string>(() => {});
        return `<<<FILE ${path}>>>\nexport const x = 1\n<<<ENDFILE>>>`;
      },
      writeFiles: async (f) => { writes.push(f.map((x) => ({ ...x }))); },
    }));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('timed out');
    // The finished foundation files were salvaged into the workspace for the full builder.
    expect(r.salvagedPaths?.sort()).toEqual(['src/lib/seed.ts', 'src/lib/types.ts']);
    expect(r.filesWritten).toBe(2);
    expect(writes).toHaveLength(1); // exactly the salvage write — no zombie dump later
    expect(writes[0].map((f) => f.path).sort()).toEqual(['src/lib/seed.ts', 'src/lib/types.ts']);
  });

  it('ZOMBIE KILL — the orphaned closure can NEVER write files after the timeout fired', async () => {
    const writes: OneShotFile[][] = [];
    let releaseShell: (v: string) => void = () => {};
    const r = await runSimpleBuild(baseDeps({
      shareContract: false,
      overallTimeoutMs: 60,
      generate: async (_s, user) => {
        if (user.includes('Plan the file list')) return 'src/lib/a.ts :: a\nsrc/lib/b.ts :: b\nsrc/App.tsx :: app';
        const path = (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || 'x.ts';
        if (path === 'src/App.tsx') {
          // Resolves AFTER the timeout — the zombie then reaches its final writeFiles and must be refused.
          return new Promise<string>((res) => { releaseShell = res; });
        }
        return `<<<FILE ${path}>>>\nexport const v = 1\n<<<ENDFILE>>>`;
      },
      writeFiles: async (f) => { writes.push(f.map((x) => ({ ...x }))); },
    }));
    expect(r.ok).toBe(false);
    const writesAtTimeout = writes.length; // the salvage write only
    // Now the zombie's hung call completes — in the real bug this is where the second module tree landed.
    releaseShell('<<<FILE src/App.tsx>>>\nexport default function App(){return null}\n<<<ENDFILE>>>');
    await new Promise((res) => setTimeout(res, 50)); // give the orphaned closure time to (try to) write
    expect(writes.length).toBe(writesAtTimeout); // ZERO post-timeout writes — the workspace stays the full builder's
  });

  it('TOKEN-BURN STOP — after the timeout, queued per-file generations are skipped (no more model calls)', async () => {
    const genPaths: string[] = [];
    let releaseFirst: (v: string) => void = () => {};
    const r = await runSimpleBuild(baseDeps({
      shareContract: false,
      depOrder: false, // one flat batch, concurrency 1 → the 2nd/3rd files queue behind the hung 1st
      concurrency: 1,
      overallTimeoutMs: 60,
      generate: async (_s, user) => {
        if (user.includes('Plan the file list')) return 'src/lib/a.ts :: a\nsrc/lib/b.ts :: b\nsrc/lib/c.ts :: c';
        const path = (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || 'x.ts';
        genPaths.push(path);
        return new Promise<string>((res) => { releaseFirst = res; }); // first call hangs past the deadline
      },
      writeFiles: async () => {},
    }));
    expect(r.ok).toBe(false);
    releaseFirst('<<<FILE src/lib/a.ts>>>\nexport const a = 1\n<<<ENDFILE>>>');
    await new Promise((res) => setTimeout(res, 50));
    expect(genPaths).toEqual(['src/lib/a.ts']); // b/c were queued behind it and SKIPPED once lapsed — no wasted calls
  });

  it('a NON-timeout failure (manifest too small) salvages nothing — old behavior unchanged', async () => {
    const writes: OneShotFile[][] = [];
    const r = await runSimpleBuild(baseDeps({
      generate: async () => 'src/App.tsx :: only one file',
      writeFiles: async (f) => { writes.push(f); },
    }));
    expect(r.ok).toBe(false);
    expect(r.salvagedPaths).toBeUndefined();
    expect(writes).toHaveLength(0);
  });

  it('a slow/hung preview never blocks success (files already written)', async () => {
    const r = await runSimpleBuild(baseDeps({ startPreview: () => new Promise(() => {}), previewTimeoutMs: 20 }));
    expect(r.ok).toBe(true);
  });

  // A — verify gate + auto-repair
  it('verify passes → success is EARNED (ok:true)', async () => {
    let verifies = 0;
    const r = await runSimpleBuild(baseDeps({ verify: async () => { verifies++; return { ok: true, errors: '' }; } }));
    expect(r.ok).toBe(true);
    expect(verifies).toBe(1); // verified exactly once
  });

  // Deep-test root cause (clock re-run, 2026-07-13): a verify that COULD NOT RUN (tsc missing — every
  // vite-react JS app) must return ok:true + ran:false, NOT ok:false. ok:false forced a wasteful
  // per-file→one-shot fallback on every simple JS build. ran:false must SHIP on the fast path (no
  // repair, no fallback) and NEVER claim "verified ✓".
  it('verify that could-not-run (ran:false) SHIPS on the fast path — no repair, no fallback', async () => {
    let verifies = 0;
    let repairs = 0;
    const logs: string[] = [];
    const r = await runSimpleBuild(baseDeps({
      verify: async () => { verifies++; return { ok: true, errors: '', ran: false }; },
      repair: async () => { repairs++; return []; },
      log: (m) => logs.push(m),
    }));
    expect(r.ok).toBe(true);            // ships (no fallback)
    expect(repairs).toBe(0);            // never tried to "repair" code that was fine
    expect(verifies).toBe(1);           // verified once, accepted the can't-run verdict
    expect(r.typecheckRan).toBe(false); // honest: the check did not actually run
    expect(logs.join('\n')).not.toMatch(/compiles\. ✓/); // never a fake "verified ✓"
  });

  it('verify fails then repair fixes it → re-verify passes → ok:true', async () => {
    let verifies = 0;
    let repairs = 0;
    const r = await runSimpleBuild(baseDeps({
      verify: async () => { verifies++; return verifies === 1 ? { ok: false, errors: "error TS2339: Property 'input' does not exist" } : { ok: true, errors: '' }; },
      repair: async (_errs, files) => { repairs++; return [{ path: files[0].path, content: '// fixed' }]; },
    }));
    expect(r.ok).toBe(true);
    expect(repairs).toBe(1);
    expect(verifies).toBe(2); // verify → repair → verify
  });

  it('verify keeps failing (with NEW errors each time) after maxRepairs → ok:false (hands off, NO fake success)', async () => {
    let repairs = 0;
    let v = 0;
    const r = await runSimpleBuild(baseDeps({
      // Distinct errors each attempt → the circuit-breaker does NOT fire; the loop runs the full budget.
      verify: async () => ({ ok: false, errors: `error TS2339: broken #${++v}` }),
      repair: async (_e, files) => { repairs++; return [{ path: files[0].path, content: `// attempt ${repairs}` }]; },
      maxRepairs: 2,
    }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('verify_failed');
    expect(repairs).toBe(2); // tried exactly maxRepairs times before handing off
    // Observability (deep-test App #2): the REAL compiler error is carried out so the report is minable
    // (not just "TYPECHECK_FAILED"). The last verify's error text must survive on the result.
    expect(r.verifyErrors).toMatch(/error TS2339: broken/);
  });

  it('GA-8 circuit-breaker: identical errors after a repair → stops early (no wasted attempts), still hands off', async () => {
    let repairs = 0;
    const r = await runSimpleBuild(baseDeps({
      // The SAME error every time → a repair makes zero progress → break after the first no-progress attempt.
      verify: async () => ({ ok: false, errors: 'error TS2339: stuck' }),
      repair: async (_e, files) => { repairs++; return [{ path: files[0].path, content: `// no progress ${repairs}` }]; },
      maxRepairs: 5, // budget is 5, but the breaker should stop long before exhausting it
    }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('verify_failed');
    expect(repairs).toBe(1); // one attempt proved no progress → handed off instead of burning 4 more
  });

  it('a verify infra error does NOT block success (best-effort) — but is HONEST about it', async () => {
    // The jungle-game bug (2026-07-12): a verify THROW was silently converted into ok:true and the
    // build printed "Build verified ✓" for a check that never ran. Now: still ships (sticky success),
    // but typecheckRan=false, the honest warning is logged, and "Build verified" is NEVER printed.
    const logs: string[] = [];
    const r = await runSimpleBuild(baseDeps({
      log: (m) => logs.push(m),
      verify: async () => { throw new Error('sandbox gone'); },
    }));
    expect(r.ok).toBe(true);
    expect(r.typecheckRan).toBe(false);
    expect(logs.some((l) => l.includes('Build verified'))).toBe(false); // no fake success line
    expect(logs.some((l) => l.includes('could not run'))).toBe(true);   // the honest warning instead
    expect(r.outcome).toBe('BUILD_PARTIAL'); // typecheckOk null — "unknown", never a pass
  });

  it('a verify that reports ran:false (retries exhausted) is treated the same as a throw', async () => {
    const logs: string[] = [];
    const r = await runSimpleBuild(baseDeps({
      log: (m) => logs.push(m),
      verify: async () => ({ ok: true, errors: '', ran: false }),
    }));
    expect(r.ok).toBe(true);
    expect(r.typecheckRan).toBe(false);
    expect(logs.some((l) => l.includes('Build verified'))).toBe(false);
  });

  it('a verify that genuinely RAN and passed still prints "Build verified ✓" (unchanged)', async () => {
    const logs: string[] = [];
    const r = await runSimpleBuild(baseDeps({
      log: (m) => logs.push(m),
      verify: async () => ({ ok: true, errors: '' }),
    }));
    expect(r.ok).toBe(true);
    expect(r.typecheckRan).toBe(true);
    expect(logs.some((l) => l.includes('Build verified'))).toBe(true);
  });

  it('without a verify dep, behavior is unchanged (sticky success)', async () => {
    const r = await runSimpleBuild(baseDeps());
    expect(r.ok).toBe(true);
    expect(r.typecheckRan).toBeUndefined(); // verify not wired — tri-state stays honest
  });
});

// LENS A — SHARED CONTRACTS FIRST: a single contract is designed up front and injected into every
// per-file (and repair) prompt so independently-generated files agree on names/shapes by construction.
describe('contractBlock (pure)', () => {
  it('is empty for empty/whitespace contract (no behavior change when no contract)', () => {
    expect(contractBlock(undefined)).toBe('');
    expect(contractBlock('   \n  ')).toBe('');
  });
  it('renders the FROZEN contract as a fenced block when present', () => {
    const b = contractBlock('enum MediaType { YouTube, Vimeo }');
    expect(b).toContain('SHARED CONTRACT');
    expect(b).toContain('enum MediaType { YouTube, Vimeo }');
    expect(b).toContain('```ts');
  });
  it('flows the contract into the per-file and repair prompts', () => {
    const m = [{ path: 'src/Player.tsx', purpose: 'player' }];
    const contract = 'interface PlayerProps { url: string; mediaType: MediaType }';
    expect(fileUserPrompt('app', m[0], m, contract)).toContain('PlayerProps');
    expect(repairUserPrompt('app', 'error TS2322', [{ path: 'src/Player.tsx', content: 'x' }], contract)).toContain('PlayerProps');
  });
  it('per-file prompt with NO contract is unchanged (no SHARED CONTRACT header leaks in)', () => {
    const m = [{ path: 'src/App.tsx', purpose: 'root' }];
    expect(fileUserPrompt('app', m[0], m)).not.toContain('SHARED CONTRACT');
  });
});

describe('GA-8 — ordered multi-strategy repair ladder', () => {
  it('climbs the ladder by attempt and clamps past the last rung', () => {
    expect(repairStrategyForAttempt(1)).toBe('contract-full');
    expect(repairStrategyForAttempt(2)).toBe('focus-offenders');
    expect(repairStrategyForAttempt(3)).toBe('contract-authority');
    expect(repairStrategyForAttempt(4)).toBe('contract-authority'); // clamped
    expect(repairStrategyForAttempt(0)).toBe('contract-full');      // guarded low
    expect(REPAIR_LADDER).toEqual(['contract-full', 'focus-offenders', 'contract-authority']);
  });

  it('attempt-1 (contract-full) prompt is byte-identical to the default — no regression', () => {
    expect(repairSystemPrompt('vite-react', 'contract-full')).toBe(repairSystemPrompt('vite-react'));
    expect(repairUserPrompt('app', 'e', [{ path: 'a.ts', content: 'x' }], 'c', 'contract-full'))
      .toBe(repairUserPrompt('app', 'e', [{ path: 'a.ts', content: 'x' }], 'c'));
  });

  it('focus-offenders escalation names ONLY the compiler-named files present in the set', () => {
    const errors = 'src/hooks/useNotes.ts(12,5): error TS2613\nsrc/pages/Missing.tsx(1,1): error TS1000';
    const files = [{ path: 'src/hooks/useNotes.ts', content: 'x' }, { path: 'src/App.tsx', content: 'y' }];
    const sys = repairSystemPrompt('vite-react', 'focus-offenders');
    const user = repairUserPrompt('app', errors, files, undefined, 'focus-offenders');
    expect(sys).toContain('ESCALATION');
    expect(sys).toContain('compiler explicitly names');
    // useNotes.ts is in the set and named → listed; Missing.tsx is named but NOT generated → excluded
    // from the instruction line (it still appears in the verbatim error dump above, which is expected).
    const instruction = user.split('\n').find((l) => l.startsWith('Rewrite ONLY these files')) ?? '';
    expect(instruction).toBe('Rewrite ONLY these files the compiler named: src/hooks/useNotes.ts.');
    expect(instruction).not.toContain('Missing.tsx');
  });

  it('contract-authority escalation reframes the contract as the source of truth', () => {
    const sys = repairSystemPrompt('vite-react', 'contract-authority');
    expect(sys).toContain('ABSOLUTE source of truth');
    expect(sys).not.toContain('compiler explicitly names'); // distinct from focus-offenders
  });

  it('offendingFiles extracts tsc/eslint paths, dedupes, and ignores unknown files', () => {
    const errors = [
      'src/a.ts(1,2): error TS1', 'src/a.ts(9,9): error TS2', // dup → once
      'src/b.tsx:3:4 error', 'unknown/c.ts(1,1): error',       // unknown → dropped
      'not a path here',
    ].join('\n');
    expect(offendingFiles(errors, ['src/a.ts', 'src/b.tsx'])).toEqual(['src/a.ts', 'src/b.tsx']);
    expect(offendingFiles('', ['src/a.ts'])).toEqual([]);
  });

  it('runSimpleBuild passes an escalating strategy on each repair attempt', async () => {
    const seenStrategies: (string | undefined)[] = [];
    let verifyCall = 0;
    const sb = await runSimpleBuild({
      prompt: 'app', framework: 'vite-react', scaffoldPaths: ['src/App.tsx'], maxRepairs: 3,
      shareContract: false, depOrder: false,
      generate: async (_s: string, user: string) => {
        if (user.includes('Plan the file list')) return 'src/App.tsx :: root\nsrc/Foo.tsx :: foo';
        const path = (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || 'src/App.tsx';
        return `<<<FILE ${path}>>>\nbad\n<<<ENDFILE>>>`;
      },
      writeFiles: async () => {},
      // Always fail with DISTINCT errors so the circuit-breaker never short-circuits the ladder.
      verify: async () => ({ ok: false, errors: `err ${verifyCall++}`, ran: true }),
      repair: async (_e, _f, _c, strategy) => { seenStrategies.push(strategy); return [{ path: 'src/App.tsx', content: 'still' }]; },
    });
    expect(sb.ok).toBe(false); // never a fake success — hands to the full builder
    expect(seenStrategies).toEqual(['contract-full', 'focus-offenders', 'contract-authority']);
  });
});

describe('runSimpleBuild — shared contract wiring', () => {
  const deps = (over: Partial<Parameters<typeof runSimpleBuild>[0]> = {}) => ({
    prompt: 'an online media player', framework: 'vite-react', scaffoldPaths: ['src/App.tsx'],
    generate: async (_s: string, user: string) => {
      if (user.includes('Plan the file list')) return 'src/App.tsx :: root\nsrc/Player.tsx :: player\nsrc/types.ts :: types';
      if (user.includes('Design the shared contract')) return 'enum MediaType { YouTube, Vimeo }';
      const path = (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || 'src/App.tsx';
      return `<<<FILE ${path}>>>\n// ${path}\nexport default function X(){return null}\n<<<ENDFILE>>>`;
    },
    writeFiles: async () => {},
    ...over,
  });

  it('designs a contract once and injects it into EVERY per-file generation prompt', async () => {
    const perFilePrompts: string[] = [];
    let contractCalls = 0;
    const r = await runSimpleBuild(deps({
      generate: async (_s: string, user: string) => {
        if (user.includes('Plan the file list')) return 'src/App.tsx :: root\nsrc/Player.tsx :: player\nsrc/types.ts :: types';
        if (user.includes('Design the shared contract')) { contractCalls++; return 'enum MediaType { YouTube, Vimeo }'; }
        perFilePrompts.push(user);
        const path = (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || 'src/App.tsx';
        return `<<<FILE ${path}>>>\nok\n<<<ENDFILE>>>`;
      },
    }));
    expect(r.ok).toBe(true);
    expect(contractCalls).toBe(1); // exactly ONE contract call, up front
    expect(perFilePrompts).toHaveLength(3);
    for (const p of perFilePrompts) expect(p).toContain('enum MediaType { YouTube, Vimeo }');
  });

  it('a failed contract call NEVER fails the build (best-effort, falls back to contract-free)', async () => {
    const r = await runSimpleBuild(deps({
      generate: async (_s: string, user: string) => {
        if (user.includes('Plan the file list')) return 'src/App.tsx :: root\nsrc/Player.tsx :: player';
        if (user.includes('Design the shared contract')) throw new Error('contract call down');
        const path = (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || 'src/App.tsx';
        return `<<<FILE ${path}>>>\nok\n<<<ENDFILE>>>`;
      },
    }));
    expect(r.ok).toBe(true);
    expect(r.filesWritten).toBe(2);
  });

  it('shareContract:false skips the contract call entirely (prior behavior preserved)', async () => {
    let contractCalls = 0;
    const r = await runSimpleBuild(deps({
      shareContract: false,
      generate: async (_s: string, user: string) => {
        if (user.includes('Plan the file list')) return 'src/App.tsx :: root\nsrc/Player.tsx :: player';
        if (user.includes('Design the shared contract')) { contractCalls++; return 'x'; }
        const path = (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || 'src/App.tsx';
        return `<<<FILE ${path}>>>\nok\n<<<ENDFILE>>>`;
      },
    }));
    expect(r.ok).toBe(true);
    expect(contractCalls).toBe(0);
  });

  it('threads the contract into the repair call so it can reconcile drift against the source of truth', async () => {
    let repairContract: string | undefined;
    let verifies = 0;
    const r = await runSimpleBuild(deps({
      verify: async () => { verifies++; return verifies === 1 ? { ok: false, errors: 'error TS2339' } : { ok: true, errors: '' }; },
      repair: async (_errs, files, contract) => { repairContract = contract; return [{ path: files[0].path, content: '// fixed' }]; },
    }));
    expect(r.ok).toBe(true);
    expect(repairContract).toContain('enum MediaType { YouTube, Vimeo }');
  });

  it('contract system prompt freezes enum member casing + per-component props (the drift the report hit)', () => {
    const p = contractSystemPrompt('vite-react');
    expect(p).toContain('ENUM');
    expect(p).toContain('FROZEN');
    expect(p).toContain('props interface');
  });
});

describe('generationTier (LENS B — leaves before consumers)', () => {
  it('classifies foundation (types/utils/hooks/contexts/stores/css) as tier 0', () => {
    expect(generationTier('src/types/media.ts')).toBe(0);
    expect(generationTier('src/utils/extractEmbedUrl.ts')).toBe(0);
    expect(generationTier('src/hooks/useMediaUrl.ts')).toBe(0);
    expect(generationTier('src/useTimer.ts')).toBe(0);
    expect(generationTier('src/context/AuthContext.tsx')).toBe(0);
    expect(generationTier('src/store/cart.ts')).toBe(0);
    expect(generationTier('src/styles/App.css')).toBe(0);
    expect(generationTier('src/constants.ts')).toBe(0);
  });
  it('classifies the shell/entry/pages as tier 2 (generated last)', () => {
    expect(generationTier('src/main.tsx')).toBe(2);
    expect(generationTier('src/App.tsx')).toBe(2);
    expect(generationTier('src/pages/Home.tsx')).toBe(2);
    expect(generationTier('src/components/PlayerPage.tsx')).toBe(2); // *Page composes components → last
    expect(generationTier('index.html')).toBe(1); // not a TS entry; just a normal file
  });
  it('classifies ordinary components as tier 1', () => {
    expect(generationTier('src/components/MediaPlayer.tsx')).toBe(1);
    expect(generationTier('src/components/UrlInput.tsx')).toBe(1);
  });
});

describe('dependencyContext (LENS B — real producer source block)', () => {
  it('frames the real source and caps each file', () => {
    const out = dependencyContext([{ path: 'src/types/media.ts', content: 'export enum MediaType { YouTube }' }]);
    expect(out).toContain('ALREADY-WRITTEN FILES YOU CAN IMPORT');
    expect(out).toContain('<<<FILE src/types/media.ts>>>');
    expect(out).toContain('export enum MediaType { YouTube }');
  });
  it('returns "" for no producers and caps long content', () => {
    expect(dependencyContext([])).toBe('');
    const big = 'x'.repeat(9000);
    const out = dependencyContext([{ path: 'a.ts', content: big }], 100);
    expect(out.includes('x'.repeat(100))).toBe(true);
    expect(out.includes('x'.repeat(101))).toBe(false);
  });
});

describe('runSimpleBuild — LENS B staged generation', () => {
  const PLAN = 'src/types/media.ts :: types\nsrc/components/MediaPlayer.tsx :: player\nsrc/App.tsx :: root';
  const stagedDeps = (over = {}) => {
    const calls: string[] = []; // file-generation order (paths)
    const prompts: Record<string, string> = {};
    return {
      calls, prompts,
      deps: {
        prompt: 'media player', framework: 'vite-react', scaffoldPaths: ['src/App.tsx'],
        shareContract: false, // isolate LENS B from LENS A in this test
        generate: async (_s: string, user: string) => {
          if (user.includes('Plan the COMPLETE file list') || user.includes('Plan the file list') || user.includes('complete file list:')) {
            if (!user.includes('write THIS file')) return PLAN;
          }
          const m = user.match(/write THIS file in full:\s*\n\s*([^\n]+)/);
          if (m) {
            const path = m[1].trim();
            calls.push(path);
            prompts[path] = user;
            return `<<<FILE ${path}>>>\n// ${path}\nexport default function X(){return null}\n<<<ENDFILE>>>`;
          }
          return PLAN; // manifest fallback
        },
        writeFiles: async () => {},
        ...over,
      },
    };
  };

  it('generates foundation BEFORE the component BEFORE the shell, and feeds real source forward', async () => {
    const h = stagedDeps();
    const r = await runSimpleBuild(h.deps);
    expect(r.ok).toBe(true);
    const iTypes = h.calls.indexOf('src/types/media.ts');
    const iComp = h.calls.indexOf('src/components/MediaPlayer.tsx');
    const iApp = h.calls.indexOf('src/App.tsx');
    expect(iTypes).toBeGreaterThanOrEqual(0);
    expect(iTypes).toBeLessThan(iComp);   // foundation first
    expect(iComp).toBeLessThan(iApp);     // component before the shell
    // The component's prompt carried the foundation file's REAL export surface (Fix 69: signature
    // context replaces the full-body dump — same names/shapes, a fraction of the tokens).
    expect(h.prompts['src/components/MediaPlayer.tsx']).toContain('ALREADY-WRITTEN FILES YOU CAN IMPORT');
    expect(h.prompts['src/components/MediaPlayer.tsx']).toContain('<<<EXPORTS src/types/media.ts>>>');
    // The shell saw both the foundation AND the component.
    expect(h.prompts['src/App.tsx']).toContain('src/components/MediaPlayer.tsx');
  });

  it('depOrder:false falls back to one batch with NO dependency block (byte-identical path)', async () => {
    const h = stagedDeps({ depOrder: false });
    const r = await runSimpleBuild(h.deps);
    expect(r.ok).toBe(true);
    for (const p of Object.values(h.prompts)) {
      expect(p).not.toContain('ALREADY-WRITTEN FILES YOU CAN IMPORT');
    }
  });
});

describe('blueprintAdvisoryBlock (P-ARCH+.3 — advisory blueprint for the agentic architect)', () => {
  const manifest = [
    { path: 'src/App.tsx', purpose: 'root shell' },
    { path: 'src/components/Hero.tsx', purpose: 'hero section' },
  ];
  it('returns empty for an empty manifest', () => {
    expect(blueprintAdvisoryBlock([])).toBe('');
  });
  it('renders the file list and is framed ADVISORY, never FROZEN', () => {
    const b = blueprintAdvisoryBlock(manifest);
    expect(b).toContain('SUGGESTED BLUEPRINT (advisory)');
    expect(b).toContain('src/App.tsx — root shell');
    expect(b).toContain('src/components/Hero.tsx — hero section');
    expect(b).toContain('NOT frozen');
    // Must NOT reuse the fast lane's frozen-contract language (that would over-constrain the architect).
    expect(b).not.toContain('FROZEN and SHARED');
  });
  it('includes the shared contract when provided, and omits it when absent', () => {
    const withC = blueprintAdvisoryBlock(manifest, 'export enum Role { Admin, User }');
    expect(withC).toContain('Proposed shared contract');
    expect(withC).toContain('export enum Role');
    const withoutC = blueprintAdvisoryBlock(manifest, '   ');
    expect(withoutC).not.toContain('Proposed shared contract');
  });
});

describe('cssBraceImbalance (Fix 38d) — the "Unclosed block" postcss killer, caught at verify time', () => {
  it('flags the exact report failure: an @layer block never closed', () => {
    expect(cssBraceImbalance('@layer utilities {\n  .text-primary { color: red; }\n')).toBe(1);
  });
  it('passes balanced css (comments ignored)', () => {
    expect(cssBraceImbalance('/* { not a brace } */ .a { color: red; } @media (x) { .b { y: z; } }')).toBe(0);
    expect(cssBraceImbalance('')).toBe(0);
  });
  it('flags extra closing braces as negative', () => {
    expect(cssBraceImbalance('.a { color: red; } }')).toBe(-1);
  });
});

describe('parseFileManifest cap (Fix 38a) — planned files are never silently dropped at 40', () => {
  it('keeps a 50-file manifest intact (old cap sliced it to 40, dropping the pages)', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `src/pages/Page${i}.tsx :: page ${i}`).join('\n');
    expect(parseFileManifest(lines).length).toBe(50);
  });
});

// NotesNest autopsy (2026-07-16): the fast lane generated a full src/index.css that NOTHING imported
// → the shipped app rendered as raw unstyled HTML. The deterministic pre-write guard wires it.
describe('runSimpleBuild — orphan-stylesheet guard (app must actually be styled)', () => {
  it('injects the global css import into the entry when the generated sheet is orphaned', async () => {
    let written: OneShotFile[] = [];
    const r = await runSimpleBuild({
      prompt: 'notes app', framework: 'vite-react', scaffoldPaths: ['index.html'],
      shareContract: false,
      generate: async (_s: string, user: string) => {
        if (user.includes('Plan the file list')) return 'src/main.tsx :: entry\nsrc/App.tsx :: app\nsrc/index.css :: styles';
        const path = (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || 'x.ts';
        if (path === 'src/index.css') return `<<<FILE src/index.css>>>\nbody { margin: 0; }\n<<<ENDFILE>>>`;
        if (path === 'src/main.tsx') return `<<<FILE src/main.tsx>>>\nimport App from './App';\nexport {};\n<<<ENDFILE>>>`; // forgot the css import
        return `<<<FILE ${path}>>>\nexport default function App(){return null}\n<<<ENDFILE>>>`;
      },
      writeFiles: async (f: OneShotFile[]) => { written = f; },
    });
    expect(r.ok).toBe(true);
    const main = written.find((f) => f.path === 'src/main.tsx');
    expect(main?.content).toContain(`import './index.css';`); // wired before the files ever ship
  });
});
