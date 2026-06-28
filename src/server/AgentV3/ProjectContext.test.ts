import { describe, it, expect } from 'vitest';
import { buildProjectContext, extractConversationSummary } from './ProjectContext';

describe('extractConversationSummary — recap prior turns so the model remembers', () => {
  it('summarizes user + assistant turns, notes tool calls, skips tool results', () => {
    const messages = [
      { role: 'user', content: 'build a calculator' },
      { role: 'assistant', content: [
        { type: 'text', text: 'Creating the Calculator component.' },
        { type: 'tool_use', name: 'write_file', input: {} },
      ] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] }, // skipped (no text)
      { role: 'assistant', content: 'Done — the calculator works.' },
    ];
    const s = extractConversationSummary(messages, 8);
    expect(s).toContain('User: build a calculator');
    expect(s).toContain('You: Creating the Calculator component. [called write_file]');
    expect(s).toContain('You: Done — the calculator works.');
  });

  it('keeps only the last maxTurns', () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({ role: 'user', content: `m${i}` }));
    const s = extractConversationSummary(messages, 3);
    expect(s.split('\n')).toHaveLength(3);
    expect(s).toContain('m19');
    expect(s).not.toContain('m0');
  });

  it('returns "" for empty / malformed input', () => {
    expect(extractConversationSummary([], 5)).toBe('');
    expect(extractConversationSummary([{ role: 'assistant', content: [] }, null as unknown], 5)).toBe('');
  });
});

describe('buildProjectContext — Claude-level memory for a follow-up build', () => {
  it('lists the existing files and tells the model to CONTINUE (no "what to continue")', () => {
    const ctx = buildProjectContext({
      files: ['src/components/Calculator.tsx', 'src/App.tsx', 'node_modules/react/index.js'],
      projectMap: 'Project memory: 9 files, 30 symbols.\nComponents: Calculator, Display',
      recentRequests: ['ek calculator banao'],
    });
    expect(ctx).toContain('CONTINUING an existing project');
    expect(ctx).toContain('src/components/Calculator.tsx');
    expect(ctx).toContain('Components: Calculator, Display');
    expect(ctx).toContain('ek calculator banao');
    expect(ctx).toContain('Do NOT ask "what would you like me to continue with"');
    // heavy dirs excluded
    expect(ctx).not.toContain('node_modules');
  });

  it('returns empty for a brand-new empty workspace', () => {
    expect(buildProjectContext({ files: [], recentRequests: [], projectMap: '' })).toBe('');
  });

  it('works with only a file list (no map / requests)', () => {
    const ctx = buildProjectContext({ files: ['index.html'] });
    expect(ctx).toContain('index.html');
    expect(ctx).toContain('CONTINUING');
  });

  it('caps files and requests so the context stays compact', () => {
    const files = Array.from({ length: 200 }, (_, i) => `src/f${i}.tsx`);
    const ctx = buildProjectContext({ files });
    expect((ctx.match(/src\/f\d+\.tsx/g) || []).length).toBe(60);
  });
});
