import { describe, it, expect } from 'vitest';
import { parseFileManifest, runSimpleBuild, manifestSystemPrompt, fileUserPrompt, fileSystemPrompt, repairSystemPrompt, contractBlock, contractSystemPrompt, repairUserPrompt, generationTier, dependencyContext, blueprintAdvisoryBlock, cssBraceImbalance } from './SimpleBuilder';
import type { OneShotFile } from './OneShotBuilder';

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

  it('verify still fails after maxRepairs → ok:false (hands off to the full builder, NO fake success)', async () => {
    let repairs = 0;
    const r = await runSimpleBuild(baseDeps({
      verify: async () => ({ ok: false, errors: 'error TS2339: broken' }),
      repair: async (_e, files) => { repairs++; return [{ path: files[0].path, content: '// still broken' }]; },
      maxRepairs: 2,
    }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('verify_failed');
    expect(repairs).toBe(2); // tried exactly maxRepairs times before handing off
  });

  it('a verify infra error does NOT block success (best-effort)', async () => {
    const r = await runSimpleBuild(baseDeps({ verify: async () => { throw new Error('sandbox gone'); } }));
    expect(r.ok).toBe(true);
  });

  it('without a verify dep, behavior is unchanged (sticky success)', async () => {
    const r = await runSimpleBuild(baseDeps());
    expect(r.ok).toBe(true);
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
    // The component's prompt carried the REAL generated source of the foundation file.
    expect(h.prompts['src/components/MediaPlayer.tsx']).toContain('ALREADY-WRITTEN FILES YOU CAN IMPORT');
    expect(h.prompts['src/components/MediaPlayer.tsx']).toContain('<<<FILE src/types/media.ts>>>');
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
