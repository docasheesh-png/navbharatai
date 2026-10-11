// ONE GOOGLE SDK, AND THE TRUTH ABOUT WHAT AN ABORT BUYS ON IT (admin 2026-10-11, Q-769: move the Vertex rungs
// onto `@google/genai` with `vertexai: true`).
//
// Two facts read from the installed packages, not assumed:
//  • `@google-cloud/vertexai`'s README: "deprecated as of June 24, 2025 and will be removed on June 24, 2026".
//    Three call sites (the router's Vertex rung, the vision chain, Doctor AI) rested on it.
//  • `@google/genai`'s typings on `abortSignal`: "a client-only operation … will not cancel the request in the
//    service. You will still be charged usage". The queue row's premise — that the swap stops Google's bill —
//    was false, and the Gemini provider's comment made the same claim. Both now say what is true.
// And a sibling the swap found: Doctor AI's two direct-Gemini calls put the system prompt OUTSIDE `config`,
// cast `as any` — the SDK ignored it, so Doctor AI answered on that rung without its own instructions.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { vertexClientOptions, vertexLocation } from '../src/server/lib/vertexGenAI';

const code = (p: string) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
function sources(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}

describe('🔒 the Vertex client keeps the service-account auth', () => {
  it('an explicit project and region — never an API key, so an env key cannot hijack the rung', () => {
    expect(vertexClientOptions({ GOOGLE_CLOUD_PROJECT: 'p1', GEMINI_API_KEY: 'k' } as NodeJS.ProcessEnv)).toEqual({ vertexai: true, project: 'p1', location: 'us-central1' });
    expect(vertexClientOptions({ GOOGLE_CLOUD_PROJECT_ID: 'p2', GOOGLE_CLOUD_REGION: 'asia-southeast1' } as NodeJS.ProcessEnv)).toEqual({ vertexai: true, project: 'p2', location: 'asia-southeast1' });
    expect(vertexClientOptions({} as NodeJS.ProcessEnv)).toBeNull();
    expect(vertexLocation({} as NodeJS.ProcessEnv)).toBe('us-central1');
  });
});

describe('the Vertex rung hands the abort to the request', () => {
  const calls: Array<Record<string, any>> = [];
  beforeEach(() => { calls.length = 0; vi.resetModules(); });

  async function provider(answer: (p: Record<string, any>) => Promise<any>) {
    vi.doMock('../src/server/lib/vertexGenAI', () => ({
      vertexProjectId: () => 'p1',
      vertexLocation: () => 'us-central1',
      vertexGenAI: () => ({
        models: {
          generateContent: (p: Record<string, any>) => { calls.push(p); return answer(p); },
          generateContentStream: async (p: Record<string, any>) => {
            calls.push(p);
            return (async function* () { yield { text: 'a' }; yield { text: 'b' }; })();
          },
        },
      }),
    }));
    const { VertexProvider } = await import('../src/server/AI/Router/providers/VertexProvider');
    return new VertexProvider();
  }

  it('a stream carries the caller\'s signal, and the system prompt sits in config', async () => {
    const p = await provider(async () => ({}));
    const ac = new AbortController();
    const out = await p.executeStream!('hi', 'be brief', () => {}, 'gemini-2.5-flash', ac.signal);
    expect(out).toBe('ab');
    expect(calls[0].config.abortSignal).toBe(ac.signal);
    expect(calls[0].config.systemInstruction).toBe('be brief');
    expect(calls[0].model).toBe('gemini-2.5-flash');
  });

  it('a plain answer reads the new response shape and its usage', async () => {
    const p = await provider(async () => ({ text: 'hello', usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 } }));
    const r = await p.execute('hi');
    expect(r.content).toBe('hello');
    expect(r.provider).toBe('VERTEX');
    expect(calls[0].config.abortSignal).toBeInstanceOf(AbortSignal); // the timeout aborts, not races
  });
});

describe('🔒 the old SDK is gone, everywhere', () => {
  it('no source imports @google-cloud/vertexai, and the package is not a dependency', () => {
    const users = [...sources('src'), 'server.ts'].filter((f) => code(f).includes('@google-cloud/vertexai'));
    expect(users).toEqual([]);
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.dependencies?.['@google-cloud/vertexai']).toBeUndefined();
  });

  it('the three Vertex callers share the one client', () => {
    expect(code('src/server/AI/Router/providers/VertexProvider.ts')).toContain('vertexGenAI()');
    expect(code('src/server/lib/visionChain.ts')).toContain('vertexGenAI()');
    expect(code('src/server/routes/sda.ts')).toContain('vertexGenAI()');
  });
});

describe('🔒 a GenAI request is written in the shape the SDK reads', () => {
  // The class behind Doctor AI's lost system prompt: a parameter object cast `as any`, so the compiler could not
  // say that `systemInstruction` at the top level is not a field. Every call is checked, in every file.
  it('no generateContent call casts its parameters, or puts the system prompt outside config', () => {
    const bad: string[] = [];
    for (const f of [...sources('src'), 'server.ts']) {
      const src = code(f);
      for (const m of src.matchAll(/models\.generateContent(?:Stream)?\(/g)) {
        let depth = 0; let i = (m.index ?? 0) + m[0].length - 1; const start = i;
        for (; i < src.length; i++) { if (src[i] === '(') depth++; else if (src[i] === ')' && --depth === 0) break; }
        const call = src.slice(start, i + 1);
        // top-level keys of the object literal: depth-1 `name:` inside the outer braces
        let d = 0; const top: string[] = [];
        for (let j = 0; j < call.length; j++) {
          const ch = call[j];
          if ('({['.includes(ch)) d++;
          else if (')}]'.includes(ch)) d--;
          else if (d === 2) { const k = /^\s*([A-Za-z_]\w*)\s*:/.exec(call.slice(j)); if (k && /[{,]\s*$/.test(call.slice(0, j))) top.push(k[1]); }
        }
        if (top.includes('systemInstruction')) bad.push(`${f}: systemInstruction outside config`);
        if (/\}\s*as\s+any\s*\)$/.test(call)) bad.push(`${f}: parameters cast as any`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('Doctor AI\'s Gemini answers carry its system prompt', () => {
    const sda = code('src/server/routes/sda.ts');
    expect((sda.match(/config: \{ systemInstruction: SDA_SYSTEM_FINAL/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

describe('🔒 nothing claims an abort stops Google\'s bill', () => {
  it('the Gemini and Vertex providers say the abort is client-side', () => {
    for (const f of ['src/server/AI/Router/providers/GeminiProvider.ts', 'src/server/AI/Router/providers/VertexProvider.ts']) {
      const raw = readFileSync(f, 'utf8');
      expect(raw, f).not.toMatch(/stop consuming AND stop paying/);
      expect(raw, f).not.toMatch(/stops being generated rather than/);
    }
    expect(readFileSync('src/server/lib/vertexGenAI.ts', 'utf8')).toContain('You will still be charged usage');
  });
});
