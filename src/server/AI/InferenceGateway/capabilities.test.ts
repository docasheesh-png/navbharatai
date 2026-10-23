import { describe, expect, it } from 'vitest';
import { isCapabilityRequestValid, supportsCapability } from './capabilities';
import { evidenceBinding, hasCurrentEvidence, quotaLedgerKey } from './profiles';
import type { CapabilityRequest, CapabilitySupport, EvidenceRecord } from './types';

const request: CapabilityRequest = { kind: 'text', inputTokens: 80, outputTokens: 20, streaming: true, systemPrompt: true };
const support: CapabilitySupport = { kind: 'text', maxInputTokens: 80, maxOutputTokens: 20, maxContextTokens: 100, streaming: true, systemPrompt: true };
const tool: CapabilityRequest = { ...request, kind: 'tool-json', features: ['tool-calls', 'strict-json-schema'], schemaDialect: 'exact-dialect' };
const toolSupport: CapabilitySupport = { ...support, kind: 'tool-json', features: ['tool-calls', 'strict-json-schema'], schemaDialects: ['exact-dialect'] };
const vision: CapabilityRequest = { ...request, kind: 'vision-pdf', formats: ['application/pdf'], imageCount: 0, pdfPages: 10 };
const visionSupport: CapabilitySupport = { ...support, kind: 'vision-pdf', formats: ['application/pdf'], maxImages: 0, maxPdfPages: 10 };

describe('exact capability ceilings', () => {
  it('accepts exact input/output/combined context limits', () => expect(supportsCapability(request, support)).toBe(true));
  it.each(['inputTokens', 'outputTokens'] as const)('rejects one token above %s', field => {
    expect(supportsCapability({ ...request, [field]: request[field] + 1 }, support)).toBe(false);
  });
  it('counts output toward the verified combined context ceiling', () => {
    expect(supportsCapability(request, { ...support, maxContextTokens: 99 })).toBe(false);
  });
  it.each(['streaming', 'systemPrompt'] as const)('does not silently drop %s requirements', field => {
    expect(supportsCapability(request, { ...support, [field]: false })).toBe(false);
  });
  it.each([NaN, Infinity, -1, 0, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid request token bound %s', inputTokens => {
    expect(isCapabilityRequestValid({ ...request, inputTokens })).toBe(false);
  });
  it('rejects safe integers whose sum overflows', () => {
    expect(isCapabilityRequestValid({ ...request, inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1 })).toBe(false);
  });
  it.each([NaN, Infinity, -1, 0, 1.5])('does not infer an unknown model token capacity %s', maxContextTokens => {
    expect(supportsCapability(request, { ...support, maxContextTokens })).toBe(false);
  });
  it('matches the exact schema dialect and all required tool features', () => {
    expect(supportsCapability(tool, toolSupport)).toBe(true);
    expect(supportsCapability(tool, { ...toolSupport, schemaDialects: ['other-dialect'] })).toBe(false);
    expect(supportsCapability(tool, { ...toolSupport, features: ['tool-calls'] })).toBe(false);
  });
  it('parallel tools cannot be declared without tool-calls', () => {
    expect(isCapabilityRequestValid({ ...tool, features: ['parallel-tool-calls'] })).toBe(false);
    expect(supportsCapability({ ...tool, features: ['tool-calls', 'parallel-tool-calls'] }, toolSupport)).toBe(false);
  });
  it('rejects unsupported/duplicated tool requirements', () => {
    expect(isCapabilityRequestValid({ ...tool, features: ['tool-calls', 'tool-calls'] })).toBe(false);
    expect(isCapabilityRequestValid({ ...tool, features: ['invented'] } as unknown as CapabilityRequest)).toBe(false);
  });
  it('requires explicit PDF support and a verified page ceiling', () => {
    expect(supportsCapability(vision, visionSupport)).toBe(true);
    expect(supportsCapability({ ...vision, pdfPages: 11 }, visionSupport)).toBe(false);
    expect(supportsCapability(vision, { ...visionSupport, formats: ['image/png'] })).toBe(false);
  });
  it('does not silently treat attachments as text', () => {
    expect(isCapabilityRequestValid({ ...vision, formats: ['image/png'] })).toBe(false);
    expect(isCapabilityRequestValid({ ...vision, pdfPages: 0 })).toBe(false);
    expect(isCapabilityRequestValid({ ...vision, imageCount: 1 })).toBe(false);
  });
  it('embedding dimensions and model/preprocessing space must both be exact', () => {
    const r: CapabilityRequest = { kind: 'embedding', inputTokens: 80, dimensions: 64, vectorSpaceId: 'model-a:preprocess-v1' };
    const s: CapabilitySupport = { kind: 'embedding', maxInputTokens: 80, dimensions: 64, vectorSpaceId: 'model-a:preprocess-v1' };
    expect(supportsCapability(r, s)).toBe(true);
    expect(supportsCapability(r, { ...s, dimensions: 128 })).toBe(false);
    expect(supportsCapability(r, { ...s, vectorSpaceId: 'model-b:preprocess-v1' })).toBe(false);
    expect(supportsCapability(r, { ...s, vectorSpaceId: 'model-a:preprocess-v2' })).toBe(false);
    expect(supportsCapability(r, { ...s, maxInputTokens: 79 })).toBe(false);
  });
  it('voice requires its exact formats, duplex/interruption behavior and session duration', () => {
    const r: CapabilityRequest = { kind: 'voice-session', inputFormat: 'fixture-in', outputFormat: 'fixture-out',
      bidirectional: true, interruption: true, maxDurationMs: 300_000 };
    const s: CapabilitySupport = { kind: 'voice-session', inputFormats: ['fixture-in'], outputFormats: ['fixture-out'],
      bidirectional: true, interruption: true, maxDurationMs: 300_000 };
    expect(supportsCapability(r, s)).toBe(true);
    for (const unsupported of [{ ...s, inputFormats: ['different'] }, { ...s, outputFormats: ['different'] },
      { ...s, bidirectional: false }, { ...s, interruption: false }, { ...s, maxDurationMs: 299_999 }]) {
      expect(supportsCapability(r, unsupported)).toBe(false);
    }
  });
  it('grounding requires verified result/query bounds and requested citation/domain features', () => {
    const r: CapabilityRequest = { kind: 'grounding-search', queries: 2, maxResults: 10, citations: true, domainFiltering: true };
    const s: CapabilitySupport = { kind: 'grounding-search', maxQueries: 2, maxResults: 10, citations: true, domainFiltering: true };
    expect(supportsCapability(r, s)).toBe(true);
    for (const unsupported of [{ ...s, maxQueries: 1 }, { ...s, maxResults: 9 }, { ...s, citations: false }, { ...s, domainFiltering: false }]) {
      expect(supportsCapability(r, unsupported)).toBe(false);
    }
  });
  it('unknown capability families are never assumed text-compatible', () => {
    expect(isCapabilityRequestValid({ kind: 'unknown' } as unknown as CapabilityRequest)).toBe(false);
    expect(supportsCapability(request, { kind: 'unknown' } as unknown as CapabilitySupport)).toBe(false);
  });
});

