import { describe, it, expect } from 'vitest';
import { parseFileManifest, runSimpleBuild, manifestSystemPrompt, fileUserPrompt, fileSystemPrompt, repairSystemPrompt } from './SimpleBuilder';
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

  it('caps at 40 files and returns [] for empty', () => {
    expect(parseFileManifest('')).toEqual([]);
    const many = Array.from({ length: 60 }, (_, i) => `src/f${i}.tsx :: file ${i}`).join('\n');
    expect(parseFileManifest(many)).toHaveLength(40);
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

  it('plans a manifest, generates each file individually, writes them, returns ok', async () => {
    let written: OneShotFile[] = [];
    const r = await runSimpleBuild(baseDeps({ writeFiles: async (f) => { written = f; } }));
    expect(r.ok).toBe(true);
    expect(r.filesWritten).toBe(3);
    expect(written.map((f) => f.path).sort()).toEqual(['src/App.tsx', 'src/TodoList.tsx', 'src/index.css']);
  });

  it('falls back (ok:false) when the manifest is too small', async () => {
    const r = await runSimpleBuild(baseDeps({ generate: async () => 'src/App.tsx :: only one' }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('manifest_too_small');
  });

  it('a single file\'s failed call does not kill the build (others still ship)', async () => {
    let calls = 0;
    const r = await runSimpleBuild(baseDeps({
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
