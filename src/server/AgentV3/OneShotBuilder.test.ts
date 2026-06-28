import { describe, it, expect, afterEach } from 'vitest';
import {
  classifyForOneShot, oneShotEnabled, parseFileBlocks, runOneShot, type OneShotFile,
} from './OneShotBuilder';

describe('classifyForOneShot — simple → one-shot, complex → loop', () => {
  it('routes simple/medium tiers to the one-shot lane', () => {
    expect(classifyForOneShot('gemini')).toBe(true);
    expect(classifyForOneShot('haiku')).toBe(true);
  });
  it('keeps complex tiers on the full agentic loop', () => {
    expect(classifyForOneShot('sonnet')).toBe(false);
    expect(classifyForOneShot('opus')).toBe(false);
    expect(classifyForOneShot(undefined)).toBe(false);
  });
});

describe('oneShotEnabled — on by default, AGENTV3_ONESHOT=off disables', () => {
  const prev = process.env.AGENTV3_ONESHOT;
  afterEach(() => { if (prev === undefined) delete process.env.AGENTV3_ONESHOT; else process.env.AGENTV3_ONESHOT = prev; });
  it('on by default', () => { delete process.env.AGENTV3_ONESHOT; expect(oneShotEnabled()).toBe(true); });
  it('off when set to off', () => { process.env.AGENTV3_ONESHOT = 'off'; expect(oneShotEnabled()).toBe(false); });
});

describe('parseFileBlocks', () => {
  it('parses multiple FILE blocks, ignoring surrounding prose', () => {
    const text = [
      'here you go',
      '<<<FILE index.html>>>',
      '<!doctype html><div id="root"></div>',
      '<<<ENDFILE>>>',
      '<<<FILE src/App.tsx>>>',
      'export default function App(){ return <h1>Hi</h1> }',
      '<<<ENDFILE>>>',
    ].join('\n');
    const files = parseFileBlocks(text);
    expect(files.map((f) => f.path)).toEqual(['index.html', 'src/App.tsx']);
    expect(files[1].content).toContain('export default function App');
  });
  it('rejects unsafe paths (absolute / traversal) and de-dupes (last wins)', () => {
    const text = [
      '<<<FILE /etc/passwd>>>\nx\n<<<ENDFILE>>>',
      '<<<FILE ../secret>>>\ny\n<<<ENDFILE>>>',
      '<<<FILE a.ts>>>\nfirst\n<<<ENDFILE>>>',
      '<<<FILE a.ts>>>\nsecond\n<<<ENDFILE>>>',
    ].join('\n');
    const files = parseFileBlocks(text);
    expect(files).toEqual([{ path: 'a.ts', content: 'second' }]);
  });
  it('returns [] for text with no blocks', () => {
    expect(parseFileBlocks('I am an AI, I have no file system')).toEqual([]);
    expect(parseFileBlocks('')).toEqual([]);
  });
});

describe('runOneShot', () => {
  const baseDeps = (over: Partial<Parameters<typeof runOneShot>[0]> = {}) => ({
    prompt: 'build a todo app', framework: 'vite-react', scaffoldPaths: ['index.html', 'src/App.tsx'],
    generate: async () => '<<<FILE src/App.tsx>>>\nexport default function App(){return null}\n<<<ENDFILE>>>',
    writeFiles: async (_f: OneShotFile[]) => {},
    ...over,
  });

  it('succeeds: generates, writes the files, returns ok', async () => {
    let written: OneShotFile[] = [];
    const r = await runOneShot(baseDeps({ writeFiles: async (f) => { written = f; } }));
    expect(r.ok).toBe(true);
    expect(r.filesWritten).toBe(1);
    expect(written[0].path).toBe('src/App.tsx');
  });

  it('falls back (ok:false) when the model returns no usable files — the safety net', async () => {
    const r = await runOneShot(baseDeps({ generate: async () => 'sorry, I cannot help' }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no_files_parsed');
  });

  it('falls back (ok:false, never throws) when generation throws', async () => {
    const r = await runOneShot(baseDeps({ generate: async () => { throw new Error('429 overloaded'); } }));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('429');
  });

  it('a preview failure does NOT fail the build (files already written)', async () => {
    const r = await runOneShot(baseDeps({ startPreview: async () => { throw new Error('port down'); } }));
    expect(r.ok).toBe(true);
  });

  it('a HUNG writeFiles (sandbox write never returns) does NOT hang — bails to fallback within the timeout', async () => {
    const r = await runOneShot(baseDeps({
      writeFiles: () => new Promise<void>(() => { /* never resolves */ }),
      overallTimeoutMs: 30,
    }));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('did not finish');
  });

  it('a HUNG generate (model call never returns) does NOT hang — bails to fallback within the overall timeout', async () => {
    // The exact production hang: the OneShot model call stalls and never resolves, so without an
    // overall cap the build would spin at "working…" forever. It must bail to ok:false (fallback).
    const r = await runOneShot(baseDeps({
      generate: () => new Promise<string>(() => { /* never resolves */ }),
      overallTimeoutMs: 30,
    }));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('did not finish');
  });

  it('STICKY SUCCESS: once files are written, a slow/hung preview never discards the build', async () => {
    // The exact production failure: OneShot wrote the files (app built), but the preview was slow,
    // so the attempt was discarded (ok:false) and the heavy agentic loop re-ran on top → 12-min
    // timeout. The generate/write phase is fast here; only the preview hangs → must stay ok:true.
    let written = 0;
    const r = await runOneShot(baseDeps({
      writeFiles: async (f) => { written = f.length; },
      startPreview: () => new Promise<void>(() => { /* preview never comes up */ }),
      overallTimeoutMs: 50,   // tight generate/write cap — must NOT apply to the preview
      previewTimeoutMs: 30,
    }));
    expect(r.ok).toBe(true);          // success is LOCKED IN once files are written
    expect(written).toBe(1);
    expect(r.filesWritten).toBe(1);
  });

  it('a HUNG preview (never resolves) does NOT hang the build — it completes within the timeout', async () => {
    // Reproduces the real bug: `npm run dev` never returns, so startPreview never settles. The
    // build must still finish (files are written) instead of spinning at "working…" forever.
    let logged = '';
    const r = await runOneShot(baseDeps({
      startPreview: () => new Promise<void>(() => { /* never resolves */ }),
      previewTimeoutMs: 30,
      log: (m) => { logged = m; },
    }));
    expect(r.ok).toBe(true);
    expect(r.filesWritten).toBe(1);
    expect(logged).toContain('Preview is still starting');
  });
});
