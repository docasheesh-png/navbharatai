import { describe, it, expect } from 'vitest';
import { compactForBudget, recentlyTouchedPaths, roughTokens, tokenCompactConfig, withWorkingSet, workingSetBlock } from './contextBudget';
import { compactTranscriptForModel } from '../SessionTimeline';

function toolTurn(i: number, size: number): unknown[] {
  return [
    { role: 'assistant', content: [{ type: 'tool_use', id: `t${i}`, name: 'read_file', input: { path: `f${i}.ts` } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: 'x'.repeat(size) }] },
  ];
}

describe('compactForBudget (AGENTV3_TOKEN_COMPACT)', () => {
  const cfg = { windowTokens: 128_000, triggerPct: 50, keepRecent: 12, maxChars: 6_000 };

  it('defaults: 128k window, 50% trigger, keep 12, 6000 chars', () => {
    expect(tokenCompactConfig({})).toEqual(cfg);
  });

  it('under budget the transcript goes out VERBATIM (the old code trimmed message 7+ to 2,000 chars)', () => {
    const msgs = [{ role: 'user', content: 'build' }];
    for (let i = 0; i < 10; i++) msgs.push(...(toolTurn(i, 5_000) as typeof msgs));
    const r = compactForBudget(msgs, 10_000, compactTranscriptForModel, cfg);
    expect(r.level).toBe('none');
    expect(r.messages).toBe(msgs);
    // The old count-based compaction would have cut the early results:
    expect(compactTranscriptForModel(msgs, { keepRecentMessages: 6, maxOldToolResultChars: 2_000 })).not.toBe(msgs);
  });

  it('over budget it compacts gently first, then tightly', () => {
    const msgs: unknown[] = [{ role: 'user', content: 'build' }];
    for (let i = 0; i < 40; i++) msgs.push(...toolTurn(i, 20_000));
    const r = compactForBudget(msgs, 10_000, compactTranscriptForModel, cfg);
    expect(r.level === 'gentle' || r.level === 'tight').toBe(true);
    expect(r.tokensAfter).toBeLessThan(r.tokensBefore);
  });

  it('roughTokens counts tool_use input and tool_result strings', () => {
    expect(roughTokens([{ role: 'user', content: [{ type: 'tool_result', content: 'x'.repeat(400) }] }])).toBeGreaterThanOrEqual(100);
  });
});

describe('working set (AGENTV3_WORKING_SET)', () => {
  const transcript = [
    { role: 'user', content: 'build' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'write_file', input: { path: 'src/a.ts', content: '1' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'ok' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'b', name: 'edit_file', input: { path: 'src/b.ts' } }, { type: 'tool_use', id: 'c', name: 'write_files_batch', input: { files: [{ path: 'src/c.ts' }] } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b', content: 'ok' }, { type: 'tool_result', tool_use_id: 'c', content: 'ok' }] },
  ];

  it('finds touched files most-recent first', () => {
    expect(recentlyTouchedPaths(transcript, 5)).toEqual(['src/c.ts', 'src/b.ts', 'src/a.ts']);
  });

  it('appends the block to the LAST user turn without mutating the stored transcript', () => {
    const block = workingSetBlock([{ path: 'src/a.ts', content: 'export const a = 1;\n' }]);
    expect(block).toContain('src/a.ts');
    const out = withWorkingSet(transcript, block);
    expect(out).not.toBe(transcript);
    expect((transcript[4].content as unknown[]).length).toBe(2);
    const last = out[out.length - 1] as { content: Array<{ type: string; text?: string }> };
    expect(last.content[last.content.length - 1].text).toContain('WORKING SET');
  });

  it('respects the per-file cap and is empty with no files', () => {
    expect(workingSetBlock([])).toBe('');
    const b = workingSetBlock([{ path: 'big.ts', content: 'y'.repeat(50_000) }], { files: 4, maxCharsPerFile: 1_000, maxTotalChars: 32_000 });
    expect(b.length).toBeLessThan(2_000);
  });
});
