/**
 * Q-129: the Gemini/Vertex runner was the one provider family that never read the build's stop signal, so a
 * pressed Stop waited up to two minutes (its per-call timeout) for a call the user no longer wanted — paid for
 * by the user, or by NavBharatAI on the free tier. The class: a waiting path that does not hear Stop. The
 * runner now hands the signal to the SDK (which cancels the HTTP request) and races the wait against it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { GeminiToolRunner, type GeminiGenAiClient } from '../src/server/AgentV3/providers/GeminiToolRunner';
import { isBuildStoppedError } from '../src/server/AgentV3/stopSignal';

const PARAMS = { system: 'sys', messages: [{ role: 'user', content: 'hi' }], tools: [], model: 'gemini-x' } as never;

function hangingClient(seen: { signal?: AbortSignal }): GeminiGenAiClient {
  return {
    models: {
      generateContent: (p) => {
        seen.signal = p.config?.abortSignal;
        return new Promise(() => { /* never answers — a stalled provider call */ });
      },
    },
  };
}

describe('Stop reaches the Gemini/Vertex runner', () => {
  it('a stop pressed mid-call ends the wait at once with the shared stop error — never a provider failure', async () => {
    const seen: { signal?: AbortSignal } = {};
    const ctl = new AbortController();
    const runner = new GeminiToolRunner(hangingClient(seen), { timeoutMs: 60_000 });
    const started = Date.now();
    const turn = runner.runTurn({ ...(PARAMS as object), signal: ctl.signal } as never);
    setTimeout(() => ctl.abort(), 20);
    const err = await turn.then(() => null, (e) => e);
    expect(isBuildStoppedError(err)).toBe(true);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(seen.signal).toBe(ctl.signal); // the SDK got the signal, so the HTTP request itself is cancelled
  });

  it('a build already stopped never starts the call', async () => {
    const seen: { signal?: AbortSignal } = {};
    const ctl = new AbortController();
    ctl.abort();
    let called = false;
    const client: GeminiGenAiClient = { models: { generateContent: () => { called = true; return new Promise(() => {}); } } };
    const err = await new GeminiToolRunner(client).runTurn({ ...(PARAMS as object), signal: ctl.signal } as never).then(() => null, (e) => e);
    expect(isBuildStoppedError(err)).toBe(true);
    expect(called).toBe(false);
    void seen;
  });
});

describe('census: every provider runner hears Stop', () => {
  it('each TurnRunner implementation reads the build\'s stop signal', () => {
    const ROOT = join(__dirname, '../src/server');
    const runners: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const f = join(d, n);
        if (statSync(f).isDirectory()) { walk(f); continue; }
        if (!/\.ts$/.test(n) || /\.test\.ts$/.test(n)) continue;
        const src = readFileSync(f, 'utf8');
        if (/\bimplements TurnRunner\b/.test(src)) runners.push(f);
      }
    };
    walk(ROOT);
    expect(runners.length).toBeGreaterThanOrEqual(3);
    for (const f of runners) {
      expect(readFileSync(f, 'utf8'), f).toMatch(/throwIfStopped\(params\.signal\)|params\.signal\?\.aborted/);
    }
  });
});
