import { describe, it, expect } from 'vitest';
import { buildPromptAudit, savePromptAudit, loadPromptAudits } from '../src/server/AgentV3/PromptAuditStore';

/** P-PE.6 — Prompt audit trail: pure record builder + best-effort no-throw under VITEST. */

describe('buildPromptAudit', () => {
  it('normalises a full record and clamps the system-prompt prefix to 200 chars', () => {
    const rec = buildPromptAudit({
      ts: 1000,
      promptVersion: 'architect@3',
      intentLabel: 'new_build',
      model: 'claude-opus',
      taskType: 'complex_app',
      ok: true,
      systemPrompt: 'x'.repeat(500),
    });
    expect(rec.ts).toBe(1000);
    expect(rec.promptVersion).toBe('architect@3');
    expect(rec.intentLabel).toBe('new_build');
    expect(rec.ok).toBe(true);
    expect(rec.systemPromptPrefix.length).toBe(200);
  });
  it('defaults missing fields safely', () => {
    const rec = buildPromptAudit({ ts: 0 });
    expect(rec.ts).toBeGreaterThan(0);
    expect(rec.promptVersion).toBe('');
    expect(rec.intentLabel).toBe('unknown');
    expect(rec.taskType).toBe('unknown');
    expect(rec.ok).toBe(false);
    expect(rec.systemPromptPrefix).toBe('');
  });
});

describe('store (best-effort, no Firestore under VITEST)', () => {
  it('savePromptAudit never throws and loadPromptAudits returns []', async () => {
    const rec = buildPromptAudit({ ts: 1, promptVersion: 'v1', systemPrompt: 'hello' });
    await expect(savePromptAudit('user-1', rec)).resolves.toBeUndefined();
    await expect(savePromptAudit(null, rec)).resolves.toBeUndefined();
    await expect(loadPromptAudits('user-1')).resolves.toEqual([]);
    await expect(loadPromptAudits('')).resolves.toEqual([]);
  });
});
