import { describe, it, expect, vi } from 'vitest';
import { fixWithAiAfterDeepRefresh } from './previewDeepRefresh';

describe('fixWithAiAfterDeepRefresh', () => {
  it('recovers without sending to AI when the deep refresh makes the preview render', async () => {
    const onRecovered = vi.fn();
    const onNeedsAi = vi.fn();
    const deepRefresh = vi.fn().mockResolvedValue(true);

    const outcome = await fixWithAiAfterDeepRefresh({
      deepRefresh, onRecovered, onNeedsAi, errorText: 'boom',
    });

    expect(outcome).toBe('recovered');
    expect(deepRefresh).toHaveBeenCalledTimes(1);
    expect(onRecovered).toHaveBeenCalledTimes(1);
    expect(onNeedsAi).not.toHaveBeenCalled();
  });

  it('sends the original error to the AI when the deep refresh does NOT recover the preview', async () => {
    const onRecovered = vi.fn();
    const onNeedsAi = vi.fn();
    const deepRefresh = vi.fn().mockResolvedValue(false);

    const outcome = await fixWithAiAfterDeepRefresh({
      deepRefresh, onRecovered, onNeedsAi, errorText: 'Missing dependency react',
    });

    expect(outcome).toBe('sent-to-ai');
    expect(onRecovered).not.toHaveBeenCalled();
    expect(onNeedsAi).toHaveBeenCalledWith('Missing dependency react');
  });

  it('falls through to the AI (never swallows the fix) when the deep refresh itself throws', async () => {
    const onRecovered = vi.fn();
    const onNeedsAi = vi.fn();
    const deepRefresh = vi.fn().mockRejectedValue(new Error('network'));

    const outcome = await fixWithAiAfterDeepRefresh({
      deepRefresh, onRecovered, onNeedsAi, errorText: 'err',
    });

    expect(outcome).toBe('sent-to-ai');
    expect(onRecovered).not.toHaveBeenCalled();
    expect(onNeedsAi).toHaveBeenCalledWith('err');
  });

  it('always runs the deep refresh before deciding (free fix tried first)', async () => {
    const order: string[] = [];
    const deepRefresh = vi.fn(async () => { order.push('refresh'); return false; });
    const onNeedsAi = vi.fn(() => { order.push('ai'); });

    await fixWithAiAfterDeepRefresh({
      deepRefresh, onRecovered: vi.fn(), onNeedsAi, errorText: 'x',
    });

    expect(order).toEqual(['refresh', 'ai']);
  });
});
