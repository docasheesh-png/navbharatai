import { describe, it, expect } from 'vitest';
import {
  isTruncatedStop, shouldContinue, continuationPrompt, joinContinuation, unterminatedTailPath,
  MAX_CONTINUATIONS, continueFastLaneGeneration,
} from './FastLaneContinuation';
import { parseFileBlocks } from './OneShotBuilder';

describe('isTruncatedStop', () => {
  it('recognises both provider spellings of "I ran out of output budget"', () => {
    expect(isTruncatedStop('max_tokens')).toBe(true);   // Anthropic / the report's kimi calls
    expect(isTruncatedStop('length')).toBe(true);       // OpenAI-compatible cheap coders
  });

  it('does not treat a normal finish as truncation', () => {
    for (const s of ['end_turn', 'tool_use', 'stop', null, undefined, '']) {
      expect(isTruncatedStop(s)).toBe(false);
    }
  });
});

describe('shouldContinue', () => {
  it('continues a truncated call while attempts remain', () => {
    expect(shouldContinue('max_tokens', 0)).toBe(true);
    expect(shouldContinue('max_tokens', MAX_CONTINUATIONS - 1)).toBe(true);
  });

  it('is bounded — a model that never terminates cannot burn the build', () => {
    expect(shouldContinue('max_tokens', MAX_CONTINUATIONS)).toBe(false);
  });

  it('never continues a call that finished normally', () => {
    expect(shouldContinue('end_turn', 0)).toBe(false);
  });
});

describe('continuationPrompt', () => {
  it('shows the model the exact tail it stopped at', () => {
    const produced = `${'x'.repeat(5000)}TAIL_MARKER_HERE`;
    const p = continuationPrompt(produced);
    expect(p).toContain('TAIL_MARKER_HERE');
    expect(p).toContain('RESUME HERE');
    // Only the tail is echoed — resending 5000 chars would re-spend the tokens we are trying to save.
    expect(p.length).toBeLessThan(3000);
  });

  it('forbids restarting or repeating finished files', () => {
    const p = continuationPrompt('<<<FILE a.ts>>>x');
    expect(p).toMatch(/do NOT repeat/i);
    expect(p).toMatch(/do NOT start over/i);
  });
});

describe('joinContinuation', () => {
  it('fuses a mid-file cut back into ONE complete file (report 858f6d7b shape)', () => {
    // kimi stopped mid-content; the continuation resumes at the exact character.
    const first = '<<<FILE src/App.tsx>>>\nexport default function App() {\n  return <div>He';
    const rest = 'llo</div>;\n}\n<<<ENDFILE>>>';
    const files = parseFileBlocks(joinContinuation(first, rest));
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('src/App.tsx');
    expect(files[0].content).toContain('Hello</div>');
  });

  it('lets a re-emitted file replace the partial one (last-wins), not corrupt it', () => {
    const first = '<<<FILE src/App.tsx>>>\nexport default function App() {\n  return <div>He';
    const restart = '<<<FILE src/App.tsx>>>\nexport default function App() {\n  return <div>Hello</div>;\n}\n<<<ENDFILE>>>';
    const files = parseFileBlocks(joinContinuation(first, restart));
    expect(files).toHaveLength(1);
    expect(files[0].content).toContain('Hello</div>');
    expect(files[0].content).not.toMatch(/He$/);
  });

  it('recovers the files the truncated response never reached (the missing src/main.tsx)', () => {
    const first = '<<<FILE src/App.tsx>>>\nconst App = () => null;\nexport default App;\n<<<ENDFILE>>>\n<<<FILE src/mai';
    const rest = 'n.tsx>>>\nimport App from "./App";\n<<<ENDFILE>>>';
    const paths = parseFileBlocks(joinContinuation(first, rest)).map((f) => f.path);
    expect(paths).toContain('src/main.tsx');
  });

  it('inserts a line break so a resumed <<<FILE header stays parseable', () => {
    const joined = joinContinuation('...done<<<ENDFILE>>>', '<<<FILE b.ts>>>\nx\n<<<ENDFILE>>>');
    expect(parseFileBlocks(joined).map((f) => f.path)).toContain('b.ts');
  });

  it('handles empty inputs without inventing content', () => {
    expect(joinContinuation('a', '')).toBe('a');
    expect(joinContinuation('', 'b')).toBe('b');
  });
});

