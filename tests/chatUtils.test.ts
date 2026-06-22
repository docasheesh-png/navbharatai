/**
 * Tests for src/lib/chatUtils.ts — pure utility functions extracted from App.tsx.
 */
import { describe, it, expect } from 'vitest';
import type { Message } from '../src/types/index';
import {
  generateUCI,
  getRandomElement,
  generateSmartHeuristicSummary,
  extractCode,
  classifyBuildIntent,
  classifyAutoIntent,
  dedupAndSortMessages,
} from '../src/lib/chatUtils';

// ─── generateUCI ─────────────────────────────────────────────────────────────

describe('generateUCI', () => {
  it('returns a string between 10 and 16 characters', () => {
    for (let i = 0; i < 20; i++) {
      const uci = generateUCI();
      expect(uci.length).toBeGreaterThanOrEqual(10);
      expect(uci.length).toBeLessThanOrEqual(16);
    }
  });

  it('always contains at least one uppercase letter', () => {
    for (let i = 0; i < 20; i++) {
      expect(/[A-Z]/.test(generateUCI())).toBe(true);
    }
  });

  it('always contains at least one lowercase letter', () => {
    for (let i = 0; i < 20; i++) {
      expect(/[a-z]/.test(generateUCI())).toBe(true);
    }
  });

  it('always contains at least one digit', () => {
    for (let i = 0; i < 20; i++) {
      expect(/[0-9]/.test(generateUCI())).toBe(true);
    }
  });

  it('always contains at least one symbol from !@#$%^&*', () => {
    for (let i = 0; i < 20; i++) {
      expect(/[!@#$%^&*]/.test(generateUCI())).toBe(true);
    }
  });

  it('generates distinct values on consecutive calls', () => {
    const set = new Set(Array.from({ length: 50 }, () => generateUCI()));
    expect(set.size).toBeGreaterThan(45);
  });
});

// ─── getRandomElement ────────────────────────────────────────────────────────

describe('getRandomElement', () => {
  it('returns an element that exists in the array', () => {
    const arr = [1, 2, 3, 4, 5];
    for (let i = 0; i < 20; i++) {
      expect(arr).toContain(getRandomElement(arr));
    }
  });

  it('works with string arrays', () => {
    const arr = ['a', 'b', 'c'];
    for (let i = 0; i < 10; i++) {
      expect(arr).toContain(getRandomElement(arr));
    }
  });

  it('returns the only element when array has one item', () => {
    expect(getRandomElement(['only'])).toBe('only');
  });
});

// ─── generateSmartHeuristicSummary ───────────────────────────────────────────

function makeMessage(sender: 'user' | 'ai', text: string): Message {
  return { id: '1', text, sender, timestamp: new Date() };
}

describe('generateSmartHeuristicSummary', () => {
  it('returns fallback string when history is empty', () => {
    expect(generateSmartHeuristicSummary([])).toBe('Initialized default sandbox environment');
  });

  it('returns fallback string when history has only AI messages', () => {
    const history = [makeMessage('ai', 'Hello!')];
    expect(generateSmartHeuristicSummary(history)).toBe('Initialized default sandbox environment');
  });

  it('classifies build/create messages as completed milestones', () => {
    const history = [makeMessage('user', 'Build me a todo app')];
    const summary = generateSmartHeuristicSummary(history);
    expect(summary).toContain('Completed Milestones');
    expect(summary).toContain('Feature build');
  });

  it('classifies fix/bug messages as debugging sessions', () => {
    const history = [makeMessage('user', 'Fix the bug in the login page')];
    const summary = generateSmartHeuristicSummary(history);
    expect(summary).toContain('Debugging session');
  });

  it('classifies unrecognized messages as pending items', () => {
    const history = [makeMessage('user', 'What is React?')];
    const summary = generateSmartHeuristicSummary(history);
    expect(summary).toContain('Pending Actions');
    expect(summary).toContain('Pending item');
  });

  it('includes WORKSPACE MEMORY header', () => {
    const history = [makeMessage('user', 'Banao ek app')];
    expect(generateSmartHeuristicSummary(history)).toContain('WORKSPACE MEMORY');
  });
});

// ─── extractCode ──────────────────────────────────────────────────────────────

describe('extractCode', () => {
  it('returns null when no code block is present', () => {
    expect(extractCode('Just a plain text response')).toBeNull();
  });

  it('extracts HTML from a markdown html code block', () => {
    const text = '```html\n<html><head></head><body>hello</body></html>\n```';
    const result = extractCode(text);
    expect(result).not.toBeNull();
    expect(result).toContain('<html>');
  });

  it('injects error tracker into html with </head>', () => {
    const text = '```html\n<html><head></head><body>hi</body></html>\n```';
    const result = extractCode(text);
    expect(result).toContain('SANDBOX_ERROR');
  });

  it('injects viewport meta when not already present', () => {
    const text = '```html\n<html><head></head><body></body></html>\n```';
    const result = extractCode(text);
    expect(result).toContain('viewport');
  });

  it('does not double-inject viewport when already present', () => {
    const html = '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body></body></html>';
    const text = '```html\n' + html + '\n```';
    const result = extractCode(text) ?? '';
    const matches = result.match(/viewport/g) || [];
    expect(matches.length).toBe(1);
  });

  it('returns empty string when only JS block present (no HTML — js-only is not wrapped)', () => {
    const text = '```js\nconsole.log("hi")\n```';
    const result = extractCode(text);
    expect(result).toBe('');
  });
});

// ─── classifyBuildIntent ─────────────────────────────────────────────────────

describe('classifyBuildIntent', () => {
  it('returns "chat" for a simple greeting', () => {
    expect(classifyBuildIntent('hi')).toBe('chat');
    expect(classifyBuildIntent('hello!')).toBe('chat');
    expect(classifyBuildIntent('namaste')).toBe('chat');
  });

  it('returns "chat" for "thanks"', () => {
    expect(classifyBuildIntent('thanks')).toBe('chat');
  });

  it('returns "build" when message contains "app"', () => {
    expect(classifyBuildIntent('I want to build an app')).toBe('build');
  });

  it('returns "build" for "banao" keyword', () => {
    expect(classifyBuildIntent('ek todo app banao')).toBe('build');
  });

  it('returns "build" for "calculator" keyword', () => {
    expect(classifyBuildIntent('make a calculator')).toBe('build');
  });

  it('returns "chat" for a short question', () => {
    expect(classifyBuildIntent('what is React?')).toBe('chat');
    expect(classifyBuildIntent('kya hai React?')).toBe('chat');
  });

  it('returns "build" when no special pattern matches (default)', () => {
    expect(classifyBuildIntent('create a todo list for me please definitely yes')).toBe('build');
  });
});

// ─── classifyAutoIntent ──────────────────────────────────────────────────────

describe('classifyAutoIntent', () => {
  const noHistory: Message[] = [];

  it('returns "chat" for explicit no-build signal', () => {
    expect(classifyAutoIntent('no code', noHistory)).toBe('chat');
    expect(classifyAutoIntent('sirf bata', noHistory)).toBe('chat');
    expect(classifyAutoIntent('bas batao', noHistory)).toBe('chat');
  });

  it('returns "chat" for a pure question without a build verb', () => {
    expect(classifyAutoIntent('what is React?', noHistory)).toBe('chat');
    expect(classifyAutoIntent('kya hai zustand?', noHistory)).toBe('chat');
  });

  it('returns "chat" when no build verb and no app noun', () => {
    expect(classifyAutoIntent('nice weather today', noHistory)).toBe('chat');
  });

  it('returns "direct_build" when AI just asked "shall I build?" and user confirms', () => {
    const history: Message[] = [
      makeMessage('ai', 'Shall I build a todo app for you?'),
    ];
    expect(classifyAutoIntent('yes', history)).toBe('direct_build');
    expect(classifyAutoIntent('haan', history)).toBe('direct_build');
  });

  it('returns "clarify" for a short noun phrase without a build verb', () => {
    expect(classifyAutoIntent('a calculator', noHistory)).toBe('clarify');
  });

  it('returns "plan_build" for a complex build request', () => {
    const complex = 'Build me an app with auth, login, database, dark mode and payment support';
    expect(classifyAutoIntent(complex, noHistory)).toBe('plan_build');
  });

  it('returns "direct_build" for a simple build request', () => {
    expect(classifyAutoIntent('build a todo app', noHistory)).toBe('direct_build');
  });
});

// ─── dedupAndSortMessages ────────────────────────────────────────────────────

describe('dedupAndSortMessages', () => {
  const mk = (id: string, ts: string, text = ''): Message =>
    ({ id, text, sender: 'user', timestamp: ts } as unknown as Message);

  it('removes duplicate ids (last write wins)', () => {
    const result = dedupAndSortMessages([
      mk('1', '2024-01-01T00:00:00Z', 'old'),
      mk('1', '2024-01-01T00:00:00Z', 'new'),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('new');
  });

  it('sorts by ascending timestamp', () => {
    const result = dedupAndSortMessages([
      mk('b', '2024-01-03T00:00:00Z'),
      mk('a', '2024-01-01T00:00:00Z'),
      mk('c', '2024-01-02T00:00:00Z'),
    ]);
    expect(result.map(m => m.id)).toEqual(['a', 'c', 'b']);
  });

  it('skips messages without an id', () => {
    const result = dedupAndSortMessages([
      mk('1', '2024-01-01T00:00:00Z'),
      { text: 'no id', sender: 'ai', timestamp: '2024-01-02T00:00:00Z' } as unknown as Message,
    ]);
    expect(result).toHaveLength(1);
  });

  it('returns an empty array for empty input', () => {
    expect(dedupAndSortMessages([])).toEqual([]);
  });
});
