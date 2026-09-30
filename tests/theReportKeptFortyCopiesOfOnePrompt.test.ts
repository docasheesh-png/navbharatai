// Autopsy a5b661c8, the open item (2026-09-30): the stored build report kept 40 of 151 model calls,
// and every one of the forty carried the same first 800 characters of the system prompt.
//
// So the report could not say what any call was asked, it could not say what happened between
// 12:16 and 12:20, and it could not prove where one broken import came from. Two caps did it: the
// recorder cut the whole preview at 2,000 characters (always inside a long system prompt, so the
// separator and the turn's own message never survived), and the store cut again at 800.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { capPromptPreview, compactPromptPreviews, PROMPT_PREVIEW_SEPARATOR, SAME_SYSTEM_HEAD } from '../src/server/AgentV3/promptPreviewShape';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import {
  trimReportForStorage, fitReportForStorage, storedLlmCallsCap,
  STORED_LLM_CALLS_MIN, STORED_LLM_CALLS_MAX, LLM_CALLS_STORAGE_BYTES,
} from '../src/server/AgentV3/DiagnosticsStore';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

// The architect's system prompt is tens of thousands of characters; AgentRunner sends a 4,000-char head.
const SYSTEM = 'You are the NavBharatAI architect. ' + 'Rules and contracts. '.repeat(400);
const preview = (asked: string) => `${SYSTEM.slice(0, 4000)}${PROMPT_PREVIEW_SEPARATOR}${asked}`;
const call = (i: number, asked = `tool_result for step ${i}: wrote src/steps/Step${i}.tsx`) => ({
  model: 'glm-4.7-flashx', provider: 'GLM', ok: true, inputTokens: 37000, outputTokens: 900, latencyMs: 8000,
  promptPreview: preview(asked), promptChars: 46000, responsePreview: `reply ${i} `.repeat(120), responseChars: 1500,
  finishReason: 'tool_use', toolCalls: 1,
});

describe('the recorder keeps what the call was ASKED', () => {
  it('a long system prompt can no longer push the turn\'s own message out', () => {
    const d = new BuildDiagnostics({ now: () => 1 });
    d.recordLlmCall(call(1, 'tool_result: CollectionTheme is not exported from ./theme'));
    const kept = d.report().llmCalls![0].promptPreview!;
    expect(kept).toContain('CollectionTheme is not exported from ./theme');
    expect(kept.length).toBeLessThan(2200);
  });

  it('each half is capped on its own; a preview with no separator gets both allowances', () => {
    const out = capPromptPreview(`${'s'.repeat(5000)}${PROMPT_PREVIEW_SEPARATOR}${'m'.repeat(5000)}`, 100, 200);
    const [sys, msg] = out.split(PROMPT_PREVIEW_SEPARATOR);
    expect(sys.startsWith('s'.repeat(100) + '…[')).toBe(true);
    expect(msg.startsWith('m'.repeat(200) + '…[')).toBe(true);
    expect(capPromptPreview('x'.repeat(250), 100, 200)).toBe('x'.repeat(250));
  });
});

describe('a system head repeated from the call above is said once', () => {
  it('the second of two identical heads becomes the marker; the message stays', () => {
    const [a, b] = compactPromptPreviews([call(1), call(2)], 500, 700);
    expect(a.promptPreview!.startsWith('You are the NavBharatAI architect.')).toBe(true);
    expect(b.promptPreview!.startsWith(SAME_SYSTEM_HEAD + PROMPT_PREVIEW_SEPARATOR)).toBe(true);
    expect(b.promptPreview).toContain('wrote src/steps/Step2.tsx');
  });

  it('a different head is written out in full', () => {
    const other = { ...call(2), promptPreview: `You are the reviewer.${PROMPT_PREVIEW_SEPARATOR}review this` };
    const [, b] = compactPromptPreviews([call(1), other], 500, 700);
    expect(b.promptPreview!.startsWith('You are the reviewer.')).toBe(true);
  });

  it('the marker never points past a gap: the store marks AFTER taking its window', () => {
    const d = new BuildDiagnostics({ now: () => 1 });
    for (let i = 1; i <= 300; i++) d.recordLlmCall(call(i));
    const stored = trimReportForStorage(d.report(), { llmCallsCap: 40 }).llmCalls!;
    expect(stored[0].promptPreview!.startsWith('You are the NavBharatAI architect.')).toBe(true);
    expect(stored[20].promptPreview!.startsWith(SAME_SYSTEM_HEAD)).toBe(true); // first of the tail, previous is stored[19]
  });
});

