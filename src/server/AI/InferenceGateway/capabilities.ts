import type { CapabilityRequest, CapabilitySupport, StructuredFeature, VisionFormat } from './types';

export const isCount = (n: number): boolean => Number.isSafeInteger(n) && n >= 0;
export const isPositiveCount = (n: number): boolean => isCount(n) && n > 0;
export const isIdentifier = (s: string): boolean => typeof s === 'string' && s.trim().length > 0 && s.length <= 256;
const structured: readonly StructuredFeature[] = ['tool-calls', 'strict-json-schema', 'parallel-tool-calls'];
const vision: readonly VisionFormat[] = ['image/png', 'image/jpeg', 'application/pdf'];
const flag = (b: boolean): boolean => typeof b === 'boolean';
const strings = (values: readonly string[]): boolean => Array.isArray(values) && values.length > 0
  && values.every(isIdentifier) && new Set(values).size === values.length;

export function isCapabilityRequestValid(r: CapabilityRequest): boolean {
  if (!r || typeof r !== 'object') return false;
  switch (r.kind) {
    case 'text': return validGeneration(r);
    case 'tool-json': return validGeneration(r) && strings(r.features)
      && r.features.every(v => structured.includes(v)) && isIdentifier(r.schemaDialect)
      && (!r.features.includes('parallel-tool-calls') || r.features.includes('tool-calls'));
    case 'vision-pdf': return validGeneration(r) && strings(r.formats) && r.formats.every(v => vision.includes(v))
      && isCount(r.imageCount) && isCount(r.pdfPages) && r.imageCount + r.pdfPages > 0
      && (r.pdfPages === 0 || r.formats.includes('application/pdf'))
      && (r.imageCount === 0 || r.formats.some(v => v !== 'application/pdf'));
    case 'voice-session': return isIdentifier(r.inputFormat) && isIdentifier(r.outputFormat)
      && flag(r.bidirectional) && flag(r.interruption) && isPositiveCount(r.maxDurationMs);
    case 'embedding': return isPositiveCount(r.inputTokens) && isPositiveCount(r.dimensions) && isIdentifier(r.vectorSpaceId);
    case 'grounding-search': return isPositiveCount(r.queries) && isPositiveCount(r.maxResults)
      && flag(r.citations) && flag(r.domainFiltering);
    default: return false;
  }
}
function validGeneration(r: { inputTokens: number; outputTokens: number; streaming: boolean; systemPrompt: boolean }): boolean {
  return isPositiveCount(r.inputTokens) && isPositiveCount(r.outputTokens)
    && isCount(r.inputTokens + r.outputTokens) && flag(r.streaming) && flag(r.systemPrompt);
}
function generationFits(r: { inputTokens: number; outputTokens: number; streaming: boolean; systemPrompt: boolean },
  s: { maxInputTokens: number; maxOutputTokens: number; maxContextTokens: number; streaming: boolean; systemPrompt: boolean }): boolean {
  return [s.maxInputTokens, s.maxOutputTokens, s.maxContextTokens].every(isPositiveCount)
    && flag(s.streaming) && flag(s.systemPrompt) && r.inputTokens <= s.maxInputTokens
    && r.outputTokens <= s.maxOutputTokens && r.inputTokens + r.outputTokens <= s.maxContextTokens
    && (!r.streaming || s.streaming) && (!r.systemPrompt || s.systemPrompt);
}
/** Exact adapter family matching: text support never implies tools, vision, audio or vectors. */
export function supportsCapability(r: CapabilityRequest, s: CapabilitySupport): boolean {
  if (!isCapabilityRequestValid(r) || !s || r.kind !== s.kind) return false;
  switch (r.kind) {
    case 'text': return s.kind === 'text' && generationFits(r, s);
    case 'tool-json': return s.kind === 'tool-json' && generationFits(r, s)
      && strings(s.features) && s.features.every(v => structured.includes(v))
      && strings(s.schemaDialects) && s.schemaDialects.includes(r.schemaDialect)
      && r.features.every(f => s.features.includes(f));
    case 'vision-pdf': return s.kind === 'vision-pdf' && generationFits(r, s)
      && strings(s.formats) && s.formats.every(v => vision.includes(v))
      && isCount(s.maxImages) && isCount(s.maxPdfPages) && r.imageCount <= s.maxImages && r.pdfPages <= s.maxPdfPages
      && r.formats.every(f => s.formats.includes(f));
    case 'voice-session': return s.kind === 'voice-session' && strings(s.inputFormats) && strings(s.outputFormats)
      && s.inputFormats.includes(r.inputFormat) && s.outputFormats.includes(r.outputFormat)
      && isPositiveCount(s.maxDurationMs) && r.maxDurationMs <= s.maxDurationMs
      && flag(s.bidirectional) && flag(s.interruption) && (!r.bidirectional || s.bidirectional) && (!r.interruption || s.interruption);
    case 'embedding': return s.kind === 'embedding' && isPositiveCount(s.maxInputTokens) && r.inputTokens <= s.maxInputTokens
      && r.dimensions === s.dimensions && r.vectorSpaceId === s.vectorSpaceId;
    case 'grounding-search': return s.kind === 'grounding-search' && isPositiveCount(s.maxQueries)
      && isPositiveCount(s.maxResults) && r.queries <= s.maxQueries && r.maxResults <= s.maxResults
      && flag(s.citations) && flag(s.domainFiltering) && (!r.citations || s.citations) && (!r.domainFiltering || s.domainFiltering);
    default: return false;
  }
}
