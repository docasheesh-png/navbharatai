import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ selected: vi.fn(), vision: vi.fn(), legacy: vi.fn() }));
vi.mock('./runtime', async (original) => ({ ...await original<typeof import('./runtime')>(), isGatewayRouteSelected: m.selected, maybeGatewayVision: m.vision }));
vi.mock('../inferencePolicy', () => ({ assertLegacyInferenceAllowed: m.legacy }));
import { describeVisionAttachments } from '../../lib/visionDescribe';
import { runVisionChain } from '../../lib/visionChain';
import { InferenceGatewayTerminalError } from './runtime';
beforeEach(() => { vi.clearAllMocks(); m.selected.mockReturnValue(true); m.vision.mockResolvedValue({ ok: true, content: 'reviewed result', provider: 'GLM' }); });
afterEach(() => vi.restoreAllMocks());
describe('selected Free vision caller', () => {
    it('passes exact media to the claimed adapter and never opens legacy', async () => {
        const result = await runVisionChain([{ name: 'photo', type: 'image/png', base64: 'unchanged' }], { prompt: 'describe', systemPrompt: 'rules', allowClaude: false });
        expect(result).toEqual({ text: 'reviewed result', provider: 'GLM' });
        expect(m.vision).toHaveBeenCalledWith({ kind: 'vision-pdf', prompt: 'describe', systemPrompt: 'rules', attachments: [{ mimeType: 'image/png', data: 'unchanged' }], streaming: false });
        expect(m.legacy).not.toHaveBeenCalled();
    });
    it.each([null, { ok: false, content: '', provider: 'GLM' }, { ok: true, content: 'unreviewed', provider: 'GROK' }])('does not fall back after unavailable selected result %j', async (value) => { m.vision.mockResolvedValue(value); await expect(runVisionChain([{ name: 'a', type: 'image/png', base64: 'x' }], { prompt: 'p', allowClaude: false })).rejects.toBeInstanceOf(InferenceGatewayTerminalError); expect(m.legacy).not.toHaveBeenCalled(); });
    it('keeps refusal terminal', async () => { m.vision.mockRejectedValue(new InferenceGatewayTerminalError('refusal')); await expect(runVisionChain([{ name: 'a', type: 'image/png', base64: 'x' }], { prompt: 'p', allowClaude: false })).rejects.toThrow(); expect(m.legacy).not.toHaveBeenCalled(); });
    it.each(['image/webp', 'image/svg+xml', 'video/mp4'])('does not silently drop unsupported %s', async (type) => { await expect(runVisionChain([{ name: 'a', type, base64: 'x' }], { prompt: 'p', allowClaude: false })).rejects.toThrow(); expect(m.vision).not.toHaveBeenCalled(); expect(m.legacy).not.toHaveBeenCalled(); });
    it('rejects a paid-universe mismatch rather than moving its payer', async () => { await expect(runVisionChain([{ name: 'a', type: 'image/png', base64: 'x' }], { prompt: 'p', allowClaude: true })).rejects.toThrow(); expect(m.vision).not.toHaveBeenCalled(); });
    it('does not add gateway work outside selected context', async () => { m.selected.mockReturnValue(false); m.legacy.mockImplementation(() => { throw Error('legacy boundary reached'); }); await expect(runVisionChain([{ name: 'a', type: 'image/png', base64: 'x' }], { prompt: 'p', allowClaude: true })).rejects.toThrow('legacy boundary reached'); expect(m.vision).not.toHaveBeenCalled(); });
});
it('describes selected professional attachments with the original expert instruction and labels', async () => {
    const result = await describeVisionAttachments([{ name: 'report.pdf', type: 'application/pdf', base64: 'unchanged' }], { noClaude: true, instruction: 'Read for this expert' });
    expect(m.vision).toHaveBeenCalledWith({ kind: 'vision-pdf', prompt: 'Read for this expert', attachments: [{ mimeType: 'application/pdf', data: 'unchanged' }], streaming: false });
    expect(result).toBe('[PDF: report.pdf]\nreviewed result');
    expect(m.legacy).not.toHaveBeenCalled();
});
it('does not hide selected professional vision refusal behind an unreadable-file placeholder', async () => {
    m.vision.mockRejectedValue(new InferenceGatewayTerminalError('refusal'));
    await expect(describeVisionAttachments([{ name: 'photo', type: 'image/png', base64: 'x' }], { noClaude: true })).rejects.toThrow();
    expect(m.legacy).not.toHaveBeenCalled();
});

it('preserves selected vision accounting identity without inventing prices', async () => {
    const marker = { version: 1, logicalRequestId: 'vision-child', accounting: 'separate-ledger' };
    const result = { ok: true, content: 'read', provider: 'GEMINI', model: 'gemini-2.5-flash', usage: { inputTokens: 100, outputTokens: 20 }, inferenceGateway: marker };
    m.vision.mockResolvedValue(result);
    const response = await runVisionChain([{ name: 'a', type: 'application/pdf', base64: 'x' }], { prompt: 'p', allowClaude: false });
    expect(response).toMatchObject({ model: result.model, usage: result.usage, inferenceGateway: marker });
    expect(response?.gatewayPricingProof).toBeUndefined();
    const report = vi.fn();
    await describeVisionAttachments([{ name: 'a', type: 'application/pdf', base64: 'x' }], { onGatewayResult: report });
    expect(report).toHaveBeenCalledWith(result);
});