describe('the number of stored calls follows a byte budget, not a fixed forty', () => {
  it('a real-shaped build keeps far more than forty, inside its allowance', () => {
    const calls = Array.from({ length: 151 }, (_, i) => call(i + 1));
    const cap = storedLlmCallsCap(calls);
    expect(cap).toBeGreaterThanOrEqual(100);
    const d = new BuildDiagnostics({ now: () => 1 });
    calls.forEach((c) => d.recordLlmCall(c));
    const stored = trimReportForStorage(d.report()).llmCalls!;
    expect(stored.length).toBe(Math.min(151, cap));
    expect(Buffer.byteLength(JSON.stringify(stored), 'utf8')).toBeLessThanOrEqual(LLM_CALLS_STORAGE_BYTES * 1.05);
  });

  it('never fewer than the old forty, never more than the recorder keeps', () => {
    const calls = Array.from({ length: 300 }, (_, i) => call(i));
    expect(storedLlmCallsCap(calls, 10_000)).toBe(STORED_LLM_CALLS_MIN); // a tiny budget still keeps forty
    expect(storedLlmCallsCap([{ promptPreview: 'a', responsePreview: 'b' }])).toBe(STORED_LLM_CALLS_MAX);
    expect(storedLlmCallsCap(undefined)).toBe(STORED_LLM_CALLS_MIN);
  });
});

describe('a report too big for the document gives back the calls before anything else', () => {
  const report = () => {
    const d = new BuildDiagnostics({ now: () => 1 });
    for (let i = 1; i <= 200; i++) d.recordLlmCall(call(i));
    for (let i = 0; i < 40; i++) d.recordCommand?.({ command: `npm run build #${i}`, exitCode: 0, stdout: 'o'.repeat(1400), stderr: '' } as never);
    return d.report();
  };

  it('over the limit it keeps forty calls AND its commands, rather than dropping both', () => {
    const full = trimReportForStorage(report());
    const min = trimReportForStorage(report(), { llmCallsCap: STORED_LLM_CALLS_MIN });
    const limit = Math.floor((Buffer.byteLength(JSON.stringify(full)) + Buffer.byteLength(JSON.stringify(min))) / 2);
    const fitted = fitReportForStorage(report(), limit);
    expect(fitted.llmCalls).toHaveLength(STORED_LLM_CALLS_MIN);
    expect(fitted.commands?.length ?? 0).toBe(min.commands?.length ?? 0);
    expect(fitted.truncation?.channels?.llmCalls).toMatchObject({ kept: STORED_LLM_CALLS_MIN, total: 200 });
  });

  it('under the limit nothing is given back', () => {
    expect(fitReportForStorage(report()).llmCalls!.length).toBeGreaterThan(STORED_LLM_CALLS_MIN);
  });
});

describe('every durable copy goes through the one fit (source guards)', () => {
  it('the admin record fits its focused build, and earlier builds keep the old forty', () => {
    const s = read('src/server/AgentV3/AdminBuildReportStore.ts');
    expect(s).toContain('const trimmed = fitReportForStorage(report);');
    expect(s).toContain('trimReportForStorage(b, { llmCallsCap: STORED_LLM_CALLS_MIN })');
  });

  it('AgentRunner builds its preview with the separator the reader splits on', () => {
    expect(read('src/server/AgentV3/AgentRunner.ts')).toContain('const SEPARATOR = PROMPT_PREVIEW_SEPARATOR;');
  });
});
