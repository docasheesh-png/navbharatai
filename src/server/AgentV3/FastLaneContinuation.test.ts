import { describe, it, expect } from 'vitest';
import {
  isTruncatedStop, shouldContinue, continuationPrompt, joinContinuation, unterminatedTailPath,
  MAX_CONTINUATIONS,
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
