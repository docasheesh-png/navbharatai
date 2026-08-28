import { describe, it, expect } from 'vitest';
import { buildProjectContext, extractConversationSummary, buildRunningSummary, formatPlanState, parsePlanState } from './ProjectContext';

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
    // Reworded 2026-08-28 (the Dino-hijack autopsy): memory now SUBMITS to the current request
    // instead of shouting "CONTINUING" unconditionally. The invariant kept: memory exists and leads.
    expect(ctx).toContain('PROJECT MEMORY');
    expect(ctx).toContain('CURRENT REQUEST below is your only task');
    expect(ctx).toContain('src/components/Calculator.tsx');
    expect(ctx).toContain('Components: Calculator, Display');
    expect(ctx).toContain('ek calculator banao');
    expect(ctx).toContain('Never ask "what would you like me to continue with"');
    // heavy dirs excluded
    expect(ctx).not.toContain('node_modules');
  });

  it('returns empty for a brand-new empty workspace', () => {
    expect(buildProjectContext({ files: [], recentRequests: [], projectMap: '' })).toBe('');
  });

  it('works with only a file list (no map / requests)', () => {
    const ctx = buildProjectContext({ files: ['index.html'] });
    expect(ctx).toContain('index.html');
    expect(ctx).toContain('PROJECT MEMORY');
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
    expect(ctx).toContain('PREVIOUS build’s plan');
    // …and the guard that ends the hijack class: a different request must drop the old plan.
    expect(ctx).toContain('IGNORE it completely');
    expect(ctx).toContain('Build the timer UI');
    expect(ctx).toContain('resume its unfinished items without resetting to 0');
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

describe('parsePlanState — restore a resumed session\'s plan from durable storage', () => {
  it('round-trips formatPlanState (titles + statuses survive)', () => {
    const todos = [
      { title: 'Create app structure', status: 'done' },
      { title: 'Build dashboard', status: 'in_progress' },
      { title: 'Build patients page', status: 'blocked' },
      { title: 'Build OPD queue', status: 'pending' },
    ];
    const parsed = parsePlanState(formatPlanState(todos));
    expect(parsed.map((t) => t.title)).toEqual(todos.map((t) => t.title));
    expect(parsed.map((t) => t.status)).toEqual(['done', 'in_progress', 'blocked', 'pending']);
    expect(parsed.every((t) => typeof t.id === 'string' && t.id.length > 0)).toBe(true);
  });

  it('tolerates the stored "PLAN_STATE\\n" note prefix', () => {
    const block = `PLAN_STATE\n${formatPlanState([{ title: 'Do X', status: 'done' }])}`;
    const parsed = parsePlanState(block);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ title: 'Do X', status: 'done' });
  });

  it('returns [] for empty / null / non-plan text', () => {
    expect(parsePlanState('')).toEqual([]);
    expect(parsePlanState(null)).toEqual([]);
    expect(parsePlanState('just some prose with no [brackets]')).toEqual([]);
  });

  it('coerces an unknown status to pending', () => {
    expect(parsePlanState('  ○ Something [weird]')[0].status).toBe('pending');
  });
});
