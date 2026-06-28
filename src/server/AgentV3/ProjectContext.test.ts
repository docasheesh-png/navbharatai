import { describe, it, expect } from 'vitest';
import { buildProjectContext, extractConversationSummary, buildRunningSummary, formatPlanState } from './ProjectContext';

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

describe('buildRunningSummary — rolling memory so long sessions never drop early context', () => {
  it('returns a plain recap when the session is short (≤ recentTurns)', () => {
    const messages = [
      { role: 'user', content: 'build a calculator' },
      { role: 'assistant', content: 'Done.' },
    ];
    const s = buildRunningSummary(messages, { recentTurns: 8 });
    expect(s).toBe(extractConversationSummary(messages, 8));
    expect(s).not.toContain('Earlier in this session'); // no digest needed
  });

  it('condenses everything before the recent window AND keeps recent turns verbatim', () => {
    const messages = [
      { role: 'user', content: 'build a fitness tracker app' },           // earliest ask — must survive
      { role: 'assistant', content: [{ type: 'text', text: 'Scaffolding.' }, { type: 'tool_use', name: 'write_file', input: {} }] },
      ...Array.from({ length: 10 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `chatter ${i}` })),
      { role: 'user', content: 'now add a dark mode toggle' },            // recent — verbatim
      { role: 'assistant', content: 'Added dark mode.' },
    ];
    const s = buildRunningSummary(messages, { recentTurns: 4 });
    expect(s).toContain('Earlier in this session');
    expect(s).toContain('build a fitness tracker app');   // early ask preserved in the digest
    expect(s).toContain('Actions taken earlier: write_file');
    expect(s).toContain('Most recent turns');
    expect(s).toContain('now add a dark mode toggle');    // recent kept verbatim
    expect(s).toContain('Added dark mode.');
  });

  it('returns "" for an empty transcript', () => {
    expect(buildRunningSummary([], { recentTurns: 8 })).toBe('');
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

  it('carries over the last plan so a follow-up CONTINUES instead of resetting to 0/N', () => {
    const lastPlan = formatPlanState([
      { title: 'Scaffold the app', status: 'done' },
      { title: 'Build the timer UI', status: 'in_progress' },
      { title: 'Wire localStorage', status: 'pending' },
    ]);
    const ctx = buildProjectContext({ files: ['src/App.tsx'], lastPlan });
    expect(ctx).toContain('plan you were working through');
    expect(ctx).toContain('Build the timer UI');
    expect(ctx).toContain('CONTINUE the unfinished items');
    expect(ctx).toContain('✓'); // done marker rendered
    expect(ctx).toContain('⋯'); // in-progress marker rendered
  });

  it('renders a plan even when there are no files yet (plan alone is non-empty)', () => {
    const ctx = buildProjectContext({ files: [], lastPlan: formatPlanState([{ title: 'Do the thing', status: 'pending' }]) });
    expect(ctx).toContain('Do the thing');
  });
});

describe('formatPlanState — durable, compact plan status for carry-over', () => {
  it('renders each todo with a status marker and label', () => {
    const s = formatPlanState([
      { title: 'A', status: 'done' },
      { title: 'B', status: 'in_progress' },
      { title: 'C', status: 'blocked' },
      { title: 'D', status: 'pending' },
    ]);
    expect(s).toContain('✓ A [done]');
    expect(s).toContain('⋯ B [in_progress]');
    expect(s).toContain('✗ C [blocked]');
    expect(s).toContain('○ D [pending]');
  });

  it('returns "" for an empty / malformed plan', () => {
    expect(formatPlanState([])).toBe('');
    expect(formatPlanState([{ status: 'done' } as unknown as { title: string }])).toBe('');
  });

  it('defaults an unknown status to the pending marker', () => {
    expect(formatPlanState([{ title: 'X', status: 'weird' }])).toContain('○ X [weird]');
  });

  it('caps at 20 items to stay compact', () => {
    const todos = Array.from({ length: 40 }, (_, i) => ({ title: `t${i}`, status: 'pending' }));
    const s = formatPlanState(todos);
    expect(s.split('\n')).toHaveLength(20);
  });
});