describe('server evidence and quota identity primitives', () => {
  it('canonicalizes field order but preserves array order and exact values', () => {
    expect(evidenceBinding({ b: 2, a: 1 })).toBe(evidenceBinding({ a: 1, b: 2 }));
    expect(evidenceBinding([1, 2])).not.toBe(evidenceBinding([2, 1]));
    expect(evidenceBinding({ a: 1 })).not.toBe(evidenceBinding({ a: '1' }));
  });
  it.each([undefined, NaN, Infinity, new Date(0), () => 1])('rejects non-canonical evidence subject %s', value => {
    expect(() => evidenceBinding(value)).toThrow();
  });
  it('rejects cyclic objects, while allowing repeated equal subobjects', () => {
    const circular: { self?: unknown } = {}; circular.self = circular;
    expect(() => evidenceBinding(circular)).toThrow();
    const repeated = { n: 1 }; expect(evidenceBinding([repeated, repeated])).toBe('[{"n":1},{"n":1}]');
  });
  it('a plausible binding cannot authorize itself without the trusted server resolver', () => {
    const subject = { model: 'fixture' }; const record: EvidenceRecord = { kind: 'profile', binding: evidenceBinding(subject),
      issuedAtMs: 1, expiresAtMs: 100, revoked: false };
    expect(hasCurrentEvidence({ lookup: () => undefined }, 'ref', 'profile', subject, 50)).toBe(false);
    expect(hasCurrentEvidence({ lookup: () => record }, 'ref', 'profile', subject, 50)).toBe(true);
    expect(hasCurrentEvidence({ lookup: () => record }, 'ref', 'profile', subject, 100)).toBe(false);
  });
  it('quota keys are unambiguous and distinguish provider, actual scope and meter', () => {
    const d = { scope: { providerId: 'fixture', kind: 'organization' as const, id: 'account:a' }, meter: 'requests/day' };
    expect(quotaLedgerKey(d)).not.toBe(quotaLedgerKey({ ...d, scope: { ...d.scope, providerId: 'other' } }));
    expect(quotaLedgerKey(d)).not.toBe(quotaLedgerKey({ ...d, scope: { ...d.scope, kind: 'project' } }));
    expect(quotaLedgerKey(d)).not.toBe(quotaLedgerKey({ ...d, meter: 'tokens/day' }));
  });
});