describe('unterminatedTailPath', () => {
  it('names the half-written file a truncated response left open', () => {
    const text = '<<<FILE a.ts>>>\nok\n<<<ENDFILE>>>\n<<<FILE src/index.css>>>\n:root { --bg: #fff';
    expect(unterminatedTailPath(text)).toBe('src/index.css');
  });

  it('returns null for a cleanly terminated response', () => {
    expect(unterminatedTailPath('<<<FILE a.ts>>>\nok\n<<<ENDFILE>>>')).toBeNull();
  });

  it('returns null when there are no file blocks at all', () => {
    expect(unterminatedTailPath('just some prose')).toBeNull();
    expect(unterminatedTailPath('')).toBeNull();
  });

  it('is the guard that stops half a file shipping as a whole one', () => {
    // parseFileBlocks deliberately accepts a final unterminated block, so on its own it CANNOT tell a
    // truncated file from a complete one — this is exactly the gap the guard closes.
    const truncated = '<<<FILE src/App.tsx>>>\nexport default function App() { return <div>He';
    expect(parseFileBlocks(truncated)).toHaveLength(1);
    expect(unterminatedTailPath(truncated)).toBe('src/App.tsx');
  });
});

describe('the continuation loop returns the file blocks it can keep', () => {
  const complete = '<<<FILE src/ok.ts>>>\nexport const ok = true;\n<<<ENDFILE>>>\n';
  const partial = '<<<FILE src/App.tsx>>>\nexport default function App() { return <div>He';
  const reply = (text: string, stopReason = 'max_tokens', provider = 'first') => ({
    text, stopReason, billedAs: { provider, outputTokens: 10 },
  });

  it('discards a partial first file at offset zero when the continuation fails', async () => {
    const first = reply(partial);
    const error = new Error('deadline reached');
    const result = await continueFastLaneGeneration(first, { generate: async () => { throw error; } });
    expect(parseFileBlocks(result.text)).toEqual([]);
    expect(result).toMatchObject({ attempts: 1, continued: 0, failure: { error }, dropped: { path: 'src/App.tsx', reply: first } });
  });

  it('keeps completed earlier files while removing the failed partial tail', async () => {
    const result = await continueFastLaneGeneration(reply(complete + partial), { generate: async () => { throw new Error('provider unavailable'); } });
    expect(parseFileBlocks(result.text)).toEqual([{ path: 'src/ok.ts', content: 'export const ok = true;' }]);
    expect(result.dropped?.path).toBe('src/App.tsx');
  });

  it('counts successful replies separately from the later failed attempt and attributes the discarded output', async () => {
    const second = reply('llo', 'length', 'second');
    let calls = 0;
    const result = await continueFastLaneGeneration(reply(complete + partial), {
      generate: async () => { if (calls++ === 0) return second; throw new Error('budget ended'); },
    });
    expect(result).toMatchObject({ attempts: 2, continued: 1, dropped: { reply: second } });
    expect(parseFileBlocks(result.text).map((f) => f.path)).toEqual(['src/ok.ts']);
  });

  it('removes the partial file after all continuations still hit the ceiling', async () => {
    const attempts: number[] = [];
    const result = await continueFastLaneGeneration(reply(partial), {
      generate: async () => reply(' more'),
      onAttempt: (attempt) => { attempts.push(attempt); },
    });
    expect(attempts).toEqual([1, 2, 3]);
    expect(result).toMatchObject({ text: '', attempts: MAX_CONTINUATIONS, continued: MAX_CONTINUATIONS, failure: null });
    expect(result.dropped?.path).toBe('src/App.tsx');
  });

  it('an empty continuation with a normal stop cannot turn a known partial file into a finished one', async () => {
    const first = reply(partial);
    const result = await continueFastLaneGeneration(first, { generate: async () => reply('  \n', 'end_turn', 'empty') });
    expect(result).toMatchObject({ text: '', attempts: 1, continued: 0, stopReason: 'max_tokens', dropped: { reply: first } });
    expect(result.failure?.error).toBeInstanceOf(Error);
  });

  it('a nonempty refusal with a normal stop cannot certify the interrupted file either', async () => {
    const first = reply(partial);
    const refusal = reply('I cannot continue that file.', 'end_turn', 'refusal');
    const result = await continueFastLaneGeneration(first, {
      generate: async () => refusal,
    });
    expect(result.stopReason).toBe('end_turn');
    expect(parseFileBlocks(result.text)).toEqual([]);
    expect(result.dropped?.path).toBe('src/App.tsx');
    expect(result.discardedReplies).toEqual([first, refusal]);
  });

  it('a completed continuation preserves the joined file and its explicit end marker', async () => {
    const result = await continueFastLaneGeneration(reply(partial), { generate: async (prompt) => {
      expect(prompt).toContain('src/App.tsx');
      return reply('llo</div>; }\n<<<ENDFILE>>>', 'end_turn');
    } });
    expect(result).toMatchObject({ continued: 1, attempts: 1, failure: null, dropped: null, stopReason: 'end_turn' });
    expect(parseFileBlocks(result.text)[0].content).toContain('Hello</div>');
  });

  it('a continuation that skips to another file cannot hide the known partial behind its complete block', async () => {
    const first = reply(partial);
    const result = await continueFastLaneGeneration(first, { generate: async () => reply(complete, 'end_turn', 'second') });
    expect(parseFileBlocks(result.text).map((file) => file.path)).toEqual(['src/ok.ts']);
    expect(result.abandoned).toEqual([{ path: 'src/App.tsx', reply: first, contributors: [first] }]);
    expect(result.dropped).toBeNull();
  });

  it('keeps an interrupted file the continuation closes before opening the next file', async () => {
    const result = await continueFastLaneGeneration(reply(partial), {
      generate: async () => reply('llo</div>; }\n<<<ENDFILE>>\n' + complete, 'end_turn'),
    });
    expect(parseFileBlocks(result.text).map((file) => file.path)).toEqual(['src/App.tsx', 'src/ok.ts']);
    expect(result.abandoned).toEqual([]);
  });

  it('keeps a deliberate full restart of the interrupted file, or a welded repeated header', async () => {
    for (const text of [
      '<<<FILE src/App.tsx>>>\nexport default function App() { return <div>Hello</div>; }\n<<<ENDFILE>>>',
      '<<<FILE src/App.tsx>>>\nllo</div>; }\n<<<ENDFILE>>>',
    ]) {
      const result = await continueFastLaneGeneration(reply(partial), { generate: async () => reply(text, 'end_turn') });
      expect(parseFileBlocks(result.text)[0].content).toContain('Hello</div>');
      expect(result.abandoned).toEqual([]);
    }
  });

  it('a response truncated between complete files never discards the files it did complete', async () => {
    const result = await continueFastLaneGeneration(reply(complete), { generate: async () => { throw new Error('stopped'); } });
    expect(result.dropped).toBeNull();
    expect(parseFileBlocks(result.text)).toHaveLength(1);
    expect(result.continued).toBe(0);
  });

  it('leaves normal replies unchanged and never continues a reasoning-only empty output', async () => {
    for (const first of [reply(complete, 'end_turn'), reply('<<<FILE a.ts>>>\nexport const a = 1;', 'end_turn'), reply('  ', 'max_tokens')]) {
      const result = await continueFastLaneGeneration(first, { generate: async () => { throw new Error('must not call'); } });
      expect(result).toMatchObject({ text: first.text, attempts: 0, continued: 0, failure: null, dropped: null });
    }
  });
});
